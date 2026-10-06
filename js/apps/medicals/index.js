/* medicals — built on the generic app engine: overview, sections, tables, forms, detail pages. */
import { kpiTile } from '../../ui/components.js';
import { db } from '../../core/db.js';
import { sumBy } from '../../core/money.js';
import { today, addDays, diffDays } from '../../core/dates.js';
import { makeApp } from '../_generic.js';

export default makeApp({
  id: 'medicals',
  sub: "Occupational fitness certificates. Clinical details stay confidential — only the fitness outcome and expiry are shown.",
  collections: ["medicals"],
  kpis: () => [
    kpiTile({ label: "Medicals on file", value: db.count('medicals'), icon: 'heart-pulse', tile: 't-rose' }),
    kpiTile({ label: "Fit", value: db.filter('medicals', m => /fit/.test(m.outcome || '') && !/unfit/.test(m.outcome || '')).length, icon: 'circle-check', tile: 't-grass' }),
    kpiTile({ label: "Expiring in 60 days", value: db.filter('medicals', m => m.expiry_date && m.expiry_date >= today() && m.expiry_date <= addDays(today(), 60)).length, icon: 'timer', tile: 't-sun' }),
    kpiTile({ label: "Expired", value: db.filter('medicals', m => m.expiry_date && m.expiry_date < today()).length, icon: 'badge-x', tile: 't-rose' })
  ]
});
void kpiTile; void sumBy; void today; void addDays; void diffDays; void db;
