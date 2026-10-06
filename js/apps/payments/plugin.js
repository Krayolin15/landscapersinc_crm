import { registerBadge } from '../../ui/shell.js';
import { registerAction } from '../../core/search.js';
import { db } from '../../core/db.js';

export default function () {
  registerBadge('payments', () => { const n = db.filter('payments', p => p.status === 'awaiting_verification').length; return { n, hot: n > 0 }; });
  registerAction({ id: 'pay-pop', label: 'Match a proof of payment to an invoice', icon: 'scan-search', keywords: 'pop proof of payment match verify eft', app: 'payments', run: () => (location.hash = '#/payments?tab=pop') });
  registerAction({ id: 'pay-ageing', label: 'Debtors ageing (0–30 / 31–60 / 60+)', icon: 'hand-coins', keywords: 'debtors ageing aging owe statement', app: 'payments', run: () => (location.hash = '#/payments') });
}
