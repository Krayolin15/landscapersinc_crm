/* Admin → Groups: a thin, schema-driven CRUD page over the `groups` collection. */
import { entityListPage } from '../../ui/entity.js';
import { openRecordForm } from '../../ui/form.js';
import { adminNav } from './nav.js';

export function groupsPage(ctx) {
  return entityListPage('groups', ctx, {
    title: 'Groups', sub: 'Distribution lists used across Mail, Chat and sharing.',
    actions: [adminNav(ctx, 'groups')],
    onOpen: r => openRecordForm('groups', { id: r.id })
  });
}
