// The HTML guides (README.html, docs/*.html, data/README.html):  node tests/guides.test.js
// Every link between them and into the app folder resolves (file and #anchor), no Markdown is left in them,
// their tags balance, and every guide named anywhere in the code exists.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
let passed = 0, failed = 0;
const t = (name, fn) => { try { fn(); passed++; } catch (e) { failed++; console.error('✗', name, '\n ', e.message); } };
const pages = ['README.html', 'data/README.html', ...readdirSync(join(root, 'docs')).filter(f => f.endsWith('.html')).map(f => `docs/${f}`)];
const html = Object.fromEntries(pages.map(p => [p, readFileSync(join(root, p), 'utf8')]));
const ids = Object.fromEntries(pages.map(p => [p, new Set([...html[p].matchAll(/\sid="([^"]+)"/g)].map(m => m[1]))]));
// private folders are not in a clean checkout of the code; links into them are still allowed
const PRIVATE = /^(data\/seed|data\/vault|data-tools)(\/|$)/;

t('nine guides', () => assert.equal(pages.length, 9, pages.join(', ')));
t('every link resolves to a file, and every #anchor to a heading', () => {
  const bad = [];
  for (const p of pages) for (const [, href] of html[p].matchAll(/<a [^>]*href="([^"]+)"/g)) {
    if (/^(https?:|mailto:)/.test(href)) continue;
    const [file, hash] = href.split('#');
    const target = file ? relative(root, resolve(dirname(join(root, p)), decodeURIComponent(file))).split('\\').join('/') : p;
    if (PRIVATE.test(target)) continue;
    if (!existsSync(join(root, target))) { bad.push(`${p}: ${href} (no ${target})`); continue; }
    if (hash && (!ids[target] || !ids[target].has(hash))) bad.push(`${p}: ${href} (no #${hash} in ${target})`);
  }
  assert.deepEqual(bad, []);
});
t('the stylesheet, script, logo and icon each page uses exist', () => {
  for (const p of pages) for (const [, src] of html[p].matchAll(/(?:src|href)="([^"#]+\.(?:css|js|jpg|svg|png))"/g)) assert.ok(existsSync(resolve(dirname(join(root, p)), src)), `${p}: ${src}`);
});
t('no Markdown left in the text', () => {
  for (const p of pages) {
    const text = html[p].replace(/<pre[\s\S]*?<\/pre>/g, '').replace(/<code>[\s\S]*?<\/code>/g, '').replace(/<[^>]+>/g, ' ');
    for (const [re, what] of [[/\*\*/, '**'], [/\]\(/, ']('], [/`/, 'backtick'], [/^\s*#{1,6}\s/m, 'heading #'], [/\.md\b/, '.md link']]) assert.ok(!re.test(text), `${p}: ${what} — ${(text.match(re) || [''])[0]}`);
  }
});
t('tags balance', () => {
  for (const p of pages) {
    const stack = [];
    for (const [, close, tag] of html[p].replace(/<pre[\s\S]*?<\/pre>/g, '<pre></pre>').matchAll(/<(\/?)([a-z][a-z0-9]*)\b[^>]*>/g)) {
      if (['meta', 'link', 'img', 'br', 'hr', 'input', '!doctype'].includes(tag)) continue;
      if (!close) stack.push(tag);
      else { const top = stack.pop(); assert.equal(top, tag, `${p}: </${tag}> closes <${top}>`); }
    }
    assert.deepEqual(stack, [], `${p}: unclosed ${stack.join(', ')}`);
  }
});
t('every guide the code points people to exists (docs/X.html), and none is still .md', () => {
  const bad = [];
  (function walk(d) {
    for (const f of readdirSync(d)) {
      const p = join(d, f);
      if (statSync(p).isDirectory()) { if (!['node_modules', '.git', 'vault', 'seed'].includes(f)) walk(p); continue; }
      if (!/\.js$/.test(f) || f === 'app.bundle.js') continue;
      const src = readFileSync(p, 'utf8');
      for (const [m] of src.matchAll(/\bdocs\/[A-Z][A-Z-]+\.(?:md|html)/g)) if (m.endsWith('.md') || !existsSync(join(root, m))) bad.push(`${relative(root, p)}: ${m}`);
      if (f !== 'guides.test.js' && /README\.md/.test(src)) bad.push(`${relative(root, p)}: README.md`);
    }
  })(root);
  assert.deepEqual(bad, []);
});

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
