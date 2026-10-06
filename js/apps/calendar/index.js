/* =============================================================================
   Calendar app — the company's shared calendar (Google-Calendar-class).
   Day / Week / Month / Year / Agenda views, drag to move/resize, recurrence,
   .ics import/export, holidays manager, and a Sage AI skill.
   ========================================================================== */

import { ensureStyle } from '../../ui/dom.js';
import { calendarPage, newEventPage } from './main-view.js';
import { eventDetailPage } from './event-detail.js';
import { holidaysPage } from './holidays-page.js';

ensureStyle('js/apps/calendar/style.css');

export default {
  id: 'calendar',
  fullWidth: true,
  routes: {
    '': ctx => calendarPage(ctx),
    'new': ctx => newEventPage(ctx),
    'event/:id': ctx => eventDetailPage(ctx.params.id, ctx),
    'holidays': ctx => holidaysPage(ctx)
  },
  detail: {
    events: (id, ctx) => eventDetailPage(id, ctx)
  }
};
