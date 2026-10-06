import { registerCreate } from '../../ui/shell.js';
import { registerAction } from '../../core/search.js';

export default function () {
  registerCreate({ id: 'new-note', label: 'Note', icon: 'sticky-note', group: 'Workspace', app: 'keep', run: () => (location.hash = '#/keep') });
  registerAction({ id: 'keep-open', label: 'Open Keep notes', icon: 'sticky-note', keywords: 'notes keep memo checklist', app: 'keep', run: () => (location.hash = '#/keep') });
}
