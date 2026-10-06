import { registerAction } from '../../core/search.js';

export default function () {
  registerAction({ id: 'settings-open', label: 'My settings — profile, password, theme', icon: 'settings', keywords: 'settings profile password theme preferences notifications avatar signature', app: 'settings', run: () => (location.hash = '#/settings') });
  registerAction({ id: 'settings-shortcuts', label: 'Keyboard shortcuts reference', icon: 'keyboard', keywords: 'keyboard shortcuts hotkeys help ctrl k', app: 'settings', run: () => (location.hash = '#/settings') });
  registerAction({ id: 'settings-install', label: 'Install this app on your phone', icon: 'smartphone', keywords: 'install app home screen pwa offline android ios', app: 'settings', run: () => (location.hash = '#/settings') });
}
