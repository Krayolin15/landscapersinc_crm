/* compliance — built on the generic app engine: overview, sections, tables, forms, detail pages. */
import { kpiTile } from '../../ui/components.js';
import { db } from '../../core/db.js';
import { sumBy } from '../../core/money.js';
import { today, addDays, diffDays } from '../../core/dates.js';
import { makeApp } from '../_generic.js';

export default makeApp({
  id: 'compliance',
  collections: ["compliance_docs","bank_accounts","data_issues"],
  kpis: () => [
    kpiTile({ label: "Company documents", value: db.count('compliance_docs'), icon: 'scale', tile: 't-slate', href: '#/compliance/compliance_docs' }),
    kpiTile({ label: "Expiring in 90 days", value: db.filter('compliance_docs', c => c.expiry_date && c.expiry_date >= today() && c.expiry_date <= addDays(today(), 90)).length, icon: 'timer', tile: 't-sun' }),
    kpiTile({ label: "Expired", value: db.filter('compliance_docs', c => c.expiry_date && c.expiry_date < today()).length, icon: 'badge-x', tile: 't-rose' }),
    kpiTile({ label: "Open data questions", value: db.filter('data_issues', d => d.status === 'open').length, icon: 'circle-help', tile: 't-violet', href: '#/compliance/data_issues' })
  ]
});
void kpiTile; void sumBy; void today; void addDays; void diffDays; void db;
