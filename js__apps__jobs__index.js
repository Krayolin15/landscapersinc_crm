/* jobs — built on the generic app engine: overview, sections, tables, forms, detail pages. */
import { kpiTile } from '../../ui/components.js';
import { db } from '../../core/db.js';
import { sumBy } from '../../core/money.js';
import { today, addDays, diffDays } from '../../core/dates.js';
import { makeApp } from '../_generic.js';

export default makeApp({
  id: 'jobs',
  collections: ["jobs","job_costs"],
  kpis: () => [
    kpiTile({ label: "Open jobs", value: db.filter('jobs', x => ['scheduled', 'in_progress', 'awaiting_deposit', 'on_hold'].includes(x.status)).length, icon: 'shovel', tile: 't-clay', href: '#/jobs/jobs' }),
    kpiTile({ label: "Work in hand", value: sumBy(db.filter('jobs', x => ['scheduled', 'in_progress', 'awaiting_deposit', 'on_hold'].includes(x.status)), x => x.value || 0), icon: 'briefcase', tile: 't-sun', format: 'money' }),
    kpiTile({ label: "Completed value", value: sumBy(db.filter('jobs', x => ['completed', 'invoiced', 'closed_paid'].includes(x.status)), x => x.value || 0), icon: 'circle-check', tile: 't-grass', format: 'money' }),
    kpiTile({ label: "Recorded profit", value: sumBy(db.all('jobs'), x => x.profit || 0), icon: 'trending-up', tile: 't-forest', format: 'money', foot: 'where profit was captured' })
  ]
});
void kpiTile; void sumBy; void today; void addDays; void diffDays; void db;
