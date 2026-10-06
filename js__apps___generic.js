/* =============================================================================
   Generic app engine. Any app can be declared as a set of collections and it
   immediately gets: an overview dashboard (live counts, key totals, recent
   activity), one tab per collection with a full data table (search, filters,
   sort, export, bulk actions), validated create/edit forms, and detail pages
   with related records, files, comments and change history.
   Specialised apps (calendar, mail, invoices...) replace or extend this.

   makeApp({ id, title, icon, tile, sub, collections:[col], kpis(ctx)->[kpiTile], above(ctx)->Node })
   ========================================================================== */

import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { pageHeader, kpiTile, card, tabs, emptyState, listItem, attribution, btn } from '../ui/components.js';
import { entityListPage, entityDetailPage, recordLink } from '../ui/entity.js';
import { openRecordForm } from '../ui/form.js';
import { db } from '../core/db.js';
import { getDef } from '../core/schema.js';
import { can } from '../core/perms.js';
import { appById } from './registry.js';
import * as fmt from '../core/format.js';

export function makeApp(o) {
  const meta = appById(o.id) || {};
  const cols = (o.collections || []).filter(c => getDef(c));
  const readable = () => cols.filter(c => can('read', c));

  function overview(ctx) {
    const list = readable();
    const tiles = h('div.grid.cols-4.stagger', { style: 'margin-bottom:18px' });
    const recent = h('div');
    const draw = () => {
      tiles.replaceChildren(...(o.kpis ? o.kpis(ctx) : list.slice(0, 8).map(c => {
        const def = getDef(c);
        return kpiTile({ label: def.label, value: db.count(c), icon: def.icon, tile: def.tile || meta.tile, href: `#/${o.id}/${c}` });
      })));
      const rows = list.flatMap(c => db.all(c).map(r => ({ c, r }))).sort((a, b) => String(b.r.updated_at || '').localeCompare(String(a.r.updated_at || ''))).slice(0, 12);
      recent.replaceChildren(rows.length ? h('div.list.divider-list', rows.map(({ c, r }) => listItem({
        title: db.label(c, r), sub: h('span', getDef(c).singular, ' · ', attribution(r, { verb: r._seed ? 'Imported' : 'Added', showUpdate: false })),
        icon: getDef(c).icon, tile: getDef(c).tile || meta.tile, href: recordLink(c, r.id)
      }))) : emptyState({ icon: meta.icon || 'leaf', title: 'Nothing here yet', text: 'Records you add will appear here.' }));
    };
    draw();
    list.forEach(c => ctx.dispose.add(db.on(c, draw)));
    return h('div',
      pageHeader({ title: o.title || meta.name, sub: o.sub || meta.desc, icon: o.icon || meta.icon, tile: o.tile || meta.tile,
        actions: list.filter(c => can('write', c)).slice(0, 2).map((c, i) => btn({ label: `New ${getDef(c).singular.toLowerCase()}`, icon: 'plus', variant: i === 0 ? 'primary' : undefined, onClick: () => openRecordForm(c) })) }),
      o.above ? o.above(ctx) : null,
      tiles,
      h('div.grid.cols-2',
        card({ title: 'Sections', icon: 'layers', cls: 'solid' }, h('div.list', list.map(c => { const def = getDef(c); return listItem({ title: def.label, sub: `${fmt.num(db.count(c))} ${db.count(c) === 1 ? def.singular.toLowerCase() : def.label.toLowerCase()}`, icon: def.icon, tile: def.tile || meta.tile, href: `#/${o.id}/${c}`, right: icon('chevron-right', 16) }); }))),
        card({ title: 'Recent activity', icon: 'history', cls: 'solid' }, recent)));
  }

  function section(ctx) {
    const col = ctx.params.col;
    if (!cols.includes(col)) return emptyState({ icon: 'search-x', title: 'Unknown section' });
    const list = readable();
    return h('div',
      list.length > 1 ? tabs([{ id: '__overview', label: 'Overview', icon: 'layout-dashboard' }, ...list.map(c => ({ id: c, label: getDef(c).label, icon: getDef(c).icon, count: db.count(c) }))], col, id => ctx.navigate(id === '__overview' ? o.id : `${o.id}/${id}`)) : null,
      entityListPage(col, ctx, { onOpen: r => ctx.navigate(`${o.id}/${col}/${encodeURIComponent(r.id)}`), ...(o.listOptions && o.listOptions[col]) }));
  }

  function detail(ctx) {
    const { col, id } = ctx.params;
    return entityDetailPage(col, decodeURIComponent(id), ctx, { backHref: `#/${o.id}/${col}`, backLabel: getDef(col).label });
  }

  return {
    id: o.id,
    // custom routes first: the router takes the first pattern that matches
    routes: { ...(o.routes || {}), '': o.home || (cols.length === 1 ? c => section({ ...c, params: { col: cols[0] } }) : overview), ':col': section, ':col/:id': detail },
    detail: Object.fromEntries(cols.map(c => [c, (id, ctx) => entityDetailPage(c, id, ctx, { backHref: `#/${o.id}/${c}`, backLabel: getDef(c).label })]))
  };
}
