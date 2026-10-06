/* fleet — built on the generic app engine: overview, sections, tables, forms, detail pages. */
import { kpiTile } from '../../ui/components.js';
import { db } from '../../core/db.js';
import { sumBy } from '../../core/money.js';
import { today, addDays, diffDays } from '../../core/dates.js';
import { makeApp } from '../_generic.js';

export default makeApp({
  id: 'fleet',
  collections: ["vehicles","vehicle_logs"],
  kpis: () => [
    kpiTile({ label: "Vehicles", value: db.filter('vehicles', v => v.status !== 'sold').length, icon: 'truck', tile: 't-slate', href: '#/fleet/vehicles' }),
    kpiTile({ label: "Fuel this month", value: sumBy(db.filter('vehicle_logs', l => l.type === 'fuel' && String(l.date).startsWith(today().slice(0, 7))), l => l.amount || 0), icon: 'fuel', tile: 't-clay', format: 'money' }),
    kpiTile({ label: "Services due (30 days)", value: db.filter('vehicles', v => v.next_service_date && v.next_service_date <= addDays(today(), 30)).length, icon: 'wrench', tile: 't-sun' }),
    kpiTile({ label: "Licences due (60 days)", value: db.filter('vehicles', v => v.licence_expiry && v.licence_expiry <= addDays(today(), 60)).length, icon: 'badge-alert', tile: 't-rose' })
  ]
});
void kpiTile; void sumBy; void today; void addDays; void diffDays; void db;
