/* suppliers — built on the generic app engine: overview, sections, tables, forms, detail pages. */
import { kpiTile } from '../../ui/components.js';
import { db } from '../../core/db.js';
import { sumBy } from '../../core/money.js';
import { today, addDays, diffDays } from '../../core/dates.js';
import { makeApp } from '../_generic.js';

export default makeApp({
  id: 'suppliers',
  collections: ["suppliers","purchases"],
  kpis: () => [
    kpiTile({ label: "Suppliers", value: db.count('suppliers'), icon: 'store', tile: 't-clay', href: '#/suppliers/suppliers' }),
    kpiTile({ label: "Purchases", value: db.count('purchases'), icon: 'shopping-cart', tile: 't-sun', href: '#/suppliers/purchases' }),
    kpiTile({ label: "Total purchased", value: sumBy(db.all('purchases'), p => p.amount || 0), icon: 'banknote', tile: 't-forest', format: 'money' }),
    kpiTile({ label: "Awaiting delivery", value: db.filter('purchases', p => ['ordered', 'paid'].includes(p.status)).length, icon: 'package', tile: 't-sky' })
  ]
});
void kpiTile; void sumBy; void today; void addDays; void diffDays; void db;
