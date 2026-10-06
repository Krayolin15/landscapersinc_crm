// Deploy the Edge Functions (supabase/functions/<name>/index.js) to your Supabase project:
//
//   PowerShell:  node tools/deploy-functions.js --project-ref <project ref>
//   bash:        node tools/deploy-functions.js --project-ref <project ref>
//
// Options: --project-ref <ref> (else the project `supabase link` saved) · --only <name> (just that function)
//          --dry-run (print the config and the commands, change and run nothing)
//
// Needs the Supabase CLI 1.215.0 or newer (on your PATH, else it is run through `npx supabase@latest`) and
// `supabase login` done once. The project ref is the 20 letters in your dashboard address
// (supabase.com/dashboard/project/<ref>).
//
// The functions are plain JavaScript, and the CLI only looks for index.ts unless supabase/config.toml names the
// entry file ([functions.<name>] entrypoint = './functions/<name>/index.js'). config.toml is not kept in the
// project (it is TOML); this tool writes it before deploying — a new file with just those sections, or, when
// `supabase init` already made one, only the [functions.<name>] entrypoint / verify_jwt lines are set and every
// other line is left exactly as it was. Safe to re-run.
//
// agent-run and inbound-email are called by machines with no Supabase login (pg_cron, the email provider) and
// check their own secret header, so they deploy with JWT verification OFF; every other function keeps it ON.
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync, realpathSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const NO_JWT = new Set(['agent-run', 'inbound-email']); // they check x-cron-secret / x-inbound-secret themselves
export const MIN_CLI = '1.215.0'; // first CLI that reads `entrypoint` (a non-index.ts entry file)
const PROJECT_ID = 'landscapers-inc-hq'; // config.toml's project_id is only a local name (Docker labels), not the project ref
const REF_RE = /^[a-z]{20}$/;
const SLUG_RE = /^[A-Za-z][A-Za-z0-9_-]*$/; // the CLI's own rule for function names

/** Every supabase/functions/<name>/ folder (not _shared) with its JWT setting, in name order. */
export function listFunctions(dir = root) {
  const fnDir = join(dir, 'supabase/functions');
  return readdirSync(fnDir, { withFileTypes: true })
    .filter(d => d.isDirectory() && !/^[_.]/.test(d.name))
    .map(d => d.name).sort()
    .map(name => {
      if (!SLUG_RE.test(name)) throw new Error(`supabase/functions/${name}: not a valid function name (letters, digits, - and _ only)`);
      if (!existsSync(join(fnDir, name, 'index.js'))) throw new Error(`supabase/functions/${name} has no index.js`);
      return { name, verifyJwt: !NO_JWT.has(name) };
    });
}

/* ------------------------------------------------------------------ config.toml (no TOML library: line edits only) */
const entryLine = name => `entrypoint = './functions/${name}/index.js'`;
const jwtLine = fn => `verify_jwt = ${fn.verifyJwt}`;
const sectionText = (fn, eol) => [`[functions.${fn.name}]`, entryLine(fn.name), jwtLine(fn)].join(eol) + eol;

/** "functions . 'admin-users'" -> ['functions', 'admin-users'] (TOML dotted key; bare, "basic" or 'literal' parts), or null. */
function dottedKey(src) {
  const parts = [];
  let i = 0;
  const ws = () => { while (i < src.length && /[ \t]/.test(src[i])) i++; };
  for (;;) {
    ws();
    let m;
    if (src[i] === '"') { const j = src.indexOf('"', i + 1); if (j < 0) return null; parts.push(src.slice(i + 1, j)); i = j + 1; }
    else if (src[i] === "'") { const j = src.indexOf("'", i + 1); if (j < 0) return null; parts.push(src.slice(i + 1, j)); i = j + 1; }
    else if ((m = /^[A-Za-z0-9_-]+/.exec(src.slice(i)))) { parts.push(m[0]); i += m[0].length; }
    else return null;
    ws();
    if (i >= src.length) return parts;
    if (src[i] !== '.') return null;
    i++;
  }
}

/** For each line: is the scanner outside any multi-line string / array / inline table at its start? A '[' inside one is not a table header. */
function cleanLineStarts(lines) {
  let basic = false, literal = false, depth = 0;
  return lines.map(line => {
    const clean = !basic && !literal && depth === 0;
    for (let i = 0; i < line.length; i++) {
      if (basic) { if (line[i] === '\\') i++; else if (line.startsWith('"""', i)) { basic = false; i += 2; } continue; }
      if (literal) { if (line.startsWith("'''", i)) { literal = false; i += 2; } continue; }
      const c = line[i];
      if (c === '#') break;
      if (line.startsWith('"""', i)) { basic = true; i += 2; }
      else if (line.startsWith("'''", i)) { literal = true; i += 2; }
      else if (c === '"') { i++; while (i < line.length && line[i] !== '"') { if (line[i] === '\\') i++; i++; } }
      else if (c === "'") { const j = line.indexOf("'", i + 1); i = j < 0 ? line.length : j; }
      else if (c === '[' || c === '{') depth++;
      else if (c === ']' || c === '}') depth = Math.max(0, depth - 1);
    }
    return clean;
  });
}

/**
 * Work out config.toml for these functions. `existing` is the current file text, or null when there is none.
 * Returns { text, created, changes: [{ name, action: 'added' | 'updated' | 'unchanged' }] }. Lines outside the
 * entrypoint / verify_jwt lines of our [functions.<name>] tables are kept byte for byte (line endings included).
 */
export function planConfig(existing, functions) {
  if (existing == null) {
    const text = [
      '# Written by tools/deploy-functions.js for `supabase functions deploy`. Not kept in the project: the tool',
      '# writes it again whenever it deploys. The CLI fills in its defaults for everything not listed here.',
      `project_id = "${PROJECT_ID}"`,
      '',
      ...functions.map(fn => sectionText(fn, '\n'))
    ].join('\n');
    return { text, created: true, changes: functions.map(fn => ({ name: fn.name, action: 'added' })) };
  }

  const eol = existing.includes('\r\n') ? '\r\n' : '\n';
  // each piece keeps its own line ending, so untouched lines are re-joined exactly as they were
  const pieces = existing.split(/(?<=\n)/);
  const lines = pieces.map(p => p.replace(/\r?\n$/, ''));
  const ends = pieces.map((p, i) => p.slice(lines[i].length));
  const clean = cleanLineStarts(lines);
  const names = new Set(functions.map(fn => fn.name));

  // table headers ([x] and [[x]]) and where each of our [functions.<name>] tables starts
  const headers = [];
  const starts = new Map();
  let table = []; // key parts of the table the line belongs to ([] = top of the file, null = an array table)
  lines.forEach((line, i) => {
    if (!clean[i]) return;
    const m = /^\s*(\[\[?)\s*(.*?)\s*\]\]?\s*(#.*)?$/.exec(line);
    if (m) {
      headers.push(i);
      table = m[1] === '[' ? dottedKey(m[2]) : null;
      if (table && table.length === 2 && table[0] === 'functions' && names.has(table[1])) {
        if (starts.has(table[1])) throw new Error(`supabase/config.toml has [functions.${table[1]}] twice — remove one and run again`);
        starts.set(table[1], i);
      }
      return;
    }
    // our functions' settings written as dotted keys above their table (functions.agent-run.verify_jwt = … at the
    // top, or agent-run.verify_jwt = … under [functions]): adding a [functions.agent-run] table would then be invalid
    const k = /^\s*((?:[A-Za-z0-9_-]+|"[^"]*"|'[^']*')(?:\s*\.\s*(?:[A-Za-z0-9_-]+|"[^"]*"|'[^']*'))*)\s*=/.exec(line);
    const key = k && dottedKey(k[1]);
    if (!key || !table || table.length >= 2) return;
    const full = [...table, ...key];
    if (full.length >= 2 && full[0] === 'functions' && names.has(full[1])) {
      throw new Error(`supabase/config.toml sets functions.${full[1]} outside a [functions.${full[1]}] table (line ${i + 1}) — move it into that table and run again`);
    }
  });

  const changes = [];
  const replace = new Map(); // line index -> new text
  const insertAfter = new Map(); // line index -> [new lines]
  for (const fn of functions) {
    const start = starts.get(fn.name);
    if (start === undefined) { changes.push({ name: fn.name, action: 'added' }); continue; }
    const end = headers.find(h => h > start) ?? lines.length;
    let changed = false;
    const missing = [];
    const entry = `./functions/${fn.name}/index.js`;
    for (const [key, want, okValues] of [['entrypoint', entryLine(fn.name), [`'${entry}'`, `"${entry}"`]], ['verify_jwt', jwtLine(fn), [String(fn.verifyJwt)]]]) {
      const at = [];
      for (let i = start + 1; i < end; i++) if (clean[i] && new RegExp(`^\\s*(${key}|"${key}"|'${key}')\\s*=`).test(lines[i])) at.push(i);
      if (at.length > 1) throw new Error(`supabase/config.toml sets ${key} twice in [functions.${fn.name}] — remove one and run again`);
      // a line that already says the right thing is left alone (with any comment on it)
      if (!at.length) { missing.push(want); changed = true; }
      else if (!okValues.includes(lines[at[0]].replace(/^[^=]*=/, '').replace(/#.*$/, '').trim())) { replace.set(at[0], want); changed = true; }
    }
    if (missing.length) {
      // after the table's last setting, so blank lines / comments that lead into the next table stay where they are
      let last = start;
      for (let i = start + 1; i < end; i++) if (lines[i].trim() && !(clean[i] && lines[i].trim().startsWith('#'))) last = i;
      insertAfter.set(last, missing);
    }
    changes.push({ name: fn.name, action: changed ? 'updated' : 'unchanged' });
  }

  let text = '';
  lines.forEach((line, i) => {
    const end = ends[i] || (insertAfter.has(i) ? eol : '');
    text += (replace.has(i) ? replace.get(i) : line) + end;
    if (insertAfter.has(i)) text += insertAfter.get(i).map(l => l + eol).join('');
  });
  const added = functions.filter(fn => !starts.has(fn.name));
  if (added.length) {
    if (text && !text.endsWith('\n')) text += eol;
    text += `${text ? eol : ''}# Edge Functions (JavaScript entry files) — written by tools/deploy-functions.js${eol}`;
    text += added.map(fn => sectionText(fn, eol)).join(eol);
  }
  return { text, created: false, changes };
}

/* ------------------------------------------------------------------ the Supabase CLI */
const versionOf = s => (/(\d+)\.(\d+)\.(\d+)/.exec(s || '') || []).slice(1, 4).map(Number);
export const atLeast = (v, min) => { const a = versionOf(v), b = versionOf(min); if (a.length < 3) return false; for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i]; return true; };

// On Windows the CLI is often supabase.cmd (npm) and npx is npx.cmd: those only start through the shell. Every
// part is checked to be a plain word first, so joining them for the shell can't run anything else.
function run(parts, opts = {}) {
  for (const p of parts) if (!/^[\w@.:/=-]+$/.test(p)) throw new Error(`refusing to run an unexpected argument: ${p}`);
  const o = { cwd: root, encoding: 'utf8', ...opts };
  return process.platform === 'win32' ? spawnSync(parts.join(' '), { ...o, shell: true }) : spawnSync(parts[0], parts.slice(1), o);
}
const outputOf = r => `${r.stdout || ''}${r.stderr || ''}`.trim();

function findCli() {
  const firstLine = r => (r.stdout || '').trim().split(/\r?\n/)[0] || outputOf(r); // stderr may add an "update available" note
  const local = run(['supabase', '--version'], { stdio: 'pipe', timeout: 60000 });
  if (local.status === 0) {
    const v = firstLine(local);
    if (!atLeast(v, MIN_CLI)) fail(`Your Supabase CLI is ${v || 'an unknown version'}; JavaScript functions need ${MIN_CLI} or newer.\n  Update it (scoop update supabase · brew upgrade supabase · npm i -g supabase@latest) and run this again.`);
    return { cmd: ['supabase'], label: `supabase ${v}` };
  }
  console.log('Supabase CLI not found on your PATH — using npx supabase@latest (the first run downloads it) …');
  const npx = run(['npx', '--yes', 'supabase@latest', '--version'], { stdio: 'pipe', timeout: 600000 });
  if (npx.status === 0) return { cmd: ['npx', '--yes', 'supabase@latest'], label: `npx supabase@latest (${firstLine(npx)})` };
  fail('The Supabase CLI is not installed and npx could not fetch it.\n  Install it (https://supabase.com/docs/guides/local-development/cli/getting-started):\n    Windows: scoop bucket add supabase https://github.com/supabase/scoop-bucket.git; scoop install supabase\n    macOS:   brew install supabase/tap/supabase\n  then run this again.');
}

function fail(message) { console.error(`✗ ${message}`); process.exit(1); }

function parseArgs(argv) {
  const opts = { ref: '', only: [], dry: false };
  for (let i = 0; i < argv.length; i++) {
    const [flag, inline] = argv[i].split(/=(.*)/s);
    const value = () => { const v = inline ?? argv[++i]; if (!v || v.startsWith('--')) fail(`${flag} needs a value`); return v; };
    if (flag === '--project-ref') opts.ref = value().trim();
    else if (flag === '--only') opts.only.push(...value().split(',').map(s => s.trim()).filter(Boolean));
    else if (flag === '--dry-run') opts.dry = true;
    else if (flag === '--help' || flag === '-h') { console.log('Usage: node tools/deploy-functions.js [--project-ref <ref>] [--only <name>] [--dry-run]'); process.exit(0); }
    else fail(`Unknown option ${argv[i]}\n  Usage: node tools/deploy-functions.js [--project-ref <ref>] [--only <name>] [--dry-run]`);
  }
  return opts;
}

/* ------------------------------------------------------------------ main */
function main() {
  const opts = parseArgs(process.argv.slice(2));
  let functions;
  try { functions = listFunctions(); } catch (e) { fail(e.message); }
  for (const name of opts.only) if (!functions.some(fn => fn.name === name)) fail(`No function "${name}". There are: ${functions.map(fn => fn.name).join(', ')}`);
  const targets = opts.only.length ? functions.filter(fn => opts.only.includes(fn.name)) : functions;

  if (opts.ref && !REF_RE.test(opts.ref)) fail(`"${opts.ref}" is not a project ref — it is the 20 lowercase letters in your dashboard address: supabase.com/dashboard/project/<ref>`);
  const linked = existsSync(join(root, 'supabase/.temp/project-ref')) || !!process.env.SUPABASE_PROJECT_ID;
  const where = opts.ref ? `project ${opts.ref}` : 'the linked project';
  if (!opts.ref && !linked && !opts.dry) fail('Which project? Add --project-ref <ref> (the 20 letters in supabase.com/dashboard/project/<ref>), or run once: supabase link --project-ref <ref>');

  const configPath = join(root, 'supabase/config.toml');
  const existing = existsSync(configPath) ? readFileSync(configPath, 'utf8') : null;
  let plan;
  try { plan = planConfig(existing, functions); } catch (e) { fail(e.message); }
  const changed = existing !== plan.text;
  const deployArgs = fn => ['functions', 'deploy', fn.name, ...(opts.ref ? ['--project-ref', opts.ref] : []), ...(fn.verifyJwt ? [] : ['--no-verify-jwt'])];

  if (opts.dry) {
    console.log(`Dry run — nothing is written or run.\n`);
    if (plan.created) console.log(`Would create supabase/config.toml:\n\n${plan.text}`);
    else if (!changed) console.log('supabase/config.toml already has the right [functions.*] sections — it would not change.\n');
    else {
      console.log('Would update supabase/config.toml (every other line stays as it is):');
      plan.changes.forEach(c => console.log(`  [functions.${c.name}]  ${c.action}`));
      console.log(`\nThe [functions.*] sections after the update:\n\n${functions.map(fn => sectionText(fn, '\n')).join('\n')}`);
    }
    if (!opts.ref && !linked) console.log('! No --project-ref given and no linked project (supabase link) — a real run would stop here.\n');
    console.log(`Would run in ${root} (supabase = the CLI on your PATH, else npx supabase@latest):`);
    targets.forEach(fn => console.log(`  supabase ${deployArgs(fn).join(' ')}`));
    return;
  }

  const cli = findCli();
  console.log(`Using ${cli.label}`);
  // a cheap signed-in call before changing anything: says "supabase login" plainly instead of failing five times
  const who = run([...cli.cmd, 'projects', 'list'], { stdio: 'pipe', timeout: 120000 });
  if (who.status !== 0) {
    const text = outputOf(who);
    if (/access.?token|supabase login|not logged in|unauthori[sz]ed|\b401\b/i.test(text)) fail('You are not signed in to the Supabase CLI. Run:  supabase login   (it opens your browser), then run this again.');
    fail(`The Supabase CLI could not reach your account (no internet?):\n  ${text.split('\n').slice(-4).join('\n  ')}`);
  }
  if (opts.ref && !outputOf(who).includes(opts.ref)) console.warn(`! ${opts.ref} is not in the project list for this login — check the ref (or the account you logged in with).`);

  if (changed) {
    mkdirSync(dirname(configPath), { recursive: true });
    writeFileSync(configPath, plan.text);
    console.log(`${plan.created ? 'Created' : 'Updated'} supabase/config.toml (${plan.changes.filter(c => c.action !== 'unchanged').map(c => c.name).join(', ')})`);
  } else console.log('supabase/config.toml is already up to date');

  const results = [];
  for (const fn of targets) {
    console.log(`\n→ ${fn.name}  (${fn.verifyJwt ? 'JWT check ON' : 'JWT check OFF — protected by its secret header'})`);
    const r = run([...cli.cmd, ...deployArgs(fn)], { stdio: 'inherit', timeout: 900000 });
    results.push({ fn, ok: r.status === 0, why: r.error ? r.error.message : `exit ${r.status}` });
  }

  const ok = results.filter(r => r.ok).length;
  console.log(`\nDeployed ${ok} of ${results.length} function(s) to ${where}:`);
  results.forEach(r => console.log(`  ${r.ok ? '✓' : '✗'} ${r.fn.name.padEnd(14)} ${r.ok ? (r.fn.verifyJwt ? 'JWT check ON' : 'JWT check OFF (secret header)') : `failed (${r.why})`}`));
  if (ok < results.length) {
    console.log([
      '',
      'Read the CLI message above the failed function. Usual fixes:',
      '  · "access token" / 401  → supabase login, then run this again',
      '  · project not found     → check --project-ref (the 20 letters in your dashboard address)',
      '  · a Docker error        → the CLI bundles with Docker when it is running: quit Docker Desktop and run this again,',
      `                            or deploy that one on Supabase's servers: supabase functions deploy <name> --use-api${opts.ref ? ` --project-ref ${opts.ref}` : ''}`,
      '  · then repeat just that one:  node tools/deploy-functions.js --only <name>' + (opts.ref ? ` --project-ref ${opts.ref}` : '')
    ].join('\n'));
    process.exit(1);
  }
  console.log('\nSecrets are set separately (once): supabase secrets set NAME=value — see the Supabase setup guide.');
}

// run only when started as a script (tests import planConfig / listFunctions without deploying anything)
const samePath = (a, b) => { try { a = realpathSync.native(a); b = realpathSync.native(b); } catch { return false; } return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b; };
if (process.argv[1] && samePath(process.argv[1], fileURLToPath(import.meta.url))) main();
