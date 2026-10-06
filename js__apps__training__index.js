/* training — built on the generic app engine: overview, sections, tables, forms, detail pages. */
import { kpiTile } from '../../ui/components.js';
import { db } from '../../core/db.js';
import { sumBy } from '../../core/money.js';
import { today, addDays, diffDays } from '../../core/dates.js';
import { makeApp } from '../_generic.js';

export default makeApp({
  id: 'training',
  collections: ["certificates","toolbox_talks"],
  kpis: () => [
    kpiTile({ label: "Certificates", value: db.count('certificates'), icon: 'award', tile: 't-river', href: '#/training/certificates' }),
    kpiTile({ label: "Expiring in 90 days", value: db.filter('certificates', c => c.expiry_date && c.expiry_date >= today() && c.expiry_date <= addDays(today(), 90)).length, icon: 'timer', tile: 't-sun' }),
    kpiTile({ label: "Expired", value: db.filter('certificates', c => c.expiry_date && c.expiry_date < today()).length, icon: 'badge-x', tile: 't-rose' }),
    kpiTile({ label: "Toolbox talks", value: db.count('toolbox_talks'), icon: 'megaphone', tile: 't-grass', href: '#/training/toolbox_talks' })
  ]
});
void kpiTile; void sumBy; void today; void addDays; void diffDays; void db;
