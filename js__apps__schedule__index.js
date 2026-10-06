/* =============================================================================
   Live Dispatch (#/schedule) — the day's crews and visits on one board (drag a
   visit to another crew), the week, the route map, printable run-sheets, visit
   field mode for crews on their phones (check-in/out, checklist, photos, client
   sign-off, "on our way" WhatsApp), generating visits from maintenance contracts,
   and planning a day with the Autonomous Core (weather-aware).
   ========================================================================== */

import { h, ensureStyle } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { btn, badge, card, pageHeader, kpiTile, emptyState, listItem, callout, seg, statusBadge, kv } from '../../ui/components.js';
import { modal, toast, showError, confirm, prompt } from '../../ui/overlays.js';
import { entityListPage, entityDetailPage, recordLink } from '../../ui/entity.js';
import { fieldInput, openRecordForm } from '../../ui/form.js';
import { celebrate } from '../../ui/animate.js';
import { db } from '../../core/db.js';
import { can, canApp } from '../../core/perms.js';
import { store } from '../../core/bus.js';
import { today, addDays, startOfWeek } from '../../core/dates.js';
import { holidayOn, isPublicHoliday } from '../../core/holidays.js';
import { uploadFiles, fileUrl } from '../../core/files.js';
import * as fmt from '../../core/format.js';
import { waLink } from '../_biz.js';
import { generateVisits, orderRun, crewLoad, minutesBetween, weekday } from './logic.js';
import { ensureLib } from '../../core/lazy.js';

ensureStyle('lsi-dispatch', `
.board{display:grid;grid-auto-flow:column;grid-auto-columns:minmax(270px,1fr);gap:12px;overflow-x:auto;padding-bottom:8px}
.crew-col{background:var(--surface-2);border-radius:18px;padding:10px;min-height:220px;display:flex;flex-direction:column;gap:8px;transition:outline .15s}
.crew-col.over{outline:2px dashed var(--primary);background:var(--primary-soft)}
.crew-head{display:flex;align-items:center;gap:8px;padding:2px 4px 6px}
.crew-head .sw{width:12px;height:12px;border-radius:4px;flex:none}
.vcard{background:var(--surface-solid);border:1px solid var(--border);border-left:4px solid var(--vc,#1f7440);border-radius:14px;padding:9px 11px;cursor:grab;box-shadow:var(--shadow-sm)}
.vcard:hover{box-shadow:var(--shadow-md)}.vcard.done{opacity:.65}.vcard .t{font-weight:650}.vcard .s{font-size:var(--fs-xs);color:var(--muted);margin-top:2px}
.wx-strip{display:flex;gap:8px;overflow-x:auto;margin-bottom:12px}.wx{display:flex;align-items:center;gap:6px;padding:6px 12px;border-radius:999px;background:var(--surface);border:1px solid var(--border);font-size:.82rem;white-space:nowrap}
.week{display:grid;grid-template-columns:140px repeat(6,minmax(110px,1fr));gap:6px;overflow-x:auto}
.week .c{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:8px;font-size:.82rem;min-height:56px}
.week .hd{font-weight:700;background:transparent;border:0}
.field-actions{display:grid;grid-template-columns:1fr 1fr;gap:10px}.field-actions .btn{min-height:52px;font-size:1rem}
.thumbs{display:flex;gap:8px;flex-wrap:wrap}.thumbs img{width:88px;height:88px;object-fit:cover;border-radius:12px}
#dispatch-map{height:460px;border-radius:18px;overflow:hidden}
@media print{.page-header .page-actions,.no-print{display:none!important}.runsheet{page-break-after:always}}
`);

const TEAMLESS = '__none';
const crewColor = c => (c && c.color) || '#6b7a70';
const clientFor = v => (v.client_id ? db.get('clients', v.client_id) : null);
const siteFor = v => (v.site_id ? db.get('sites', v.site_id) : null);
const shiftDate = (d, n) => addDays(d, n);

function banner(date) {
  const hol = holidayOn(date).filter(h2 => h2.type === 'public');
  const wd = weekday(date);
  if (hol.length) return callout('warning', `Public holiday: ${hol.map(x => x.name).join(', ')}`, 'No maintenance rounds are planned today — the dispatcher moves them to the next working day.', 'party-popper');
  if (wd === 'Sun') return callout('info', 'Sunday', 'No scheduled rounds on Sundays.', 'sun');
  return null;
}

function weatherStrip(visits) {
  const el = h('div.wx-strip');
  const subs = [...new Set(visits.map(v => { const s = siteFor(v), c = clientFor(v); return (s && (s.suburb || s.estate)) || (c && c.suburb) || null; }).filter(Boolean))].slice(0, 8);
  if (!subs.length) return el;
  el.appendChild(h('span.wx', icon('cloud-sun', 14), 'Loading forecast…'));
  Promise.all([import('../../core/weather.js'), import('../../core/geo.js')]).then(async ([W, G]) => {
    const chips = [];
    for (const s of subs) {
      const loc = G.resolveLocation(s); if (!loc) continue;
      try { const a = await W.assessDay(loc.lat, loc.lng, visits[0].date); chips.push(h('span.wx', icon(a.risk === 'dry' ? 'sun' : a.risk === 'storm' ? 'cloud-lightning' : a.risk === 'windy' ? 'wind' : 'cloud-rain', 14), h('strong', loc.name), ` ${a.risk}${a.rainProbMax != null ? ` · ${a.rainProbMax}% rain` : ''}`)); } catch { /* offline */ }
    }
    el.replaceChildren(...(chips.length ? chips : [h('span.wx', icon('cloud-off', 14), 'Forecast unavailable (offline)')]));
  }).catch(() => el.replaceChildren(h('span.wx', icon('cloud-off', 14), 'Forecast unavailable')));
  return el;
}

/* ---------------- day board ---------------- */
function dayBoard(ctx, date) {
  const visits = db.filter('visits', v => v.date === date && v.status !== 'cancelled');
  const crews = db.filter('crews', c => c.active !== false).sort((a, b) => String(a.name).localeCompare(String(b.name)));
  const cols = [...crews.map(c => ({ crew: c, list: orderRun(visits.filter(v => v.crew_id === c.id)) })), { crew: null, list: orderRun(visits.filter(v => !v.crew_id || !crews.some(c => c.id === v.crew_id))) }];
  const move = async (id, crewId) => {
    const v = db.get('visits', id); if (!v || (v.crew_id || TEAMLESS) === crewId) return;
    const crew = crewId === TEAMLESS ? null : db.get('crews', crewId);
    const names = crew ? (crew.members || []).map(m => (db.get('employees', m) || {}).known_as).filter(Boolean).join(' · ') : null;
    try { await db.update('visits', id, { crew_id: crew ? crew.id : null, crew_names: names || v.crew_names }); toast.success(crew ? `Moved to ${crew.name}` : 'Unassigned'); } catch (e) { showError(e); }
  };
  return h('div',
    banner(date), weatherStrip(visits),
    visits.length ? h('div.board', cols.map(({ crew, list }) => {
      const load = crewLoad(list, crew || {});
      const col = h('div.crew-col', {
        onDragover: e => { e.preventDefault(); col.classList.add('over'); }, onDragleave: () => col.classList.remove('over'),
        onDrop: e => { e.preventDefault(); col.classList.remove('over'); move(e.dataTransfer.getData('text/visit'), crew ? crew.id : TEAMLESS); }
      },
      h('div.crew-head', h('span.sw', { style: { background: crewColor(crew) } }), h('strong', crew ? crew.name : 'Unassigned'), h('span.spacer'), badge(`${list.length}`, load.over ? 'red' : 'gray')),
      crew ? h('div.small.muted', { style: 'padding:0 4px 4px' }, `${load.planned} planned min (${load.pct}% of a day)${crew.leader_id ? ` · leader ${(db.get('employees', crew.leader_id) || {}).known_as || ''}` : ' · no driver set'}`) : null,
      ...list.map(v => h('div', { class: ['vcard', v.status === 'completed' ? 'done' : ''], style: { '--vc': crewColor(crew) }, draggable: can('write', 'visits') ? 'true' : 'false',
        onDragstart: e => e.dataTransfer.setData('text/visit', v.id), onClick: () => ctx.navigate(`schedule/visit/${encodeURIComponent(v.id)}`) },
        h('div.row.gap-8', h('span.t', v.site_name), h('span.spacer'), statusBadge(v.status)),
        h('div.s', [v.client_name, v.start_time && `from ${v.start_time}`, v.finish_by && `finish by ${v.finish_by}`].filter(Boolean).join(' · ')),
        v.instructions ? h('div.s', { style: 'color:var(--warning)' }, icon('megaphone', 12), ' ', v.instructions) : null)));
      return col;
    })) : emptyState({ icon: 'calendar-x', title: 'No visits on this day', text: 'Generate the month from the maintenance contracts, or add a visit.', action: can('write', 'visits') ? btn({ label: 'Generate visits', icon: 'wand-sparkles', variant: 'primary', onClick: () => ctx.navigate(`schedule/generate?from=${date}`) }) : null }));
}

/* ---------------- week board ---------------- */
function weekBoard(ctx, date) {
  const mon = startOfWeek(date);
  const days = Array.from({ length: 6 }, (_, i) => addDays(mon, i));
  const crews = [...db.filter('crews', c => c.active !== false), { id: TEAMLESS, name: 'Unassigned' }];
  const cell = (crewId, d) => {
    const vs = db.filter('visits', v => v.date === d && v.status !== 'cancelled' && ((v.crew_id || TEAMLESS) === crewId || (crewId === TEAMLESS && v.crew_id && !db.get('crews', v.crew_id))));
    return h('button.c', { style: 'text-align:left;cursor:pointer', onClick: () => ctx.navigate(`schedule?d=${d}`) }, vs.length ? [h('strong', `${vs.length} visit${vs.length === 1 ? '' : 's'}`), h('div.small.muted', `${vs.filter(v => v.status === 'completed').length} done`)] : h('span.faint', '—'));
  };
  return h('div.week', h('div.c.hd', ''), ...days.map(d => h('div.c.hd', `${weekday(d)} ${d.slice(8)}`, isPublicHoliday(d) ? h('div', badge('Holiday', 'red')) : null)),
    ...crews.flatMap(c => [h('div.c.hd', c.name), ...days.map(d => cell(c.id, d))]));
}

/* ---------------- map ---------------- */
function mapView(ctx, date) {
  const box = h('div#dispatch-map');
  const note = h('p.small.muted');
  requestAnimationFrame(async () => {
    try { await ensureLib('leaflet'); } catch { box.replaceChildren(emptyState({ icon: 'map', title: 'The map could not load', text: 'Check your connection and try again.' })); return; }
    if (!box.isConnected) return; // the user moved on while the map was loading
    const G = await import('../../core/geo.js');
    const map = window.L.map(box).setView([G.DEPOT.lat, G.DEPOT.lng], 11);
    window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap' }).addTo(map);
    window.L.marker([G.DEPOT.lat, G.DEPOT.lng]).addTo(map).bindPopup('Depot — Kingfisher Office Park');
    let missing = 0;
    for (const c of [...db.filter('crews', x => x.active !== false), null]) {
      const vs = orderRun(db.filter('visits', v => v.date === date && v.status !== 'cancelled' && (c ? v.crew_id === c.id : !v.crew_id)));
      const pts = vs.map(v => { const s = siteFor(v), cl = clientFor(v); const loc = G.resolveLocation([s && s.name, s && s.suburb, s && s.address, cl && cl.suburb, v.site_name].filter(Boolean).join(' ')); if (!loc) missing++; return loc ? { ...loc, v } : null; }).filter(Boolean);
      if (!pts.length) continue;
      const route = G.optimiseRoute(G.DEPOT, pts); // nearest-neighbour + 2-opt: returns the points in driving order
      const ordered = Array.isArray(route) && route.length ? route : pts;
      window.L.polyline([[G.DEPOT.lat, G.DEPOT.lng], ...ordered.map(p => [p.lat, p.lng])], { color: crewColor(c), weight: 4, opacity: 0.8 }).addTo(map);
      ordered.forEach((p, i) => window.L.circleMarker([p.lat, p.lng], { radius: 8, color: crewColor(c), fillOpacity: 0.9 }).addTo(map).bindPopup(`${i + 1}. ${p.v.site_name}<br>${c ? c.name : 'Unassigned'}`));
    }
    note.textContent = `Locations are approximate (suburb / estate centre).${missing ? ` ${missing} visit(s) could not be placed — add the suburb on the site.` : ''}`;
    ctx.dispose.add(() => map.remove());
  });
  return h('div', box, note);
}

/* ---------------- print ---------------- */
ensureStyle('lsi-runsheet-print', `
#runsheet-print{display:none}
#runsheet-print h2{color:#175a33;margin:0 0 8px}#runsheet-print table{width:100%;border-collapse:collapse;font-size:12px}
#runsheet-print th,#runsheet-print td{border:1px solid #ccc;padding:6px;vertical-align:top;text-align:left}#runsheet-print th{background:#103d24;color:#fff}
@media print{body.printing-runsheets>*:not(#runsheet-print){display:none!important}body.printing-runsheets #runsheet-print{display:block!important}}
`);
/** Printable A4 run-sheet per crew — built with h() (no HTML strings) and printed from this page. */
function printRunSheets(date) {
  const crews = [...db.filter('crews', c => c.active !== false), null];
  const sheets = crews.map(c => {
    const vs = orderRun(db.filter('visits', v => v.date === date && v.status !== 'cancelled' && (c ? v.crew_id === c.id : !v.crew_id)));
    if (!vs.length) return null;
    return h('section.runsheet', h('h2', `${c ? c.name : 'Unassigned'} — ${fmt.date(date, 'full')}`),
      h('table', h('thead', h('tr', ['#', 'Site', 'Client / phone', 'Time', 'Access & notes', 'Done'].map(x => h('th', x)))),
        h('tbody', vs.map((v, i) => { const cl = clientFor(v) || {}; const s = siteFor(v) || {};
          return h('tr', h('td', String(i + 1)), h('td', h('strong', v.site_name), h('br'), s.address || cl.address || ''), h('td', v.client_name || cl.name || '', h('br'), cl.phone || ''),
            h('td', [v.start_time && `from ${v.start_time}`, v.finish_by && `by ${v.finish_by}`].filter(Boolean).join(' ')),
            h('td', [cl.gate_code && `Gate: ${cl.gate_code}`, cl.pets && `Pets: ${cl.pets}`, v.instructions || cl.standing_instructions].filter(Boolean).join(' · ')), h('td', '☐'));
        }))));
  }).filter(Boolean);
  if (!sheets.length) return toast.info('No visits to print for this day');
  document.getElementById('runsheet-print')?.remove();
  document.body.appendChild(h('div#runsheet-print', sheets));
  document.body.classList.add('printing-runsheets');
  const done = () => { document.body.classList.remove('printing-runsheets'); document.getElementById('runsheet-print')?.remove(); window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  setTimeout(() => window.print(), 50);
}

/* ---------------- main page ---------------- */
function main(ctx) {
  let date = ctx.query.d || today();
  let view = ctx.query.view || 'day';
  const body = h('div');
  const dateLabel = h('strong');
  const draw = () => {
    dateLabel.textContent = view === 'week' ? `Week of ${fmt.date(startOfWeek(date), 'long')}` : fmt.date(date, 'full');
    body.replaceChildren(h('div.anim-fade', view === 'week' ? weekBoard(ctx, date) : view === 'map' ? mapView(ctx, date) : dayBoard(ctx, date)));
  };
  const go = n => { date = shiftDate(date, view === 'week' ? 7 * n : n); draw(); };
  ctx.dispose.add(db.on('visits', () => view !== 'map' && draw()));
  ctx.dispose.add(db.on('crews', draw));
  const todays = db.filter('visits', v => v.date === today());
  draw();
  return h('div',
    pageHeader({ title: 'Live Dispatch', sub: 'Crews, visits and routes — drag a visit to move it to another crew.', icon: 'route', tile: 't-river',
      actions: [
        canApp('agent') ? btn({ label: 'Plan with the agent', icon: 'bot', onClick: async e => { try { const { runNow } = await import('../../agent/runner.js'); const r = await runNow('morning_dispatch', { date, force: true }); toast.success('Dispatch planned', { text: r && r.run ? r.run.summary : 'See Autonomous Core for decisions' }); } catch (err) { showError(err, 'Planning failed'); } } }) : null,
        btn({ label: 'Print run-sheets', icon: 'printer', variant: 'ghost', onClick: () => printRunSheets(date) }),
        can('write', 'visits') ? btn({ label: 'Generate visits', icon: 'wand-sparkles', variant: 'ghost', onClick: () => ctx.navigate(`schedule/generate?from=${date}`) }) : null,
        can('write', 'visits') ? btn({ label: 'New visit', icon: 'plus', variant: 'primary', onClick: () => openRecordForm('visits', { values: { date, status: 'scheduled', kind: 'maintenance' } }) }) : null] }),
    h('div.grid.cols-4.stagger', { style: 'margin-bottom:14px' },
      kpiTile({ label: 'Visits today', value: todays.length, icon: 'map-pin', tile: 't-river' }),
      kpiTile({ label: 'Completed', value: todays.filter(v => v.status === 'completed').length, icon: 'circle-check', tile: 't-grass' }),
      kpiTile({ label: 'In progress', value: todays.filter(v => v.status === 'in_progress').length, icon: 'loader', tile: 't-sun' }),
      kpiTile({ label: 'Unassigned', value: todays.filter(v => !v.crew_id).length, icon: 'user-x', tile: 't-rose' })),
    h('div.row.wrap.gap-8.no-print', { style: 'margin-bottom:12px;align-items:center' },
      btn({ icon: 'chevron-left', variant: 'ghost', size: 'sm', title: 'Previous', onClick: () => go(-1) }), btn({ label: 'Today', size: 'sm', onClick: () => { date = today(); draw(); } }), btn({ icon: 'chevron-right', variant: 'ghost', size: 'sm', title: 'Next', onClick: () => go(1) }),
      h('input.input', { type: 'date', value: date, style: 'width:auto', onChange: e => { if (e.target.value) { date = e.target.value; draw(); } } }), dateLabel, h('span.spacer'),
      seg([{ id: 'day', label: 'Day', icon: 'columns-3' }, { id: 'week', label: 'Week', icon: 'calendar-range' }, { id: 'map', label: 'Map', icon: 'map' }], view, id => { view = id; draw(); }),
      h('a.btn.btn-ghost.btn-sm', { href: '#/schedule/crews' }, icon('users-round', 15), 'Crews')),
    body);
}

/* ---------------- visit field mode ---------------- */
const CHECKS = [['gate', 'Gate closed & property secured'], ['clippings', 'Clippings and rubbish removed'], ['edges', 'Edges and paths neat'], ['hazards', 'Hazards noted / reported'], ['client', 'Client instructions followed']];
function visitPage(ctx) {
  const id = decodeURIComponent(ctx.params.id);
  const root = h('div');
  const draw = () => {
    const v = db.get('visits', id);
    if (!v) { root.replaceChildren(emptyState({ icon: 'search-x', title: 'Visit not found' })); return; }
    const cl = clientFor(v) || {}, s = siteFor(v) || {}, crew = v.crew_id ? db.get('crews', v.crew_id) : null;
    const w = can('write', 'visits');
    const phone = cl.phone || cl.phone_alt;
    const upd = async (patch, msg) => { try { await db.update('visits', id, patch); if (msg) toast.success(msg); } catch (e) { showError(e); } };
    const geo = () => new Promise(res => { if (!navigator.geolocation) return res(null); navigator.geolocation.getCurrentPosition(p => res({ lat: p.coords.latitude, lng: p.coords.longitude, acc: Math.round(p.coords.accuracy), at: new Date().toISOString() }), () => res(null), { timeout: 8000, maximumAge: 60000 }); });
    const photos = (key, label) => {
      const ids = Array.isArray(v[key]) ? v[key] : [];
      const box = h('div.thumbs');
      ids.forEach(fid => { const f = db.get('files', fid); if (f) fileUrl(f).then(u => u && box.appendChild(h('img', { src: u, alt: label }))).catch(() => {}); });
      const input = h('input', { type: 'file', accept: 'image/*', capture: 'environment', multiple: true, style: 'display:none', onChange: async e => {
        try { const recs = await uploadFiles(e.target.files, { drive_id: 'drive-operations', linked: [{ collection: 'visits', id }, ...(v.client_id ? [{ collection: 'clients', id: v.client_id }] : [])] }); await upd({ [key]: [...ids, ...recs.map(r => r.id)] }, `${recs.length} photo${recs.length === 1 ? '' : 's'} added`); } catch (err) { showError(err, 'Upload failed'); }
      } });
      return h('div.stack.tight', h('div.row', h('strong', label), h('span.spacer'), w ? btn({ label: 'Add photo', icon: 'camera', size: 'sm', onClick: () => input.click() }) : null, input), ids.length ? box : h('span.small.muted', 'No photos yet'));
    };
    const checks = v.site_check && typeof v.site_check === 'object' ? v.site_check : {};
    root.replaceChildren(
      pageHeader({ title: v.site_name, sub: `${fmt.date(v.date, 'full')}${crew ? ' · ' + crew.name : ''}`, icon: 'map-pin', tile: 't-river', crumbs: [{ label: 'Live Dispatch', href: `#/schedule?d=${v.date}` }, { label: v.site_name }],
        actions: [statusBadge(v.status), phone ? h('a.btn', { href: `tel:${phone}` }, icon('phone', 16), 'Call') : null] }),
      (v.instructions || cl.standing_instructions) ? callout('warning', 'Instructions', v.instructions || cl.standing_instructions, 'megaphone') : null,
      card({ title: 'Site access', icon: 'key-round', cls: 'solid' }, kv([['Client', v.client_name || cl.name], ['Address', [s.address || cl.address, s.suburb || cl.suburb].filter(Boolean).join(', ')], ['Gate code', cl.gate_code || s.gate_code], ['Guardhouse', cl.guardhouse], ['Pets', cl.pets || s.pets], ['Irrigation', cl.irrigation], ['Outlets / water', cl.power_water], ['Times', [v.start_time && `start ${v.start_time}`, v.finish_by && `finish by ${v.finish_by}`].filter(Boolean).join(' · ')]])),
      w ? card({ title: 'On site', icon: 'hand', cls: 'solid' },
        h('div.field-actions',
          phone ? h('a.btn', { href: waLink(phone, `Good day ${String(cl.contact_name || cl.name || '').split(' ')[0]}, the Landscapers Inc team is on the way to ${v.site_name}.`), target: '_blank', rel: 'noopener', onClick: () => db.insert('outbox', { channel: 'whatsapp', to: phone, to_name: cl.name, body: 'On our way', status: 'sent', sent_at: new Date().toISOString(), related_collection: 'visits', related_id: id }).catch(() => {}) }, icon('navigation', 18), 'On our way') : h('span'),
          v.status !== 'in_progress' && v.status !== 'completed' ? btn({ label: 'Check in', icon: 'log-in', variant: 'primary', onClick: async () => upd({ status: 'in_progress', check_in_at: new Date().toISOString(), geo: { check_in: await geo() } }, 'Checked in') }) : h('span'),
          v.status === 'in_progress' ? btn({ label: 'Check out', icon: 'log-out', variant: 'primary', onClick: async () => { const out = new Date().toISOString(); await upd({ status: 'completed', check_out_at: out, actual_minutes: minutesBetween(v.check_in_at, out), geo: { ...(v.geo || {}), check_out: await geo() } }, 'Visit completed'); celebrate({ confetti: false }); } }) : h('span'),
          v.status !== 'completed' ? btn({ label: 'Postpone', icon: 'calendar-clock', onClick: async () => {
            const reason = await prompt('Why is this visit being moved?', { title: 'Postpone visit', ok: 'Next step', placeholder: 'e.g. rain, client not home, no access' }); if (reason === null) return;
            const nd = await prompt('Move to which date?', { title: 'New date', type: 'date', value: addDays(v.date, 1) }); if (!nd) return;
            upd({ date: nd, status: 'rescheduled', rescheduled_from: v.date, reschedule_reason: reason }, `Moved to ${nd}`);
          } }) : h('span'),
          v.status !== 'completed' ? btn({ label: 'No access', icon: 'door-closed', variant: 'ghost', onClick: async () => { const r = await prompt('What happened?', { title: 'No access' }); if (r !== null) upd({ status: 'no_access', notes: [v.notes, `No access: ${r}`].filter(Boolean).join('\n') }, 'Recorded'); } }) : h('span'))) : null,
      card({ title: 'Site checklist', icon: 'list-checks', cls: 'solid' }, h('div.stack.tight', CHECKS.map(([k, label]) => h('label.row.gap-8', h('input', { type: 'checkbox', checked: !!checks[k], disabled: !w, onChange: e => upd({ site_check: { ...checks, [k]: e.target.checked } }) }), label)))),
      card({ title: 'Photos', icon: 'camera', cls: 'solid' }, h('div.stack', photos('photos_before', 'Before'), photos('photos_after', 'After'))),
      card({ title: 'Client sign-off & notes', icon: 'signature', cls: 'solid' },
        h('div.stack', fieldInput({ type: 'signature' }, v.client_signature, sig => upd({ client_signature: sig }), { readonly: !w }),
          h('div.field', h('label.field-label', 'Notes'), fieldInput({ type: 'longtext', rows: 3 }, v.notes, x => { v.notes = x; }, { readonly: !w })),
          w ? btn({ label: 'Save notes', icon: 'check', size: 'sm', onClick: () => upd({ notes: v.notes }, 'Saved') }) : null)),
      h('p.small.muted', v.check_in_at ? `Checked in ${fmt.time(v.check_in_at)}${v.check_out_at ? ` · out ${fmt.time(v.check_out_at)} · ${v.actual_minutes} min on site` : ''}` : ''),
      h('a.btn.btn-ghost', { href: recordLink('visits', id) }, icon('list', 15), 'All details, files & history'));
  };
  draw();
  ctx.dispose.add(db.on('visits', e => { if (!e.rec || e.rec.id === id) draw(); }));
  return root;
}

/* ---------------- generate from contracts ---------------- */
function generatePage(ctx) {
  const from0 = ctx.query.from || today();
  const st = { from: from0.slice(0, 8) + '01' >= today() ? from0.slice(0, 8) + '01' : from0, to: addDays(from0.slice(0, 8) + '01', 40).slice(0, 8) + '01' };
  st.to = addDays(st.to, -1);
  const out = h('div');
  const run = () => {
    const res = generateVisits({ contracts: db.all('contracts'), sites: db.all('sites'), clients: db.all('clients'), from: st.from, to: st.to, existing: db.all('visits'), isHoliday: isPublicHoliday });
    out.replaceChildren(
      h('div.grid.cols-3.stagger', { style: 'margin:14px 0' }, kpiTile({ label: 'Visits to create', value: res.create.length, icon: 'calendar-plus', tile: 't-river' }), kpiTile({ label: 'Moved for public holidays', value: res.create.filter(v => v.rescheduled_from).length, icon: 'party-popper', tile: 't-sun' }), kpiTile({ label: 'Contracts needing visit days', value: res.skipped.length, icon: 'circle-help', tile: 't-rose' })),
      res.skipped.length ? card({ title: 'Contracts without visit days', sub: 'Set the visit days on these contracts, then generate again.', icon: 'circle-help', cls: 'solid' }, h('div.list.divider-list', res.skipped.map(s => listItem({ title: s.contract.name, sub: s.reason, icon: 'file-check', tile: 't-slate', href: recordLink('contracts', s.contract.id) })))) : null,
      res.create.length ? card({ title: 'Preview', icon: 'eye', cls: 'solid', actions: [btn({ label: `Create ${res.create.length} visits`, icon: 'check', variant: 'primary', onClick: async () => {
        if (!(await confirm(`Create ${res.create.length} visits from ${st.from} to ${st.to}?`, { ok: 'Create visits' }))) return;
        let n = 0; for (const v of res.create) { try { await db.insert('visits', v); n++; } catch (e) { console.warn(e); } }
        toast.success(`${n} visits created`); ctx.navigate(`schedule?d=${st.from}`);
      } })] }, h('div.list.divider-list', res.create.slice(0, 300).map(v => listItem({ title: `${fmt.date(v.date, 'short')} · ${v.site_name}`, sub: [v.crew_id ? (db.get('crews', v.crew_id) || {}).name : 'no crew', v.reschedule_reason].filter(Boolean).join(' · '), icon: 'map-pin', tile: 't-river' }))))
        : emptyState({ icon: 'check-check', title: 'Nothing to create', text: 'Every contract visit in this range already exists.' }));
  };
  const f = (label, key) => h('div.field', h('label.field-label', label), h('input.input', { type: 'date', value: st[key], onChange: e => { st[key] = e.target.value; run(); } }));
  run();
  return h('div', pageHeader({ title: 'Generate visits from contracts', sub: 'Uses each contract’s visit days and frequency (weekly, fortnightly, 2–3× a week, daily, monthly). Public holidays move to the next working day. Never duplicates.', icon: 'wand-sparkles', tile: 't-river', crumbs: [{ label: 'Live Dispatch', href: '#/schedule' }, { label: 'Generate' }] }),
    card({ cls: 'solid' }, h('div.form-grid', f('From', 'from'), f('To', 'to'))), out);
}

export default {
  id: 'schedule',
  routes: {
    '': main, generate: generatePage, 'visit/:id': visitPage,
    crews: ctx => entityListPage('crews', ctx, { sub: 'Teams, their members, leader/driver, vehicle and daily capacity.' }),
    visits: ctx => entityListPage('visits', ctx, { sub: 'Every visit ever scheduled.' })
  },
  detail: { visits: (id, ctx) => entityDetailPage('visits', id, ctx, { backHref: '#/schedule', backLabel: 'Live Dispatch', actions: v => [h('a.btn.btn-primary', { href: `#/schedule/visit/${encodeURIComponent(v.id)}` }, icon('smartphone', 16), 'Field mode')] }) }
};
void store; void badge;
