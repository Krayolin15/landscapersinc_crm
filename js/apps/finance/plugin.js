import { registerCreate } from '../../ui/shell.js';
import { registerSkill } from '../../ai/skills.js';
import { db } from '../../core/db.js';
import { formatMoney, sumBy } from '../../core/money.js';
import { today } from '../../core/dates.js';

export default function () {
  registerCreate({ id: 'new-expense', label: 'Expense', icon: 'receipt-text', group: 'Money', app: 'finance', run: async () => { const { openRecordForm } = await import('../../ui/form.js'); openRecordForm('expenses', { values: { period: today().slice(0, 7), date: today() } }); } });
  registerSkill({
    id: 'finance-pl', app: 'finance', label: 'Profit & loss',
    examples: ['did we make a profit in august', 'income statement', 'what did we spend on fuel', 'expenses this month', 'how much has the owner invested'],
    keywords: ['profit', 'loss', 'income statement', 'expenses', 'spend', 'spent', 'costs', 'fuel', 'owner', 'investment', 'net'],
    run: async (q, ents) => {
      const { monthRows } = await import('./index.js');
      const months = ents.months && ents.months.length ? ents.months : [...new Set(db.all('financial_periods').map(p => p.period))].sort().slice(-3);
      const rows = monthRows(months);
      const cat = (q.match(/fuel|insurance|ppe|equipment|vehicle|medical|printing|storage|chemical|design/i) || [])[0];
      const cards = [{ type: 'table', columns: [{ key: 'period', label: 'Month' }, { key: 'income', label: 'Income', format: 'money' }, { key: 'costs', label: 'Costs', format: 'money' }, { key: 'net', label: 'Net', format: 'money' }, { key: 'owner', label: 'Owner in', format: 'money' }], rows: rows.map(r => ({ period: r.period, income: r.income, costs: r.costs, net: r.net, owner: r.owner })) }];
      let text = rows.map(r => `${r.period}: income ${formatMoney(r.income || 0)}, costs ${formatMoney(r.costs || 0)}, net ${formatMoney(r.net || 0)}`).join('; ') + '.';
      if (cat) { const lines = db.filter('expenses', e => new RegExp(cat, 'i').test(`${e.category} ${e.description}`)); text = `${lines.length} expense lines matching “${cat}” total ${formatMoney(sumBy(lines, 'amount'))}. ` + text; }
      const owner = sumBy(db.all('owner_funding'), 'amount');
      if (/owner|invest/i.test(q)) text = `The owner has put in ${formatMoney(owner)} in total to cover shortfalls. ` + text;
      return { text, cards, actions: [{ label: 'Open Finance', href: '#/finance' }], sources: ['financial_periods', 'expenses', 'invoices', 'payroll'] };
    }
  });
}
