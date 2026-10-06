/* =============================================================================
   photoGallery({ collection, id, tagPrefix }) — before/after photo gallery for
   any record (client, job, visit): take photos with the phone camera, tag them
   Before / After, view in a lightbox and compare before vs after with a slider.
   ========================================================================== */

import { h, ensureStyle } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { btn, emptyState, seg } from '../../ui/components.js';
import { modal, showError } from '../../ui/overlays.js';
import { db } from '../../core/db.js';
import { uploadFiles, fileUrl, filesFor } from '../../core/files.js';
import * as fmt from '../../core/format.js';

ensureStyle('lsi-gallery', `
.gal{display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:10px}
.gal figure{margin:0;position:relative;border-radius:14px;overflow:hidden;cursor:zoom-in;aspect-ratio:1;background:var(--surface-2)}
.gal img{width:100%;height:100%;object-fit:cover}.gal figcaption{position:absolute;left:6px;top:6px;background:rgba(0,0,0,.55);color:#fff;border-radius:8px;padding:1px 7px;font-size:.72rem}
.cmp{position:relative;max-width:100%;overflow:hidden;border-radius:14px;user-select:none}.cmp img{display:block;width:100%}
.cmp .after{position:absolute;inset:0;overflow:hidden}.cmp .after img{position:absolute;left:0;top:0;height:100%;width:auto;max-width:none}
.cmp input{width:100%;margin-top:8px}
`);

export function photoGallery({ collection, id, tagPrefix = '' }) {
  const root = h('div');
  const tagOf = f => ((f.tags || []).find(t => /^(before|after)$/i.test(t)) || '').toLowerCase();
  const draw = async () => {
    const photos = filesFor(collection, id).filter(f => /^image\//.test(f.mime || '')).sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
    let tag = 'before';
    const input = h('input', { type: 'file', accept: 'image/*', capture: 'environment', multiple: true, style: 'display:none', onChange: async e => {
      try { const recs = await uploadFiles(e.target.files, { linked: [{ collection, id }], description: `${tag === 'before' ? 'Before' : 'After'} photo${tagPrefix ? ' — ' + tagPrefix : ''}` }); for (const r of recs) await db.update('files', r.id, { tags: [tag === 'before' ? 'Before' : 'After'] }); draw(); } catch (err) { showError(err, 'Upload failed'); }
    } });
    const grid = h('div.gal');
    for (const f of photos) {
      const fig = h('figure', { onClick: () => lightbox(f) }, h('figcaption', tagOf(f) ? tagOf(f).toUpperCase() : fmt.date(f.created_at, 'short')));
      grid.appendChild(fig);
      fileUrl(f).then(u => u && fig.prepend(h('img', { src: u, alt: f.name, loading: 'lazy' }))).catch(() => {});
    }
    const before = photos.filter(f => tagOf(f) === 'before'), after = photos.filter(f => tagOf(f) === 'after');
    root.replaceChildren(
      h('div.row.gap-8', { style: 'margin-bottom:10px' }, seg([{ id: 'before', label: 'Before' }, { id: 'after', label: 'After' }], tag, x => { tag = x; }), btn({ label: 'Take / add photos', icon: 'camera', variant: 'primary', size: 'sm', onClick: () => input.click() }), input,
        before.length && after.length ? btn({ label: 'Compare', icon: 'columns-2', size: 'sm', onClick: () => compare(before[before.length - 1], after[after.length - 1]) }) : null),
      photos.length ? grid : emptyState({ icon: 'images', title: 'No photos yet', text: 'Add before and after photos from your phone camera.' }));
  };
  draw();
  return root;
}

async function lightbox(f) {
  const u = await fileUrl(f);
  modal({ title: f.name, icon: 'image', tile: 't-clay', size: 'xwide', body: u ? h('img', { src: u, alt: f.name, style: 'max-width:100%;max-height:75vh;display:block;margin:auto;border-radius:12px' }) : emptyState({ icon: 'cloud-off', title: 'Not available offline' }) });
}
async function compare(b, a) {
  const [ub, ua] = await Promise.all([fileUrl(b), fileUrl(a)]);
  const afterBox = h('div.after', { style: 'width:50%' }, h('img', { src: ua, alt: 'After' }));
  const wrap = h('div.cmp', h('img', { src: ub, alt: 'Before' }), afterBox);
  const range = h('input', { type: 'range', min: 0, max: 100, value: 50, onInput: e => { afterBox.style.width = `${e.target.value}%`; } });
  modal({ title: 'Before / after', icon: 'columns-2', tile: 't-grass', size: 'wide', body: h('div', wrap, range, h('div.row.small.muted', h('span', 'Before'), h('span.spacer'), h('span', 'After'))) });
  requestAnimationFrame(() => { const img = afterBox.querySelector('img'); if (img) img.style.width = `${wrap.clientWidth}px`; });
}
