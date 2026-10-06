// The app in a real browser — headless Chrome or Edge with a fresh, throw-away profile every run:
//   npm run test:browser                       both ways the app is opened: double-clicked (file://) and served (http)
//   node tools__test-browser.js [--mode file|http|both] [--browser chrome|edge] [--show] [--shots <folder>]
//
// For each way: the first start loads the whole data pack (every record counted); a temporary owner login is made
// inside that throw-away profile only; every app opens with no error; original documents open (a PDF and a photo);
// an invoice PDF downloads with the logo in it; opened from the folder, Load original documents is run against
// data/vault and Sheets can then import an original spreadsheet. Any browser error or warning-level failure fails it.
// Needs Chrome or Edge installed (or LSI_BROWSER=<path to the browser>). Uses only Node's built-in modules.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { startServer } from './serve.js';
import { readManifest, readCollection, hasPack } from './lib/seed-files.js';
import { APPS } from '../js__apps__registry.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const MODES = ({ both: ['file', 'http'], file: ['file'], http: ['http'] })[arg('--mode', 'both')];
const SHOW = process.argv.includes('--show');
const SHOTS = arg('--shots', null) ? resolve(arg('--shots')) : null;
if (!MODES) { console.error('--mode must be file, http or both'); process.exit(2); }
if (!hasPack(join(root, 'data/seed'))) { console.error('✗ data/seed/ (the company data pack) is missing — this test needs it.'); process.exit(2); }
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

function findBrowser() {
  if (process.env.LSI_BROWSER) return process.env.LSI_BROWSER;
  const want = arg('--browser', null);
  const pf = [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA].filter(Boolean);
  const chrome = [...pf.map(p => join(p, 'Google/Chrome/Application/chrome.exe')), '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'];
  const edge = [...pf.map(p => join(p, 'Microsoft/Edge/Application/msedge.exe')), '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', '/usr/bin/microsoft-edge'];
  const list = want === 'edge' ? edge : want === 'chrome' ? chrome : [...chrome, ...edge];
  return list.find(p => existsSync(p)) || null;
}

/* ---------------- a minimal Chrome DevTools Protocol client ---------------- */
class CDP {
  constructor(ws) {
    this.ws = ws; this.n = 0; this.pending = new Map(); this.listeners = new Set();
    ws.addEventListener('message', e => {
      const m = JSON.parse(e.data);
      if (m.id && this.pending.has(m.id)) { const p = this.pending.get(m.id); this.pending.delete(m.id); if (m.error) p.bad(new Error(`${m.error.message}${m.error.data ? ` (${m.error.data})` : ''}`)); else p.ok(m.result); }
      else if (m.method) for (const fn of this.listeners) fn(m);
    });
  }
  send(method, params = {}, sessionId) { const id = ++this.n; this.ws.send(JSON.stringify({ id, method, params, sessionId })); return new Promise((ok, bad) => this.pending.set(id, { ok, bad })); }
  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function launch(exe, profile) {
  const args = [`--user-data-dir=${profile}`, '--remote-debugging-port=0', '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-sync', '--disable-features=Translate,MediaRouter', '--window-size=1366,900', 'about:blank'];
  if (!SHOW) args.unshift('--headless=new');
  const child = spawn(exe, args, { stdio: 'ignore' });
  const portFile = join(profile, 'DevToolsActivePort');
  for (let i = 0; i < 150 && !existsSync(portFile); i++) await sleep(100);
  if (!existsSync(portFile)) { child.kill(); throw new Error('the browser did not start (no DevToolsActivePort)'); }
  const [port, path] = readFileSync(portFile, 'utf8').split('\n');
  const ws = new WebSocket(`ws://127.0.0.1:${port.trim()}${path.trim()}`);
  await new Promise((ok, bad) => { ws.addEventListener('open', ok); ws.addEventListener('error', bad); });
  return { child, cdp: new CDP(ws), ws };
}

/* ---------------- checks ---------------- */
let passed = 0, failed = 0;
const ok = (name, cond, detail = '') => { if (cond) { passed++; console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ''}`); } else { failed++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); } return cond; };

const manifest = readManifest(join(root, 'data/seed'));
const files = readCollection(join(root, 'data/seed'), 'files') || [];
const invoices = readCollection(join(root, 'data/seed'), 'invoices') || [];
const vaultDir = join(root, 'data/vault');
const vaultThere = rec => existsSync(join(vaultDir, ...String(rec.vault_path).split('/')));
const vaultPdf = files.find(f => f.vault_path && /pdf/.test(f.mime || '') && vaultThere(f));
const vaultPhoto = files.find(f => f.vault_path && /^image\/(jpeg|png)/.test(f.mime || '') && vaultThere(f));
const vaultSheet = files.find(f => f.vault_path && /\.xlsx$/i.test(f.name || '') && vaultThere(f));
const vaultCount = files.filter(f => f.vault_path).length;

async function runMode(mode, exe) {
  console.log(`\n${mode === 'file' ? 'Opened from the folder (file://, js__app.bundle.js)' : 'Served over http (ES modules)'}`);
  const profile = mkdtempSync(join(tmpdir(), 'lsi-browser-'));
  const downloads = join(profile, 'downloads'); mkdirSync(downloads);
  let server = null, browser = null;
  const problems = [];
  try {
    if (mode === 'http') server = await startServer(0, '127.0.0.1');
    const base = mode === 'file' ? pathToFileURL(join(root, 'index.html')).href : `http://127.0.0.1:${server.address().port}/index.html`;
    browser = await launch(exe, profile);
    const { cdp } = browser;
    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    const S = (m, p) => cdp.send(m, p, sessionId);
    await Promise.all([S('Page.enable'), S('Runtime.enable'), S('Log.enable'), S('Network.enable')]);
    await cdp.send('Browser.setDownloadBehavior', { behavior: 'allowAndName', downloadPath: downloads, eventsEnabled: true });
    const done = new Set();
    const vaultLoads = new Map();
    cdp.on(m => {
      if (m.sessionId && m.sessionId !== sessionId) return;
      if (m.method === 'Runtime.exceptionThrown') problems.push(`exception: ${m.params.exceptionDetails.exception ? m.params.exceptionDetails.exception.description : m.params.exceptionDetails.text}`.split('\n')[0]);
      if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') problems.push(`console.error: ${m.params.args.map(a => a.value ?? a.description ?? '').join(' ')}`.slice(0, 300));
      if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') problems.push(`browser: ${m.params.entry.text}${m.params.entry.url ? ` (${m.params.entry.url})` : ''}`.slice(0, 300));
      if (m.method === 'Network.responseReceived' && m.params.response.url.includes('/data/vault/')) vaultLoads.set(decodeURIComponent(m.params.response.url.split('/data/vault/')[1]), m.params.response.status);
      if (m.method === 'Browser.downloadProgress' && m.params.state === 'completed') done.add(m.params.guid);
    });
    const evaluate = async (expression, awaitPromise = true) => {
      const r = await S('Runtime.evaluate', { expression, awaitPromise, returnByValue: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception ? r.exceptionDetails.exception.description : r.exceptionDetails.text);
      return r.result.value;
    };
    const waitFor = async (expression, ms = 30000, what = expression) => {
      const until = Date.now() + ms;
      while (Date.now() < until) { try { if (await evaluate(`!!(${expression})`, false)) return true; } catch { /* page changing */ } await sleep(100); }
      throw new Error(`timed out waiting for ${what}`);
    };
    const shot = async name => { if (!SHOTS) return; const { data } = await S('Page.captureScreenshot', { format: 'png' }); writeFileSync(join(SHOTS, `${mode}-${name}.png`), Buffer.from(data, 'base64')); };
    const go = async hash => { await evaluate(`location.hash = ${JSON.stringify(hash)}`); await sleep(150); await waitFor(`document.querySelector('#main .view') && !document.querySelector('#main .view .empty .e-art [data-lucide="loader"]')`, 20000, `${hash} to render`); await sleep(350); };
    const mainText = () => evaluate(`(document.querySelector('#main') || document.body).innerText`);

    // 1. first start: the whole data pack loads
    let t0 = Date.now();
    await S('Page.navigate', { url: base });
    await waitFor(`/Welcome back/.test(document.body.innerText)`, 120000, 'the sign-in screen');
    ok('first start shows the sign-in screen', true, `${((Date.now() - t0) / 1000).toFixed(1)} s including loading ${manifest.collections.reduce((a, c) => a + c.count, 0)} records`);
    const loaded = await evaluate(`(async () => {
      const d = await new Promise((ok, bad) => { const r = indexedDB.open('landscapers-hq'); r.onsuccess = () => ok(r.result); r.onerror = () => bad(r.error); });
      const t = d.transaction(['records', 'kv'], 'readonly');
      const recs = await new Promise(ok => { const r = t.objectStore('records').getAll(); r.onsuccess = () => ok(r.result); });
      const ver = await new Promise(ok => { const r = t.objectStore('kv').get('seed.version'); r.onsuccess = () => ok(r.result ? r.result.v : null); });
      d.close();
      const by = {}; for (const x of recs) if (x.v && x.v._seed) by[x.col] = (by[x.col] || 0) + 1;
      return { ver, by };
    })()`);
    const wrong = manifest.collections.filter(c => (loaded.by[c.name] || 0) !== c.count).map(c => `${c.name} ${loaded.by[c.name] || 0}/${c.count}`);
    ok('every record of the data pack is in the browser', !wrong.length && loaded.ver === manifest.version, wrong.length ? wrong.join(', ') : `version ${loaded.ver}, ${manifest.collections.length} collections`);
    await shot('signin');

    // 2. a temporary owner login, only inside this throw-away browser profile
    const pw = `Test-${randomBytes(12).toString('base64url')}-9`;
    await evaluate(`(async () => {
      const salt = Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join('');
      const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(${JSON.stringify(pw)}), 'PBKDF2', false, ['deriveBits']);
      const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: new TextEncoder().encode(salt), iterations: 100000 }, key, 256);
      const hash = Array.from(new Uint8Array(bits), b => b.toString(16).padStart(2, '0')).join('');
      const now = new Date().toISOString();
      const v = { id: 'prof-browser-test', name: 'Zz Browser Test', role: 'owner', status: 'active', title: 'Automated test', must_change_password: false, password_hash: hash, password_salt: salt, created_at: now, updated_at: now };
      const d = await new Promise((ok, bad) => { const r = indexedDB.open('landscapers-hq'); r.onsuccess = () => ok(r.result); r.onerror = () => bad(r.error); });
      await new Promise((ok, bad) => { const t = d.transaction('records', 'readwrite'); t.objectStore('records').put({ k: 'profiles|' + v.id, col: 'profiles', id: v.id, v }); t.oncomplete = ok; t.onerror = () => bad(t.error); });
      d.close();
    })()`);
    t0 = Date.now();
    await S('Page.reload');
    await waitFor(`[...document.querySelectorAll('.user-pick button b')].some(b => b.textContent === 'Zz')`, 60000, 'the test login on the sign-in screen');
    ok('second start (data already in the browser)', true, `${((Date.now() - t0) / 1000).toFixed(1)} s to the sign-in screen`);
    await evaluate(`[...document.querySelectorAll('.user-pick button')].find(b => (b.querySelector('b') || {}).textContent === 'Zz').click()`);
    await sleep(100);
    await evaluate(`document.querySelector('input[type=password]').focus()`);
    await S('Input.insertText', { text: pw });
    await evaluate(`document.querySelector('form button[type=submit]').click()`);
    await waitFor(`document.querySelector('#main .view')`, 30000, 'the app after signing in');
    ok('signs in', true);
    await sleep(800);
    await shot('home');

    // 3. every app opens without an error
    const before = problems.length;
    const broken = [];
    for (const a of APPS) {
      try {
        await go(`#/${a.id}`);
        const txt = await mainText();
        if (/This page could not be opened|Page not found/.test(txt)) broken.push(`${a.id}: ${txt.split('\n').slice(0, 3).join(' ')}`);
      } catch (e) { broken.push(`${a.id}: ${e.message}`); }
    }
    ok(`all ${APPS.length} apps open`, !broken.length, broken.join(' | '));
    ok('no browser errors while opening them', problems.length === before, problems.slice(before).join(' | '));
    await go('#/admin/golive').catch(() => {});
    const golive = await mainText().catch(() => '');
    await shot('golive');
    ok('Admin → Go live opens', /Go live/i.test(golive) && !/could not be opened|not found/i.test(golive));
    const wide = await evaluate(`(() => { const m = document.querySelector('#main'); return [...m.querySelectorAll('section.card')].filter(c => c.getBoundingClientRect().right > m.getBoundingClientRect().right + 1).length; })()`).catch(() => -1);
    ok('Admin → Go live fits the screen (long commands scroll inside their box)', wide === 0, wide ? `${wide} card(s) wider than the page` : '');

    // 4. original documents open
    const openDoc = async rec => {
      const folderRoute = rec.folder_id ? `#/drive/f/${encodeURIComponent(rec.folder_id)}` : `#/drive/d/${encodeURIComponent(rec.drive_id)}`;
      await go(folderRoute);
      await evaluate(`[...document.querySelectorAll('.fcard, .list-item')].find(c => c.querySelector('.nm, .li-title') && c.querySelector('.nm, .li-title').textContent === ${JSON.stringify(rec.name)}).click()`);
      await waitFor(`document.querySelector('.modal iframe, .modal img[alt]')`, 20000, `the preview of ${rec.name}`);
      await sleep(1500);
    };
    if (vaultPdf) {
      await openDoc(vaultPdf);
      const src = await evaluate(`document.querySelector('.modal iframe').getAttribute('src')`);
      const expect = mode === 'file' ? src.startsWith('data/vault/') : src.startsWith('blob:');
      const status = vaultLoads.get(vaultPdf.vault_path);
      const notFound = problems.filter(p => p.includes('data/vault/')); // the browser logs a vault file it could not open
      ok('an original PDF opens', expect && !notFound.length && (mode === 'file' || status === 200), notFound.length ? notFound[0] : `${mode === 'file' ? 'from data/vault in the viewer' : `blob from data/vault (HTTP ${status})`}`);
      await shot('pdf');
      await evaluate(`document.querySelector('.modal-backdrop, .modal .modal-close, .modal [aria-label=Close]') && (document.querySelector('.modal [aria-label=Close], .modal .modal-close') || document.querySelector('.modal-backdrop')).click()`).catch(() => {});
      await S('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); await sleep(300);
    } else ok('an original PDF opens', false, 'no PDF found in data/vault — is the folder complete?');
    if (vaultPhoto) {
      await openDoc(vaultPhoto);
      const w = await evaluate(`(async () => { const i = document.querySelector('.modal img[alt]'); if (!i.complete) await new Promise(r => { i.onload = i.onerror = r; }); return i.naturalWidth; })()`);
      ok('an original photo opens', w > 0, `${w} px wide`);
      await S('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); await sleep(300);
    }

    // 5. an invoice PDF downloads, with the logo
    const inv = invoices.find(i => i.number || i.legacy_number);
    if (inv) {
      await go(`#/invoices/i/${encodeURIComponent(inv.id)}`);
      const n0 = done.size;
      await evaluate(`[...document.querySelectorAll('#main button')].find(b => /^\s*PDF\s*$/.test(b.textContent)).click()`);
      const until = Date.now() + 30000; while (done.size === n0 && Date.now() < until) await sleep(100);
      const got = readdirSync(downloads).map(f => readFileSync(join(downloads, f))).find(b => b.subarray(0, 5).toString() === '%PDF-');
      ok('an invoice PDF downloads with the logo', !!got && got.includes('/Subtype /Image'), got ? `${(got.length / 1024).toFixed(0)} KB` : 'no PDF arrived');
    }

    // 6. opened from the folder: features that read a document's contents, before and after Load original documents
    if (mode === 'file') {
      if (vaultSheet) {
        await go(`#/sheets/import?file=${encodeURIComponent(vaultSheet.id)}`);
        await sleep(800);
        ok('Sheets explains how to load an original spreadsheet', /Load original documents/.test(await mainText()));
      }
      await go('#/drive/load');
      // Chrome's automation cannot fill a folder picker, so the picker takes files for this test; the page then runs
      // exactly as after a folder pick (the same change handler, the same matching by content)
      await evaluate(`(() => { const i = document.querySelector('input[type=file][webkitdirectory]'); i.webkitdirectory = false; i.id = 'lsi-test-load'; })()`);
      const { result } = await S('Runtime.evaluate', { expression: `document.getElementById('lsi-test-load')` });
      await S('DOM.enable'); // needed for setFileInputFiles
      // the browser cannot be handed a folder here, so it gets the documents themselves (a folder pick gives the same files)
      await S('DOM.setFileInputFiles', { files: files.filter(f => f.vault_path).map(f => join(vaultDir, ...f.vault_path.split('/'))), objectId: result.objectId });
      await waitFor(`/Loaded now/.test(document.querySelector('#main').innerText)`, 240000, 'Load original documents to finish');
      const txt = await mainText();
      const num = label => { const m = new RegExp(`${label}\\s*\\n?\\s*([\\d\\s ,]+)`).exec(txt); return m ? Number(m[1].replace(/[^\d]/g, '')) : NaN; };
      const loadedNow = num('Loaded now'), mism = num('Different from the record \\(left out\\)');
      ok('Load original documents loads every original document', loadedNow === vaultCount && mism === 0, `${loadedNow} of ${vaultCount} loaded, ${mism} different`);
      await shot('load-documents');
      if (vaultSheet) {
        await go(`#/sheets/import?file=${encodeURIComponent(vaultSheet.id)}`);
        await waitFor(`/^#\\/sheets\\/(?!import)/.test(location.hash)`, 30000, 'the spreadsheet to import');
        ok('after loading, Sheets imports an original spreadsheet', true, vaultSheet.name.replace(/[^\w .-]/g, '') ? 'imported' : '');
      }
    } else {
      const nav = await evaluate(`[...document.querySelectorAll('a')].some(a => /Load original documents/.test(a.textContent))`);
      ok('served: no Load original documents step is needed', !nav);
    }
    // 7. forgot the password: reset-password.html sets a new one, and the app accepts it
    const pw2 = `Reset-${randomBytes(12).toString('base64url')}-7`;
    await evaluate(`sessionStorage.clear(); localStorage.clear()`); // signed out, as someone who forgot their password
    await S('Page.navigate', { url: base.replace(/index\.html$/, 'reset-password.html') });
    await waitFor(`document.getElementById('who')`, 20000, 'the reset page');
    await evaluate(`(() => { document.getElementById('who').value = 'prof-browser-test'; document.getElementById('pw1').value = document.getElementById('pw2').value = ${JSON.stringify(pw2)}; document.querySelector('.reset-form button').click(); })()`);
    await waitFor(`/Done\\./.test(document.body.innerText)`, 30000, 'the reset to finish');
    const logged = await evaluate(`(async () => { const d = await new Promise(ok => { const r = indexedDB.open('landscapers-hq'); r.onsuccess = () => ok(r.result); }); const all = await new Promise(ok => { const r = d.transaction('records').objectStore('records').getAll(); r.onsuccess = () => ok(r.result); }); d.close();
      return { audit: all.filter(x => x.col === 'audit_log' && x.v.action === 'password_reset').length, notes: all.filter(x => x.col === 'notifications' && x.v.kind === 'security').length }; })()`);
    ok('reset-password.html sets a new password, logs it and tells everyone', logged.audit === 1 && logged.notes >= 1, `${logged.audit} audit entry, ${logged.notes} notifications`);
    await S('Page.navigate', { url: base });
    await waitFor(`[...document.querySelectorAll('.user-pick button b')].some(b => b.textContent === 'Zz')`, 60000, 'the sign-in screen after the reset');
    await evaluate(`[...document.querySelectorAll('.user-pick button')].find(b => (b.querySelector('b') || {}).textContent === 'Zz').click()`);
    await sleep(100);
    await evaluate(`document.querySelector('input[type=password]').focus()`);
    await S('Input.insertText', { text: pw2 });
    await evaluate(`document.querySelector('form button[type=submit]').click()`);
    await waitFor(`document.querySelector('#main .view')`, 30000, 'signing in with the new password');
    ok('signs in with the new password', true);
    ok('no browser errors in this run', !problems.length, problems.slice(0, 8).join(' | '));
  } catch (e) {
    ok(`${mode} run`, false, e.message);
    if (problems.length) console.log(`    browser said: ${problems.slice(0, 8).join(' | ')}`);
  } finally {
    if (browser) { try { await browser.cdp.send('Browser.close'); } catch { /* already gone */ } browser.ws.close(); await sleep(500); browser.child.kill(); }
    if (server) server.close();
    for (let i = 0; i < 10; i++) { try { rmSync(profile, { recursive: true, force: true }); break; } catch { await sleep(500); } }
  }
}

const exe = findBrowser();
if (!exe) { console.error('✗ Chrome or Edge not found — install one, or set LSI_BROWSER to the browser program.'); process.exit(2); }
console.log(`Browser: ${exe}`);
for (const m of MODES) await runMode(m, exe);
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
