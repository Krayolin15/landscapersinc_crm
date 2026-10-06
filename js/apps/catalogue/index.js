/* catalogue — built on the generic app engine: overview, sections, tables, forms, detail pages. */
import { kpiTile } from '../../ui/components.js';
import { db } from '../../core/db.js';
import { sumBy } from '../../core/money.js';
import { today, addDays, diffDays } from '../../core/dates.js';
import { makeApp } from '../_generic.js';

export default makeApp({
  id: 'catalogue',
  collections: ["services","design_options"],
  kpis: () => [
    kpiTile({ label: "Active services", value: db.filter('services', s => s.active !== false).length, icon: 'tag', tile: 't-grass', href: '#/catalogue/services' }),
    kpiTile({ label: "Design & paving options", value: db.count('design_options'), icon: 'palette', tile: 't-sun', href: '#/catalogue/design_options' }),
    kpiTile({ label: "Weather-sensitive services", value: db.filter('services', s => s.weather_sensitive).length, icon: 'cloud-rain', tile: 't-sky', foot: 'rescheduled automatically in rain' }),
    kpiTile({ label: "Avg. standard rate", value: db.count('services') ? sumBy(db.all('services'), s => s.rate || 0) / db.count('services') : 0, icon: 'calculator', tile: 't-forest', format: 'money' })
  ]
});
void kpiTile; void sumBy; void today; void addDays; void diffDays; void db;
