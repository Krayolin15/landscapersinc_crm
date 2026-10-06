// Calendar app — pure logic tests:  node tests/calendar.test.js
import assert from 'node:assert/strict';
import { layoutColumns, exportEventsICS, exportOccurrencesICS, parseICS, recurrenceToRRule, rruleToRecurrence, parseNaturalDate, parseNaturalTime, minutesReminderLabel, heatLevel } from '../js/apps/calendar/logic.js';
import { occurrences } from '../js/core/recurrence.js';

let passed = 0, failed = 0;
const t = (name, fn) => { try { fn(); passed++; } catch (e) { failed++; console.error('✗', name, '\n ', e.message); } };

/* ---------------- overlap column layout ---------------- */
t('two overlapping events get 2 columns', () => {
  const map = layoutColumns([{ id: 'a', start: 600, end: 660 }, { id: 'b', start: 630, end: 690 }]);
  assert.equal(map.get('a').cols, 2); assert.equal(map.get('b').cols, 2);
  assert.notEqual(map.get('a').col, map.get('b').col);
});
t('non-overlapping events each get the full column', () => {
  const map = layoutColumns([{ id: 'a', start: 540, end: 600 }, { id: 'b', start: 600, end: 660 }]);
  assert.equal(map.get('a').cols, 1); assert.equal(map.get('b').cols, 1);
  assert.equal(map.get('a').col, 0); assert.equal(map.get('b').col, 0);
});
t('three-way overlap needs 3 columns, a later solo event stays full width', () => {
  const map = layoutColumns([
    { id: 'a', start: 540, end: 600 }, { id: 'b', start: 545, end: 610 }, { id: 'c', start: 550, end: 605 },
    { id: 'd', start: 700, end: 730 }
  ]);
  assert.equal(map.get('a').cols, 3); assert.equal(map.get('b').cols, 3); assert.equal(map.get('c').cols, 3);
  assert.equal(new Set([map.get('a').col, map.get('b').col, map.get('c').col]).size, 3);
  assert.equal(map.get('d').cols, 1);
});
t('a third event that starts after one of the first two ends can reuse its column', () => {
  const map = layoutColumns([{ id: 'a', start: 540, end: 570 }, { id: 'b', start: 545, end: 620 }, { id: 'c', start: 575, end: 600 }]);
  // a and c do not overlap (570 <= 575) so c can share a's column; the cluster still needs 2 columns overall (b spans the whole thing)
  assert.equal(map.get('a').cols, 2); assert.equal(map.get('b').cols, 2); assert.equal(map.get('c').cols, 2);
  assert.equal(map.get('a').col, map.get('c').col);
  assert.notEqual(map.get('b').col, map.get('a').col);
});

/* ---------------- ICS export / import roundtrip ---------------- */
t('single timed event roundtrips through .ics', () => {
  const ev = { id: 'e1', title: 'Site visit — Umhlanga', start_date: '2026-09-10', start_time: '10:00', end_date: '2026-09-10', end_time: '11:00', location: 'Umhlanga', description: 'Bring the drone', recurrence: 'none' };
  const ics = exportEventsICS([ev]);
  assert.match(ics, /BEGIN:VCALENDAR/); assert.match(ics, /TZID:Africa\/Johannesburg/); assert.match(ics, /SUMMARY:Site visit — Umhlanga/);
  const [parsed] = parseICS(ics);
  assert.equal(parsed.title, 'Site visit — Umhlanga');
  assert.equal(parsed.start_date, '2026-09-10'); assert.equal(parsed.start_time, '10:00');
  assert.equal(parsed.end_date, '2026-09-10'); assert.equal(parsed.end_time, '11:00');
  assert.equal(parsed.location, 'Umhlanga'); assert.equal(parsed.description, 'Bring the drone');
  assert.equal(parsed.all_day, false);
});
t('all-day multi-day event roundtrips (DTEND exclusive handled)', () => {
  const ev = { id: 'e2', title: 'Trade show', start_date: '2026-09-10', end_date: '2026-09-12', all_day: true, recurrence: 'none' };
  const ics = exportEventsICS([ev]);
  const [parsed] = parseICS(ics);
  assert.equal(parsed.all_day, true);
  assert.equal(parsed.start_date, '2026-09-10');
  assert.equal(parsed.end_date, '2026-09-12');
});
t('weekly recurrence with UNTIL roundtrips', () => {
  const ev = { id: 'e3', title: 'Team standup', start_date: '2026-09-07', start_time: '08:00', end_time: '08:15', recurrence: 'weekly', recurrence_until: '2026-10-05' };
  const ics = exportEventsICS([ev]);
  assert.match(ics, /RRULE:FREQ=WEEKLY;UNTIL=20261005/);
  const [parsed] = parseICS(ics);
  assert.equal(parsed.recurrence, 'weekly');
  assert.equal(parsed.recurrence_until, '2026-10-05');
});
t('fortnightly / quarterly / weekdays map both ways', () => {
  for (const rec of ['daily', 'weekdays', 'weekly', 'fortnightly', 'monthly', 'quarterly', 'yearly']) {
    const rr = recurrenceToRRule({ recurrence: rec, start_date: '2026-09-08' });
    assert.equal(rruleToRecurrence(rr).recurrence, rec, `${rec} -> ${rr} -> ${rruleToRecurrence(rr).recurrence}`);
  }
});
t('monthly_nth (2nd Tuesday) exports a BYDAY rule that maps back to monthly_nth', () => {
  const rr = recurrenceToRRule({ recurrence: 'monthly_nth', start_date: '2026-09-08' }); // a Tuesday, 2nd of the month
  assert.equal(rr, 'FREQ=MONTHLY;BYDAY=2TU');
  assert.equal(rruleToRecurrence(rr).recurrence, 'monthly_nth');
});
t('export of visible occurrences drops the RRULE (each instance is its own VEVENT)', () => {
  const ev = { id: 'e4', title: 'Weekly wash', start_date: '2026-09-01', start_time: '09:00', end_time: '09:30', recurrence: 'weekly' };
  const occs = occurrences(ev, '2026-09-01', '2026-09-30');
  const ics = exportOccurrencesICS(occs);
  const parsed = parseICS(ics);
  assert.equal(parsed.length, occs.length);
  assert.ok(parsed.every(p => p.recurrence === 'none'));
  assert.deepEqual(parsed.map(p => p.start_date), occs.map(o => o.date));
});
t('long summary lines are folded and unfold back to the same text', () => {
  const ev = { id: 'e5', title: 'A very long event title that will certainly exceed the seventy-five octet line length limit imposed by RFC 5545 on unfolded content lines', start_date: '2026-09-10', recurrence: 'none' };
  const ics = exportEventsICS([ev]);
  assert.ok(ics.split('\r\n').every(l => l.length <= 75 || l.startsWith(' ')));
  const [parsed] = parseICS(ics);
  assert.equal(parsed.title, ev.title);
});

/* ---------------- week layout via real occurrences (integration of both) ---------------- */
t('Wayne\'s "Meeting 10:00 on 10 September" example lands on 10 Sep at 10:00', () => {
  const ev = { id: 'wayne1', title: 'Meeting', start_date: '2026-09-10', start_time: '10:00', end_time: '11:00', created_by_name: 'Wayne', recurrence: 'none' };
  const occ = occurrences(ev, '2026-09-01', '2026-09-30');
  assert.equal(occ.length, 1);
  assert.equal(occ[0].date, '2026-09-10'); assert.equal(occ[0].start_time, '10:00');
  assert.equal(occ[0].event.created_by_name, 'Wayne');
});

/* ---------------- natural language date parsing ---------------- */
const TODAY = '2026-09-10'; // a Thursday
t('today / tomorrow / yesterday', () => {
  assert.equal(parseNaturalDate('today', TODAY).date, '2026-09-10');
  assert.equal(parseNaturalDate('tomorrow', TODAY).date, '2026-09-11');
  assert.equal(parseNaturalDate('yesterday', TODAY).date, '2026-09-09');
});
t('weekday name resolves to the next occurrence on/after today', () => {
  assert.equal(parseNaturalDate('friday', TODAY).date, '2026-09-11');
  assert.equal(parseNaturalDate('this thursday', TODAY).date, '2026-09-10'); // today is Thursday
  assert.equal(parseNaturalDate('next friday', TODAY).date, '2026-09-18');
});
t('this week / next week ranges', () => {
  const w = parseNaturalDate('this week', TODAY); assert.equal(w.date, '2026-09-07'); assert.equal(w.to, '2026-09-13');
  const nw = parseNaturalDate('next week', TODAY); assert.equal(nw.date, '2026-09-14'); assert.equal(nw.to, '2026-09-20');
});
t('"10 September" without a year assumes this year unless already past', () => {
  assert.equal(parseNaturalDate('10 September', TODAY).date, '2026-09-10');
  assert.equal(parseNaturalDate('meet on 1 January', TODAY).date, '2027-01-01'); // already passed this year -> next year
});
t('DD/MM (South African order) and ISO dates', () => {
  assert.equal(parseNaturalDate('10/09', TODAY).date, '2026-09-10');
  assert.equal(parseNaturalDate('2026-09-10', TODAY).date, '2026-09-10');
});
t('time-of-day extracted alongside the date', () => {
  const r = parseNaturalDate('create a meeting on friday at 10', TODAY);
  assert.equal(r.date, '2026-09-11'); assert.equal(r.time, '10:00');
});
t('parseNaturalTime handles am/pm and 24h', () => {
  assert.equal(parseNaturalTime('at 10'), '10:00');
  assert.equal(parseNaturalTime('2:30pm'), '14:30');
  assert.equal(parseNaturalTime('14:00'), '14:00');
  assert.equal(parseNaturalTime('9am'), '09:00');
});
t('unrecognised text returns null', () => { assert.equal(parseNaturalDate('what is on', TODAY), null); });

/* ---------------- reminder labels ---------------- */
t('reminder minute labels', () => {
  assert.equal(minutesReminderLabel(10), '10 minutes before');
  assert.equal(minutesReminderLabel(60), '1 hour before');
  assert.equal(minutesReminderLabel(1440), '1 day before');
  assert.equal(minutesReminderLabel(10080), '1 week before');
});

/* ---------------- year-view heat buckets ---------------- */
t('heatLevel: zero events is level 0', () => { assert.equal(heatLevel(0, 10), 0); });
t('heatLevel: the busiest day of the range is the top bucket', () => { assert.equal(heatLevel(10, 10), 4); });
t('heatLevel: buckets scale with the ratio to the busiest day', () => {
  assert.equal(heatLevel(1, 10), 1);
  assert.equal(heatLevel(3, 10), 2);
  assert.equal(heatLevel(6, 10), 3);
  assert.equal(heatLevel(8, 10), 4);
});
t('heatLevel: never crashes on a zero max', () => { assert.equal(heatLevel(0, 0), 0); assert.equal(heatLevel(2, 0), 4); });

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
