/* =============================================================================
   Calendar — Holidays manager (#/calendar/holidays): computed SA public
   holidays + observances for a chosen year, plus CRUD for custom company
   holidays / once-off declared public holidays (the `holidays` collection —
   managers only).
   ========================================================================== */

import { h } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { btn, badge, pageHeader, card, emptyState } from '../../ui/components.js';
import { openRecordForm } from '../../ui/form.js';
import { confirm, toast, showError } from '../../ui/overlays.js';
import { db } from '../../core/db.js';
import { isManager } from '../../core/perms.js';
import * as fmt from '../../core/format.js';
import { holidaysForYear } from '../../core/holidays.js';

const TYPE_META = {
  public: { icon: 'flag', tile: 't-rose', badge: 'red', label: 'Public holiday' },
  company: { icon: 'building-2', tile: 't-clay', badge: 'clay', label: 'Company closure' },
  observance: { icon: 'sparkles', tile: 't-slate', badge: 'gray', label: 'Observance' }
};

export function holidaysPage(ctx) {
  let year = ctx.query && ctx.query.y ? +ctx.query.y : new Date().getFullYear();
  const canManage = isManager();
  const root = h('div');

  const draw = () => {
    const list = holidaysForYear(year).slice().sort((a, b) => a.date.localeCompare(b.date));
    root.replaceChildren(
      pageHeader({
        crumbs: [{ label: 'Calendar', href: '#/calendar' }, { label: 'Holidays' }],
        title: 'Public holidays & observances', sub: 'South Africa · Public Holidays Act 36 of 1994', icon: 'party-popper', tile: 't-rose',
        actions: [
          h('div.row.gap-4',
            btn({ icon: 'chevron-left', variant: 'ghost', 'aria-label': 'Previous year', onClick: () => { year--; draw(); } }),
            h('b', { style: 'min-width:44px;text-align:center' }, String(year)),
            btn({ icon: 'chevron-right', variant: 'ghost', 'aria-label': 'Next year', onClick: () => { year++; draw(); } })),
          canManage ? btn({ label: 'Add holiday', icon: 'plus', variant: 'primary', onClick: () => openRecordForm('holidays', { values: { date: `${year}-01-01` }, onSaved: draw }) }) : null
        ]
      }),
      card({ cls: 'solid' }, list.length ? h('div.list', list.map(hd => {
        const meta = TYPE_META[hd.type] || TYPE_META.observance;
        return h('div.list-item',
          h('div', { class: ['li-ico', meta.tile] }, icon(meta.icon, 18)),
          h('div.li-main', h('div.li-title', hd.name, hd.observed ? h('span.small.muted', ' (observed)') : null), h('div.li-sub', fmt.date(hd.date, 'full'))),
          badge(meta.label, meta.badge),
          hd.custom && canManage ? h('div.row.gap-4',
            btn({ icon: 'pencil', size: 'sm', variant: 'ghost', 'aria-label': 'Edit', onClick: () => openRecordForm('holidays', { id: hd.id, onSaved: draw }) }),
            btn({
              icon: 'trash-2', size: 'sm', variant: 'ghost', 'aria-label': 'Delete', onClick: async () => {
                if (await confirm(`Remove “${hd.name}”?`, { danger: true, ok: 'Remove' })) {
                  try { await db.remove('holidays', hd.id); toast.success('Removed'); } catch (e) { showError(e); }
                }
              }
            })) : null);
      })) : emptyState({ icon: 'party-popper', title: 'No holidays this year' })));
  };
  draw();
  ctx.dispose.add(db.on('holidays', draw));
  return root;
}
