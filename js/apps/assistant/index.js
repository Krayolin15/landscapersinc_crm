/* =============================================================================
   Sage AI (#/assistant) — ask anything about the business in plain English.
   Answers are computed from LIVE records by the skills each app registers
   (js/ai/skills.js + js/ai/engine.js) and shown as text, KPI tiles, tables, lists
   and charts with one-click actions. Nothing is invented: every answer names the
   records it used, and when no skill fits Sage searches the records instead.
   Optional cloud mode (Supabase + ai-assistant function) lets Claude word the
   answer from those same facts. Conversations are saved per user.
   ========================================================================== */

import { h, ensureStyle } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { btn, badge, listItem, kpiTile } from '../../ui/components.js';
import { toast, confirm } from '../../ui/overlays.js';
import { chart } from '../../ui/charts.js';
import { openRecordForm } from '../../ui/form.js';
import { db } from '../../core/db.js';
import { store } from '../../core/bus.js';
import { SCHEMA } from '../../core/schema.js';
import { today } from '../../core/dates.js';
import * as fmt from '../../core/format.js';
import { CONFIG, IS_SUPABASE } from '../../config.js';
import { ask, suggestions } from '../../ai/engine.js';
import { allSkills } from '../../ai/skills.js';

ensureStyle('lsi-sage', `
.sage{display:grid;grid-template-columns:250px minmax(0,1fr);gap:16px;height:calc(100vh - 130px);min-height:480px}
@media (max-width:1200px){.sage{grid-template-columns:1fr}.sage .hist{display:none}.sage.show-hist{grid-template-columns:220px minmax(0,1fr)}.sage.show-hist .hist{display:block}}
@media (max-width:700px){.sage{height:auto}.sage.show-hist{grid-template-columns:1fr}}
.sage .kgrid .k-value{font-size:1.3rem;line-height:1.2;word-break:break-word}
.sage .hist{overflow:auto;border:1px solid var(--border);border-radius:18px;background:var(--surface-solid);padding:10px}
.sage .hist button.cv{display:block;width:100%;text-align:left;border:0;background:none;border-radius:12px;padding:8px 10px;cursor:pointer;color:inherit}
.sage .hist button.cv:hover{background:var(--surface-2)}.sage .hist button.cv.on{background:var(--primary-soft);color:var(--primary);font-weight:650}
.sage .sg-main{display:flex;flex-direction:column;min-height:0;border:1px solid var(--border);border-radius:20px;background:var(--surface-solid);overflow:hidden}
.sage .stream{flex:1;overflow:auto;padding:18px 18px 8px;scroll-behavior:smooth}
.sage .welcome{text-align:center;padding:30px 10px}
.sage .orb{width:86px;height:86px;border-radius:50%;margin:0 auto 14px;background:conic-gradient(from 0deg,#1f7a4d,#5ee0c8,#9be15d,#f2b42f,#1f7a4d);animation:orbspin 9s linear infinite;box-shadow:0 12px 40px rgba(31,122,77,.35);position:relative}
.sage .orb::after{content:'';position:absolute;inset:8px;border-radius:50%;background:radial-gradient(circle at 35% 30%,#ffffffcc,#ffffff22 45%,transparent 70%),var(--surface-solid);opacity:.9}
@keyframes orbspin{to{transform:rotate(360deg)}}
.sage .chips{display:flex;flex-wrap:wrap;gap:8px;justify-content:center}
.sage .chip-q{border:1px solid var(--border);background:var(--surface);border-radius:999px;padding:7px 14px;cursor:pointer;font-size:.86rem;transition:transform .15s,border-color .15s}
.sage .chip-q:hover{transform:translateY(-2px);border-color:var(--primary)}
.sage .msg{display:flex;gap:10px;margin:0 0 16px;animation:fadeUp .3s ease}
.sage .msg.me{justify-content:flex-end}
.sage .bubble{max-width:min(760px,92%);border-radius:18px;padding:11px 15px;line-height:1.5}
.sage .msg.me .bubble{background:var(--primary);color:#fff;border-bottom-right-radius:6px;white-space:pre-wrap}
.sage .msg.ai .bubble{background:var(--surface-2);border-bottom-left-radius:6px;min-width:0;flex:1}
.sage .ai-ico{width:32px;height:32px;border-radius:50%;flex:none;background:conic-gradient(from 90deg,#1f7a4d,#5ee0c8,#9be15d,#1f7a4d);display:grid;place-items:center;color:#fff}
.sage .ans{white-space:pre-wrap}
.sage .cards{display:flex;flex-direction:column;gap:10px;margin-top:10px}
.sage .kgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px}
.sage .kgrid .kpi{padding:12px}
.sage .tbl{overflow:auto;border:1px solid var(--border);border-radius:12px;background:var(--surface-solid)}
.sage .tbl table{width:100%;border-collapse:collapse;font-size:.84rem}.sage .tbl th{text-align:left;background:var(--surface-2);padding:7px 10px;font-weight:650;white-space:nowrap}.sage .tbl td{padding:7px 10px;border-top:1px solid var(--border)}
.sage .tbl td.n{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}.sage .tbl tr.go{cursor:pointer}.sage .tbl tr.go:hover td{background:var(--primary-soft)}
.sage .meta{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-top:10px;font-size:.74rem;color:var(--muted)}
.sage .meta button{border:0;background:none;cursor:pointer;color:var(--muted);padding:2px 4px;border-radius:6px}.sage .meta button:hover{color:var(--primary)}.sage .meta button.on{color:var(--primary)}
.sage .acts{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}
.sage .typing span{display:inline-block;width:7px;height:7px;border-radius:50%;background:var(--muted);margin:0 2px;animation:blink 1.2s infinite}.sage .typing span:nth-child(2){animation-delay:.2s}.sage .typing span:nth-child(3){animation-delay:.4s}
@keyframes blink{0%,80%,100%{opacity:.25;transform:translateY(0)}40%{opacity:1;transform:translateY(-3px)}}
.sage .composer{border-top:1px solid var(--border);padding:10px;display:flex;gap:8px;align-items:flex-end;background:var(--surface)}
.sage .composer textarea{flex:1;resize:none;border:1px solid var(--border);border-radius:14px;padding:10px 12px;font:inherit;max-height:160px;background:var(--surface-solid);color:var(--text)}
.sage .mic.on{background:#e0525e;color:#fff;animation:pulse 1.2s infinite}
.sage .cloud{display:flex;align-items:center;gap:6px;font-size:.78rem;color:var(--muted)}
`);

const me = () => store.get('user') || {};
const cloudAvailable = () => IS_SUPABASE() && !!db.client && (db.find('settings', s => s.key === 'ai_assistant') || {}).value?.cloud_enabled !== false;
const cloudKey = () => `lsihq.sage-cloud.${me().id || 'anon'}`;
const cloudOn = () => { try { return cloudAvailable() && localStorage.getItem(cloudKey()) === '1'; } catch { return false; } };

/* ---------------- answers -> plain, storable data ---------------- */
const FMT = { money: v => fmt.money(v), num: v => fmt.num(v, Number.isInteger(Number(v)) ? 0 : 2), pct: v => fmt.pct(v), date: v => fmt.date(v) };
function freeze(ans) {
  const cards = (ans.cards || []).map(c => {
    if (c.type === 'table') {
      const cols = (c.columns || []).map(col => ({ key: col.key, label: col.label, format: typeof col.format === 'string' ? col.format : null, fn: typeof col.format === 'function' ? col.format : null }));
      const rows = (c.rows || []).slice(0, 60).map(r => { const o = {}; cols.forEach(col => { o[col.key] = col.fn ? col.fn(r[col.key], r) : r[col.key]; }); if (typeof c.link === 'function') { try { o._href = c.link(r); } catch { /* */ } } else if (r._href) o._href = r._href; return o; });
      return { type: 'table', title: c.title, columns: cols.map(({ key, label, format }) => ({ key, label, format })), rows, more: (c.rows || []).length > 60 ? (c.rows || []).length - 60 : 0 };
    }
    if (c.type === 'kpis') return { type: 'kpis', items: (c.items || []).map(k => ({ label: k.label, value: typeof k.format === 'function' ? k.format(k.value) : k.value, format: typeof k.format === 'string' ? k.format : null, href: k.href })) };
    if (c.type === 'list') return { type: 'list', items: (c.items || []).slice(0, 40).map(i => ({ title: String(i.title ?? ''), sub: i.sub ? String(i.sub) : '', href: i.href || null, icon: i.icon || null })) };
    if (c.type === 'chart') return { type: 'chart', chart: JSON.parse(JSON.stringify(c.chart || {})) };
    return null;
  }).filter(Boolean);
  return { text: ans.text || '', cards, actions: (ans.actions || []).map(a => ({ label: a.label, href: a.href || null, action: a.action || null, collection: a.collection || null, values: a.values || null })), sources: ans.sources || [], skill: ans.skill || null, skillLabel: ans.skillLabel || null, lowConfidence: !!ans.lowConfidence, alternatives: (ans.alternatives || []).map(x => ({ id: x.id, label: x.label, example: x.example })), fallback: !!ans.fallback, error: !!ans.error };
}
/** The facts sent to the cloud model: only what the local answer already showed this user. */
function factsFor(q, a) {
  const facts = { today: today(), company: 'Landscapers Inc', asked_by_role: me().role || null, answer_from_records: a.text, answered_by: a.skillLabel || a.skill || 'record search', records_used: a.sources, cards: a.cards.map(c => (c.type === 'table' ? { ...c, rows: c.rows.slice(0, 40).map(({ _href, ...r }) => r) } : c.type === 'list' ? { ...c, items: c.items.map(({ href, icon: _i, ...r }) => r) } : c)) };
  let s = JSON.stringify(facts);
  while (s.length > 36000 && facts.cards.some(c => (c.rows || c.items || []).length > 5)) { facts.cards.forEach(c => { if (c.rows) c.rows = c.rows.slice(0, Math.ceil(c.rows.length / 2)); if (c.items) c.items = c.items.slice(0, Math.ceil(c.items.length / 2)); }); s = JSON.stringify(facts); }
  return facts;
}

/* ---------------- rendering ---------------- */
const cell = (v, f) => (v == null || v === '' ? '—' : f && FMT[f] ? FMT[f](v) : typeof v === 'number' ? fmt.num(v, Number.isInteger(v) ? 0 : 2) : String(v));
function renderCard(c, go) {
  if (c.type === 'kpis') return h('div.kgrid', c.items.map(k => kpiTile({ label: k.label, value: typeof k.value === 'number' ? k.value : k.value ?? '—', format: k.format || undefined, href: k.href || undefined })));
  if (c.type === 'table') return h('div.tbl', c.title ? h('div', { style: 'padding:8px 10px;font-weight:650' }, c.title) : null, h('table', h('thead', h('tr', c.columns.map(col => h('th', col.label)))), h('tbody', c.rows.map(r => h('tr', { class: r._href ? 'go' : '', onClick: r._href ? () => go(r._href) : undefined }, c.columns.map(col => h('td', { class: typeof r[col.key] === 'number' || ['money', 'num', 'pct'].includes(col.format) ? 'n' : '' }, cell(r[col.key], col.format))))))), c.more ? h('div.small.muted', { style: 'padding:6px 10px' }, `…and ${c.more} more`) : null);
  if (c.type === 'list') return h('div.list.divider-list', { style: 'background:var(--surface-solid);border-radius:12px;border:1px solid var(--border)' }, c.items.map(i => listItem({ title: i.title, sub: i.sub, icon: i.icon || 'circle-dot', tile: 't-aurora', href: i.href || undefined })));
  if (c.type === 'chart' && c.chart && c.chart.labels) return h('div', { style: 'background:var(--surface-solid);border-radius:12px;border:1px solid var(--border);padding:8px' }, chart({ ...c.chart, height: 220 }));
  return null;
}

/* ---------------- screen ---------------- */
function home(ctx) {
  let conv = null; // current ai_conversations record (null = unsaved new chat)
  let msgs = [];
  let busy = false;
  const stream = h('div.stream');
  const hist = h('div.hist');
  const input = h('textarea', { rows: 1, placeholder: 'Ask about clients, invoices, jobs, crews, weather, money… (Enter to send)', 'aria-label': 'Question' });
  const go = href => { if (href) location.hash = href.startsWith('#') ? href : `#/${href}`; };

  const myConvs = () => db.filter('ai_conversations', c => c.user_id === me().id).sort((a, b) => String(b.updated_at || b.created_at).localeCompare(String(a.updated_at || a.created_at)));
  function drawHist() {
    hist.replaceChildren(btn({ label: 'New chat', icon: 'plus', variant: 'primary', size: 'sm', onClick: () => { conv = null; msgs = []; drawStream(); input.focus(); drawHist(); } }),
      h('div.small.muted', { style: 'margin:12px 6px 4px;font-weight:650;text-transform:uppercase;letter-spacing:.06em;font-size:.68rem' }, 'Recent'),
      ...myConvs().slice(0, 60).map(c => h('div.row', { style: 'align-items:center' }, h('button', { class: ['cv', conv && conv.id === c.id ? 'on' : ''], type: 'button', onClick: () => { conv = c; msgs = JSON.parse(JSON.stringify(c.messages || [])); drawStream(); drawHist(); } }, h('div', { style: 'white-space:nowrap;overflow:hidden;text-overflow:ellipsis' }, c.title || 'Conversation'), h('div.small.muted', fmt.relative(c.updated_at || c.created_at))),
        btn({ icon: 'trash-2', size: 'sm', variant: 'ghost', title: 'Delete conversation', onClick: async () => { if (!(await confirm('Delete this conversation?', { danger: true, ok: 'Delete' }))) return; await db.remove('ai_conversations', c.id); if (conv && conv.id === c.id) { conv = null; msgs = []; drawStream(); } drawHist(); } }))));
  }

  function welcome() {
    const hour = new Date().getHours();
    const sug = suggestions(allSkills(), 8, new Date().getDate());
    return h('div.welcome', h('div.orb'), h('h2', `${hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'}, ${String(me().name || '').split(' ')[0] || 'there'}`),
      h('p.muted', { style: 'max-width:520px;margin:6px auto 18px' }, 'I answer from the company’s live records — invoices, clients, visits, crews, calendar, finance, documents — and show you exactly where each answer came from.'),
      h('div.chips', sug.map(s => h('button.chip-q', { type: 'button', onClick: () => send(s.example) }, s.example))));
  }
  function msgView(m, i) {
    if (m.role === 'user') return h('div.msg.me', h('div.bubble', m.content));
    const a = m;
    const meta = h('div.meta',
      a.skillLabel ? badge(a.skillLabel, 'green') : a.fallback ? badge('Record search', 'gray') : null,
      a.cloud ? badge(`Worded by Claude`, 'violet') : null,
      a.sources && a.sources.length ? h('span', `From: ${a.sources.map(s => (SCHEMA[s] && SCHEMA[s].label) || s).join(', ')}`) : null,
      h('span.spacer'),
      h('button', { type: 'button', title: 'Helpful', class: a.feedback === 1 ? 'on' : '', onClick: () => rate(i, 1) }, icon('thumbs-up', 14)),
      h('button', { type: 'button', title: 'Not helpful', class: a.feedback === -1 ? 'on' : '', onClick: () => rate(i, -1) }, icon('thumbs-down', 14)),
      h('button', { type: 'button', title: 'Copy answer', onClick: () => navigator.clipboard && navigator.clipboard.writeText(a.content).then(() => toast.success('Copied')) }, icon('copy', 14)));
    return h('div.msg.ai', h('div.ai-ico', icon('sparkles', 16)), h('div.bubble',
      h('div.ans', a.content),
      a.cloudNote ? h('div.small.muted', { style: 'margin-top:6px' }, a.cloudNote) : null,
      a.cards && a.cards.length ? h('div.cards', a.cards.map(c => renderCard(c, go))) : null,
      a.lowConfidence || (a.alternatives && a.alternatives.length && (a.fallback || a.error)) ? h('div', { style: 'margin-top:10px' }, h('div.small.muted', a.lowConfidence ? 'Not quite right? Try:' : 'You could ask:'), h('div.chips', { style: 'justify-content:flex-start;margin-top:6px' }, a.alternatives.filter(x => x.example).map(x => h('button.chip-q', { type: 'button', onClick: () => send(x.example) }, x.example)))) : null,
      a.actions && a.actions.length ? h('div.acts', a.actions.map(ac => btn({ label: ac.label, size: 'sm', variant: 'ghost', icon: ac.action === 'create' ? 'plus' : 'arrow-right', onClick: () => (ac.action === 'create' && ac.collection ? openRecordForm(ac.collection, { values: ac.values || {} }) : go(ac.href)) }))) : null,
      meta));
  }
  function drawStream(typing = false) {
    stream.replaceChildren(...(msgs.length ? msgs.map(msgView) : [welcome()]), ...(typing ? [h('div.msg.ai', h('div.ai-ico', icon('sparkles', 16)), h('div.bubble', h('div.typing', h('span'), h('span'), h('span'))))] : []));
    stream.scrollTop = stream.scrollHeight;
  }
  async function persist() {
    try {
      const title = (msgs.find(m => m.role === 'user') || {}).content || 'Conversation';
      if (conv) conv = await db.update('ai_conversations', conv.id, { messages: msgs, title: fmt.truncate(title, 70) });
      else conv = await db.insert('ai_conversations', { title: fmt.truncate(title, 70), messages: msgs, user_id: me().id });
      drawHist();
    } catch (e) { console.warn('Sage: could not save conversation', e); }
  }
  function rate(i, v) { msgs[i].feedback = msgs[i].feedback === v ? 0 : v; drawStream(); persist(); }

  async function send(text) {
    const q = String(text ?? input.value).trim();
    if (!q || busy) return;
    busy = true; input.value = ''; autosize();
    msgs.push({ role: 'user', content: q, at: new Date().toISOString() });
    drawStream(true);
    let a;
    try { a = freeze(await ask(q)); } catch (e) { a = freeze({ text: `Something went wrong while answering: ${e.message}`, error: true }); }
    const m = { role: 'assistant', content: a.text, at: new Date().toISOString(), ...a };
    delete m.text;
    if (cloudOn() && !a.error) {
      try {
        const history = msgs.slice(0, -1).slice(-6).map(x => ({ role: x.role, content: x.content }));
        const { data, error } = await db.client.functions.invoke(CONFIG.functions.assistant, { body: { question: q, facts: factsFor(q, a), history } });
        if (error) throw error;
        if (data && data.error) throw new Error(data.error);
        if (data && data.text) { m.localText = m.content; m.content = data.text; m.cloud = true; m.model = data.model; if (data.truncated) m.cloudNote = 'The answer was cut short.'; }
      } catch (e) { m.cloudNote = `Cloud AI unavailable (${e.message || e}) — showing the answer from the records.`; }
    }
    msgs.push(m);
    busy = false;
    drawStream();
    persist();
  }

  /* composer */
  const autosize = () => { input.style.height = 'auto'; input.style.height = `${Math.min(160, input.scrollHeight)}px`; };
  input.addEventListener('input', autosize);
  input.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } });
  const Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
  let rec = null;
  const mic = Rec ? btn({ icon: 'mic', variant: 'ghost', title: 'Ask by voice', onClick: () => {
    if (rec) { rec.stop(); return; }
    rec = new Rec(); rec.lang = 'en-ZA'; rec.interimResults = true;
    mic.classList.add('mic', 'on');
    rec.onresult = e => { input.value = Array.from(e.results).map(r => r[0].transcript).join(' '); autosize(); if (e.results[e.results.length - 1].isFinal) { rec.stop(); send(); } };
    rec.onend = () => { mic.classList.remove('on'); rec = null; };
    rec.onerror = () => { mic.classList.remove('on'); rec = null; toast.error('Voice input is not available right now'); };
    rec.start();
  } }) : null;
  ctx.dispose.add(() => { if (rec) rec.abort(); });
  const cloudToggle = cloudAvailable() ? h('label.cloud', { title: 'When on, the figures for each question are sent to Anthropic’s Claude to word the answer. Off: everything stays in your browser and database.' },
    h('input', { type: 'checkbox', checked: cloudOn(), onChange: e => { try { localStorage.setItem(cloudKey(), e.target.checked ? '1' : '0'); } catch { /* private mode */ } toast.info(e.target.checked ? 'Claude will word answers from your records' : 'Answers stay on the company system'); } }), icon('cloud', 14), 'Claude') : null;

  drawHist();
  drawStream();
  const root = h('div',
    h('div.row.gap-8', { style: 'margin-bottom:10px;align-items:center' }, h('div.ai-ico', { style: 'width:38px;height:38px;border-radius:50%;background:conic-gradient(from 90deg,#1f7a4d,#5ee0c8,#9be15d,#1f7a4d);display:grid;place-items:center;color:#fff' }, icon('sparkles', 18)), h('div', h('h1', { style: 'font-size:1.4rem;margin:0' }, 'Sage AI'), h('div.small.muted', 'Answers from your live data — never made up')), h('span.spacer'), cloudToggle,
      btn({ icon: 'history', variant: 'ghost', size: 'sm', title: 'Conversations', onClick: () => root.querySelector('.sage').classList.toggle('show-hist') })),
    h('div.sage', hist, h('div.sg-main', stream, h('div.composer', mic, input, btn({ icon: 'send', variant: 'primary', title: 'Send', onClick: () => send() })))));
  if (ctx.query.q) setTimeout(() => send(ctx.query.q), 50);
  else setTimeout(() => input.focus(), 50);
  return root;
}

export default { id: 'assistant', routes: { '': home } };
