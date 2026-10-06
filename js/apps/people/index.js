/* people — built on the generic app engine: overview, sections, tables, forms, detail pages. */
import { kpiTile } from '../../ui/components.js';
import { db } from '../../core/db.js';
import { sumBy } from '../../core/money.js';
import { today, addDays, diffDays } from '../../core/dates.js';
import { makeApp } from '../_generic.js';

export default makeApp({
  id: 'people',
  collections: ["employees","payroll","deductions","hr_actions"],
  kpis: () => [
    kpiTile({ label: "Active staff", value: db.filter('employees', e => e.status === 'active').length, icon: 'id-card', tile: 't-forest', href: '#/people/employees' }),
    kpiTile({ label: "Ex-employees", value: db.filter('employees', e => e.status && e.status !== 'active' && e.status !== 'on_leave').length, icon: 'user-x', tile: 't-slate' }),
    kpiTile({ label: "Wages, last recorded month", value: (() => { const ps = [...new Set(db.all('payroll').map(p => p.period).filter(Boolean))].sort(); const last = ps[ps.length - 1]; return last ? sumBy(db.filter('payroll', p => p.period === last), p => p.gross || 0) : 0; })(), icon: 'wallet', tile: 't-grass', format: 'money' }),
    kpiTile({ label: "Open HR matters", value: db.filter('hr_actions', a => a.status === 'open').length, icon: 'gavel', tile: 't-rose', href: '#/people/hr_actions' })
  ]
});
void kpiTile; void sumBy; void today; void addDays; void diffDays; void db;
