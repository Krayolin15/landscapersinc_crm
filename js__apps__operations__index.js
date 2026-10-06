/* operations — built on the generic app engine: overview, sections, tables, forms, detail pages. */
import { kpiTile } from '../../ui/components.js';
import { db } from '../../core/db.js';
import { sumBy } from '../../core/money.js';
import { today, addDays, diffDays } from '../../core/dates.js';
import { makeApp } from '../_generic.js';

export default makeApp({
  id: 'operations',
  sub: "The operations workbook registers — jobs, maintenance, inspections and weekly KPIs — now live and shared.",
  collections: ["jobs","asset_maintenance","kpi_entries","visits"]
});
void kpiTile; void sumBy; void today; void addDays; void diffDays; void db;
