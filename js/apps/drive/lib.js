/* Drive — pure helpers (no DOM, no db). Unit tested in tests/drive.test.js. */

export const COMPANY_DRIVES = [
  { id: 'drive-admin', name: 'ADMIN', color: '#6b7a70', icon: 'folder-cog' },
  { id: 'drive-finance', name: 'FINANCE', color: '#1f7440', icon: 'landmark', restricted: true, roles: ['finance'] },
  { id: 'drive-hr', name: 'HR', color: '#de8d4f', icon: 'id-card', restricted: true, roles: ['hr'] },
  { id: 'drive-legal', name: 'LEGAL AND COMPLIANCE', color: '#e0525e', icon: 'scale' },
  { id: 'drive-management', name: 'MANAGEMENT', color: '#7b61ff', icon: 'mountain' },
  { id: 'drive-operations', name: 'OPERATIONS', color: '#1e9bc4', icon: 'route' },
  { id: 'drive-sales', name: 'SALES', color: '#f2b42f', icon: 'target' },
  { id: 'drive-sops', name: "SOP'S & TEMPLATES", color: '#5fa83b', icon: 'book-open' }
];

/** Folder chain from the root to `folderId` (for breadcrumbs). */
export function folderPath(folders, folderId) {
  const byId = new Map(folders.map(f => [f.id, f]));
  const out = [];
  let cur = byId.get(folderId), guard = 0;
  while (cur && guard++ < 50) { out.unshift(cur); cur = cur.parent_id ? byId.get(cur.parent_id) : null; }
  return out;
}

/** Validate a document-vault manifest; returns { ok, errors[], files, bytes, byDrive }. */
export function validateManifest(m) {
  const errors = [];
  if (!m || typeof m !== 'object') return { ok: false, errors: ['manifest.json is missing or not JSON'], files: 0, bytes: 0, byDrive: {} };
  const files = Array.isArray(m.files) ? m.files : [];
  if (!files.length) errors.push('The manifest lists no files');
  const seen = new Set(), byDrive = {};
  let bytes = 0;
  files.forEach((f, i) => {
    if (!f.path_in_zip) errors.push(`Entry ${i + 1} has no path_in_zip`);
    if (!f.drive) errors.push(`Entry ${i + 1} (${f.path_in_zip}) has no drive`);
    if (f.sha && seen.has(f.sha)) errors.push(`Duplicate file ${f.path_in_zip}`);
    if (f.sha) seen.add(f.sha);
    bytes += Number(f.size) || 0;
    byDrive[f.drive] = (byDrive[f.drive] || 0) + 1;
  });
  return { ok: !errors.length, errors, files: files.length, bytes, byDrive };
}

/** Split "A/B/c.pdf" into { folders:['A','B'], name:'c.pdf' } (ignores empty parts and __MACOSX). */
export function splitZipPath(p) {
  const parts = String(p).replace(/\\/g, '/').split('/').filter(Boolean);
  return { folders: parts.slice(0, -1), name: parts[parts.length - 1] || '' };
}
export const isJunk = p => /(^|\/)(__MACOSX|\.DS_Store|Thumbs\.db|desktop\.ini)(\/|$)/i.test(p);

export function sortFiles(list, by = 'name') {
  const s = list.slice();
  if (by === 'modified') return s.sort((a, b) => String(b.updated_at || b.created_at).localeCompare(String(a.updated_at || a.created_at)));
  if (by === 'size') return s.sort((a, b) => (b.size || 0) - (a.size || 0));
  return s.sort((a, b) => String(a.name).localeCompare(String(b.name), undefined, { numeric: true, sensitivity: 'base' }));
}

export function typeOf(f) {
  const m = String(f.mime || ''), n = String(f.name || '').toLowerCase();
  if (f.kind === 'doc') return 'docs'; if (f.kind === 'sheet') return 'sheets'; if (f.kind === 'slides') return 'slides'; if (f.kind === 'form') return 'forms';
  if (m.includes('pdf') || n.endsWith('.pdf')) return 'pdf';
  if (m.startsWith('image/')) return 'images';
  if (/sheet|excel|csv/.test(m) || /\.(xlsx?|csv)$/.test(n)) return 'spreadsheets';
  if (/word|document/.test(m) || /\.docx?$/.test(n)) return 'documents';
  if (/presentation|powerpoint/.test(m) || /\.pptx?$/.test(n)) return 'presentations';
  return 'other';
}
