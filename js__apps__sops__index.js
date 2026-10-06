/* =============================================================================
   SOPs & Policies (#/sops) — the company knowledge library: every policy,
   procedure, SOP, job description, agenda and training guide, grouped by type,
   with review status, search inside the text, and the "read & acknowledge"
   matrix showing who has signed off each controlled document.
   ========================================================================== */

import { h, ensureStyle } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { badge, card, pageHeader, emptyState, kpiTile, tabs, listItem } from '../../ui/components.js';
import { db } from '../../core/db.js';
import { store } from '../../core/bus.js';
import { today } from '../../core/dates.js';
import * as fmt from '../../core/format.js';
import { reviewStatus } from '../docs/lib.js';

ensureStyle('lsi-sops', `.ack-matrix{overflow:auto}.ack-matrix table{border-collapse:collapse;font-size:.8rem}.ack-matrix th,.ack-matrix td{border:1px solid var(--border);padding:4px 6px;white-space:nowrap}.ack-matrix th.rot{writing-mode:vertical-rl;transform:rotate(180deg);height:150px;text-align:left}`);

const GROUPS = [['policy', 'Policies', 'shield-check'], ['procedure', 'Procedures & workflows', 'list-ordered'], ['sop', 'SOPs', 'book-open'], ['job_description', 'Job descriptions', 'id-card'], ['agenda', 'Meeting agendas', 'calendar-range'], ['plan', 'Plans & strategy', 'mountain'], ['template', 'Letters of appointment & templates', 'stamp'], ['general', 'Training guides & other', 'graduation-cap']];
const CONTROLLED = ['policy', 'procedure', 'sop', 'job_description'];

function page(ctx) {
  let tab = ctx.query.tab || 'library', q = '';
  const body = h('div');
  const docs = () => db.all('docs').filter(d => GROUPS.some(g => g[0] === d.category) && d.category !== 'letter');
  const draw = () => {
    const all = docs();
    if (tab === 'matrix') {
      const people = db.filter('profiles', p => p.status !== 'suspended');
      const ctl = all.filter(d => CONTROLLED.includes(d.category)).sort((a, b) => String(a.doc_code || a.title).localeCompare(String(b.doc_code || b.title)));
      body.replaceChildren(card({ title: 'Read & acknowledge', sub: 'Who has confirmed they read each controlled document. Open a document and tap “I have read and understood”.', icon: 'check-check', cls: 'solid' },
        h('div.ack-matrix', h('table', h('thead', h('tr', h('th', 'Person'), ...ctl.map(d => h('th.rot', { title: d.title }, d.doc_code || fmt.truncate(d.title, 28))))),
          h('tbody', people.map(p => h('tr', h('th', p.name), ...ctl.map(d => { const a = (d.acknowledgements || []).find(x => x.user_id === p.id); return h('td', { title: a ? `Acknowledged ${a.at}` : 'Not yet', style: `text-align:center;color:${a ? 'var(--success)' : 'var(--muted)'}` }, a ? '✓' : '·'); }))))))));
      return;
    }
    const filtered = all.filter(d => !q || `${d.title} ${d.doc_code || ''} ${d.text || ''}`.toLowerCase().includes(q));
    body.replaceChildren(...GROUPS.map(([cat, label, ic]) => {
      const list = filtered.filter(d => d.category === cat).sort((a, b) => String(a.doc_code || a.title).localeCompare(String(b.doc_code || b.title), undefined, { numeric: true }));
      if (!list.length) return null;
      return card({ title: label, sub: `${list.length}`, icon: ic, cls: 'solid', style: 'margin-bottom:14px' }, h('div.list.divider-list', list.map(d => {
        const rs = reviewStatus(d, today());
        const acks = (d.acknowledgements || []).length;
        return listItem({ title: `${d.doc_code ? d.doc_code + ' · ' : ''}${d.title}`, sub: [d.revision ? `Rev ${d.revision}` : null, d.effective_date ? `effective ${fmt.date(d.effective_date)}` : null, CONTROLLED.includes(cat) ? `${acks} acknowledged` : null].filter(Boolean).join(' · '),
          icon: d.locked ? 'lock' : 'file-text', tile: 't-grass', href: `#/docs/${encodeURIComponent(d.id)}`, right: rs.key !== 'none' ? badge(rs.label, rs.color) : null });
      })));
    }).filter(Boolean));
    if (!body.children.length) body.replaceChildren(emptyState({ icon: 'book-open', title: 'No documents found' }));
  };
  ctx.dispose.add(db.on('docs', draw));
  draw();
  const all = docs(), ctl = all.filter(d => CONTROLLED.includes(d.category));
  const me = store.get('user') || {};
  return h('div',
    pageHeader({ title: 'SOPs & Policies', sub: 'The company rule book — every policy, procedure and SOP in full, with review dates and sign-off.', icon: 'book-open', tile: 't-grass' }),
    h('div.grid.cols-4.stagger', { style: 'margin-bottom:14px' },
      kpiTile({ label: 'Documents', value: all.length, icon: 'library', tile: 't-grass' }),
      kpiTile({ label: 'Review overdue', value: ctl.filter(d => reviewStatus(d, today()).key === 'overdue').length, icon: 'alarm-clock', tile: 't-rose' }),
      kpiTile({ label: 'Review in 30 days', value: ctl.filter(d => reviewStatus(d, today()).key === 'due').length, icon: 'calendar-clock', tile: 't-sun' }),
      kpiTile({ label: 'Still to read (you)', value: ctl.filter(d => !(d.acknowledgements || []).some(a => a.user_id === me.id)).length, icon: 'book-open-check', tile: 't-violet' })),
    h('div.row.wrap.gap-8', { style: 'margin-bottom:12px' }, tabs([{ id: 'library', label: 'Library', icon: 'library' }, { id: 'matrix', label: 'Acknowledgements', icon: 'grid-3x3' }], tab, id => { tab = id; draw(); }), h('span.spacer'),
      h('input.input', { placeholder: 'Search inside every document…', style: 'max-width:300px', onInput: e => { q = e.target.value.toLowerCase(); draw(); } })),
    body);
}

export default { id: 'sops', routes: { '': page } };
void icon;
