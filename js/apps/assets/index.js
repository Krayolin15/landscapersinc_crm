/* assets — built on the generic app engine: overview, sections, tables, forms, detail pages. */
import { kpiTile } from '../../ui/components.js';
import { db } from '../../core/db.js';
import { sumBy } from '../../core/money.js';
import { today, addDays, diffDays } from '../../core/dates.js';
import { makeApp } from '../_generic.js';

export default makeApp({
  id: 'assets',
  collections: ["assets","asset_maintenance"],
  kpis: () => [
    kpiTile({ label: "Assets", value: db.filter('assets', a => a.status !== 'disposed').length, icon: 'wrench', tile: 't-slate', href: '#/assets/assets' }),
    kpiTile({ label: "Recorded value", value: sumBy(db.filter('assets', a => a.status !== 'disposed'), a => a.cost || 0), icon: 'coins', tile: 't-forest', format: 'money' }),
    kpiTile({ label: "Open repairs", value: db.filter('asset_maintenance', m => m.status !== 'closed').length, icon: 'hammer', tile: 't-clay', href: '#/assets/asset_maintenance' }),
    kpiTile({ label: "Service due (30 days)", value: db.filter('assets', a => a.next_service_date && a.next_service_date <= addDays(today(), 30)).length, icon: 'calendar-clock', tile: 't-sun' })
  ]
});
void kpiTile; void sumBy; void today; void addDays; void diffDays; void db;
