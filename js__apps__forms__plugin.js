import { registerBadge, registerCreate } from '../../ui/shell.js';
import { registerAlertSource } from '../../core/notify.js';
import { registerSkill } from '../../ai/skills.js';
import { db } from '../../core/db.js';
import { store } from '../../core/bus.js';
import { addDays, today, sastDay } from '../../core/dates.js';
import { worstRisk, canReadResponse, categoryReaders } from './logic.js';

// HR and incident responses are confidential (logic.js): nothing here counts, lists or alerts on one the person may not open
const readable = (pred = () => true) => { const u = store.get('user'); return db.filter('form_responses', r => pred(r) && canReadResponse(r, u, (db.get('forms', r.form_id) || {}).category)); };
const awaiting = r => (r.status || 'submitted') === 'submitted';

export default function () {
  registerBadge('forms', () => ({ n: readable(awaiting).length, hot: false }));
  registerCreate({ id: 'fill-checklist', label: 'Fill a checklist', icon: 'clipboard-check', group: 'Operations', app: 'forms', run: () => (location.hash = '#/forms') });
  registerAlertSource(() => {
    const out = [];
    const dayAgo = new Date(Date.now() - 864e5).toISOString();
    for (const r of readable(awaiting)) {
      const f = db.get('forms', r.form_id); if (!f) continue;
      const risk = worstRisk(f.questions || [], r.answers);
      const old = String(r.created_at) < dayAgo;
      if (risk >= 4 || (f.category === 'incident' && old)) out.push({ key: `form-review|${r.id}`, title: risk >= 4 ? `High-risk finding: ${f.title}` : `Incident form not reviewed: ${f.title}`, body: `Submitted by ${r.created_by_name || '—'} ${sastDay(r.created_at)}`, link: `#/forms/${encodeURIComponent(f.id)}/responses?r=${r.id}`, severity: risk >= 4 ? 'danger' : 'warn', roles: categoryReaders(f.category) || ['manager', 'operations', 'hr'], icon: 'siren', tile: 't-rose' });
    }
    return out;
  });
  registerSkill({
    id: 'forms-week', app: 'forms', label: 'Checklists submitted',
    examples: ['which checklists were submitted this week', 'was the fire equipment inspection done this month', 'any high risk findings'],
    keywords: ['checklist', 'checklists', 'inspection', 'form', 'forms', 'submitted', 'risk'],
    run: q => {
      const from = /month/.test(q.toLowerCase()) ? today().slice(0, 8) + '01' : addDays(today(), -7);
      const list = readable(r => sastDay(r.created_at) >= from).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
      // "not yet done" looks at every submission (a checklist is done whoever did it) but names only inspection forms
      const done = new Set(db.filter('form_responses', r => sastDay(r.created_at) >= from).map(r => r.form_id));
      const notDone = db.filter('forms', f => f.category === 'inspection' && f.accepting !== false && !done.has(f.id));
      return { text: `${list.length} form${list.length === 1 ? '' : 's'} submitted since ${from}.${notDone.length ? ` Not yet done: ${notDone.map(f => f.doc_code || f.title).join(', ')}.` : ''}`,
        cards: list.length ? [{ type: 'list', items: list.slice(0, 12).map(r => ({ title: r.form_title, sub: `${r.created_by_name || ''} · ${sastDay(r.created_at)}`, href: `#/forms/${encodeURIComponent(r.form_id)}/responses?r=${r.id}`, icon: 'clipboard-check' })) }] : [], actions: [{ label: 'Open Forms', href: '#/forms' }], sources: ['form_responses'] };
    }
  });
}
