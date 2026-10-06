/* =============================================================================
   Telemetry bar — the top-bar chip cluster: a live SAST clock, a live Durban
   weather chip (click for a mini forecast across the region), and an
   "Agent Active" status badge (click -> Autonomous Core). Mounted once into
   the shell (js__ui__shell.js imports and calls telemetryBar()); it manages
   its own timers for the rest of the session.
   ========================================================================== */

import { h, onOutside } from './dom.js';
import { icon } from './icons.js';
import { db } from '../core/db.js';
import { bus } from '../core/bus.js';
import { nowSA } from '../core/dates.js';
import { relative } from '../core/format.js';
import { DEPOT } from '../core/geo.js';
import { assessDay, weatherCodeLabel } from '../core/weather.js';

const KEY_SUBURBS = ['Mount Edgecombe', 'Umhlanga', 'Ballito', 'Westville', 'Pinetown'];
const pad = n => String(n).padStart(2, '0');

function clockChip() {
  const el = h('span.chip', { style: 'height:auto;padding:4px 10px;font-variant-numeric:tabular-nums;cursor:default', 'data-tip': 'South African time (SAST)' }, icon('clock', 14));
  const text = h('b', '--:--:--');
  el.appendChild(text);
  const tick = () => { const d = nowSA(); text.textContent = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; };
  tick();
  setInterval(tick, 1000);
  return el;
}

// Agent settings live behind a dynamic import (adapters.js pulls in the pure
// agent modules) so the always-on telemetry chip never blocks first paint.
let cachedJobsEnabled = null;
import('../agent/adapters.js').then(m => { cachedJobsEnabled = m.agentSettings().jobsEnabled; }).catch(() => {});
db.on('settings', async () => { try { const m = await import('../agent/adapters.js'); cachedJobsEnabled = m.agentSettings().jobsEnabled; } catch { /* ignore */ } });

function agentStatus() {
  let cloudRun = null, anyRun = null;   // newest finished run (and newest cloud run), one pass
  for (const r of db.all('agent_runs')) {
    if (!r.status || r.status === 'running') continue;
    const at = String(r.started_at || '');
    if (!anyRun || at > String(anyRun.started_at || '')) anyRun = r;
    if (r.runner === 'cloud' && (!cloudRun || at > String(cloudRun.started_at || ''))) cloudRun = r;
  }
  const allOff = cachedJobsEnabled && Object.keys(cachedJobsEnabled).length && Object.values(cachedJobsEnabled).every(v => v === false);
  if (allOff) return { state: 'paused', label: 'Agent paused', last: null };
  if (cloudRun) return { state: 'cloud', label: 'Cloud agent active', last: cloudRun.started_at };
  return { state: 'local', label: 'Local agent', last: anyRun ? anyRun.started_at : null };
}

function agentChip() {
  const dot = h('span.live-dot');
  const label = h('b', 'Agent');
  const sub = h('span.xs.muted');
  const el = h('a.chip', { href: '#/agent', style: 'height:auto;padding:4px 10px 4px 8px;text-decoration:none', 'data-tip': 'Open the Autonomous Core' }, dot, h('span.stack.tight', { style: 'gap:0' }, label, sub));
  const draw = () => {
    const s = agentStatus();
    dot.className = `live-dot${s.state === 'paused' ? ' warn' : ''}`;
    dot.style.background = s.state === 'paused' ? '' : s.state === 'cloud' ? 'var(--success)' : 'var(--sun-500, #f2b42f)';
    label.textContent = s.label;
    sub.textContent = s.last ? relative(s.last) : s.state === 'paused' ? 'no jobs enabled' : 'not run yet';
  };
  draw();
  db.on('agent_runs', draw);
  bus.on('agent:ran', draw);
  setInterval(draw, 60000);
  return el;
}

function weatherChip() {
  const iconSlot = h('span', { style: 'display:inline-flex;animation:spin 1s linear infinite' }, icon('loader', 14));
  const label = h('b', '—');
  const el = h('button.chip', { type: 'button', style: 'height:auto;padding:4px 10px', 'data-tip': 'Durban weather — click for the regional forecast' }, iconSlot, label);
  let last = null;
  const load = async () => {
    try {
      const today = nowSA().toISOString().slice(0, 10);
      const a = await assessDay(DEPOT.lat, DEPOT.lng, today);
      last = a;
      const { icon: iconName } = weatherCodeLabel(a.risk === 'storm' ? 95 : a.risk === 'wet' ? 63 : a.risk === 'showers' ? 51 : 0);
      iconSlot.style.animation = '';
      iconSlot.replaceChildren(icon(iconName, 14));
      label.textContent = `${a.rainProbMax}%${a.rainMm ? ` · ${a.rainMm}mm` : ''}`;
    } catch { iconSlot.style.animation = ''; iconSlot.replaceChildren(icon('cloud-off', 14)); label.textContent = 'Offline'; }
  };
  load();
  setInterval(load, 30 * 60 * 1000);
  el.addEventListener('click', () => openWeatherPopover(el));
  return el;
}

let popoverEl = null;
function openWeatherPopover(anchor) {
  if (popoverEl) { popoverEl.remove(); popoverEl = null; return; }
  const body = h('div.stack.tight', h('div.small.muted', 'Loading forecast…'));
  popoverEl = h('div.menu', { style: 'padding:12px;min-width:240px' }, h('div.row', { style: 'margin-bottom:8px' }, icon('cloud-sun', 16), h('b', 'Regional forecast')), body);
  document.body.appendChild(popoverEl);
  const r = anchor.getBoundingClientRect();
  popoverEl.style.left = Math.max(8, Math.min(r.left, innerWidth - 260)) + 'px';
  popoverEl.style.top = r.bottom + 6 + 'px';
  const off = onOutside(popoverEl, () => { popoverEl && popoverEl.remove(); popoverEl = null; off(); });
  (async () => {
    const today = nowSA().toISOString().slice(0, 10);
    const { SUBURBS } = await import('../core/geo.js');
    const rows = [];
    for (const name of KEY_SUBURBS) {
      const pt = SUBURBS[name]; if (!pt) continue;
      try { const a = await assessDay(pt.lat, pt.lng, today); rows.push({ name, a }); } catch { rows.push({ name, a: null }); }
    }
    if (!popoverEl) return;
    body.replaceChildren(...rows.map(({ name, a }) => h('div.row', { style: 'justify-content:space-between;gap:12px;padding:4px 0' },
      h('span', name), a ? h('span.row.gap-4', h('b', `${a.rainProbMax}%`), h('span.xs.muted', a.summary || a.risk)) : h('span.xs.muted', 'unavailable'))));
  })();
}

/** The compact chip cluster mounted into the top bar. */
export function telemetryBar() {
  return h('div.row.gap-6', { style: 'align-items:center' }, clockChip(), weatherChip(), agentChip());
}
