/* Admin → System: mode & versions, service worker, storage, notifications,
   a built-in self-test runner, and "reset local database" (danger). */
import { h } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { pageHeader, card, btn, badge, callout, kpiTile } from '../../ui/components.js';
import { modal, toast, showError } from '../../ui/overlays.js';
import { db } from '../../core/db.js';
import { CONFIG, IS_SUPABASE } from '../../config.js';
import { requestBrowserPermission } from '../../core/notify.js';
import * as fmt from '../../core/format.js';
import { adminNav } from './nav.js';

async function runSelfTests() {
  const results = [];
  const t = (name, fn) => { try { fn(); results.push({ name, ok: true }); } catch (e) { results.push({ name, ok: false, error: e.message || String(e) }); } };
  const assertEq = (a, b, msg) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg || 'not equal'}: got ${JSON.stringify(a)}, expected ${JSON.stringify(b)}`); };
  const assertOk = (v, msg) => { if (!v) throw new Error(msg || 'expected a truthy value'); };

  const { lineTotal } = await import('../../core/money.js');
  t('Money: unrounded rate rule — 4 × R630.315 = R2,521.26', () => assertEq(lineTotal(4, 630.315), 2521.26, 'lineTotal'));

  const { publicHolidays } = await import('../../core/holidays.js');
  t('SA holidays 2026 — 13 declared public holidays incl. New Year’s Day', () => {
    const h2026 = publicHolidays(2026);
    assertEq(h2026.length, 13, '2026 public holiday count');
    assertOk(h2026.some(x => x.date === '2026-01-01' && /New Year/i.test(x.name)), "New Year's Day on 1 Jan");
  });

  const { saIdInfo } = await import('../../core/validate.js');
  t('Validation: SA ID checksum (Luhn) catches a wrong digit', () => {
    assertOk(saIdInfo('8001015009087').valid, 'known-good ID should validate');
    assertOk(!saIdInfo('8001015009088').valid, 'ID with a changed check digit should fail');
  });

  const { occurrences } = await import('../../core/recurrence.js');
  t('Recurrence: weekly expands to 4 occurrences in September 2026', () => {
    const o = occurrences({ id: 'selftest', start_date: '2026-09-07', recurrence: 'weekly' }, '2026-09-01', '2026-09-30');
    assertEq(o.map(x => x.date), ['2026-09-07', '2026-09-14', '2026-09-21', '2026-09-28'], 'weekly occurrences');
  });

  const { trainTestSplit } = await import('../../ml/core.js');
  t('ML split: stratified, disjoint and reproducible', () => {
    const X = Array.from({ length: 40 }, (_, i) => [i]), y = X.map(([i]) => (i % 4 === 0 ? 1 : 0));
    const s = trainTestSplit(X, y, { testSize: 0.25, seed: 5 });
    assertEq(s.trainIdx.length + s.testIdx.length, 40, 'train+test covers every row');
    assertEq(new Set([...s.trainIdx, ...s.testIdx]).size, 40, 'no row used twice');
    const s2 = trainTestSplit(X, y, { testSize: 0.25, seed: 5 });
    assertEq(s.testIdx, s2.testIdx, 'same seed gives the same split');
  });

  return results;
}

function selfTestsSection() {
  const wrap = h('div');
  const run = async () => {
    wrap.replaceChildren(h('div.row.gap-8', h('span.spinner'), h('span.muted', 'Running…')));
    const results = await runSelfTests();
    const failed = results.filter(r => !r.ok);
    wrap.replaceChildren(
      h('div.row.gap-8', { style: 'margin-bottom:10px' },
        badge(`${results.length - failed.length} / ${results.length} passed`, failed.length ? 'gold' : 'green'),
        failed.length ? badge(`${failed.length} failed`, 'red') : null),
      h('div.stack.tight', results.map(r => h('div.row.gap-8', { style: 'padding:6px 0;border-bottom:1px solid var(--border)' },
        r.ok ? h('span', { style: 'color:var(--success)' }, icon('circle-check', 16)) : h('span', { style: 'color:var(--danger)' }, icon('circle-x', 16)),
        h('div', h('div', r.name), r.error ? h('div.small', { style: 'color:var(--danger)' }, r.error) : null)))));
  };
  const rerun = h('div.row.end', { style: 'margin-bottom:10px' }, btn({ label: 'Run self-tests', icon: 'play', variant: 'primary', size: 'sm', onClick: run }));
  wrap.replaceChildren(h('p.muted', 'Quick checks of core calculations — money rounding, SA public holidays, ID validation, recurrence and the ML train/test split — run right here in your browser.'));
  return h('div', rerun, wrap);
}

async function serviceWorkerStatus() {
  if (!('serviceWorker' in navigator)) return { supported: false };
  const regs = await navigator.serviceWorker.getRegistrations();
  return { supported: true, active: regs.some(r => r.active), count: regs.length, regs };
}
async function updateApp() {
  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map(r => r.unregister()));
    }
    if ('caches' in window) { const keys = await caches.keys(); await Promise.all(keys.map(k => caches.delete(k))); }
    toast.success('Cache cleared — reloading…');
    setTimeout(() => location.reload(), 500);
  } catch (e) { showError(e, 'Could not clear the cached app'); }
}

async function resetLocalDatabase(input) {
  if (input.value.trim() !== 'RESET') { toast.error('Type RESET exactly to confirm'); return false; }
  try {
    await db.wipeLocal();
    toast.success('Local database cleared — reloading…');
    setTimeout(() => location.reload(), 500);
  } catch (e) { showError(e, 'Could not reset the local database'); return false; }
}

export function systemPage(ctx) {
  const root = h('div');
  const draw = async () => {
    let estimate = null;
    try { estimate = ('storage' in navigator && navigator.storage.estimate) ? await navigator.storage.estimate() : null; } catch { estimate = null; }
    const sw = await serviceWorkerStatus();
    const notifPerm = ('Notification' in window) ? Notification.permission : 'unsupported';

    const openResetModal = () => {
      const input = h('input.input', { placeholder: 'Type RESET to confirm', autofocus: true });
      modal({
        title: 'Reset local database', icon: 'triangle-alert', tile: 't-rose',
        body: h('div.stack',
          h('p', IS_SUPABASE() ? 'This clears only the offline cache on this device — the shared cloud database is untouched. You will need to be online to sign in again.' : 'This permanently deletes every record on this device, including clients, invoices, staff and files. There is no undo unless you have a backup.'),
          h('div.field', h('label.field-label', 'Type RESET to confirm'), input)),
        actions: [
          { label: 'Cancel', variant: 'ghost' },
          { label: 'Reset now', icon: 'trash-2', variant: 'danger', onClick: async () => resetLocalDatabase(input) }
        ]
      });
    };

    root.replaceChildren(
      pageHeader({ title: 'System', sub: 'Mode, versions, offline cache, notifications and self-tests.', icon: 'cpu', tile: 't-slate', actions: [adminNav(ctx, 'system')] }),
      h('div.grid.cols-3.stagger', { style: 'margin-bottom:18px' },
        kpiTile({ label: 'Mode', value: IS_SUPABASE() ? 'Cloud (Supabase)' : 'Local', icon: IS_SUPABASE() ? 'cloud' : 'hard-drive', tile: 't-forest' }),
        kpiTile({ label: 'Storage used', value: estimate ? estimate.usage : null, format: v => fmt.fileSize(v), icon: 'hard-drive', tile: 't-river', foot: estimate ? `of ${fmt.fileSize(estimate.quota)} available` : 'not available in this browser' }),
        kpiTile({ label: 'Notifications', value: notifPerm === 'granted' ? 'On' : notifPerm === 'denied' ? 'Blocked' : 'Not set', icon: 'bell', tile: notifPerm === 'granted' ? 't-forest' : 't-sun' })),
      h('div.grid.cols-2',
        card({ title: 'Versions & environment', icon: 'info', cls: 'solid' },
          h('dl.kv',
            h('dt', 'App'), h('dd', CONFIG.appName),
            h('dt', 'Data mode'), h('dd', IS_SUPABASE() ? `Supabase — ${CONFIG.SUPABASE_URL}` : `Local (IndexedDB “${CONFIG.dbName}”, v${CONFIG.dbVersion})`),
            h('dt', 'Currency / locale'), h('dd', `${CONFIG.currency} · ${CONFIG.locale}`),
            h('dt', 'Timezone'), h('dd', CONFIG.timezone),
            h('dt', 'Browser'), h('dd', navigator.userAgent),
            h('dt', 'Online'), h('dd', navigator.onLine ? badge('Online', 'green') : badge('Offline', 'gold')))),
        card({ title: 'Offline app (service worker)', icon: 'refresh-ccw', cls: 'solid' },
          sw.supported
            ? h('div.stack',
                h('p', sw.active ? badge('Installed', 'green') : badge('Not installed', 'gray'), ` ${sw.count} registration${sw.count === 1 ? '' : 's'} for this site.`),
                h('p.small.muted', 'If the app looks out of date after an update, use this to clear the cached copy and reload the latest version.'),
                btn({ label: 'Update app (clear cache & reload)', icon: 'rotate-cw', variant: 'soft', onClick: updateApp }))
            : callout('info', 'Not supported', 'This browser does not support offline service workers.', 'info'))),
      h('div', { style: 'margin-top:16px' },
        card({ title: 'Notifications', icon: 'bell', cls: 'solid' },
          h('p.muted', 'Browser notifications for reminders and alerts (calendar events, overdue invoices, expiring certificates…).'),
          h('div.row.gap-8', badge(notifPerm === 'granted' ? 'Allowed' : notifPerm === 'denied' ? 'Blocked by browser' : 'Not asked yet', notifPerm === 'granted' ? 'green' : notifPerm === 'denied' ? 'red' : 'gray'),
            notifPerm !== 'granted' ? btn({ label: 'Enable notifications', icon: 'bell-ring', size: 'sm', variant: 'soft', onClick: async () => { const p = await requestBrowserPermission(); toast[p === 'granted' ? 'success' : 'warn'](p === 'granted' ? 'Notifications enabled' : 'Not enabled', { text: p === 'denied' ? 'Allow notifications for this site in your browser settings to change this.' : undefined }); draw(); } }) : null))),
      h('div', { style: 'margin-top:16px' }, card({ title: 'Self-tests', icon: 'flask-conical', cls: 'solid' }, selfTestsSection())),
      h('div', { style: 'margin-top:16px' },
        card({ title: 'Danger zone', icon: 'triangle-alert', cls: 'solid', accent: 'var(--danger)' },
          h('p.muted', IS_SUPABASE() ? 'Clears the offline cache stored on this device. The shared cloud data is not affected.' : 'Permanently deletes every record stored on this device. Take a backup first (Admin → Backup).'),
          btn({ label: 'Reset local database', icon: 'trash-2', variant: 'danger', onClick: openResetModal }))));
  };
  draw();
  return root;
}
