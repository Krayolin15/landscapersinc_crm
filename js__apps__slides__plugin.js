import { registerCreate } from '../../ui/shell.js';
import { registerSkill } from '../../ai/skills.js';
import { db } from '../../core/db.js';
import { today } from '../../core/dates.js';
import { money } from '../../core/format.js';

export default function () {
  registerCreate({ id: 'new-slides', label: 'Presentation', icon: 'presentation', group: 'Workspace', app: 'slides', run: () => (location.hash = '#/slides/new') });
  registerSkill({
    id: 'slides-month-review', app: 'slides', label: 'Monthly review deck',
    examples: ['make a presentation for this month', 'build the monthly review slides', 'create a deck for last month'],
    keywords: ['presentation', 'deck', 'slides', 'review', 'monthly', 'pitch'],
    run: async q => {
      const { monthFigures, createDeck } = await import('./index.js');
      const { deckMonthly } = await import('./lib.js');
      const { company } = await import('../_biz.js');
      const d = new Date(`${today()}T12:00:00`); if (/last month|previous month/i.test(q)) d.setMonth(d.getMonth() - 1);
      const month = d.toISOString().slice(0, 7);
      const m = monthFigures(month);
      const deck = await createDeck(`Monthly review — ${m.monthLabel}`, deckMonthly(m, company()));
      return { text: `I built a ${deckMonthly(m, company()).length}-slide review for ${m.monthLabel}: ${money(m.invoiced)} invoiced, ${money(m.expenses)} expenses, ${m.visitsDone} visits completed.`,
        cards: [{ type: 'kpis', items: [{ label: 'Invoiced', value: money(m.invoiced) }, { label: 'Expenses', value: money(m.expenses) }, { label: 'Visits done', value: String(m.visitsDone) }, { label: 'New leads', value: String(m.newLeads) }] }],
        actions: [{ label: 'Open the deck', href: `#/slides/${encodeURIComponent(deck.id)}` }], sources: ['invoices', 'expenses', 'visits', 'leads'] };
    }
  });
  registerSkill({
    id: 'slides-find', app: 'slides', label: 'Find a presentation',
    examples: ['show my presentations', 'open the Carron Glen proposal'],
    keywords: ['presentation', 'presentations', 'proposal', 'deck', 'slides'],
    run: q => {
      const words = q.toLowerCase().split(/\W+/).filter(w => w.length > 2 && !['presentation', 'presentations', 'show', 'open', 'the', 'deck', 'decks', 'slides', 'my', 'have', 'all', 'any', 'list', 'there', 'are', 'our', 'what', 'which', 'find'].includes(w));
      const all = db.all('slides').sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')));
      const hits = words.length ? all.filter(s => words.some(w => String(s.title).toLowerCase().includes(w))) : all;
      return { text: hits.length ? `${hits.length} presentation${hits.length === 1 ? '' : 's'} found.` : 'No presentation matches that.', cards: hits.length ? [{ type: 'list', items: hits.slice(0, 10).map(s => ({ title: s.title, sub: `${(s.slides || []).length} slides`, href: `#/slides/${encodeURIComponent(s.id)}`, icon: 'presentation' })) }] : [], actions: [{ label: 'Open Slides', href: '#/slides' }], sources: ['slides'] };
    }
  });
}
