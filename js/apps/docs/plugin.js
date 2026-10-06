import { registerCreate } from '../../ui/shell.js';
import { registerAction } from '../../core/search.js';
import { registerCalendarSource } from '../../core/calendar-sources.js';
import { db } from '../../core/db.js';

export default function () {
  registerCreate({ id: 'new-doc', label: 'Document', icon: 'file-text', group: 'Workspace', app: 'docs', run: () => (location.hash = '#/docs/new') });
  registerAction({ id: 'docs-open', label: 'Open Docs', icon: 'file-text', keywords: 'docs documents letter write word', app: 'docs', run: () => (location.hash = '#/docs') });
  registerCalendarSource({ id: 'doc-reviews', label: 'Policy & SOP reviews', color: '#5fa83b', icon: 'book-open', app: 'docs', defaultOn: true,
    items: (from, to) => db.filter('docs', d => d.review_date && d.review_date >= from && d.review_date <= to).map(d => ({ id: `docrev-${d.id}`, date: d.review_date, title: `Review: ${d.title}`, subtitle: d.doc_code || '', link: `#/docs/${encodeURIComponent(d.id)}`, category: 'compliance' })) });
}
