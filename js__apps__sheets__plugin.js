import { registerCreate } from '../../ui/shell.js';
import { registerSkill } from '../../ai/skills.js';
import { db } from '../../core/db.js';

export default function () {
  registerCreate({ id: 'new-sheet', label: 'Spreadsheet', icon: 'sheet', group: 'Workspace', app: 'sheets', run: () => (location.hash = '#/sheets/new') });
  registerSkill({
    id: 'sheets-find', app: 'sheets', label: 'Find a spreadsheet',
    examples: ['open the budget spreadsheet', 'which spreadsheets did Wayne edit', 'show my spreadsheets'],
    keywords: ['spreadsheet', 'spreadsheets', 'sheet', 'sheets', 'excel', 'workbook'],
    run: q => {
      const words = q.toLowerCase().split(/\W+/).filter(w => w.length > 2 && !['spreadsheet', 'spreadsheets', 'sheet', 'sheets', 'open', 'show', 'the', 'which', 'did', 'edit', 'edited', 'excel', 'workbook', 'workbooks', 'my', 'have', 'all', 'any', 'list', 'there', 'are', 'our', 'what', 'find'].includes(w));
      const all = db.all('sheets').sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')));
      const hits = words.length ? all.filter(s => words.some(w => `${s.title} ${s.updated_by_name || ''} ${s.created_by_name || ''}`.toLowerCase().includes(w))) : all;
      return { text: hits.length ? `${hits.length} spreadsheet${hits.length === 1 ? '' : 's'}${words.length ? ` matching “${words.join(' ')}”` : ''}.` : 'No spreadsheet matches that.',
        cards: hits.length ? [{ type: 'list', items: hits.slice(0, 10).map(s => ({ title: s.title, sub: `${(s.tabs || []).length} tabs · edited ${String(s.updated_at || s.created_at || '').slice(0, 10)}${s.updated_by_name ? ' by ' + s.updated_by_name : ''}`, href: `#/sheets/${encodeURIComponent(s.id)}`, icon: 'sheet' })) }] : [],
        actions: [{ label: 'Open Sheets', href: '#/sheets' }, { label: 'New spreadsheet', href: '#/sheets/new' }], sources: ['sheets'] };
    }
  });
}
