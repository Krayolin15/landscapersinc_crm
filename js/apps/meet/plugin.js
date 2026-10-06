import { registerCreate } from '../../ui/shell.js';
import { registerAction } from '../../core/search.js';

export default function () {
  registerCreate({ id: 'new-meet', label: 'Video meeting', icon: 'video', group: 'Workspace', app: 'meet', run: async () => (await import('./index.js')).schedule() });
  registerAction({ id: 'meet-now', label: 'Start a video meeting now', icon: 'video', keywords: 'meet video call zoom teams conference', app: 'meet', run: () => (location.hash = `#/meet?room=${Math.random().toString(36).slice(2, 12)}`) });
}
