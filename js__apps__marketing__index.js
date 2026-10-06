/* marketing — built on the generic app engine: overview, sections, tables, forms, detail pages. */
import { kpiTile } from '../../ui/components.js';
import { db } from '../../core/db.js';
import { sumBy } from '../../core/money.js';
import { today, addDays, diffDays } from '../../core/dates.js';
import { makeApp } from '../_generic.js';

export default makeApp({
  id: 'marketing',
  sub: "Company profile, design & paving options with prices, and client references.",
  collections: ["design_options","references","services"]
});
void kpiTile; void sumBy; void today; void addDays; void diffDays; void db;
