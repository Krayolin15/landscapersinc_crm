/* Admin → Data health: issue board, live validation scan, duplicate finder,
   orphan references, seed provenance. */
import { h } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { pageHeader, card, badge, btn, emptyState, skeleton, tabs } from '../../ui/components.js';
import { prompt, confirm, toast, showError } from '../../ui/overlays.js';
import { db } from '../../core/db.js';
import { getDef, SCHEMA } from '../../core/schema.js';
import { recordLink } from '../../ui/entity.js';
import * as fmt from '../../core/format.js';
import { adminNav } from './nav.js';
import { duplicateGroups, refPointers, findOrphans, sortBySeverity } from './lib.js';

const SEV_BADGE = { high: 'red', medium: 'gold', low: 'gray' };

/* ---------------- 1. data_issues board ---------------- */
function issueCard(r, refresh) {
  const answer = async () => {
    const text = await prompt(r.question || 'Answer for the owner', { title: 'Answer this issue', value: r.resolution || '', type: 'textarea', ok: 'Save answer' });
    if (text == null) return;
    try { await db.update('data_issues', r.id, { status: 'answered', resolution: text }); refresh(); } catch (e) { showError(e); }
  };
  const resolve = async () => {
    const text = await prompt('Resolution notes', { value: r.resolution || '', type: 'textarea', ok: 'Mark fixed' });
    if (text == null) return;
    try { await db.update('data_issues', r.id, { status: 'fixed', resolution: text || r.resolution || 'Resolved' }); refresh(); } catch (e) { showError(e); }
  };
  const setStatus = async status => { try { await db.update('data_issues', r.id, { status }); refresh(); } catch (e) { showError(e); } };
  return h('div.kcard',
    h('div.row.between', badge(fmt.titleCase(r.severity || 'medium'), SEV_BADGE[r.severity] || 'gray', { dot: true }), h('span.xs.muted', r.source_group || '')),
    h('div.semibold', { style: 'margin-top:4px' }, r.title),
    r.detail ? h('div.small.muted', { style: 'margin:6px 0' }, fmt.truncate(r.detail, 160)) : null,
    r.question ? h('div.callout.info', { style: 'margin:6px 0;padding:8px 10px;font-size:var(--fs-xs)' }, icon('circle-help', 14), h('div', r.question)) : null,
    r.resolution ? h('div.small', { style: 'margin:4px 0' }, h('b', 'Resolution: '), r.resolution) : null,
    h('div.row.gap-4.wrap', { style: 'margin-top:8px' },
      r.status !== 'answered' && r.status !== 'fixed' ? btn({ label: 'Answer', size: 'sm', variant: 'ghost', onClick: answer }) : null,
      r.status !== 'fixed' ? btn({ label: 'Resolve', size: 'sm', variant: 'soft', onClick: resolve }) : null,
      r.status !== 'wont_fix' ? btn({ label: "Won't fix", size: 'sm', variant: 'ghost', onClick: () => setStatus('wont_fix') }) : null,
      r.status !== 'open' ? btn({ label: 'Reopen', size: 'sm', variant: 'ghost', onClick: () => setStatus('open') }) : null));
}
function issuesBoard(ctx) {
  const COLS = [{ status: 'open', label: 'Open', color: 'var(--danger)' }, { status: 'answered', label: 'Answered', color: 'var(--warning)' }, { status: 'fixed', label: 'Fixed', color: 'var(--success)' }, { status: 'wont_fix', label: "Won't fix", color: 'var(--muted)' }];
  const wrap = h('div');
  const draw = () => {
    const rows = db.all('data_issues');
    if (!rows.length) { wrap.replaceChildren(emptyState({ icon: 'shield-check', title: 'No data issues logged', text: 'The autonomous agent and import tools raise issues here when something in the data needs a human decision.' })); return; }
    wrap.replaceChildren(h('div.kanban', COLS.map(c => {
      const items = sortBySeverity(rows.filter(r => (r.status || 'open') === c.status));
      return h('div.kcol', h('div.kcol-head', h('span.kdot', { style: { background: c.color } }), h('span', c.label), h('span.ksum', items.length)),
        items.length ? items.map(r => issueCard(r, draw)) : h('div.small.muted', { style: 'padding:6px' }, '—'));
    })));
  };
  draw();
  ctx.dispose.add(db.on('data_issues', draw));
  return wrap;
}

/* ---------------- 2. live validation scan ---------------- */
function validationSection(ctx) {
  const wrap = h('div');
  const run = async () => {
    wrap.replaceChildren(skeleton(6));
    await new Promise(r => setTimeout(r, 10));
    const groups = [];
    for (const [col, def] of Object.entries(SCHEMA)) {
      const bad = [];
      for (const rec of db.all(col)) {
        const res = db.check(col, rec, { id: rec.id });
        if (!res.ok || Object.keys(res.warnings).length) bad.push({ rec, errors: res.errors, warnings: res.warnings });
      }
      if (bad.length) groups.push({ col, def, bad });
    }
    if (!groups.length) { wrap.replaceChildren(emptyState({ icon: 'circle-check', title: 'Every record passes validation', text: 'No errors or warnings against the current schema.' })); return; }
    wrap.replaceChildren(h('div.stack', groups.map(g => card({ title: g.def.label, sub: `${g.bad.length} record${g.bad.length === 1 ? '' : 's'}`, icon: g.def.icon, tile: g.def.tile, cls: 'solid' },
      h('div.stack.tight', g.bad.slice(0, 200).map(b => h('div.row.wrap.gap-8', { style: 'padding:6px 0;border-bottom:1px solid var(--border)' },
        h('a', { href: recordLink(g.col, b.rec.id) }, db.label(g.col, b.rec)),
        Object.entries(b.errors).map(([k, m]) => badge(m, 'red')),
        Object.entries(b.warnings).map(([k, m]) => badge(m, 'gold')))))))));
  };
  wrap.replaceChildren(emptyState({ icon: 'search-check', title: 'Ready to scan', text: `Runs every record in all ${Object.keys(SCHEMA).length} collections through its schema validation.`, action: btn({ label: 'Run scan', icon: 'play', variant: 'primary', onClick: run }) }));
  const rerun = h('div.row.end', { style: 'margin-bottom:10px' }, btn({ label: 'Run scan', icon: 'rotate-cw', variant: 'ghost', size: 'sm', onClick: run }));
  return h('div', rerun, wrap);
}

/* ---------------- 3. duplicate finder ---------------- */
const DUPE_TARGETS = [
  { col: 'clients', fields: { nameField: 'name', phoneField: 'phone', emailField: 'email' } },
  { col: 'leads', fields: { nameField: 'name', phoneField: 'phone', emailField: 'email' } },
  { col: 'employees', fields: { nameField: 'full_name', phoneField: 'phone', emailField: 'email' } }
];
function duplicatesSection() {
  return h('div.stack', DUPE_TARGETS.map(t => {
    const def = getDef(t.col);
    const groups = duplicateGroups(db.all(t.col), t.fields);
    return card({ title: def.label, sub: groups.length ? `${groups.length} possible duplicate group${groups.length === 1 ? '' : 's'}` : 'No possible duplicates', icon: def.icon, tile: def.tile, cls: 'solid' },
      groups.length ? h('div.stack', groups.map(g => h('div.row.wrap.gap-8', { style: 'padding:8px 0;border-bottom:1px solid var(--border)' },
        badge(`Matched by ${g.field}`, 'gray'), g.records.map(r => h('a.chip', { href: recordLink(t.col, r.id) }, db.label(t.col, r))))))
        : h('p.small.muted', 'Nothing found by matching normalised name, phone or email.'));
  }));
}

/* ---------------- 4. orphan references ---------------- */
function orphansSection() {
  const recordsByCol = {};
  for (const col of Object.keys(SCHEMA)) recordsByCol[col] = db.all(col);
  const pointers = refPointers(SCHEMA, recordsByCol);
  const orphans = findOrphans(pointers, (col, id) => !!db.get(col, id));
  if (!orphans.length) return emptyState({ icon: 'link', title: 'No orphan references', text: `Checked ${pointers.length} reference fields across every collection.` });
  const byCol = new Map();
  for (const o of orphans) { if (!byCol.has(o.col)) byCol.set(o.col, []); byCol.get(o.col).push(o); }
  return h('div.stack', [...byCol.entries()].map(([col, list]) => {
    const def = getDef(col);
    return card({ title: def.label, sub: `${list.length} broken reference${list.length === 1 ? '' : 's'}`, icon: def.icon, tile: def.tile, cls: 'solid' },
      h('div.stack.tight', list.map(o => h('div.row.wrap.gap-8', { style: 'padding:6px 0;border-bottom:1px solid var(--border)' },
        h('a', { href: recordLink(col, o.id) }, db.label(col, db.get(col, o.id))),
        badge(`${(def.fields[o.field] || {}).label || o.field} → missing ${(getDef(o.ref) || {}).singular || o.ref}`, 'red')))));
  }));
}

/* ---------------- 5. seed provenance ---------------- */
function provenanceSection() {
  const rows = [];
  for (const [col, def] of Object.entries(SCHEMA)) {
    const recs = db.all(col, { withDeleted: true }).filter(r => r._seed);
    if (!recs.length) continue;
    const bySrc = new Map();
    for (const r of recs) { const key = String(r._src || 'unknown').split('|')[0].trim(); bySrc.set(key, (bySrc.get(key) || 0) + 1); }
    rows.push({ col, def, count: recs.length, sources: [...bySrc.entries()].sort((a, b) => b[1] - a[1]) });
  }
  if (!rows.length) return emptyState({ icon: 'database', title: 'No imported records', text: 'Nothing in this database carries a _seed provenance flag.' });
  return h('div.stack', rows.sort((a, b) => b.count - a.count).map(r => card({ title: r.def.label, sub: `${r.count} imported record${r.count === 1 ? '' : 's'}`, icon: r.def.icon, tile: r.def.tile, cls: 'solid' },
    h('div.chips', r.sources.map(([src, n]) => badge(`${src} · ${n}`, 'gray'))))));
}

export function dataHealthPage(ctx) {
  const body = h('div');
  const sections = { issues: () => issuesBoard(ctx), validate: () => validationSection(ctx), duplicates: duplicatesSection, orphans: orphansSection, provenance: provenanceSection };
  const show = id => body.replaceChildren(sections[id]());
  const tabBar = tabs([
    { id: 'issues', label: 'Issues board', icon: 'shield-alert' },
    { id: 'validate', label: 'Validation scan', icon: 'search-check' },
    { id: 'duplicates', label: 'Duplicate finder', icon: 'copy' },
    { id: 'orphans', label: 'Orphan references', icon: 'unlink' },
    { id: 'provenance', label: 'Seed provenance', icon: 'database' }
  ], 'issues', show);
  show('issues');
  return h('div',
    pageHeader({ title: 'Data health', sub: 'Everything the system can tell you is wrong, missing or duplicated — with a fix, an answer or a link.', icon: 'shield-alert', tile: 't-rose', actions: [adminNav(ctx, 'data')] }),
    tabBar, h('div', { style: 'margin-top:14px' }, body));
}
