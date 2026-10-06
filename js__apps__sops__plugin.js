import { registerBadge } from '../../ui/shell.js';
import { registerAlertSource } from '../../core/notify.js';
import { registerSkill } from '../../ai/skills.js';
import { db } from '../../core/db.js';
import { today, addDays } from '../../core/dates.js';

const CONTROLLED = ['policy', 'procedure', 'sop', 'job_description'];

export default function () {
  registerBadge('sops', () => ({ n: db.filter('docs', d => CONTROLLED.includes(d.category) && d.review_date && d.review_date < today()).length, hot: false }));
  registerAlertSource(() => db.filter('docs', d => CONTROLLED.includes(d.category) && d.review_date && d.review_date <= addDays(today(), 30)).map(d => ({
    key: `doc-review|${d.id}|${d.review_date < today() ? 'overdue' : 'due'}`, title: d.review_date < today() ? 'Policy review overdue' : 'Policy review due', body: `${d.doc_code ? d.doc_code + ' · ' : ''}${d.title} — ${d.review_date}`,
    link: `#/docs/${encodeURIComponent(d.id)}`, due: d.review_date, severity: d.review_date < today() ? 'warn' : 'info', roles: ['manager', 'hr', 'operations'], icon: 'book-open', tile: 't-grass'
  })));
  registerSkill({
    id: 'sops-review', app: 'sops', label: 'Policies & SOPs',
    examples: ['which policies are overdue for review', 'who has not acknowledged the smoking policy', 'show me the ppe policy', 'what does the job execution sop say'],
    keywords: ['policy', 'policies', 'sop', 'procedure', 'acknowledged', 'review', 'rule'],
    run: q => {
      const low = q.toLowerCase();
      const docs = db.filter('docs', d => CONTROLLED.includes(d.category));
      if (/overdue|due for review|review/.test(low) && !/who/.test(low)) {
        const over = docs.filter(d => d.review_date && d.review_date < today());
        return { text: over.length ? `${over.length} controlled document${over.length === 1 ? ' is' : 's are'} overdue for review.` : 'No policy or SOP is overdue for review.', cards: over.length ? [{ type: 'list', items: over.map(d => ({ title: `${d.doc_code || ''} ${d.title}`.trim(), sub: `review was due ${d.review_date}`, href: `#/docs/${encodeURIComponent(d.id)}`, icon: 'alarm-clock' })) }] : [], sources: ['docs'] };
      }
      const words = low.replace(/who|has|have|not|acknowledged|show|me|the|what|does|say|policy|procedure|sop/g, ' ').split(/\s+/).filter(w => w.length > 2);
      const doc = docs.map(d => ({ d, s: words.filter(w => d.title.toLowerCase().includes(w)).length })).filter(x => x.s).sort((a, b) => b.s - a.s)[0];
      if (!doc) return { text: 'Which policy or SOP? Try its name, e.g. “the smoking policy”.', actions: [{ label: 'Open SOPs & Policies', href: '#/sops' }] };
      const d = doc.d;
      if (/who/.test(low)) {
        const missing = db.filter('profiles', p => p.status !== 'suspended' && !(d.acknowledgements || []).some(a => a.user_id === p.id));
        return { text: missing.length ? `${missing.length} people have not acknowledged “${d.title}”: ${missing.map(p => p.name).join(', ')}.` : `Everyone has acknowledged “${d.title}”.`, actions: [{ label: 'Open document', href: `#/docs/${encodeURIComponent(d.id)}` }], sources: ['docs', 'profiles'] };
      }
      return { text: `${d.title}${d.doc_code ? ` (${d.doc_code})` : ''}: ${String(d.text || '').slice(0, 600)}${(d.text || '').length > 600 ? '…' : ''}`, actions: [{ label: 'Read the full document', href: `#/docs/${encodeURIComponent(d.id)}` }], sources: ['docs'] };
    }
  });
}
