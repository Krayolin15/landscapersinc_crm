import { registerBadge, registerCreate } from '../../ui/shell.js';
import { db } from '../../core/db.js';
import { store } from '../../core/bus.js';

export default function () {
  registerBadge('chat', () => {
    const me = store.get('user') || {};
    const chans = db.filter('chat_channels', c => (!c.private && c.kind === 'space') || (c.members || []).includes(me.id));
    let n = 0;
    for (const c of chans) {
      const last = (db.find('chat_reads', r => r.channel_id === c.id && r.user_id === me.id) || {}).last_read_at || '';
      n += db.filter('chat_messages', m => m.channel_id === c.id && m.created_by !== me.id && String(m.created_at) > last).length;
    }
    return { n, hot: n > 0 };
  });
  registerCreate({ id: 'new-chat', label: 'Chat message', icon: 'message-square', group: 'Workspace', app: 'chat', run: () => (location.hash = '#/chat') });
}
