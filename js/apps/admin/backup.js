/* Admin → Backup & restore: full JSON export/import, last-backup tracking. */
import { h, downloadText } from '../../ui/dom.js';
import { pageHeader, card, btn, callout, kpiTile, emptyState } from '../../ui/components.js';
import { modal, confirm, toast, showError } from '../../ui/overlays.js';
import { db } from '../../core/db.js';
import { store } from '../../core/bus.js';
import { getDef } from '../../core/schema.js';
import { IS_SUPABASE } from '../../config.js';
import { today } from '../../core/dates.js';
import * as fmt from '../../core/format.js';
import { adminNav } from './nav.js';
import { backupAlert } from './lib.js';

function lastBackupRec() { return db.find('settings', s => s.key === 'last_backup'); }

async function downloadBackup(btnEl) {
  try {
    const json = await db.export();
    const counts = Object.entries(json.collections || {});
    const totalRecords = counts.reduce((s, [, rows]) => s + rows.length, 0);
    const filename = `landscapers-hq-backup-${today()}.json`;
    downloadText(JSON.stringify(json), filename, 'application/json;charset=utf-8');
    const value = { date: today(), at: new Date().toISOString(), by: (store.get('user') || {}).name || 'System', records: totalRecords, collections: counts.length, filename };
    const rec = lastBackupRec();
    if (rec) await db.update('settings', rec.id, { value });
    else await db.insert('settings', { key: 'last_backup', value, description: 'Set automatically each time a full backup is downloaded from Admin → Backup.' });
    toast.success('Backup downloaded', { text: `${totalRecords.toLocaleString()} records across ${counts.length} collections` });
  } catch (e) { showError(e, 'Could not build the backup'); }
}

function openRestoreModal(json, filename) {
  if (!json || typeof json !== 'object' || !json.collections || typeof json.collections !== 'object') {
    toast.error('Not a valid backup file', { text: 'This does not look like a Landscapers Inc. HQ export.' });
    return;
  }
  let replace = false;
  const counts = Object.entries(json.collections).map(([col, rows]) => [col, Array.isArray(rows) ? rows.length : 0]).sort((a, b) => b[1] - a[1]);
  const totalRecords = counts.reduce((s, [, n]) => s + n, 0);
  modal({
    title: 'Restore from backup', icon: 'database-backup', tile: 't-rose', size: 'wide',
    body: h('div.stack',
      h('p', `File: `, h('b', filename), ` · exported ${json.exported_at ? fmt.dateTime(json.exported_at) : 'date unknown'} · `, h('b', `${totalRecords.toLocaleString()} records`), ` across ${counts.length} collections.`),
      h('div.table-wrap', { style: 'max-height:320px;overflow:auto' },
        h('table.table', h('thead', h('tr', h('th', 'Collection'), h('th.num', 'Records in file'))),
          h('tbody', counts.map(([col, n]) => h('tr', h('td', (getDef(col) || {}).label || col), h('td.num', n)))))),
      h('label.check', { style: 'align-items:flex-start;margin-top:6px' },
        h('input', { type: 'checkbox', onChange: e => { replace = e.target.checked; } }),
        h('span', h('b', 'Replace'), ' each of these collections instead of merging on top of them — any record currently here that is not in the file will be permanently removed. Leave unchecked to merge (safer).')),
      callout('danger', 'This changes real data', IS_SUPABASE() ? 'This writes into the shared cloud database everyone uses.' : 'This writes into the database on this device.', 'triangle-alert')),
    actions: [
      { label: 'Cancel', variant: 'ghost' },
      { label: 'Restore', icon: 'upload', variant: 'danger', onClick: async () => {
        if (!(await confirm(`This will ${replace ? 'REPLACE the contents of' : 'merge into'} your database using “${filename}” (${totalRecords.toLocaleString()} records). Continue?`, { danger: true, ok: 'Continue', title: 'Are you sure?' }))) return false;
        if (!(await confirm('Last chance — this cannot be undone. Restore now?', { danger: true, ok: 'Yes, restore now', title: 'Final confirmation' }))) return false;
        try {
          await db.import(json, { replace });
          toast.success('Restore complete', { text: `${totalRecords.toLocaleString()} records applied` });
          setTimeout(() => location.reload(), 900);
        } catch (e) { showError(e, 'Restore failed'); return false; }
      } }
    ]
  });
}

export function backupPage(ctx) {
  const root = h('div');
  const draw = () => {
    const rec = lastBackupRec();
    const v = rec && rec.value;
    const alert = backupAlert(v && v.date, today());
    const totalRecords = db.collections().reduce((s, c) => s + db.all(c).length, 0);

    const fileInput = h('input', { type: 'file', accept: 'application/json', style: 'display:none', onChange: async e => {
      const file = (e.target.files || [])[0]; e.target.value = '';
      if (!file) return;
      try { openRestoreModal(JSON.parse(await file.text()), file.name); }
      catch { toast.error('Could not read that file', { text: 'It should be a .json file downloaded from this page.' }); }
    } });

    root.replaceChildren(
      pageHeader({ title: 'Backup & restore', sub: 'Download a full copy of your data, or restore from a previous backup.', icon: 'database-backup', tile: 't-slate', actions: [adminNav(ctx, 'backup')] }),
      alert ? h('div', { style: 'margin-bottom:16px' }, callout(alert.severity === 'danger' ? 'danger' : 'warn', alert.severity === 'danger' ? 'Backups are overdue' : 'Backup reminder', alert.message + ' Download one now to be safe.', 'database-backup')) : null,
      h('div.grid.cols-3.stagger', { style: 'margin-bottom:18px' },
        kpiTile({ label: 'Last backup', value: v ? fmt.date(v.date, 'short') : 'Never', icon: 'clock', tile: alert ? 't-rose' : 't-forest', foot: v ? `by ${v.by}` : 'no backup taken yet' }),
        kpiTile({ label: 'Records now', value: totalRecords, icon: 'database', tile: 't-river', foot: `${db.collections().length} collections` }),
        kpiTile({ label: 'Mode', value: IS_SUPABASE() ? 'Cloud' : 'Local', icon: IS_SUPABASE() ? 'cloud' : 'hard-drive', tile: 't-grass', foot: IS_SUPABASE() ? 'shared database' : 'this device only' })),
      h('div.grid.cols-2',
        card({ title: 'Download a backup', icon: 'download', cls: 'solid' },
          h('p.muted', 'Saves every record in every collection as one JSON file. Keep it somewhere safe — it contains all client, financial and staff data.'),
          btn({ label: 'Download full backup', icon: 'database-backup', variant: 'primary', onClick: e => downloadBackup(e.currentTarget) })),
        card({ title: 'Restore from a backup', icon: 'upload', cls: 'solid' },
          h('p.muted', 'Choose a .json file downloaded from this page (or from another Landscapers Inc. HQ install) to bring its data into this database.'),
          btn({ label: 'Choose backup file…', icon: 'folder-open', variant: 'soft', onClick: () => fileInput.click() }), fileInput)),
      !rec ? h('div', { style: 'margin-top:16px' }, emptyState({ icon: 'database-backup', title: 'No backup on record', text: 'Download your first backup above — it only takes a moment and protects the whole company database.' })) : null);
  };
  draw();
  ctx.dispose.add(db.on('settings', draw));
  return root;
}
