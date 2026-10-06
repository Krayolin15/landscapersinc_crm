// The Document Vault: the company's 8 shared drives (as on Google Drive), their folders, and one file record
// for EVERY original company document (239 unique files). Each file is linked to the records that were
// transcribed from it, carries its searchable text, confidentiality and expiry, and where the original sits:
// vault_path inside the private vault (served from data/vault/ in local mode, no import needed) and storage_path
// in Supabase storage (uploaded by tools__upload-vault.js). Documents sent later (extra zips such as
// landscapers_data.zip) are filed the same way.
// Sources: <scratchpad>/vault-index.json (data-tools__vault-index.js), groups.json + text dumps, all mapped records.
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';

export const DRIVES = [
  { id: 'drive-admin', name: 'ADMIN', color: '#6b7a70', icon: 'folder-cog' },
  { id: 'drive-finance', name: 'FINANCE', color: '#1f7440', icon: 'landmark', restricted: true, roles: ['finance'] },
  { id: 'drive-hr', name: 'HR', color: '#de8d4f', icon: 'id-card', restricted: true, roles: ['hr'] },
  { id: 'drive-legal', name: 'LEGAL AND COMPLIANCE', color: '#e0525e', icon: 'scale' },
  { id: 'drive-management', name: 'MANAGEMENT', color: '#7b61ff', icon: 'mountain' },
  { id: 'drive-operations', name: 'OPERATIONS', color: '#1e9bc4', icon: 'route' },
  { id: 'drive-sales', name: 'SALES', color: '#f2b42f', icon: 'target' },
  { id: 'drive-sops', name: "SOP'S & TEMPLATES", color: '#5fa83b', icon: 'book-open' }
];
const GROUP = {
  company_compliance: ['drive-legal', 'Company documents'], crm_workbooks: ['drive-sales', 'CRM workbooks'], financials: ['drive-finance', 'Income statements'],
  invoices_apr_may: ['drive-finance', 'Invoices'], invoices_june: ['drive-finance', 'Invoices'], invoices_july: ['drive-finance', 'Invoices'],
  kpi_trackers: ['drive-management', 'KPI trackers'], strategy_roles: ['drive-management', 'Strategy & roles'], schedule_ops_registers: ['drive-operations', 'Schedules & registers'],
  projects_fleet_purchases: ['drive-operations', 'Fleet & projects'], people_hr: ['drive-hr', 'Employees'], medicals: ['drive-hr', 'Medicals'],
  training_firstaid: ['drive-hr', 'Training material'], training_heights: ['drive-hr', 'Training material'], training_firefighting_hsrep: ['drive-hr', 'Training material'],
  hs_policies_procedures: ['drive-sops', 'H&S'], hs_forms_checklists_loa: ['drive-sops', 'H&S'], sops_toolbox: ['drive-sops', 'SOPs'],
  sales_leads: ['drive-sales', 'Sales portfolio'], marketing_options: ['drive-sales', 'Marketing & design options']
};
const STAMP = /-20\d{6}T\d{6}Z-\d-\d{3}$/;
const CONFIDENTIAL = /medical|employee index|ex_?employee|employees\/|contracts employees|director id|\bid\b|payroll|income statement|bank|certified/i;
const pathKey = p => { const parts = String(p).replace(/\\/g, '/').split('/').map(s => s.trim().toLowerCase()).filter(Boolean); return parts.slice(-2).join('|'); };

/** original folders after the timestamped download folder, with the repeated top name collapsed. */
export function folderParts(src) {
  const parts = src.replace(/\\/g, '/').split('/').slice(1, -1).map(s => s.trim()).filter(Boolean);
  if (parts.length && STAMP.test(parts[0])) parts[0] = parts[0].replace(STAMP, '').trim();
  if (parts.length > 1 && parts[0].toLowerCase() === parts[1].toLowerCase()) parts.shift();
  return parts;
}

export async function build(ctx) {
  const SP = dirname(ctx.KNOW);
  const idxPath = join(SP, 'vault-index.json');
  if (!existsSync(idxPath)) { ctx.notes.push('vault-index.json missing — run data-tools__vault-index.js first; no vault records built'); return {}; }
  const index = JSON.parse(readFileSync(idxPath, 'utf8'));
  const groups = existsSync(join(SP, 'groups.json')) ? JSON.parse(readFileSync(join(SP, 'groups.json'), 'utf8')).groups : [];
  const txtBySrc = new Map(groups.flatMap(g => g.files.map(f => [pathKey(f.src), f.txt])));

  // which records came from which file (via _src provenance)
  const linkedBy = new Map();
  // (only business records: the vault's own drives/folders/files and the Data health issues are built from these
  // links, and are present already when building on top of an existing data pack with --base)
  const NOT_SOURCES = new Set(['files', 'folders', 'drives', 'data_issues']);
  for (const [col, m] of Object.entries(ctx.records)) if (!NOT_SOURCES.has(col)) for (const r of m.values()) {
    for (const part of String(r._src || '').split(/\s;\s/)) {
      const p = part.split(' | ')[0].trim();
      if (!/\.(pdf|xlsx|docx|pptx|jpe?g|png|md)$/i.test(p)) continue;
      const k = pathKey(p);
      if (!linkedBy.has(k)) linkedBy.set(k, []);
      const arr = linkedBy.get(k);
      if (!arr.some(x => x.collection === col && x.id === r.id) && arr.length < 400) arr.push({ collection: col, id: r.id });
    }
  }
  const expiryOf = links => {
    const dates = links.map(l => { const r = ctx.records[l.collection] && ctx.records[l.collection].get(l.id); return r && (r.expiry_date || r.licence_expiry); }).filter(Boolean).sort();
    return dates[0] || null;
  };

  const out = { drives: [], folders: [], files: [] };
  for (const d of DRIVES) out.drives.push({ id: d.id, name: d.name, color: d.color, icon: d.icon, restricted: !!d.restricted, roles: d.roles || [],
    members: d.restricted ? [{ profile_id: 'prof-jared', access: 'manager' }, { profile_id: 'prof-anthony', access: 'manager' }] : [],
    description: d.restricted ? 'Restricted: directors and the general manager (add members in Drive).' : 'Shared with the whole company.', _generated: true });

  const folderId = (driveId, parts) => {
    let parent = null;
    for (let i = 0; i < parts.length; i++) {
      const id = ctx.id('fld', driveId, ...parts.slice(0, i + 1));
      if (!out.folders.some(f => f.id === id)) out.folders.push({ id, name: parts[i], drive_id: driveId, parent_id: parent, _generated: true });
      parent = id;
    }
    return parent;
  };

  // extra links for files no record cites directly
  const HR = ctx.has('people_hr') ? ctx.k('people_hr').entities : { staff_photos: [] };
  const { ALIASES } = await import('./50-people.js');
  const empByName = n => { const w = String(n || '').replace(/\(.*?\)/g, ' ').trim().toUpperCase().split(/\s+/); for (const x of w) if (ALIASES[x]) return ALIASES[x]; const last = w[w.length - 1]; return [...(ctx.records.employees || new Map()).values()].find(e => (e.full_name || '').toUpperCase().includes(last))?.id || null; };
  const extraLinks = f => {
    const n = f.name.toLowerCase(), out2 = [];
    const deck = /garden design/.test(n) ? 'Garden design options' : /paving/.test(n) ? 'Paving options' : null;
    if (deck) for (const d of (ctx.records.design_options || new Map()).values()) if (d.deck === deck) out2.push({ collection: 'design_options', id: d.id });
    if (/ex employees\.xlsx/.test(n)) out2.push({ collection: 'employees', id: 'emp-ramsaroop' });
    if (/dsw application/.test(n)) out2.push({ collection: 'compliance_docs', id: 'cd-dsw-cornubia' });
    const photo = (HR.staff_photos || []).find(p => pathKey(p.file || '') === pathKey(f.src) || String(p.file || '').endsWith(f.name));
    if (photo) { const e = empByName(photo.linked_person); if (e) out2.push({ collection: 'employees', id: e }); }
    return out2;
  };

  const usedPaths = new Set();
  for (const f of index.files) {
    let [drive, base] = GROUP[f.group] || ['drive-admin', 'Other'];
    if (f.group === 'projects_fleet_purchases') { if (/\/Purchases\//i.test(f.src)) [drive, base] = ['drive-finance', 'Purchases']; else if (/\/References\//i.test(f.src)) [drive, base] = ['drive-sales', 'References']; }
    if (/\/(EX_?\s?Employees|EMPLOYEES)\b/i.test(f.src)) [drive, base] = ['drive-hr', 'Employees'];
    let inner = folderParts(f.src);
    const carron = f.group === 'carron_glen_proposal' ? carronFile(f) : null;
    if (carron) { [drive, base] = carron.place; inner = [base, 'Carron Glen Estate']; }
    const parts = inner.length ? inner : [base];
    const links = [...(linkedBy.get(pathKey(f.src)) || []), ...extraLinks(f), ...(carron ? carron.links : [])].filter((l, i, a) => a.findIndex(x => x.collection === l.collection && x.id === l.id) === i);
    const id = `file-${f.sha256.slice(0, 24)}`;
    const txt = txtBySrc.get(pathKey(f.src));
    // text for search: the reader's text dump; when rebuilding on top of an existing data pack (--base) without
    // the dumps, keep the text the file already had
    const text = carron ? carron.text : txt && existsSync(join(SP, txt)) ? readFileSync(join(SP, txt), 'utf8').replace(/^# .*$/m, '').replace(/=== (PAGE|SLIDE) \d+ ===/g, ' ').replace(/\[[^\]]+\]\s?/g, '').replace(/\s+/g, ' ').trim().slice(0, 8000)
      : ((ctx.records.files && ctx.records.files.get(id)) || {}).text_index || null;
    // where the original sits: in the private vault (data/vault/<vault_path>, the same path inside the vault zip) and,
    // once live, in Supabase storage (storage_path, uploaded by tools__upload-vault.js) — so it opens without an import
    let vaultPath = [driveName(drive), ...parts, f.name].join('/'), n = 2;
    while (usedPaths.has(vaultPath.toLowerCase())) { const dot = f.name.lastIndexOf('.'); const stem = dot > 0 ? f.name.slice(0, dot) : f.name, ext = dot > 0 ? f.name.slice(dot) : ''; vaultPath = [driveName(drive), ...parts, `${stem} (${n++})${ext}`].join('/'); }
    usedPaths.add(vaultPath.toLowerCase());
    out.files.push({
      // id from the content hash: identical names in different folders stay separate
      id, name: f.name, drive_id: drive, folder_id: folderId(drive, parts), mime: f.mime, size: f.size, kind: 'vault',
      vault_path: vaultPath, storage_path: `${drive}/${id}/${f.name.replace(/[^\w.\- ()]+/g, '_')}`,
      description: carron ? carron.description : `Original company document${links.length ? ` · ${links.length} record${links.length === 1 ? '' : 's'} in the system came from it` : ''}.`,
      tags: carron ? carron.tags : [f.group ? f.group.replace(/_/g, ' ') : 'other'], text_index: text, source_path: f.src, linked: links, version: 1,
      expires_on: expiryOf(links), confidential: CONFIDENTIAL.test(f.src) || f.group === 'medicals',
      sha256: f.sha256, also_at: f.also_at && f.also_at.length ? f.also_at : undefined, _src: f.src
    });
  }
  return out;

  /** The Carron Glen proposal and its 13 images: where they are filed, what they show, which records they belong to. */
  function carronFile(f) {
    const K = ctx.has('carron_glen_proposal') ? ctx.k('carron_glen_proposal').entities : { images: [], proposal: {} };
    const client = [...(ctx.records.clients || new Map()).values()].find(c => c.legacy_code === 'CGE048' || /attlee agency/i.test(c.name || ''));
    const site = [...(ctx.records.sites || new Map()).values()].find(s => /^carron glen estate$/i.test(s.name || '') && (!client || s.client_id === client.id));
    const job = ctx.records.jobs && ctx.records.jobs.get('job-carron-glen-plan');
    const links = [client && { collection: 'clients', id: client.id }, site && { collection: 'sites', id: site.id }, job && { collection: 'jobs', id: job.id }].filter(Boolean);
    if (/\.docx$/i.test(f.name)) {
      const t = K.proposal.rehab_quote ? `R${K.proposal.rehab_quote.total_printed.toLocaleString('en-ZA')}` : '';
      const textPath = join(SP, 'newdata', 'proposal.txt');
      return { place: ['drive-sales', 'Proposals'], links, tags: ['proposal', 'carron glen'],
        description: `Carron Glen Estate proposal: the project plan for monthly maintenance and the once-off rehabilitation quote${t ? ` (${t})` : ''}. The project plan shows that quote discounted to R0.00 — see Data health CGP-D01.`,
        text: existsSync(textPath) ? readFileSync(textPath, 'utf8').replace(/\s+/g, ' ').trim().slice(0, 8000) : null };
    }
    const img = (K.images || []).find(i => i.file === f.name);
    return { place: ['drive-operations', 'Site photos'], links, tags: ['site photo', 'carron glen'],
      description: `${img ? img.caption : 'Site image'} Filed with the Carron Glen Estate proposal. The file name says it was generated or edited with Google Gemini — confirm it is a real site photo before showing clients (Data health).`,
      text: img ? img.caption : null };
  }
}
const driveName = id => (DRIVES.find(d => d.id === id) || { name: id }).name;
