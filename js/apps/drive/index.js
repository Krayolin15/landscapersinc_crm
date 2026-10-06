/* =============================================================================
   Drive & Vault (#/drive) — the company's shared drives (ADMIN, FINANCE, HR,
   LEGAL AND COMPLIANCE, MANAGEMENT, OPERATIONS, SALES, SOP'S & TEMPLATES) and My
   Drive: folders, upload (drag & drop), preview, rename, move, star, share,
   confidential & expiry flags, linked records, trash, photos, storage — plus the
   Document Vault importer that attaches all original company documents.
   ========================================================================== */

import { h, ensureStyle } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { btn, badge, card, pageHeader, emptyState, seg, kv, progress, callout, attribution, kpiTile } from '../../ui/components.js';
import { modal, toast, showError, confirm, prompt, menu, drawer } from '../../ui/overlays.js';
import { recordLink } from '../../ui/entity.js';
import { db } from '../../core/db.js';
import { store } from '../../core/bus.js';
import { isManager, can } from '../../core/perms.js';
import { uploadFiles, openFile, downloadFile, fileIcon, attachBytes, deleteFileBytes, storageUsed, fileUrl, fromFolder, loadVaultFolder, vaultLoadedCount } from '../../core/files.js';
import { today, addDays } from '../../core/dates.js';
import * as fmt from '../../core/format.js';
import { COMPANY_DRIVES, folderPath, validateManifest, splitZipPath, isJunk, sortFiles, typeOf } from './lib.js';
import { ensureLib } from '../../core/lazy.js';

ensureStyle('lsi-drive', `
.drv{display:grid;grid-template-columns:230px 1fr;gap:16px}
.drv-nav .it{display:flex;align-items:center;gap:8px;width:100%;padding:8px 10px;border-radius:12px;border:0;background:none;color:inherit;cursor:pointer;text-align:left;text-decoration:none}
.drv-nav .it.active{background:var(--primary-soft);font-weight:700}.drv-nav .sw{width:10px;height:10px;border-radius:3px;flex:none}
.fgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px}
.fcard{position:relative;border:1px solid var(--border);border-radius:16px;background:var(--surface-solid);padding:12px;cursor:pointer;transition:transform .12s,box-shadow .12s;min-width:0}
.fcard:hover{transform:translateY(-2px);box-shadow:var(--shadow-md)}.fcard.sel{outline:2px solid var(--primary)}
.fcard .ic{width:42px;height:42px;border-radius:12px;display:grid;place-items:center;color:#fff;margin-bottom:8px}
.fcard .nm{font-weight:600;font-size:.88rem;overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
.fcard .mt{font-size:var(--fs-xs);color:var(--muted);margin-top:4px}.fcard .thumb{width:100%;aspect-ratio:4/3;object-fit:cover;border-radius:10px;margin-bottom:6px}
.fcard .flag{position:absolute;top:8px;right:8px;display:flex;gap:3px}
.drop{outline:3px dashed var(--primary);outline-offset:-8px;border-radius:18px}
@media (max-width:860px){.drv{grid-template-columns:1fr}.drv-nav{display:flex;overflow-x:auto;gap:4px}.drv-nav .it{white-space:nowrap}}
`);

const me = () => store.get('user') || {};
// a restricted drive: owner/admin/manager, the roles named on the drive (FINANCE → finance, HR → hr) and its members — same rule as public.can_see_drive() in the database
const canSeeDrive = d => !d || !d.restricted || isManager() || (Array.isArray(d.roles) && d.roles.includes(me().role)) || (d.members || []).some(m => (m.profile_id || m.user_id) === me().id);
const starred = f => (f.starred_by || []).includes(me().id);

async function ensureCompanyDrives() {
  for (const d of COMPANY_DRIVES) if (!db.get('drives', d.id)) await db.insert('drives', { ...d, members: [], description: d.restricted ? 'Restricted drive' : 'Shared with the whole company' });
  toast.success('Company shared drives created');
}

/* ---------------- file actions ---------------- */
async function moveTo(f) {
  const opts = db.all('folders').filter(x => x.drive_id === f.drive_id);
  const sel = h('select.select', h('option', { value: '' }, '(top of the drive)'), opts.map(o => h('option', { value: o.id, selected: o.id === f.folder_id }, folderPath(db.all('folders'), o.id).map(p => p.name).join(' / '))));
  const dsel = h('select.select', db.all('drives').filter(canSeeDrive).map(d => h('option', { value: d.id, selected: d.id === f.drive_id }, d.name)), h('option', { value: '', selected: !f.drive_id }, 'My Drive'));
  modal({ title: `Move “${f.name}”`, icon: 'folder-input', body: h('div.stack', h('label.field-label', 'Drive'), dsel, h('label.field-label', 'Folder'), sel, h('p.small.muted', 'Changing the drive moves it to the top of that drive.')),
    actions: [{ label: 'Cancel', variant: 'ghost' }, { label: 'Move', variant: 'primary', icon: 'check', onClick: () => db.update('files', f.id, dsel.value !== (f.drive_id || '') ? { drive_id: dsel.value || null, folder_id: null } : { folder_id: sel.value || null }).then(() => toast.success('Moved')).catch(showError) }] });
}
function details(f) {
  const links = (f.linked || []).map(l => { const r = db.get(l.collection, l.id); return r ? h('a.chip', { href: recordLink(l.collection, l.id) }, icon('link', 12), db.label(l.collection, r)) : null; }).filter(Boolean);
  const box = h('div');
  if (/^image\//.test(f.mime || '')) fileUrl(f).then(u => u && box.appendChild(h('img', { src: u, alt: f.name, style: 'width:100%;border-radius:12px;margin-bottom:10px' }))).catch(() => {});
  drawer({ title: f.name, icon: fileIcon(f)[0], tile: fileIcon(f)[1], body: h('div.stack', box,
    kv([['Type', f.mime || '—'], ['Size', fmt.fileSize(f.size)], ['Location', [db.label('drives', f.drive_id) || 'My Drive', ...folderPath(db.all('folders'), f.folder_id).map(p => p.name)].join(' / ')], ['Original file', f.source_path], ['Confidential', f.confidential ? 'Yes' : 'No'], ['Expires', f.expires_on ? fmt.date(f.expires_on, 'long') : null], ['Status', f.kind === 'pending' ? 'Waiting for the document vault import' : 'Stored']]),
    h('div.small.muted', attribution(f)), f.description ? h('p', f.description) : null,
    links.length ? h('div', h('div.field-label', `Linked to ${links.length} record${links.length === 1 ? '' : 's'}`), h('div.chips', links)) : null,
    f.text_index ? h('details', h('summary', 'Text content (searchable)'), h('p.small', { style: 'white-space:pre-wrap;max-height:260px;overflow:auto' }, fmt.truncate(f.text_index, 3000))) : null) });
}
function fileMenu(anchor, f) {
  const w = can('write', 'files');
  menu(anchor, [
    { label: 'Open', icon: 'eye', onClick: () => openFile(f) }, { label: 'Download', icon: 'download', onClick: () => downloadFile(f) }, { label: 'Details', icon: 'info', onClick: () => details(f) },
    w ? '-' : null,
    w ? { label: 'Rename', icon: 'pencil', onClick: async () => { const n = await prompt('New name', { value: f.name }); if (n) db.update('files', f.id, { name: n }); } } : null,
    w ? { label: 'Move', icon: 'folder-input', onClick: () => moveTo(f) } : null,
    { label: starred(f) ? 'Unstar' : 'Star', icon: 'star', onClick: () => db.update('files', f.id, { starred_by: starred(f) ? (f.starred_by || []).filter(x => x !== me().id) : [...(f.starred_by || []), me().id] }, { silent: true }) },
    w ? { label: f.confidential ? 'Not confidential' : 'Mark confidential', icon: 'lock', onClick: () => db.update('files', f.id, { confidential: !f.confidential }) } : null,
    w ? { label: 'Set expiry date', icon: 'calendar-x', onClick: async () => { const d = await prompt('Document expires / renew by', { type: 'date', value: f.expires_on || '' }); if (d !== null) db.update('files', f.id, { expires_on: d || null }); } } : null,
    { label: 'Copy link', icon: 'link', onClick: () => { navigator.clipboard && navigator.clipboard.writeText(`${location.origin}${location.pathname}#/record/files/${f.id}`); toast.success('Link copied'); } },
    w ? '-' : null,
    w ? { label: 'Move to trash', icon: 'trash-2', danger: true, onClick: () => db.remove('files', f.id).then(() => toast.success('Moved to trash')) } : null
  ], { align: 'right' });
}

/* ---------------- listing ---------------- */
function listing(ctx, { title, sub, files, folders = [], driveId = null, folderId = null, crumbs = [], canUpload = true }) {
  let view = localStorage.getItem('lsihq.drive.view') || 'grid', sort = 'name', type = 'all', q = '';
  const body = h('div');
  const draw = () => {
    const fs = sortFiles(files().filter(f => (type === 'all' || typeOf(f) === type) && (!q || `${f.name} ${f.description || ''} ${(f.tags || []).join(' ')} ${f.text_index || ''}`.toLowerCase().includes(q))), sort);
    const fo = folders().filter(f => !q || f.name.toLowerCase().includes(q)).sort((a, b) => a.name.localeCompare(b.name));
    if (!fs.length && !fo.length) { body.replaceChildren(emptyState({ icon: 'folder-open', title: q ? 'No matches' : 'This folder is empty', text: canUpload ? 'Drop files here or use Upload.' : '' })); return; }
    if (view === 'list') {
      body.replaceChildren(h('div.list.divider-list', [...fo.map(f => h('a.list-item', { href: `#/drive/f/${encodeURIComponent(f.id)}` }, h('div.li-ico.t-sun', icon('folder', 18)), h('div.li-main', h('div.li-title', f.name), h('div.li-sub', `${db.filter('files', x => x.folder_id === f.id).length} items`)))),
        ...fs.map(f => h('div.list-item', { style: 'cursor:pointer', onClick: () => openFile(f) }, h('div', { class: ['li-ico', fileIcon(f)[1]] }, icon(fileIcon(f)[0], 18)), h('div.li-main', h('div.li-title', f.name), h('div.li-sub', `${fmt.fileSize(f.size)} · ${f.created_by_name || 'imported'} · ${fmt.relative(f.updated_at || f.created_at)}${f.kind === 'pending' ? ' · pending import' : ''}`)),
          f.confidential ? badge('Confidential', 'red') : null, h('button.btn.btn-ghost.btn-icon.btn-sm', { onClick: e => { e.stopPropagation(); fileMenu(e.currentTarget, f); } }, icon('ellipsis-vertical', 15))))]));
      return;
    }
    const grid = h('div.fgrid.stagger');
    for (const f of fo) grid.appendChild(h('a.fcard', { href: `#/drive/f/${encodeURIComponent(f.id)}`, style: 'text-decoration:none;color:inherit' }, h('div.ic.t-sun', icon('folder', 20)), h('div.nm', f.name), h('div.mt', `${db.filter('files', x => x.folder_id === f.id).length} files`)));
    for (const f of fs) {
      const [ic, tile] = fileIcon(f);
      const card0 = h('div.fcard', { onClick: () => openFile(f), onContextmenu: e => { e.preventDefault(); fileMenu(e.currentTarget, f); } },
        h('div.flag', f.confidential ? h('span', { title: 'Confidential' }, icon('lock', 13)) : null, starred(f) ? h('span', icon('star', 13)) : null, f.kind === 'pending' ? h('span', { title: 'Waiting for vault import' }, icon('cloud-off', 13)) : null),
        h('div', { class: ['ic', tile] }, icon(ic, 20)), h('div.nm', f.name), h('div.mt', `${fmt.fileSize(f.size)} · ${fmt.relative(f.updated_at || f.created_at)}`),
        h('button.btn.btn-ghost.btn-icon.btn-sm', { style: 'position:absolute;bottom:6px;right:6px', title: 'More', onClick: e => { e.stopPropagation(); fileMenu(e.currentTarget, f); } }, icon('ellipsis', 15)));
      if (/^image\//.test(f.mime || '') && f.kind !== 'pending') fileUrl(f).then(u => { if (u) card0.querySelector('.ic').replaceWith(h('img.thumb', { src: u, alt: '' })); }).catch(() => {});
      grid.appendChild(card0);
    }
    body.replaceChildren(grid);
  };
  const upload = async list => { if (!list || !list.length) return; await uploadFiles(list, { drive_id: driveId, folder_id: folderId }); };
  const fileIn = h('input', { type: 'file', multiple: true, style: 'display:none', onChange: e => upload(e.target.files) });
  const dirIn = h('input', { type: 'file', multiple: true, webkitdirectory: true, style: 'display:none', onChange: async e => {
    for (const file of e.target.files) { const { folders: parts } = splitZipPath(file.webkitRelativePath || file.name); let parent = folderId; for (const p of parts) { let f = db.find('folders', x => x.drive_id === driveId && (x.parent_id || null) === (parent || null) && x.name === p); if (!f) f = await db.insert('folders', { name: p, drive_id: driveId, parent_id: parent || null }); parent = f.id; } await uploadFiles([file], { drive_id: driveId, folder_id: parent }); }
  } });
  const wrap = h('div', { onDragover: e => { if (canUpload) { e.preventDefault(); wrap.classList.add('drop'); } }, onDragleave: () => wrap.classList.remove('drop'), onDrop: e => { e.preventDefault(); wrap.classList.remove('drop'); if (canUpload) upload(e.dataTransfer.files); } });
  for (const c of ['files', 'folders']) ctx.dispose.add(db.on(c, draw));
  draw();
  wrap.append(
    pageHeader({ title, sub, icon: 'hard-drive', tile: 't-grass', crumbs,
      actions: canUpload && can('write', 'files') ? [h('button.btn', { onClick: e => menu(e.currentTarget, [
        { label: 'Upload files', icon: 'upload', onClick: () => fileIn.click() }, { label: 'Upload a folder', icon: 'folder-up', onClick: () => dirIn.click() },
        { label: 'New folder', icon: 'folder-plus', onClick: async () => { const n = await prompt('Folder name', { title: 'New folder' }); if (n) db.insert('folders', { name: n, drive_id: driveId, parent_id: folderId || null }).catch(showError); } }, '-',
        { label: 'New document', icon: 'file-text', onClick: () => ctx.navigate(`docs/new?drive=${driveId || ''}&folder=${folderId || ''}`) }, { label: 'New spreadsheet', icon: 'sheet', onClick: () => ctx.navigate(`sheets/new?drive=${driveId || ''}&folder=${folderId || ''}`) },
        { label: 'New presentation', icon: 'presentation', onClick: () => ctx.navigate(`slides/new?drive=${driveId || ''}&folder=${folderId || ''}`) }, { label: 'New form', icon: 'clipboard-list', onClick: () => ctx.navigate('forms/new') }]) }, icon('plus', 16), 'New'), fileIn, dirIn] : [] }),
    h('div.row.wrap.gap-8', { style: 'margin-bottom:12px' },
      h('input.input', { placeholder: 'Search names and text inside documents…', style: 'max-width:320px', onInput: e => { q = e.target.value.toLowerCase(); clearTimeout(wrap._t); wrap._t = setTimeout(draw, 200); } }),
      h('select.select', { style: 'width:auto', onChange: e => { type = e.target.value; draw(); } }, [['all', 'All types'], ['pdf', 'PDFs'], ['images', 'Images'], ['documents', 'Word'], ['spreadsheets', 'Spreadsheets'], ['presentations', 'Presentations'], ['docs', 'Docs'], ['sheets', 'Sheets'], ['slides', 'Slides'], ['forms', 'Forms'], ['other', 'Other']].map(([v, l]) => h('option', { value: v }, l))),
      h('select.select', { style: 'width:auto', onChange: e => { sort = e.target.value; draw(); } }, h('option', { value: 'name' }, 'Name'), h('option', { value: 'modified' }, 'Last modified'), h('option', { value: 'size' }, 'Size')), h('span.spacer'),
      seg([{ id: 'grid', label: '', icon: 'layout-grid' }, { id: 'list', label: '', icon: 'list' }], view, id => { view = id; localStorage.setItem('lsihq.drive.view', id); draw(); })),
    body);
  return wrap;
}

function navPanel(active) {
  const drives = db.all('drives').filter(canSeeDrive).sort((a, b) => a.name.localeCompare(b.name));
  const it = (href, ic, label, id, extra) => h('a', { class: ['it', active === id ? 'active' : ''], href }, typeof ic === 'string' ? icon(ic, 16) : ic, h('span', label), extra || null);
  const pending = db.filter('files', f => f.kind === 'pending').length;
  return h('nav.drv-nav',
    it('#/drive', 'hard-drive', 'My Drive', 'my'),
    h('div.small.muted', { style: 'margin:10px 10px 4px;font-weight:700' }, 'SHARED DRIVES'),
    ...drives.map(d => it(`#/drive/d/${encodeURIComponent(d.id)}`, h('span.sw', { style: { background: d.color || '#1f7440' } }), d.name, d.id, d.restricted ? icon('lock', 12) : null)),
    !drives.length && isManager() ? btn({ label: 'Create company drives', icon: 'folder-plus', size: 'sm', onClick: ensureCompanyDrives }) : null,
    h('div', { style: 'height:8px' }),
    it('#/drive/recent', 'clock', 'Recent', 'recent'), it('#/drive/starred', 'star', 'Starred', 'starred'), it('#/drive/photos', 'images', 'Photos', 'photos'),
    pending ? it('#/drive/pending', 'cloud-off', 'Waiting for import', 'pending', badge(String(pending), 'gold')) : null,
    it('#/drive/trash', 'trash-2', 'Trash', 'trash'), it('#/drive/storage', 'database', 'Storage', 'storage'),
    fromFolder() ? it('#/drive/load', 'folder-input', 'Load original documents', 'load') : null,
    isManager() ? it('#/drive/import', 'archive-restore', 'Import document vault', 'import') : null);
}
const layout = (active, content) => h('div.drv', navPanel(active), h('div', content));
const live = (col, fn) => () => db.all(col).filter(fn);

/* ---------------- vault importer ---------------- */
function importPage(ctx) {
  const out = h('div');
  const input = h('input', { type: 'file', accept: '.zip,application/zip', onChange: e => e.target.files[0] && run(e.target.files[0]) });
  async function run(file) {
    let Z; try { Z = await ensureLib('jszip'); } catch (e) { return showError(e, 'The zip library could not load'); }
    out.replaceChildren(callout('info', 'Reading the zip…', `${file.name} · ${fmt.fileSize(file.size)}`, 'loader'));
    let zip; try { zip = await Z.loadAsync(file); } catch (e) { return showError(e, 'Not a valid zip'); }
    const mf = zip.file('manifest.json');
    const manifest = mf ? JSON.parse(await mf.async('string')) : null;
    const entries = manifest && manifest.files ? manifest.files : Object.values(zip.files).filter(z => !z.dir && !isJunk(z.name)).map(z => ({ path_in_zip: z.name, ...splitZipPath(z.name), folder_path: splitZipPath(z.name).folders.slice(1).join('/'), drive: splitZipPath(z.name).folders[0] || 'ADMIN' }));
    const v = manifest ? validateManifest(manifest) : { ok: true, errors: [], files: entries.length, bytes: 0, byDrive: entries.reduce((a, e) => ({ ...a, [e.drive]: (a[e.drive] || 0) + 1 }), {}) };
    const bar = h('div'), log = h('div.small.muted', { style: 'max-height:200px;overflow:auto' });
    out.replaceChildren(card({ title: manifest ? 'Document vault' : 'Plain zip (folders become folders)', icon: 'archive', cls: 'solid' },
      kv([['Files', fmt.num(v.files)], ['Size', v.bytes ? fmt.fileSize(v.bytes) : '—'], ...Object.entries(v.byDrive).map(([d, n]) => [d, `${n} files`])]),
      v.errors.length ? callout('warning', 'Manifest warnings', v.errors.slice(0, 5).join(' · '), 'triangle-alert') : null,
      h('div', { style: 'margin-top:12px' }, btn({ label: `Import ${v.files} files`, icon: 'download', variant: 'primary', onClick: async e => { e.currentTarget.disabled = true; await doImport(zip, entries, !!manifest, bar, log); } })), bar, log));
  }
  async function doImport(zip, entries, isVault, bar, log) {
    if (!db.all('drives').length || COMPANY_DRIVES.some(d => !db.get('drives', d.id))) { for (const d of COMPANY_DRIVES) if (!db.get('drives', d.id)) await db.insert('drives', { ...d, members: [] }).catch(() => {}); }
    const driveByName = n => db.find('drives', d => d.name.toLowerCase() === String(n).toLowerCase()) || db.get('drives', 'drive-admin');
    const folderFor = async (drive, path) => { let parent = null; for (const p of String(path || '').split('/').filter(Boolean)) { let f = db.find('folders', x => x.drive_id === drive.id && (x.parent_id || null) === parent && x.name === p); if (!f) f = await db.insert('folders', { name: p, drive_id: drive.id, parent_id: parent }); parent = f.id; } return parent; };
    let done = 0, skipped = 0, failed = 0;
    for (const en of entries) {
      try {
        const z = zip.file(en.path_in_zip); if (!z) { failed++; log.appendChild(h('div', `Missing in zip: ${en.path_in_zip}`)); continue; }
        const existing = en.file_id ? db.get('files', en.file_id) : null;
        if (existing && existing.kind === 'upload' && (existing.blob_id || existing.storage_path)) { skipped++; continue; } // already attached
        const blob = new Blob([await z.async('uint8array')], { type: en.mime || 'application/octet-stream' });
        if (existing) await attachBytes(existing, blob);
        else {
          const drive = driveByName(en.drive);
          const folder_id = await folderFor(drive, en.folder_path);
          const [rec] = await uploadFiles([new File([blob], en.name || splitZipPath(en.path_in_zip).name, { type: blob.type })], { drive_id: drive.id, folder_id, linked: en.linked || [], description: en.description, confidential: en.confidential });
          if (rec && en.expires_on) await db.update('files', rec.id, { expires_on: en.expires_on, source_path: en.original_path || en.path_in_zip }, { skipValidate: true });
        }
        done++;
      } catch (e) { failed++; log.appendChild(h('div', `${en.path_in_zip}: ${e.message}`)); }
      bar.replaceChildren(h('div.small', { style: 'margin:10px 0 4px' }, `${done + skipped + failed} / ${entries.length} · ${done} imported · ${skipped} already there · ${failed} failed`), progress(Math.round(((done + skipped + failed) / entries.length) * 100)));
    }
    toast.success(`Vault import finished: ${done} files imported`, { text: skipped ? `${skipped} were already imported (safe to re-run).` : '' });
  }
  return layout('import', h('div', pageHeader({ title: 'Import the document vault', sub: 'Attach every original company document (the private vault zip) — or import any zip; its folders become folders. Safe to re-run.', icon: 'archive-restore', tile: 't-grass' }),
    card({ cls: 'solid' }, h('div.stack', h('p', 'Choose landscapers-inc-PRIVATE-vault.zip. Each file is attached to the record that was created from it, so invoices, certificates, medicals and policies show their original PDF.'), input, h('p.small.muted', 'In local mode the files are stored in this browser (IndexedDB). In Supabase mode they go to your private storage bucket.'))), out));
}

/* ---------------- load original documents (app opened from the folder) ---------------- */
// A page opened by double-clicking index.html may SHOW the documents in data/vault but not READ them (browsers
// refuse fetch() of local files). Picking the folder once gives the browser that permission: every document is
// checked against its record and kept here, so Sheets import, slide PDFs and the rest can use it.
function loadPage(ctx) {
  const visible = vis; // the documents this person can see in Drive
  const status = h('div.small.muted', 'Checking this browser…');
  const out = h('div');
  const refresh = () => vaultLoadedCount(visible).then(n => {
    const total = db.filter('files', f => f.vault_path && visible(f)).length;
    status.textContent = n >= total ? `All ${fmt.num(total)} original documents you can open are loaded in this browser.` : `${fmt.num(n)} of ${fmt.num(total)} original documents you can open are loaded in this browser.`;
  }).catch(() => { status.textContent = ''; });
  const input = h('input', { type: 'file', multiple: true, webkitdirectory: true, style: 'display:none', onChange: async e => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (!files.length) return;
    const bar = h('div');
    out.replaceChildren(card({ cls: 'solid' }, h('div.small', `Checking ${fmt.num(files.length)} files…`), bar));
    try {
      const r = await loadVaultFolder(files, { visible, onProgress: ({ done, total }) => bar.replaceChildren(progress(Math.round((done / total) * 100))) });
      const ok = r.loaded + r.already;
      out.replaceChildren(card({ title: 'Done', icon: ok ? 'check' : 'triangle-alert', cls: 'solid' },
        kv([['Loaded now', fmt.num(r.loaded)], ['Already in this browser', fmt.num(r.already)], ['Different from the record (left out)', fmt.num(r.mismatched.length)], ['Other files in that folder', fmt.num(r.other)]]),
        !ok ? callout('warning', 'No original documents were found in that folder', 'Choose the folder data/vault inside the app folder (next to index.html).', 'folder-x') : null,
        r.mismatched.length ? callout('warning', 'Some files do not match their records', `${r.mismatched.slice(0, 5).join(' · ')}${r.mismatched.length > 5 ? ' …' : ''} — they were changed since the zip was made, so they were left out.`, 'triangle-alert') : null));
      if (ok) toast.success(`${fmt.num(r.loaded)} original documents loaded`, { text: r.already ? `${fmt.num(r.already)} were already here.` : '' });
    } catch (err) { showError(err, 'Could not load the documents'); }
    refresh();
  } });
  refresh();
  return layout('load', h('div', pageHeader({ title: 'Load original documents', sub: 'For when the app is opened by double-clicking index.html.', icon: 'folder-input', tile: 't-grass' }),
    card({ cls: 'solid' }, h('div.stack',
      h('p', 'Every original document already opens in the viewer. A few features also need to read a document’s contents — importing an original spreadsheet into Sheets, putting an original photo into a slide PDF, attaching an original to a message. A page opened from the folder may only read files you choose, so choose the documents folder once:'),
      h('ol', { style: 'margin:0 0 0 18px' }, h('li', 'Click the button below.'), h('li', h('span', 'In the window that opens, go into the app folder, then ', h('b', 'data'), ', and select the ', h('b', 'vault'), ' folder.')), h('li', 'Click Upload (or Select Folder). Nothing leaves this computer: the browser keeps a checked copy.')),
      h('div.row.gap-8', btn({ label: 'Choose the data/vault folder', icon: 'folder-open', variant: 'primary', onClick: () => input.click() }), input),
      status)),
    out));
}

/* ---------------- routes ---------------- */
const myDrive = ctx => layout('my', listing(ctx, { title: 'My Drive', sub: 'Your own files.', files: live('files', f => !f.drive_id && !f.folder_id && (f.owner_id === me().id || f.created_by === me().id)), folders: live('folders', f => !f.drive_id && !f.parent_id && f.created_by === me().id) }));
function drivePage(ctx) {
  const d = db.get('drives', decodeURIComponent(ctx.params.id));
  if (!d || !canSeeDrive(d)) return layout('', emptyState({ icon: 'lock', title: 'Drive not available', text: 'It does not exist or you do not have access.' }));
  return layout(d.id, listing(ctx, { title: d.name, sub: d.description, driveId: d.id, files: live('files', f => f.drive_id === d.id && !f.folder_id), folders: live('folders', f => f.drive_id === d.id && !f.parent_id) }));
}
function folderPage(ctx) {
  const f = db.get('folders', decodeURIComponent(ctx.params.id));
  if (!f) return layout('', emptyState({ icon: 'folder-x', title: 'Folder not found' }));
  const d = f.drive_id ? db.get('drives', f.drive_id) : null;
  if (d && !canSeeDrive(d)) return layout('', emptyState({ icon: 'lock', title: 'No access' }));
  const path = folderPath(db.all('folders'), f.id);
  return layout(d ? d.id : 'my', listing(ctx, { title: f.name, driveId: f.drive_id, folderId: f.id, crumbs: [{ label: d ? d.name : 'My Drive', href: d ? `#/drive/d/${encodeURIComponent(d.id)}` : '#/drive' }, ...path.slice(0, -1).map(p => ({ label: p.name, href: `#/drive/f/${encodeURIComponent(p.id)}` })), { label: f.name }],
    files: live('files', x => x.folder_id === f.id), folders: live('folders', x => x.parent_id === f.id) }));
}
const vis = f => { const d = f.drive_id ? db.get('drives', f.drive_id) : null; return !d || canSeeDrive(d); };
const special = (id, title, sub, fn, canUpload = false) => ctx => layout(id, listing(ctx, { title, sub, files: live('files', f => vis(f) && fn(f)), folders: () => [], canUpload }));
function storagePage(ctx) {
  const box = h('div');
  storageUsed().then(bytes => {
    const all = db.all('files');
    const byDrive = [...db.all('drives'), { id: null, name: 'My Drive' }].map(d => ({ d, n: all.filter(f => (f.drive_id || null) === d.id).length, s: all.filter(f => (f.drive_id || null) === d.id).reduce((a, f) => a + (f.size || 0), 0) }));
    box.replaceChildren(h('div.grid.cols-3.stagger', { style: 'margin-bottom:14px' }, kpiTile({ label: 'Used', value: fmt.fileSize(bytes), icon: 'database', tile: 't-grass' }), kpiTile({ label: 'Files', value: all.length, icon: 'files', tile: 't-sky' }), kpiTile({ label: 'Waiting for import', value: all.filter(f => f.kind === 'pending').length, icon: 'cloud-off', tile: 't-sun' })),
      card({ title: 'By drive', icon: 'hard-drive', cls: 'solid' }, h('div.list.divider-list', byDrive.map(x => h('div.list-item', h('div.li-main', h('div.li-title', x.d.name), h('div.li-sub', `${x.n} files · ${fmt.fileSize(x.s)}`)))))));
  });
  return layout('storage', h('div', pageHeader({ title: 'Storage', icon: 'database', tile: 't-grass' }), box));
}
function photosPage(ctx) {
  const imgs = db.filter('files', f => vis(f) && /^image\//.test(f.mime || '') && f.kind !== 'pending').sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  const byDay = new Map(); imgs.forEach(f => { const d = String(f.created_at || '').slice(0, 10); if (!byDay.has(d)) byDay.set(d, []); byDay.get(d).push(f); });
  return layout('photos', h('div', pageHeader({ title: 'Photos', sub: 'Every photo — job sites, before & after, staff photos.', icon: 'images', tile: 't-clay' }),
    imgs.length ? h('div.stack', [...byDay].map(([d, list]) => h('div', h('h4', fmt.date(d, 'full')), h('div.fgrid', list.map(f => { const c = h('div.fcard', { onClick: () => openFile(f) }, h('div.nm', f.name), (f.tags || []).length ? h('div.mt', f.tags.join(', ')) : null); fileUrl(f).then(u => u && c.prepend(h('img.thumb', { src: u, alt: '' }))).catch(() => {}); return c; }))))) : emptyState({ icon: 'images', title: 'No photos yet', text: 'Photos from site visits and uploads appear here.' })));
}

export default {
  id: 'drive',
  routes: {
    '': myDrive, 'd/:id': drivePage, 'f/:id': folderPage, import: importPage, storage: storagePage, photos: photosPage, load: loadPage,
    recent: special('recent', 'Recent', 'Files added or changed in the last 30 days.', f => String(f.updated_at || f.created_at) >= addDays(today(), -30)),
    starred: special('starred', 'Starred', 'Your starred files.', starred),
    pending: special('pending', 'Waiting for the vault import', 'These records point to original documents. Import the document vault to attach the files.', f => f.kind === 'pending'),
    trash: ctx => layout('trash', h('div', pageHeader({ title: 'Trash', sub: 'Restore files or delete them forever.', icon: 'trash-2', tile: 't-slate' }), trashList(ctx)))
  },
  detail: { files: (id, ctx) => { const f = db.get('files', id); if (f) setTimeout(() => details(f), 50); return f && f.folder_id ? folderPage({ ...ctx, params: { id: f.folder_id } }) : f && f.drive_id ? drivePage({ ...ctx, params: { id: f.drive_id } }) : myDrive(ctx); } }
};

function trashList(ctx) {
  const box = h('div');
  const draw = () => {
    const del = db.trash('files').filter(vis);
    box.replaceChildren(del.length ? h('div.list.divider-list', del.map(f => h('div.list-item', h('div', { class: ['li-ico', fileIcon(f)[1]] }, icon(fileIcon(f)[0], 18)), h('div.li-main', h('div.li-title', f.name), h('div.li-sub', `Deleted ${fmt.relative(f.deleted_at)} by ${f.deleted_by_name || '—'}`)),
      btn({ label: 'Restore', icon: 'rotate-ccw', size: 'sm', onClick: () => db.restore('files', f.id).then(() => toast.success('Restored')).catch(showError) }),
      isManager() ? btn({ label: 'Delete forever', icon: 'x', size: 'sm', variant: 'ghost', onClick: async () => { if (await confirm(`Delete “${f.name}” forever? This cannot be undone.`, { danger: true, ok: 'Delete forever' })) { await deleteFileBytes(f).catch(() => {}); await db.remove('files', f.id, { hard: true }); toast.success('Deleted forever'); draw(); } } }) : null))) : emptyState({ icon: 'trash', title: 'Trash is empty' }));
  };
  ctx.dispose.add(db.on('files', draw));
  draw();
  return box;
}
