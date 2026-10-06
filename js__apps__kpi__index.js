/* kpi — built on the generic app engine: overview, sections, tables, forms, detail pages. */
import { kpiTile } from '../../ui/components.js';
import { db } from '../../core/db.js';
import { sumBy } from '../../core/money.js';
import { today, addDays, diffDays } from '../../core/dates.js';
import { makeApp } from '../_generic.js';

export default makeApp({
  id: 'kpi',
  sub: "Sales and management KPI trackers, weekly scores and meeting minutes.",
  collections: ["kpi_definitions","kpi_entries","meetings"]
});
void kpiTile; void sumBy; void today; void addDays; void diffDays; void db;
