// Finance: monthly statements, expense ledger, payroll, deductions, owner funding,
// costing-sheet assets and the Adhoc job log. Source: knowledge/financials.json.
// September exists in two versions; the later file "LSI INCOME STATEMENT (1).xlsx" (A) is the ledger,
// differences from the earlier file (B) are kept in notes.
const A = 'LSI INCOME STATEMENT (1).xlsx';
const inA = r => !r.present_in || r.present_in.includes(A);
function expCategory(raw) {
  const t = String(raw || '').toUpperCase();
  if (/H100|NP ?200|VEHICLE PURCHASE/.test(t)) return ['Vehicle purchase', true];
  if (/GARDEN GREEN DESIGN/.test(t)) return ['Design & consulting', true];
  if (/FLEET VEHICLE|REPAIR/.test(t)) return ['Vehicle repairs', false];
  if (/FUEL CAP|OIL/.test(t)) return ['Machinery servicing & blades', false];
  if (/FUEL/.test(t)) return ['Fuel & transit', false];
  if (/CONSUMBLE|CONSUMABLE|BAGS/.test(t)) return ['Bags & consumables', false];
  if (/EQUIP/.test(t)) return ['Equipment', false];
  if (/PPE/.test(t)) return ['Protective gear (PPE)', false];
  if (/INSURANCE/.test(t)) return ['Insurance', false];
  if (/MEDICAL/.test(t)) return ['Medicals', false];
  if (/PRINT/.test(t)) return ['Printing & branding', false];
  if (/TELKOM|PHONE|INTERNET/.test(t)) return ['Telephone & internet', false];
  if (/STORAGE/.test(t)) return ['Storage', false];
  if (/CHEMICAL|HTH/.test(t)) return ['Chemical & fertilizer stock', false];
  if (/SARS/.test(t)) return ['SARS / tax', false];
  if (/ACCESS/.test(t)) return ['Access / site fees', false];
  if (/TRAILER/.test(t)) return ['Trailer', false];
  return ['Miscellaneous', false];
}
const ASSET_CAT = { vehicle: 'vehicle', trailer: 'trailer', power_tool: 'machine', machine: 'machine', hand_tool: 'hand_tool', ppe: 'ppe', branding: 'branding', marketing: 'branding', design: 'design', office: 'office' };
const title = s => String(s || '').toLowerCase().replace(/\b\w/g, c => c.toUpperCase()).trim();

export async function build(ctx) {
  const E = ctx.k('financials').entities;
  const out = { expenses: [], payroll: [], deductions: [], financial_periods: [], owner_funding: [], assets: [], jobs: [] };
  for (const x of E.expenses) {
    if (!inA(x)) continue;
    const [category, capital] = expCategory(x.category_normalised || x.category_raw);
    const other = E.expenses.find(y => y !== x && y.period === x.period && y.category_raw === x.category_raw && !inA(y));
    out.expenses.push({ id: ctx.id('exp', x.id), period: x.period, category, category_raw: String(x.category_raw).trim(), description: title(x.category_raw), amount: x.amount, is_capital: capital,
      version_note: [other && other.amount !== x.amount ? `Earlier September version had R${other.amount}` : null, x.included_in_sheet_total === false ? 'NOT included in the sheet\'s own total (formula skips this row)' : null].filter(Boolean).join(' · ') || null, _src: x._src });
  }
  for (const p of E.payroll_entries) {
    if (!inA(p)) continue;
    out.payroll.push({ id: ctx.id('pay', p.id), period: p.period, employee_name: title(p.employee_name), gross: p.amount, deductions: 0, net: p.amount, notes: p.line_type && p.line_type !== 'staff_cost' ? p.line_type : null, _src: p._src });
  }
  for (const d of E.payroll_deductions) {
    if (!inA(d)) continue;
    out.deductions.push({ id: ctx.id('ded', d.id), employee_name: title(d.employee_name), period: d.period, amount: d.amount, reason: d.reason || 'Not stated in the source', _src: d._src });
  }
  for (const m of E.monthly_statements) {
    if (!inA(m)) continue;
    out.financial_periods.push({
      id: ctx.id('fp', m.period), period: m.period, income_recorded: m.total_income ?? null, income_captured: m.total_income != null,
      staff_costs: m.staff_costs_total, operation_costs_recorded: m.operation_costs_total, operation_costs_lines: m.operation_costs_recomputed_all_lines ?? m.operation_costs_total,
      net_recorded: m.net_profit_loss, owner_funding: m.investment_in ?? null, status: 'closed',
      notes: [m.check_notes, m.discrepancy, m.total_income == null ? 'TOTAL INCOME is blank in the sheet — not captured yet.' : null, m.operation_costs_recomputed_all_lines != null && Math.abs(m.operation_costs_recomputed_all_lines - m.operation_costs_total) > 0.004 ? `Sheet total R${m.operation_costs_total} ≠ sum of its lines R${m.operation_costs_recomputed_all_lines} (a row is left out of the formula).` : null].filter(Boolean).join('\n') || null,
      _src: m._src
    });
  }
  for (const c of E.capital_injections) out.owner_funding.push({ id: ctx.id('own', c.id), period: c.period, amount: c.amount, kind: 'unknown', notes: [c.matches_negative_of_net === false ? `Does not equal the month's loss (R${c.net_profit_loss_same_month})` : null, c.amount < 0 ? 'Recorded with a negative sign (the cell is =B25) — every other month is positive.' : null].filter(Boolean).join(' · ') || 'Owner / shareholder funding to cover the month\'s loss (label "INVESTMENT IN")', _src: c._src });
  for (const a of E.assets) {
    const raw = a.rand_value_raw ?? a.rand_value;
    const cost = typeof a.rand_value === 'number' ? a.rand_value : null;
    out.assets.push({ id: ctx.id('ast', 'costing', a.row), name: a.item_trimmed || a.item, category: ASSET_CAT[a.asset_category] || 'other', quantity: a.quantity ?? 1, cost, cost_raw: cost == null ? String(raw ?? '(blank)') : null, register: 'costing_sheet', status: 'active', condition: 'good', notes: [a.interpretation_note, a.value_basis_note && a.quantity > 1 ? `Value is for the full quantity (${a.quantity}).` : null].filter(Boolean).join(' ') || null, _src: a._src });
  }
  for (const j of E.jobs) {
    if (!inA(j)) continue;
    out.jobs.push({ id: ctx.id('job', 'adhoclog', j.id), title: j.description || 'Ad-hoc job', month: j.period, status: 'completed', cost: j.cost ?? null, profit: j.profit ?? null, value: j.price_charged_derived ?? (j.cost != null && j.profit != null ? j.cost + j.profit : null), site_address: j.site_or_client || null, service_type: /sod|lawn/i.test(j.description) ? 'lawn' : /rubble|clean/i.test(j.description) ? 'cleanup' : /pressure/i.test(j.description) ? 'pressure_cleaning' : /tree/i.test(j.description) ? 'tree' : /design/i.test(j.description) ? 'design' : /paint/i.test(j.description) ? 'other' : /plant/i.test(j.description) ? 'planting' : 'other', notes: 'From the income-statement Adhoc log (cost and profit per job; price = cost + profit). No client or exact date recorded.', _src: j._src });
  }
  return out;
}
