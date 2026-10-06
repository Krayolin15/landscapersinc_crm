// Static check:  node tools/check.js
// 1. every JS module parses (node --check, ESM)
// 2. every static import resolves to an existing file
// 3. every named import is actually exported by that file
// 4. no forbidden patterns (innerHTML assignment with data, eval, new Function, document.write)
// 5. every app in the registry has index.js + plugin.js
// 6. js/boot.js preloads every module main.js imports at start-up
// 7. js/app.bundle.js (the double-click version, tools/build.js) is up to date, and js/core/logo.js matches the logo
// 8. the project holds only HTML, CSS and JavaScript (plus the JSON npm and phones need, images and the documents)
// 9. in a git repository: no company data, document, private zip or .env is committed, and no service_role key
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, resolve, relative, sep } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const files = [];
// js/app.bundle.js is generated from these files (checked below), so it is not scanned itself
(function walk(d) { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (/\.(m?js)$/.test(f) && f !== 'app.bundle.js') files.push(p); } })(join(root, 'js'));

let errors = 0, warnings = 0;
const err = (f, m) => { errors++; console.error(`✗ ${relative(root, f)}: ${m}`); };
const warn = (f, m) => { warnings++; console.warn(`! ${relative(root, f)}: ${m}`); };

const exportsCache = new Map();
function exportsOf(file) {
  if (exportsCache.has(file)) return exportsCache.get(file);
  const src = readFileSync(file, 'utf8');
  const names = new Set();
  for (const m of src.matchAll(/export\s+(?:async\s+)?(?:function\*?|class|const|let|var)\s+([A-Za-z_$][\w$]*)/g)) names.add(m[1]);
  for (const m of src.matchAll(/export\s*\{([^}]*)\}/g)) m[1].split(',').map(s => s.trim()).filter(Boolean).forEach(s => names.add(s.split(/\s+as\s+/).pop().trim()));
  if (/export\s+default\b/.test(src)) names.add('default');
  for (const m of src.matchAll(/export\s+\*\s+from\s+['"]([^'"]+)['"]/g)) { const t = resolve(dirname(file), m[1]); if (existsSync(t)) exportsOf(t).forEach(n => names.add(n)); }
  exportsCache.set(file, names);
  return names;
}

for (const f of files) {
  try { execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' }); }
  catch (e) { err(f, 'syntax error\n' + String(e.stderr || e.message).split('\n').slice(0, 6).join('\n')); continue; }
  const src = readFileSync(f, 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
  for (const m of code.matchAll(/import\s+([\s\S]*?)\s+from\s+['"]([^'"]+)['"]/g)) {
    const spec = m[2];
    if (!spec.startsWith('.')) continue;
    const target = resolve(dirname(f), spec);
    if (!existsSync(target)) { err(f, `imports missing file ${spec}`); continue; }
    const clause = m[1];
    const named = /\{([\s\S]*)\}/.exec(clause);
    const ex = exportsOf(target);
    if (named) for (const part of named[1].split(',').map(s => s.trim()).filter(Boolean)) {
      const name = part.split(/\s+as\s+/)[0].trim();
      if (name && !ex.has(name)) err(f, `imports { ${name} } but ${spec} does not export it`);
    }
    const def = clause.replace(/\{[\s\S]*\}/, '').replace(/\*\s+as\s+\w+/, '').replace(/,/g, '').trim();
    if (def && !ex.has('default')) err(f, `imports default from ${spec} which has no default export`);
  }
  if (/\.innerHTML\s*=(?!=)/.test(code) && !/sanitize\.js$/.test(f)) err(f, 'assigns innerHTML — use h() or the sanitiser');
  if (/\beval\s*\(|new Function\s*\(|document\.write\s*\(/.test(code)) err(f, 'uses eval/new Function/document.write');
  if (/\bconsole\.log\(/.test(code)) warn(f, 'console.log left in');
}

// registry completeness
const reg = readFileSync(join(root, 'js/apps/registry.js'), 'utf8');
// only APPS entries (they have a name:), not GROUPS
for (const m of reg.matchAll(/\{\s*id:\s*'([\w-]+)',\s*name:/g)) {
  const id = m[1];
  if (!existsSync(join(root, 'js/apps', id, 'index.js'))) err(join(root, 'js/apps/registry.js'), `app "${id}" has no js/apps/${id}/index.js`);
  if (!existsSync(join(root, 'js/apps', id, 'plugin.js'))) err(join(root, 'js/apps/registry.js'), `app "${id}" has no js/apps/${id}/plugin.js`);
}

// js/boot.js preloads every module main.js imports statically, so they download in parallel when served
// (a module missing from that list still works; it just loads one round trip later)
{
  const graph = new Set();
  (function walk(file) {
    const rel = relative(root, file).split('\\').join('/');
    if (graph.has(rel)) return;
    graph.add(rel);
    const code = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
    for (const m of code.matchAll(/(?:^|[;\n])\s*(?:import|export)\s+(?:[\s\S]*?\s+from\s+)?['"](\.[^'"]+)['"]/g)) {
      const t = resolve(dirname(file), m[1]);
      if (existsSync(t)) walk(t);
    }
  })(join(root, 'js/main.js'));
  graph.delete('js/main.js');
  const boot = join(root, 'js/boot.js');
  const list = /var PRELOAD = \[([\s\S]*?)\];/.exec(readFileSync(boot, 'utf8'));
  const pre = new Set(list ? [...list[1].matchAll(/'([^']+)'/g)].map(m => m[1]) : []);
  if (!list) err(boot, 'PRELOAD list not found');
  for (const f of graph) if (!pre.has(f)) err(boot, `add '${f}' to PRELOAD (main.js imports it at start-up)`);
  for (const f of pre) if (!existsSync(join(root, f))) err(boot, `PRELOAD names a missing file ${f}`);
  if (!/<script src="js\/settings\.js"><\/script>\s*<script src="js\/boot\.js"><\/script>/.test(readFileSync(join(root, 'index.html'), 'utf8'))) err(join(root, 'index.html'), 'must load js/settings.js and then js/boot.js');
}

// the double-click version and the built-in logo
{
  const { bundleText, logoModuleText, BUNDLE } = await import('./build.js');
  if (readFileSync(join(root, 'js/core/logo.js'), 'utf8') !== logoModuleText()) err(join(root, 'js/core/logo.js'), 'does not match assets/landscapers-logo.jpg — run "node tools/build.js --logo"');
  let text = null;
  try { text = await bundleText(); }
  catch (e) { if (/esbuild-wasm/.test(String(e))) warn(join(root, BUNDLE), 'not checked — run "npm install" first'); else err(join(root, BUNDLE), `the bundle does not build: ${e.message}`); }
  if (text !== null && (!existsSync(join(root, BUNDLE)) || readFileSync(join(root, BUNDLE), 'utf8') !== text)) err(join(root, BUNDLE), 'out of date — run "npm run build" (index.html opened from the folder runs this file)');
}

// Application code is HTML/CSS/JavaScript. Supabase deployment SQL is allowed only under supabase/; JSON, images and hosting dot-files are also allowed.
// The original company documents (data/vault) and generated, git-ignored folders are not code and are skipped.
{
  const ALLOWED = /\.(html|css|js|sql|png|jpe?g|svg|ico|webp|gif)$/i;
  const NAMED = new Set(['package.json', 'package-lock.json', 'manifest.webmanifest', '.gitignore', '.gitattributes', '.nojekyll']);
  const SKIP = new Set(['node_modules', '.git', 'build', 'test-results'].map(d => join(root, d)).concat([join(root, 'data', 'vault'), join(root, 'supabase', '.temp')]));
  const GENERATED = new Set([join(root, 'supabase', 'config.toml')]); // written by tools/deploy-functions.js, git-ignored
  (function walk(d) {
    for (const f of readdirSync(d)) {
      const p = join(d, f);
      if (statSync(p).isDirectory()) { if (!SKIP.has(p) && f !== '.claude') walk(p); continue; }
      if (!ALLOWED.test(f) && !NAMED.has(f) && !GENERATED.has(p)) err(p, 'unsupported project file type');
      if (/\.sql$/i.test(f) && !p.startsWith(join(root, 'supabase') + sep)) err(p, 'SQL files are only allowed under supabase/');
    }
  })(root);
}

// Company data must never be published. Only when this folder is a git repository (git status works).
{
  let tracked = null;
  try { tracked = execFileSync('git', ['ls-files', '-z'], { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }).toString('utf8').split('\0').filter(Boolean); } catch { /* not a git repository, or git not installed */ }
  if (tracked) {
    const priv = tracked.filter(p => /^(data\/(seed|vault)\/|data-tools\/)|PRIVATE.*\.zip$|(^|\/)vault[^/]*\.zip$|(^|\/)\.env($|\.)|(^|\/)build\/sql\//.test(p));
    for (const p of priv.slice(0, 20)) err(join(root, p), 'private company data or a secret is committed to git — remove it from the repository (git rm --cached) before pushing anywhere');
    if (priv.length > 20) err(root, `… and ${priv.length - 20} more private files committed`);
    // a Supabase service_role key (a JWT starting "ey") written into any committed file
    for (const p of tracked.filter(x => /\.(js|html|json|css)$/.test(x) && !x.startsWith('vendor/') && !x.startsWith('node_modules/'))) {
      const txt = existsSync(join(root, p)) ? readFileSync(join(root, p), 'utf8') : '';
      if (/service_role[^"\n]*"\s*:\s*"ey|SUPABASE_SERVICE_ROLE_KEY\s*=\s*["']?ey/.test(txt)) err(join(root, p), 'a Supabase service_role key appears to be in this file — revoke it in Supabase and remove it');
    }
  }
}

console.log(`\n${files.length} modules checked · ${errors} error(s) · ${warnings} warning(s)`);
process.exit(errors ? 1 : 0);
