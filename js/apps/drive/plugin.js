import { registerCreate } from '../../ui/shell.js';
import { registerAction } from '../../core/search.js';
import { registerSkill } from '../../ai/skills.js';
import { db } from '../../core/db.js';
import { today, addDays } from '../../core/dates.js';
import { watchDates } from '../_expiry.js';

export default function () {
  registerCreate({ id: 'upload-files', label: 'Upload files', icon: 'upload', group: 'Workspace', app: 'drive', run: () => (location.hash = '#/drive') });
  registerAction({ id: 'drive-open', label: 'Open Drive', icon: 'hard-drive', keywords: 'drive files documents folders storage', app: 'drive', run: () => (location.hash = '#/drive') });
  registerAction({ id: 'drive-import', label: 'Import the document vault', icon: 'archive-restore', keywords: 'vault import zip documents originals', app: 'drive', run: () => (location.hash = '#/drive/import') });
  watchDates({ id: 'file-expiry', app: 'drive', col: 'files', field: 'expires_on', what: 'Document', title: r => r.name, icon: 'file-clock', tile: 't-rose', roles: ['manager', 'finance', 'hr'], windows: [60, 30, 7], defaultOn: false, calendarLabel: 'Document expiry dates' });
  registerSkill({
    id: 'drive-find', app: 'drive', label: 'Find a document',
    examples: ['find the b-bbee certificate', 'where is the sherq policy', 'which documents expire soon', 'find the bank confirmation letter'],
    keywords: ['find', 'where is', 'document', 'file', 'certificate', 'letter', 'pdf', 'expire soon'],
    run: q => {
      const low = q.toLowerCase();
      if (/expire|expiring|renew/.test(low)) {
        const soon = db.filter('files', f => f.expires_on && f.expires_on <= addDays(today(), 60)).sort((a, b) => a.expires_on.localeCompare(b.expires_on));
        return { text: soon.length ? `${soon.length} document${soon.length === 1 ? '' : 's'} expire within 60 days.` : 'No documents expire in the next 60 days.', cards: soon.length ? [{ type: 'list', items: soon.slice(0, 10).map(f => ({ title: f.name, sub: `expires ${f.expires_on}`, href: `#/record/files/${f.id}`, icon: 'file-clock' })) }] : [], sources: ['files'] };
      }
      const words = low.replace(/find|where is|the|a|an|document|file|please|show me/g, ' ').split(/\s+/).filter(w => w.length > 2);
      const hits = db.all('files').map(f => ({ f, s: words.reduce((a, w) => a + (String(f.name).toLowerCase().includes(w) ? 3 : 0) + (String(f.text_index || '').toLowerCase().includes(w) ? 1 : 0), 0) })).filter(x => x.s).sort((a, b) => b.s - a.s).slice(0, 8);
      return { text: hits.length ? `Found ${hits.length} matching document${hits.length === 1 ? '' : 's'}.` : 'No document matched — try other words.', cards: hits.length ? [{ type: 'list', items: hits.map(x => ({ title: x.f.name, sub: `${db.label('drives', x.f.drive_id) || 'My Drive'}${x.f.kind === 'pending' ? ' · waiting for vault import' : ''}`, href: `#/record/files/${x.f.id}`, icon: 'file-text' })) }] : [], actions: [{ label: 'Open Drive', href: '#/drive' }], sources: ['files'] };
    }
  });
}
