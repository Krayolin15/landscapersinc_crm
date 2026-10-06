/* strategy — built on the generic app engine: overview, sections, tables, forms, detail pages. */
import { kpiTile } from '../../ui/components.js';
import { db } from '../../core/db.js';
import { sumBy } from '../../core/money.js';
import { today, addDays, diffDays } from '../../core/dates.js';
import { makeApp } from '../_generic.js';

export default makeApp({
  id: 'strategy',
  collections: ["goals","meetings"],
  kpis: () => [
    kpiTile({ label: "Goals", value: db.count('goals'), icon: 'mountain', tile: 't-clay', href: '#/strategy/goals' }),
    kpiTile({ label: "On track", value: db.filter('goals', g => g.status === 'on_track').length, icon: 'circle-check', tile: 't-grass' }),
    kpiTile({ label: "At risk / behind", value: db.filter('goals', g => ['at_risk', 'behind'].includes(g.status)).length, icon: 'triangle-alert', tile: 't-rose' }),
    kpiTile({ label: "Average progress", value: db.count('goals') ? sumBy(db.all('goals'), g => g.progress || 0) / db.count('goals') : 0, icon: 'gauge', tile: 't-sun', format: 'pct' })
  ]
});
void kpiTile; void sumBy; void today; void addDays; void diffDays; void db;
