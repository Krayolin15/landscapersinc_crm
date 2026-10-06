// Live Dispatch logic tests:  node tests/schedule.test.js
import assert from 'node:assert/strict';
import { contractDates, generateVisits, orderRun, crewLoad, weeksBetween, minutesBetween } from '../js/apps/schedule/logic.js';

let passed = 0, failed = 0;
const t = (name, fn) => { try { fn(); passed++; } catch (e) { failed++; console.error('✗', name, '\n ', e.message); } };
const C = o => ({ id: 'c1', status: 'active', client_id: 'cl1', site_id: 's1', name: 'Test', ...o });

t('weekly on the preferred day', () => assert.deepEqual(contractDates(C({ frequency: 'weekly', preferred_days: ['Tue'] }), '2026-10-01', '2026-10-31').dates, ['2026-10-06', '2026-10-13', '2026-10-20', '2026-10-27']));
t('fortnightly keeps the anchor week parity', () => assert.deepEqual(contractDates(C({ frequency: 'fortnightly', preferred_days: ['Tue'], schedule_anchor: '2026-09-01' }), '2026-10-01', '2026-10-31').dates, ['2026-10-13', '2026-10-27']));
t('twice weekly', () => assert.equal(contractDates(C({ frequency: 'twice_weekly', preferred_days: ['Mon', 'Thu'] }), '2026-10-05', '2026-10-11').dates.length, 2));
t('daily = working days', () => assert.equal(contractDates(C({ frequency: 'daily' }), '2026-10-05', '2026-10-11').dates.length, 5));
t('monthly = same nth weekday as anchor', () => assert.deepEqual(contractDates(C({ frequency: 'monthly', preferred_days: ['Wed'], schedule_anchor: '2026-09-16' }), '2026-10-01', '2026-11-30').dates, ['2026-10-21', '2026-11-18']));
t('no days → reported, not guessed', () => assert.equal(contractDates(C({ frequency: 'weekly' }), '2026-10-01', '2026-10-31').reason, 'No visit days set on the contract'));
t('paused window skipped', () => assert.deepEqual(contractDates(C({ frequency: 'weekly', preferred_days: ['Tue'], pause_from: '2026-10-10', pause_until: '2026-10-20' }), '2026-10-01', '2026-10-31').dates, ['2026-10-06', '2026-10-27']));
t('public holiday moves to next working day', () => {
  const r = generateVisits({ contracts: [C({ frequency: 'weekly', preferred_days: ['Wed'] })], from: '2026-12-14', to: '2026-12-20', isHoliday: d => d === '2026-12-16' });
  assert.equal(r.create.length, 1); assert.equal(r.create[0].date, '2026-12-17'); assert.equal(r.create[0].rescheduled_from, '2026-12-16');
});
t('idempotent — existing visits are not duplicated', () => {
  const r = generateVisits({ contracts: [C({ frequency: 'weekly', preferred_days: ['Tue'] })], from: '2026-10-01', to: '2026-10-14', existing: [{ contract_id: 'c1', date: '2026-10-06' }] });
  assert.deepEqual(r.create.map(v => v.date), ['2026-10-13']);
});
t('inactive contracts ignored', () => assert.equal(generateVisits({ contracts: [C({ status: 'paused', frequency: 'weekly', preferred_days: ['Tue'] })], from: '2026-10-01', to: '2026-10-31' }).create.length, 0));
t('run-sheet order: fixed times, then deadlines', () => assert.deepEqual(orderRun([{ site_name: 'C' }, { site_name: 'B', finish_by: '10:30' }, { site_name: 'A', start_time: '08:00' }]).map(v => v.site_name), ['A', 'B', 'C']));
t('crew load', () => { const l = crewLoad([{ planned_minutes: 300 }, { planned_minutes: 240 }], { capacity_per_day: 6 }); assert.equal(l.pct, 113); assert.ok(l.over); });
t('weeks between', () => { assert.equal(weeksBetween('2026-09-01', '2026-09-15'), 2); assert.equal(weeksBetween('2026-09-01', '2026-09-07'), 1); });
t('minutes on site', () => assert.equal(minutesBetween('2026-10-01T08:00:00Z', '2026-10-01T09:45:00Z'), 105));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
