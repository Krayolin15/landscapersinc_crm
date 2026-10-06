import { registerAction } from '../../core/search.js';

export default function () {
  registerAction({ id: 'home-briefing', label: 'Today’s daily briefing', icon: 'sunrise', keywords: 'home briefing today dashboard morning summary', app: 'home', run: () => (location.hash = '#/home') });
}
