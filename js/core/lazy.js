/* =============================================================================
   Load the big vendored libraries only when a screen first needs them.
   Excel, PDF, charts, maps, zip and Supabase together are ~2 MB of script;
   loading them up front made every start slower even though Home uses none.
   They stay in the service-worker cache, so on-demand loads also work offline.

   const XLSX = await ensureLib('xlsx');           // resolves with the library global
   prefetchLib('chart');                            // warm it up when the browser is idle
   ========================================================================== */

const LIBS = {
  xlsx: { js: ['vendor/xlsx.full.min.js'], ready: () => globalThis.XLSX },
  // autotable patches jsPDF.API, so jsPDF must run first (the scripts load one after the other)
  jspdf: { js: ['vendor/jspdf.umd.min.js', 'vendor/jspdf.plugin.autotable.min.js'], ready: () => globalThis.jspdf && globalThis.jspdf.jsPDF && globalThis.jspdf.jsPDF.API && globalThis.jspdf.jsPDF.API.autoTable ? globalThis.jspdf : null },
  chart: { js: ['vendor/chart.umd.min.js'], ready: () => globalThis.Chart },
  leaflet: { css: 'vendor/leaflet/leaflet.css', js: ['vendor/leaflet/leaflet.js'], ready: () => globalThis.L && globalThis.L.map ? globalThis.L : null },
  jszip: { js: ['vendor/jszip.min.js'], ready: () => globalThis.JSZip },
  supabase: { js: ['vendor/supabase.min.js'], ready: () => globalThis.supabase && globalThis.supabase.createClient ? globalThis.supabase : null }
};
const inflight = new Map();

function add(tag, attrs) {
  return new Promise((ok, bad) => {
    const el = document.createElement(tag);
    Object.assign(el, attrs);
    el.onload = () => ok();
    el.onerror = () => { el.remove(); bad(new Error(`Could not load ${attrs.src || attrs.href} — check your connection and try again.`)); };
    document.head.appendChild(el);
  });
}

/** Resolve with the library (loading it once if needed). Rejects if it cannot load; a later call retries. */
export function ensureLib(name) {
  const L = LIBS[name];
  if (!L) return Promise.reject(new Error(`Unknown library ${name}`));
  const have = L.ready();
  if (have) return Promise.resolve(have);
  if (typeof document === 'undefined') return Promise.reject(new Error(`${name} is not available here`));
  if (!inflight.has(name)) {
    inflight.set(name, (async () => {
      if (L.css && !document.querySelector(`link[href="${L.css}"]`)) await add('link', { rel: 'stylesheet', href: L.css });
      for (const src of L.js) if (!document.querySelector(`script[src="${src}"]`)) await add('script', { src, async: false });
      const lib = L.ready();
      if (!lib) throw new Error(`The ${name} library did not start — reload the page and try again.`);
      return lib;
    })().catch(e => { inflight.delete(name); throw e; }));
  }
  return inflight.get(name);
}

/** Start loading a library in the background (e.g. when the pointer moves over an Export button). */
export function prefetchLib(name) {
  if (typeof window === 'undefined') return;
  const go = () => ensureLib(name).catch(() => { /* the real call reports the problem */ });
  if (window.requestIdleCallback) window.requestIdleCallback(go, { timeout: 4000 }); else setTimeout(go, 200);
}
