/* safety — built on the generic app engine: overview, sections, tables, forms, detail pages. */
import { kpiTile } from '../../ui/components.js';
import { db } from '../../core/db.js';
import { sumBy } from '../../core/money.js';
import { today, addDays, diffDays } from '../../core/dates.js';
import { makeApp } from '../_generic.js';

export default makeApp({
  id: 'safety',
  collections: ["incidents","ppe_issues","appointments","toolbox_talks"],
  kpis: () => [
    kpiTile({ label: "Open incidents", value: db.filter('incidents', i => i.status !== 'closed').length, icon: 'siren', tile: 't-rose', href: '#/safety/incidents' }),
    kpiTile({ label: "Days since last incident", value: (() => { const d = db.all('incidents').map(i => i.date).filter(Boolean).sort().pop(); return d ? diffDays(d, today()) : 'None logged'; })(), icon: 'shield-check', tile: 't-grass' }),
    kpiTile({ label: "PPE issues", value: db.count('ppe_issues'), icon: 'hard-hat', tile: 't-sun', href: '#/safety/ppe_issues' }),
    kpiTile({ label: "Legal appointments", value: db.count('appointments'), icon: 'stamp', tile: 't-violet', href: '#/safety/appointments' })
  ]
});
void kpiTile; void sumBy; void today; void addDays; void diffDays; void db;
