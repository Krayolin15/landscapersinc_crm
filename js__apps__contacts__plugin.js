import { registerCreate } from '../../ui/shell.js';
import { registerSkill } from '../../ai/skills.js';

export default function () {
  registerCreate({ id: 'new-contact', label: 'Contact', icon: 'user-plus', group: 'Workspace', app: 'contacts', run: async () => (await import('../../ui/form.js')).openRecordForm('contacts') });
  registerSkill({
    id: 'contacts-find', app: 'contacts', label: 'Find someone’s number',
    examples: ['what is aston moodley’s number', 'phone number for the sars contact centre', 'email for pam golding'],
    keywords: ['number', 'phone', 'cell', 'email', 'contact details', 'call'],
    run: async q => {
      const { directory } = await import('./index.js');
      const words = q.toLowerCase().replace(/what is|what's|phone|number|numbers|cell|email|for|the|contact|details|’s|'s/g, ' ').split(/\s+/).filter(w => w.length > 2);
      const hits = directory().map(c => ({ c, s: words.filter(w => `${c.name} ${c.company || ''}`.toLowerCase().includes(w)).length })).filter(x => x.s).sort((a, b) => b.s - a.s).slice(0, 6).map(x => x.c);
      if (!hits.length) return { text: 'I couldn’t find that person in the contacts.', actions: [{ label: 'Open Contacts', href: '#/contacts' }] };
      return { text: hits.map(c => `${c.name}${c.company ? ` (${c.company})` : ''}: ${[c.phone, c.email].filter(Boolean).join(' · ') || 'no phone or email on record'}`).join('\n'), actions: [{ label: 'Open Contacts', href: '#/contacts' }], sources: ['contacts', 'clients', 'suppliers', 'employees'] };
    }
  });
}
