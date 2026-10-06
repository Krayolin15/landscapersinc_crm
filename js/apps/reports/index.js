/* =============================================================================
   Reports & BI — the KPI radar (revenue vs expenses, debt ageing, crew
   efficiency, retention & lifetime value), a drag-free report builder over any
   collection (group by / sum / count / chart / export) and one-click exports of
   every table to Excel.
   ========================================================================== */

import { h, downloadBlob } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { btn, badge, card, pageHeader, kpiTile, tabs, emptyState, callout, ring } from '../../ui/components.js';
import { dataTable } from '../../ui/table.js';
import { toast, showError } from '../../ui/overlays.js';
import { chart } from '../../ui/charts.js';
import { db } from '../../core/db.js';
import { can } from '../../core/perms.js';
import { SCHEMA, getDef } from '../../core/schema.js';
import { today, monthLabel, diffDays } from '../../core/dates.js';
import { toCents, fromCents, sumBy } from '../../core/money.js';
import * as fmt from '../../core/format.js';
import { ageing, mrr, clientLTV, lastMonths } from '../_biz.js';
import { monthRows } from '../finance/index.js';
import { ensureLib } from '../../core/lazy.js';

function radar(ctx) {
  const months = [...new Set([...db.all('financial_periods').map(p => p.period), ...lastMonths(6)])].filter(Boolean).sort().slice(-9);
  const rows = monthRows(months);
  const a = ageing(db.all('invoices'));
  const clients = db.all('clients'), active = clients.filter(c => c.status === 'active'), left = clients.filter(c => c.status === 'left');
  const retention = active.length + left.length ? (active.length / (active.length + left.length)) * 100 : 0;
  const ltvs = clients.map(c => clientLTV(c.id)).filter(v => v > 0);
  const tenures = active.filter(c => c.since_date).map(c => diffDays(c.since_date, today()) / 30.44);
  const visits = db.filter('visits', v => v.status === 'completed' && v.planned_minutes && v.actual_minutes);
  const crews = [...new Set(visits.map(v => v.crew_id || v.crew_names || 'Unassigned'))].map(k => { const vs = visits.filter(v => (v.crew_id || v.crew_names || 'Unassigned') === k); const plan = vs.reduce((s, v) => s + v.planned_minutes, 0), act = vs.reduce((s, v) => s + v.actual_minutes, 0); return { crew: (k && db.get('crews', k) || {}).name || k, visits: vs.length, efficiency: act ? (plan / act) * 100 : null }; });
  return h('div.stack',
    h('div.grid.cols-4.stagger',
      kpiTile({ label: 'Monthly recurring revenue', value: mrr(), format: 'money', icon: 'repeat', tile: 't-grass' }),
      kpiTile({ label: 'Debtors', value: a.total, format: 'money', icon: 'hand-coins', tile: 't-rose', foot: `60+ days ${fmt.money(a['60+'])}` }),
      kpiTile({ label: 'Client retention', value: retention, format: 'pct', icon: 'heart-handshake', tile: 't-forest', foot: `${active.length} active · ${left.length} left` }),
      kpiTile({ label: 'Average lifetime value', value: ltvs.length ? fromCents(ltvs.reduce((s, v) => s + toCents(v), 0) / ltvs.length) : 0, format: 'money', icon: 'gem', tile: 't-violet', foot: tenures.length ? `avg tenure ${(tenures.reduce((s, v) => s + v, 0) / tenures.length).toFixed(1)} months` : 'invoiced clients' })),
    h('div.grid.cols-2',
      card({ title: 'Revenue vs expenses', icon: 'chart-column', cls: 'solid' }, h('div', { style: 'height:260px' }, chart({ type: 'bar', labels: rows.map(r => monthLabel(r.period, true)), series: [{ label: 'Income', data: rows.map(r => r.income || 0), color: 'var(--c2)' }, { label: 'Costs', data: rows.map(r => r.costs || 0), color: 'var(--c6)' }], money: true, dispose: ctx.dispose }))),
      card({ title: 'Debt ageing', icon: 'hourglass', cls: 'solid' }, a.total ? h('div', { style: 'height:260px' }, chart({ type: 'doughnut', labels: ['0–30 days', '31–60 days', '60+ days'], series: [{ label: 'Owed', data: [a['0-30'], a['31-60'], a['60+']], colors: ['var(--c2)', 'var(--c4)', 'var(--c6)'] }], money: true, dispose: ctx.dispose })) : emptyState({ icon: 'party-popper', title: 'Nothing owed' })),
      card({ title: 'Crew efficiency (planned ÷ actual time)', icon: 'timer', cls: 'solid' }, crews.length ? h('div', { style: 'height:240px' }, chart({ type: 'bar', horizontal: true, labels: crews.map(c => c.crew), series: [{ label: 'Efficiency %', data: crews.map(c => Math.round(c.efficiency || 0)) }], percent: true, dispose: ctx.dispose })) : emptyState({ icon: 'timer', title: 'No timed visits yet', text: 'When crews check in and out on Live Dispatch, efficiency per crew appears here (100% = on plan).' })),
      card({ title: 'Clients by region', icon: 'map', cls: 'solid' }, (() => { const regs = [...new Set(active.map(c => c.region || c.suburb || 'Unknown'))].map(r => ({ r, n: active.filter(c => (c.region || c.suburb || 'Unknown') === r).length })).sort((x, y) => y.n - x.n).slice(0, 12); return h('div', { style: 'height:240px' }, chart({ type: 'bar', labels: regs.map(x => x.r), series: [{ label: 'Active clients', data: regs.map(x => x.n) }], dispose: ctx.dispose })); })())));
}

/* ---------------- report builder ---------------- */
function builder(ctx) {
  const cols = Object.keys(SCHEMA).filter(c => can('read', c) && db.count(c)).sort((x, y) => getDef(x).label.localeCompare(getDef(y).label));
  const st = { col: ctx.query.col && cols.includes(ctx.query.col) ? ctx.query.col : cols.includes('invoices') ? 'invoices' : cols[0], group: '', measure: 'count', type: 'bar' };
  const out = h('div');
  const controls = h('div.form-grid');
  const fieldsOf = c => Object.entries(getDef(c).fields).filter(([, f]) => !f.hidden);
  const groupable = c => fieldsOf(c).filter(([, f]) => ['enum', 'text', 'bool', 'date', 'ref'].includes(f.type));
  const measurable = c => fieldsOf(c).filter(([, f]) => ['money', 'number', 'int', 'percent'].includes(f.type));
  const keyOf = (f, n, r) => { const v = r[n]; if (v == null || v === '') return '(blank)'; if (f.type === 'date') return String(v).slice(0, 7); if (f.type === 'ref') return db.label(f.ref, v) || v; if (f.type === 'bool') return v ? 'Yes' : 'No'; return fmt.titleCase(String(v).replace(/_/g, ' ')); };
  const drawControls = () => {
    const g = groupable(st.col), m = measurable(st.col);
    if (!g.some(([n]) => n === st.group)) st.group = (g.find(([, f]) => f.type === 'enum') || g[0] || [''])[0];
    controls.replaceChildren(
      h('div.field', h('label.field-label', 'Data'), h('select.select', { onChange: e => { st.col = e.target.value; drawControls(); run(); } }, cols.map(c => h('option', { value: c, selected: c === st.col }, `${getDef(c).label} (${db.count(c)})`)))),
      h('div.field', h('label.field-label', 'Group by'), h('select.select', { onChange: e => { st.group = e.target.value; run(); } }, g.map(([n, f]) => h('option', { value: n, selected: n === st.group }, `${f.label || n}${f.type === 'date' ? ' (by month)' : ''}`)))),
      h('div.field', h('label.field-label', 'Measure'), h('select.select', { onChange: e => { st.measure = e.target.value; run(); } }, h('option', { value: 'count', selected: st.measure === 'count' }, 'Count of records'), m.map(([n, f]) => h('option', { value: n, selected: n === st.measure }, `Sum of ${f.label || n}`)))),
      h('div.field', h('label.field-label', 'Chart'), h('select.select', { onChange: e => { st.type = e.target.value; run(); } }, [['bar', 'Bars'], ['line', 'Line'], ['doughnut', 'Doughnut'], ['hbar', 'Horizontal bars']].map(([v, l]) => h('option', { value: v, selected: v === st.type }, l)))));
  };
  const run = () => {
    const def = getDef(st.col), f = def.fields[st.group];
    if (!f) { out.replaceChildren(emptyState({ icon: 'chart-pie', title: 'Nothing to group by' })); return; }
    const mf = st.measure === 'count' ? null : def.fields[st.measure];
    const groups = new Map();
    for (const r of db.all(st.col)) { const k = keyOf(f, st.group, r); const g = groups.get(k) || { key: k, count: 0, c: 0 }; g.count++; if (mf) g.c += mf.type === 'money' ? toCents(r[st.measure] || 0) : Number(r[st.measure]) || 0; groups.set(k, g); }
    let rows = [...groups.values()].map(g => ({ key: g.key, count: g.count, value: mf ? (mf.type === 'money' ? fromCents(g.c) : g.c) : g.count }));
    rows.sort((x, y) => (f.type === 'date' ? String(x.key).localeCompare(String(y.key)) : y.value - x.value));
    const money = mf && mf.type === 'money';
    const shown = rows.slice(0, 40);
    out.replaceChildren(
      card({ cls: 'solid', title: `${st.measure === 'count' ? 'Count' : 'Sum of ' + (mf.label || st.measure)} by ${f.label || st.group}`, sub: `${def.label} · ${fmt.num(db.count(st.col))} records`, icon: 'chart-bar' },
        h('div', { style: 'height:320px' }, chart({ type: st.type === 'hbar' ? 'bar' : st.type, horizontal: st.type === 'hbar', labels: shown.map(r => r.key), series: [{ label: st.measure === 'count' ? 'Records' : mf.label || st.measure, data: shown.map(r => r.value) }], money, dispose: ctx.dispose }))),
      card({ cls: 'solid', style: 'margin-top:14px', body: dataTable({ columns: [{ key: 'key', label: f.label || st.group }, { key: 'count', label: 'Records', num: true }, ...(mf ? [{ key: 'value', label: `Sum of ${mf.label || st.measure}`, num: true, render: r => (money ? fmt.money(r.value) : fmt.num(r.value, 2)) }] : [])], rows, exportName: `report-${st.col}-by-${st.group}`, footer: rs => ['Total', rs.reduce((s, r) => s + r.count, 0), ...(mf ? [money ? fmt.money(sumBy(rs, 'value')) : fmt.num(rs.reduce((s, r) => s + r.value, 0), 2)] : [])] }) }));
  };
  drawControls(); run();
  return h('div.stack', card({ cls: 'solid', title: 'Build a report', icon: 'wand-sparkles', sub: 'Pick any data, how to group it and what to add up. Export the result to Excel.' }, controls), out);
}

/* ---------------- exports ---------------- */
function exportsTab() {
  const cols = Object.keys(SCHEMA).filter(c => can('read', c) && db.count(c));
  const excelAll = async () => {
    let X; try { X = await ensureLib('xlsx'); } catch { return toast.error('The Excel library could not load — check your connection and try again'); }
    try {
      const wb = X.utils.book_new();
      for (const c of cols) { const def = getDef(c); const names = Object.keys(def.fields).filter(n => !def.fields[n].hidden); const data = db.all(c).map(r => Object.fromEntries([['id', r.id], ...names.map(n => [def.fields[n].label || n, typeof r[n] === 'object' && r[n] !== null ? JSON.stringify(r[n]) : r[n]]), ['Created by', r.created_by_name], ['Created at', r.created_at], ['Updated by', r.updated_by_name], ['Updated at', r.updated_at]])); X.utils.book_append_sheet(wb, X.utils.json_to_sheet(data), def.label.replace(/[\\/?*[\]:]/g, '').slice(0, 31)); }
      const buf = X.write(wb, { bookType: 'xlsx', type: 'array' });
      downloadBlob(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `Landscapers Inc - all data ${today()}.xlsx`);
    } catch (e) { showError(e, 'Export failed'); }
  };
  return h('div.stack',
    callout('info', 'Your data is yours', 'Download any table — or everything at once — as an Excel workbook with who created and last changed each record.', 'download'),
    h('div', btn({ label: 'Download everything (Excel)', icon: 'file-spreadsheet', variant: 'primary', onClick: excelAll })),
    card({ cls: 'solid', body: dataTable({ columns: [{ key: 'label', label: 'Table', render: r => h('div.row.gap-8', icon(r.icon || 'table', 16), r.label) }, { key: 'n', label: 'Records', num: true }], rows: cols.map(c => ({ id: c, label: getDef(c).label, icon: getDef(c).icon, n: db.count(c) })), sort: 'label', onRowClick: r => (location.hash = `#/reports/builder?col=${r.id}`) }) }));
}

function home(ctx, start) {
  let tab = start || ctx.query.tab || 'radar';
  const body = h('div');
  const draw = () => body.replaceChildren(h('div.anim-fade', tab === 'radar' ? radar(ctx) : tab === 'builder' ? builder(ctx) : exportsTab()));
  draw();
  return h('div',
    pageHeader({ title: 'Reports & BI', sub: 'The KPI radar, a report builder over every table, and full exports.', icon: 'chart-pie', tile: 't-violet' }),
    tabs([{ id: 'radar', label: 'KPI radar', icon: 'radar' }, { id: 'builder', label: 'Report builder', icon: 'wand-sparkles' }, { id: 'exports', label: 'Exports', icon: 'download' }], tab, id => { tab = id; draw(); }),
    body);
}

export default { id: 'reports', routes: { '': ctx => home(ctx), builder: ctx => home(ctx, 'builder') } };
void badge; void ring;
