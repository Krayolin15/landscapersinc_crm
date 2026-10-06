import { registerBadge, registerCreate } from '../../ui/shell.js';
import { registerAlertSource } from '../../core/notify.js';
import { registerSkill } from '../../ai/skills.js';
import { db } from '../../core/db.js';
import { store } from '../../core/bus.js';
import { triage } from './logic.js';

const me = () => store.get('user') || {};
const unread = () => db.filter('mail_flags', f => f.user_id === me().id && f.folder === 'inbox' && !f.read);

export default function () {
  registerBadge('mail', () => { const n = unread().length; const urgent = unread().some(f => { const m = db.get('mail_messages', f.message_id); return m && triage({ subject: m.subject, body: m.body_text }).key === 'emergency'; }); return { n, hot: urgent }; });
  registerCreate({ id: 'new-mail', label: 'Email', icon: 'mail', group: 'Workspace', app: 'mail', run: async () => (await import('./index.js')).compose() });
  registerAlertSource(() => {
    const out = [];
    for (const f of unread()) {
      const m = db.get('mail_messages', f.message_id); if (!m) continue;
      const c = triage({ subject: m.subject, body: m.body_text, attachments: m.attachments });
      if (c.key === 'emergency') out.push({ key: `mail-emergency|${m.id}`, title: 'Emergency email', body: `${m.from_name || m.from_email}: ${m.subject}`, link: `#/mail?m=${m.id}`, severity: 'danger', roles: '*', icon: 'siren', tile: 't-rose' });
    }
    const pend = db.filter('outbox', o => o.status === 'needs_approval').length;
    if (pend) out.push({ key: `outbox-approval|${pend}`, title: `${pend} message${pend === 1 ? '' : 's'} waiting for approval`, body: 'Payment reminders and notices prepared by the Autonomous Core.', link: '#/mail?f=outbox', severity: 'info', roles: ['manager', 'finance'], icon: 'send-horizontal', tile: 't-sun' });
    return out;
  });
  registerSkill({
    id: 'mail-unread', app: 'mail', label: 'Unread mail',
    examples: ['any new emails', 'do I have unread mail', 'any urgent emails'], keywords: ['email', 'emails', 'mail', 'inbox', 'unread'],
    run: () => {
      const list = unread().map(f => db.get('mail_messages', f.message_id)).filter(Boolean);
      return { text: list.length ? `${list.length} unread message${list.length === 1 ? '' : 's'}.` : 'No unread mail.', cards: list.length ? [{ type: 'list', items: list.slice(0, 8).map(m => ({ title: m.subject || '(no subject)', sub: `${m.from_name || m.from_email} · ${triage({ subject: m.subject, body: m.body_text }).label}`, href: `#/mail?m=${m.id}`, icon: 'mail' })) }] : [], actions: [{ label: 'Open Mail', href: '#/mail' }], sources: ['mail_messages'] };
    }
  });
}
