/* =============================================================================
   Sheets formula engine — pure (no DOM, no db). Tested in tests__sheets.test.js.

   Workbook = sheets.tabs: [{ name, cells: { A1: { v, f, s } }, rows, cols, colWidths, frozen }]
     v = literal value (number | string | boolean), f = formula text WITHOUT the leading "=",
     s = style { b, i, u, align, bg, color, fmt: general|number|int|money|percent|date }.

   Supports: + - * / ^ & % = <> < > <= >=, A1 / $A$1 / A1:B9 / A:A / 'Other tab'!A1,
   ~70 Excel functions incl. SUMIF(S), COUNTIF(S), VLOOKUP, XLOOKUP, INDEX/MATCH, dates as
   Excel serials, PMT, and SA helpers VAT(), INCVAT(), EXVAT() at 15 %.
   Errors: #DIV/0! #VALUE! #REF! #NAME? #N/A #NUM! #CIRC!
   ========================================================================== */

export class FErr { constructor(code) { this.code = code; } toString() { return this.code; } }
const E = code => new FErr(code);
const fail = code => { throw E(code); };
export const isErr = v => v instanceof FErr;

/* ---------------- addresses ---------------- */
export function colName(i) { let s = ''; i += 1; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; }
export function colIndex(s) { let n = 0; for (const ch of String(s).toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64); return n - 1; }
export const addr = (c, r) => colName(c) + (r + 1);
export function parseAddr(a) { const m = /^\$?([A-Za-z]{1,3})\$?(\d+)$/.exec(String(a).trim()); return m ? { c: colIndex(m[1]), r: Number(m[2]) - 1 } : null; }

/* ---------------- tokenizer ---------------- */
const REF = String.raw`\$?[A-Za-z]{1,3}\$?\d+`;
const SHEET = String.raw`(?:'(?:[^']|'')+'|[A-Za-z_][\w.]*)!`;
const RX = {
  ws: /^\s+/,
  num: /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/,
  str: /^"(?:[^"]|"")*"/,
  err: /^#(?:DIV\/0!|VALUE!|REF!|NAME\?|N\/A|NUM!|NULL!|CIRC!)/,
  range: new RegExp(`^(${SHEET})?(${REF})(?::(${REF}))?(?![\\w(])`),
  cols: new RegExp(`^(${SHEET})?(\\$?[A-Za-z]{1,3}):(\\$?[A-Za-z]{1,3})(?![\\w(])`),
  ident: /^[A-Za-z_][\w.]*/,
  op: /^(?:<=|>=|<>|[-+*/^&=<>%(),;:])/
};

export function tokenize(src) {
  const out = []; let i = 0; const s = String(src);
  while (i < s.length) {
    const rest = s.slice(i); let m;
    if ((m = RX.ws.exec(rest))) { i += m[0].length; continue; }
    if ((m = RX.str.exec(rest))) out.push({ t: 'str', v: m[0].slice(1, -1).replace(/""/g, '"'), at: i, text: m[0] });
    else if ((m = RX.err.exec(rest))) out.push({ t: 'err', v: m[0], at: i, text: m[0] });
    else if ((m = RX.range.exec(rest))) out.push({ t: 'ref', sheet: m[1] ? unq(m[1]) : null, a: m[2], b: m[3] || null, at: i, text: m[0] });
    else if ((m = RX.cols.exec(rest))) out.push({ t: 'cols', sheet: m[1] ? unq(m[1]) : null, a: m[2], b: m[3], at: i, text: m[0] });
    else if ((m = RX.num.exec(rest))) out.push({ t: 'num', v: Number(m[0]), at: i, text: m[0] });
    else if ((m = RX.ident.exec(rest))) out.push({ t: 'id', v: m[0].toUpperCase(), at: i, text: m[0] });
    else if ((m = RX.op.exec(rest))) out.push({ t: 'op', v: m[0] === ';' ? ',' : m[0], at: i, text: m[0] });
    else throw new SyntaxError(`Unexpected "${s[i]}" at ${i + 1}`);
    i += m[0].length;
  }
  return out;
}
const unq = sh => { sh = sh.slice(0, -1); return sh.startsWith("'") ? sh.slice(1, -1).replace(/''/g, "'") : sh; };
const quoteSheet = n => (/^[A-Za-z_][\w.]*$/.test(n) ? n : `'${n.replace(/'/g, "''")}'`);

/* ---------------- parser (Excel precedence) ---------------- */
export function parse(src) {
  const tk = tokenize(src); let p = 0;
  const peek = () => tk[p], next = () => tk[p++];
  const isOp = (...ops) => peek() && peek().t === 'op' && ops.includes(peek().v);
  const expect = v => { const x = next(); if (!x || x.t !== 'op' || x.v !== v) throw new SyntaxError(`Expected "${v}"`); };
  const bin = (sub, ops) => () => { let a = sub(); while (isOp(...ops)) { const op = next().v; a = { t: 'bin', op, a, b: sub() }; } return a; };
  const primary = () => {
    const x = next(); if (!x) throw new SyntaxError('Formula ends too early');
    if (x.t === 'num') return { t: 'num', v: x.v };
    if (x.t === 'str') return { t: 'str', v: x.v };
    if (x.t === 'err') return { t: 'errlit', v: x.v };
    if (x.t === 'ref') { const a = parseRefText(x.a); if (!x.b) return { t: 'ref', sheet: x.sheet, ...a }; const b = parseRefText(x.b); return { t: 'range', sheet: x.sheet, c1: Math.min(a.c, b.c), r1: Math.min(a.r, b.r), c2: Math.max(a.c, b.c), r2: Math.max(a.r, b.r) }; }
    if (x.t === 'cols') { const a = colIndex(x.a.replace('$', '')), b = colIndex(x.b.replace('$', '')); return { t: 'range', sheet: x.sheet, c1: Math.min(a, b), c2: Math.max(a, b), r1: 0, r2: null }; }
    if (x.t === 'id') {
      if (isOp('(')) { next(); const args = []; if (!isOp(')')) { do { args.push(isOp(',', ')') ? { t: 'blank' } : cmp()); } while (isOp(',') && next()); } expect(')'); return { t: 'fn', name: x.v, args }; }
      if (x.v === 'TRUE' || x.v === 'FALSE') return { t: 'bool', v: x.v === 'TRUE' };
      return { t: 'name', v: x.v };
    }
    if (x.t === 'op' && x.v === '(') { const e = cmp(); expect(')'); return e; }
    if (x.t === 'op' && (x.v === '-' || x.v === '+')) { const a = unary(); return x.v === '-' ? { t: 'neg', a } : a; }
    throw new SyntaxError(`Unexpected "${x.text}"`);
  };
  const postfix = () => { let a = primary(); while (isOp('%')) { next(); a = { t: 'pct', a }; } return a; };
  const unary = () => { if (isOp('-')) { next(); return { t: 'neg', a: unary() }; } if (isOp('+')) { next(); return unary(); } return postfix(); };
  const pow = () => { let a = unary(); while (isOp('^')) { next(); a = { t: 'bin', op: '^', a, b: unary() }; } return a; };
  const mul = bin(pow, ['*', '/']), add = bin(mul, ['+', '-']), cat = bin(add, ['&']), cmp = bin(cat, ['=', '<>', '<', '>', '<=', '>=']);
  const ast = cmp();
  if (p < tk.length) throw new SyntaxError(`Unexpected "${tk[p].text}"`);
  return ast;
}
function parseRefText(t) { const m = /^(\$?)([A-Za-z]{1,3})(\$?)(\d+)$/.exec(t); return { c: colIndex(m[2]), r: Number(m[4]) - 1, absC: !!m[1], absR: !!m[3] }; }

/* ---------------- rewriting references (fill / copy / insert / delete) ---------------- */
/** Rewrite every reference. fn(ref) -> {c, r} | null (null = #REF!) is called for single cells, and for each end of a
    range unless fnRange(start, end) -> [{c,r}|null, {c,r}|null] is given. A ref is {c, r, absC, absR, sheet};
    whole-column ranges (A:C) pass wholeCol:true and absR:true (their row is ignored). */
export function mapRefs(formula, fn, fnRange) {
  const s = String(formula); let out = '', last = 0;
  let toks; try { toks = tokenize(s); } catch { return s; }
  const ok = n => n && n.c >= 0 && n.r >= 0;
  for (const x of toks) {
    if (x.t !== 'ref' && x.t !== 'cols') continue;
    const prefix = x.sheet ? quoteSheet(x.sheet) + '!' : '';
    let text;
    if (x.t === 'ref') {
      const A = { ...parseRefText(x.a), sheet: x.sheet };
      const cell = (ref, n) => `${ref.absC ? '$' : ''}${colName(n.c)}${ref.absR ? '$' : ''}${n.r + 1}`;
      if (!x.b) { const n = fn(A); text = ok(n) ? prefix + cell(A, n) : null; }
      else {
        const B = { ...parseRefText(x.b), sheet: x.sheet };
        const [na, nb] = fnRange ? fnRange(A, B) : [fn(A), fn(B)];
        text = ok(na) && ok(nb) ? `${prefix}${cell(A, na)}:${cell(B, nb)}` : null;
      }
    } else {
      const end = t => ({ c: colIndex(t.replace('$', '')), r: 0, absC: t.startsWith('$'), absR: true, sheet: x.sheet, wholeCol: true });
      const A = end(x.a), B = end(x.b);
      const [na, nb] = fnRange ? fnRange(A, B) : [fn(A), fn(B)];
      text = ok(na) && ok(nb) ? `${prefix}${A.absC ? '$' : ''}${colName(na.c)}:${B.absC ? '$' : ''}${colName(nb.c)}` : null;
    }
    out += s.slice(last, x.at) + (text == null ? '#REF!' : text);
    last = x.at + x.text.length;
  }
  return out + s.slice(last);
}
/** A tab was renamed: point 'Old name'!A1 references at the new name. */
export function renameSheetRefs(formula, from, to) {
  const s = String(formula); let out = '', last = 0; let toks;
  try { toks = tokenize(s); } catch { return s; }
  for (const x of toks) {
    if ((x.t !== 'ref' && x.t !== 'cols') || !x.sheet || x.sheet.toLowerCase() !== String(from).toLowerCase()) continue;
    out += s.slice(last, x.at) + quoteSheet(to) + x.text.slice(x.text.lastIndexOf('!'));
    last = x.at + x.text.length;
  }
  return out + s.slice(last);
}
/** Upper-case function names and cell refs as Excel does ("sum(a1:b2)" -> "SUM(A1:B2)"); strings and tab names are untouched. */
export function normaliseFormula(formula) {
  const s = String(formula); let out = '', last = 0; let toks;
  try { toks = tokenize(s); } catch { return s; }
  for (const x of toks) {
    if (x.t !== 'id' && x.t !== 'ref' && x.t !== 'cols') continue;
    const cut = x.sheet ? x.text.lastIndexOf('!') + 1 : 0;
    out += s.slice(last, x.at) + x.text.slice(0, cut) + x.text.slice(cut).toUpperCase();
    last = x.at + x.text.length;
  }
  return out + s.slice(last);
}
/** Excel-safe tab name (max 31 chars, none of []:*?/\). */
export const cleanTabName = n => String(n || '').replace(/[[\]:*?/\\]/g, ' ').trim().slice(0, 31) || 'Sheet';
/** Copy/fill: shift relative references by (dr rows, dc cols). */
export const shiftFormula = (f, dr, dc) => mapRefs(f, x => ({ c: x.absC ? x.c : x.c + dc, r: x.absR ? x.r : x.r + dr }));
/** Rows/cols inserted (count > 0) or deleted (count < 0) at index `at`; `applies(ref)` picks the refs that point at the changed tab.
    Like Excel, a range loses only the deleted part (SUM(D2:D10) becomes SUM(D2:D9) when row 10 goes) and is #REF! only when wholly deleted. */
export function adjustFormula(f, axis, at, count, applies = x => !x.sheet) {
  const k = axis === 'row' ? 'r' : 'c';
  const untouched = x => !applies(x) || (x.wholeCol && k === 'r');
  const d1 = at - count - 1; // last deleted index (count < 0)
  const single = x => {
    if (untouched(x)) return { c: x.c, r: x.r };
    const v = x[k];
    if (count < 0 && v >= at && v <= d1) return null;
    return { c: x.c, r: x.r, [k]: v >= at ? v + count : v };
  };
  const range = (a, b) => {
    if (untouched(a)) return [{ c: a.c, r: a.r }, { c: b.c, r: b.r }];
    const [lo, hi] = a[k] <= b[k] ? [a, b] : [b, a];
    if (count > 0) return [a, b].map(x => ({ c: x.c, r: x.r, [k]: x[k] >= at ? x[k] + count : x[k] }));
    if (lo[k] >= at && hi[k] <= d1) return [null, null]; // the whole range was deleted
    const ns = lo[k] < at ? lo[k] : lo[k] > d1 ? lo[k] + count : at;
    const ne = hi[k] < at ? hi[k] : hi[k] > d1 ? hi[k] + count : at - 1;
    const nlo = { c: lo.c, r: lo.r, [k]: ns }, nhi = { c: hi.c, r: hi.r, [k]: ne };
    return lo === a ? [nlo, nhi] : [nhi, nlo];
  };
  return mapRefs(f, single, range);
}

/* ---------------- values & coercion ---------------- */
const clean = x => (typeof x === 'number' ? (Number.isFinite(x) ? +x.toPrecision(15) : fail('#NUM!')) : x);
export function toNum(v) {
  if (v instanceof FErr) throw v;
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v == null || v === '') return 0;
  const s = String(v).trim().replace(/^R\s?/i, '').replace(/[\s,](?=\d{3}\b)/g, '');
  if (/^-?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?%$/i.test(s)) return Number(s.slice(0, -1)) / 100;
  if (/^-?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(s)) return Number(s);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return dateToSerial(s);
  return fail('#VALUE!');
}
export function toStr(v) {
  if (v instanceof FErr) throw v;
  if (v == null) return '';
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (typeof v === 'number') return String(+v.toPrecision(15));
  return String(v);
}
const toBool = v => { if (v instanceof FErr) throw v; if (typeof v === 'boolean') return v; if (typeof v === 'number') return v !== 0; if (v == null || v === '') return false; const s = String(v).toUpperCase(); if (s === 'TRUE') return true; if (s === 'FALSE') return false; return fail('#VALUE!'); };
const typeRank = v => (typeof v === 'number' ? 0 : typeof v === 'string' ? 1 : typeof v === 'boolean' ? 2 : -1);
export function compare(a, b) {
  if (a == null || a === '') a = typeof b === 'string' ? '' : typeof b === 'boolean' ? false : 0;
  if (b == null || b === '') b = typeof a === 'string' ? '' : typeof a === 'boolean' ? false : 0;
  const ra = typeRank(a), rb = typeRank(b);
  if (ra !== rb) return ra - rb;
  if (typeof a === 'string') { const x = a.toLowerCase(), y = b.toLowerCase(); return x < y ? -1 : x > y ? 1 : 0; }
  return a < b ? -1 : a > b ? 1 : 0;
}

/* ---------------- dates (Excel serials, 1899-12-30 epoch) ---------------- */
const EPOCH = Date.UTC(1899, 11, 30);
export const dateToSerial = iso => Math.round((Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) - EPOCH) / 864e5);
/** Serial -> 'YYYY-MM-DD', or null outside Excel's date range (0001-01-01 … 9999-12-31) so formatting never throws. */
export const serialToDate = n => (Number.isFinite(n) && n >= -693593 && n <= 2958465 ? new Date(EPOCH + Math.floor(n) * 864e5).toISOString().slice(0, 10) : null);
const asDate = v => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? dateToSerial(v.slice(0, 10)) : toNum(v));
const partsOf = v => { const d = new Date(EPOCH + Math.floor(asDate(v)) * 864e5); return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(), wd: d.getUTCDay() }; };
const serialOf = (y, m, d) => Math.round((Date.UTC(y, m - 1, d) - EPOCH) / 864e5);

/* ---------------- criteria (SUMIF / COUNTIF) ---------------- */
export function criteria(c) {
  // like Excel, error cells in the criteria range never match (and never break the total)
  const inner = criteriaTest(c);
  return v => !(v instanceof FErr) && inner(v);
}
function criteriaTest(c) {
  if (typeof c === 'number' || typeof c === 'boolean') return v => compare(v, c) === 0 && typeRank(v) === typeRank(c) || (typeof c === 'number' && typeof v === 'string' && v.trim() !== '' && Number(v) === c);
  const s = String(c ?? ''); const m = /^(<=|>=|<>|<|>|=)?(.*)$/s.exec(s); const op = m[1] || '='; let rhs = m[2];
  const num = rhs.trim() !== '' && !Number.isNaN(Number(rhs)) ? Number(rhs) : null;
  if (op === '=' || op === '<>') {
    let test;
    if (rhs === '') test = v => v == null || v === '';
    else if (num != null) test = v => (typeof v === 'number' ? v === num : String(v ?? '').trim() !== '' && Number(v) === num);
    else if (/[*?]/.test(rhs)) { const re = new RegExp('^' + rhs.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/~\*/g, '\u0001').replace(/~\?/g, '\u0002').replace(/\*/g, '.*').replace(/\?/g, '.').replace(/\u0001/g, '\\*').replace(/\u0002/g, '\\?') + '$', 'is'); test = v => re.test(toStr(v)); }
    else test = v => toStr(v).toLowerCase() === rhs.toLowerCase();
    return op === '=' ? test : v => !test(v);
  }
  return v => {
    if (v == null || v === '') return false;
    if (num != null && typeof v !== 'number') return false;
    if (num == null && typeof v !== 'string') return false; // "<M" compares text only
    const d = compare(v, num != null ? num : rhs);
    return op === '<' ? d < 0 : op === '>' ? d > 0 : op === '<=' ? d <= 0 : d >= 0;
  };
}

/* ---------------- functions ---------------- */
const isMatrix = v => Array.isArray(v);
const flat = args => args.flatMap(a => (isMatrix(a) ? a.flat() : [a]));
const nums = (args, strictScalars = true) => { const out = []; for (const a of args) { if (isMatrix(a)) { for (const v of a.flat()) { if (v instanceof FErr) throw v; if (typeof v === 'number') out.push(v); } } else if (a !== undefined) { if (a instanceof FErr) throw a; if (a == null && !strictScalars) continue; out.push(toNum(a)); } } return out; };
const scalar = v => { const x = isMatrix(v) ? (v.length === 1 && v[0].length === 1 ? v[0][0] : fail('#VALUE!')) : v; if (x instanceof FErr) throw x; return x; };
const N = v => toNum(scalar(v));
const S = v => toStr(scalar(v));
const mat = v => (isMatrix(v) ? v : [[v]]);
const round = (x, n = 0) => { const f = 10 ** n; return (Math.sign(x) * Math.round(Math.abs(x) * f * (1 + Number.EPSILON))) / f; };
const sumIfs = (sumR, pairs) => { const s = mat(sumR); let total = 0, count = 0; s.forEach((row, i) => row.forEach((v, j) => { if (pairs.every(([rg, test]) => test((mat(rg)[i] || [])[j]))) { if (v instanceof FErr) throw v; if (typeof v === 'number') { total += v; count++; } } })); return { total, count }; };
const pairsOf = args => { const out = []; for (let i = 0; i < args.length; i += 2) out.push([args[i], criteria(scalar(args[i + 1]))]); return out; };
const lookupIndex = (needle, list, exact) => {
  if (exact) { const test = typeof needle === 'string' && /[*?]/.test(needle) ? criteria(needle) : v => compare(v, needle) === 0 && typeRank(v) === typeRank(needle); return list.findIndex(test); }
  let best = -1; for (let i = 0; i < list.length; i++) { if (list[i] == null || list[i] === '' || typeRank(list[i]) !== typeRank(needle)) continue; if (compare(list[i], needle) <= 0) best = i; else break; } return best;
};

export const FUNCTIONS = {
  SUM: a => nums(a, false).reduce((x, y) => x + y, 0),
  AVERAGE: a => { const n = nums(a, false); return n.length ? n.reduce((x, y) => x + y, 0) / n.length : fail('#DIV/0!'); },
  MIN: a => { const n = nums(a, false); return n.length ? Math.min(...n) : 0; },
  MAX: a => { const n = nums(a, false); return n.length ? Math.max(...n) : 0; },
  MEDIAN: a => { const n = nums(a, false).sort((x, y) => x - y); if (!n.length) fail('#NUM!'); const m = n.length >> 1; return n.length % 2 ? n[m] : (n[m - 1] + n[m]) / 2; },
  PRODUCT: a => nums(a, false).reduce((x, y) => x * y, 1),
  COUNT: a => flat(a).filter(v => typeof v === 'number').length,
  COUNTA: a => flat(a).filter(v => v != null && v !== '').length,
  COUNTBLANK: a => flat(a).filter(v => v == null || v === '').length,
  SUMPRODUCT: a => { const ms = a.map(mat); const rows = ms[0].length, cols = ms[0][0].length; if (ms.some(m => m.length !== rows || m[0].length !== cols)) fail('#VALUE!'); let t = 0; for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) t += ms.reduce((p, m) => p * (typeof m[i][j] === 'number' ? m[i][j] : 0), 1); return t; },
  SUMIF: ([r, c, s]) => sumIfs(s ?? r, [[r, criteria(scalar(c))]]).total,
  SUMIFS: ([s, ...rest]) => sumIfs(s, pairsOf(rest)).total,
  COUNTIF: ([r, c]) => { const t = criteria(scalar(c)); return mat(r).flat().filter(t).length; },
  COUNTIFS: a => { const pairs = pairsOf(a); const m = mat(a[0]); let n = 0; m.forEach((row, i) => row.forEach((_, j) => { if (pairs.every(([rg, test]) => test((mat(rg)[i] || [])[j]))) n++; })); return n; },
  AVERAGEIF: ([r, c, s]) => { const x = sumIfs(s ?? r, [[r, criteria(scalar(c))]]); return x.count ? x.total / x.count : fail('#DIV/0!'); },
  AVERAGEIFS: ([s, ...rest]) => { const x = sumIfs(s, pairsOf(rest)); return x.count ? x.total / x.count : fail('#DIV/0!'); },
  ROUND: ([x, n]) => round(N(x), n === undefined ? 0 : N(n)),
  ROUNDUP: ([x, n]) => { const f = 10 ** (n === undefined ? 0 : N(n)); const v = N(x); return (Math.sign(v) * Math.ceil(+(Math.abs(v) * f).toPrecision(15))) / f; },
  ROUNDDOWN: ([x, n]) => { const f = 10 ** (n === undefined ? 0 : N(n)); const v = N(x); return (Math.sign(v) * Math.floor(+(Math.abs(v) * f).toPrecision(15))) / f; },
  INT: ([x]) => Math.floor(N(x)),
  ABS: ([x]) => Math.abs(N(x)),
  SQRT: ([x]) => { const v = N(x); return v < 0 ? fail('#NUM!') : Math.sqrt(v); },
  POWER: ([x, y]) => N(x) ** N(y),
  MOD: ([x, y]) => { const d = N(y); if (!d) fail('#DIV/0!'); const v = N(x); return v - d * Math.floor(v / d); },
  // clean the quotient first: 1.11/0.01 is 111.00000000000001 in binary floating point
  CEILING: ([x, s]) => { const g = s === undefined ? 1 : N(s); return g ? clean(Math.ceil(+(N(x) / g).toPrecision(15)) * g) : 0; },
  FLOOR: ([x, s]) => { const g = s === undefined ? 1 : N(s); return g ? clean(Math.floor(+(N(x) / g).toPrecision(15)) * g) : 0; },
  PI: () => Math.PI,
  SIGN: ([x]) => Math.sign(N(x)),
  IF: null, IFERROR: null, IFNA: null, // lazy — handled in evaluator
  AND: a => flat(a).filter(v => v != null && v !== '').every(toBool),
  OR: a => flat(a).filter(v => v != null && v !== '').some(toBool),
  NOT: ([x]) => !toBool(scalar(x)),
  TRUE: () => true, FALSE: () => false,
  ISERROR: null, ISNA: null, ISBLANK: null, ISNUMBER: null, ISTEXT: null, ISLOGICAL: null, ISNONTEXT: null, // lazy — never pass errors through
  NA: () => fail('#N/A'),
  CONCAT: a => flat(a).map(toStr).join(''),
  CONCATENATE: a => flat(a).map(toStr).join(''),
  TEXTJOIN: ([d, ign, ...a]) => { const skip = toBool(scalar(ign)); return flat(a).filter(v => !(skip && (v == null || v === ''))).map(toStr).join(S(d)); },
  LEN: ([x]) => S(x).length,
  UPPER: ([x]) => S(x).toUpperCase(),
  LOWER: ([x]) => S(x).toLowerCase(),
  PROPER: ([x]) => S(x).toLowerCase().replace(/(^|[^a-z])([a-z])/g, (m, p, c) => p + c.toUpperCase()),
  TRIM: ([x]) => S(x).trim().replace(/\s+/g, ' '),
  LEFT: ([x, n]) => S(x).slice(0, n === undefined ? 1 : N(n)),
  RIGHT: ([x, n]) => { const s = S(x), k = n === undefined ? 1 : N(n); return k ? s.slice(-k) : ''; },
  MID: ([x, st, n]) => S(x).substr(N(st) - 1, N(n)),
  SUBSTITUTE: ([x, a, b]) => S(x).split(S(a)).join(S(b)),
  FIND: ([n, h, st]) => { const i = S(h).indexOf(S(n), (st === undefined ? 1 : N(st)) - 1); return i < 0 ? fail('#VALUE!') : i + 1; },
  SEARCH: ([n, h, st]) => { const i = S(h).toLowerCase().indexOf(S(n).toLowerCase(), (st === undefined ? 1 : N(st)) - 1); return i < 0 ? fail('#VALUE!') : i + 1; },
  VALUE: ([x]) => toNum(scalar(x)),
  TEXT: ([x, f]) => formatValue(scalar(x), excelFmt(S(f))),
  REPT: ([x, n]) => S(x).repeat(Math.max(0, N(n))),
  TODAY: (_, ctx) => dateToSerial(ctx.today),
  NOW: (_, ctx) => dateToSerial(ctx.today) + ((ctx.nowMinutes ?? 0) / 1440),
  DATE: ([y, m, d]) => serialOf(N(y), N(m), N(d)),
  YEAR: ([x]) => partsOf(scalar(x)).y,
  MONTH: ([x]) => partsOf(scalar(x)).m,
  DAY: ([x]) => partsOf(scalar(x)).d,
  WEEKDAY: ([x, t]) => { const wd = partsOf(scalar(x)).wd; const type = t === undefined ? 1 : N(t); return type === 2 ? ((wd + 6) % 7) + 1 : type === 3 ? (wd + 6) % 7 : wd + 1; },
  DAYS: ([e, s]) => Math.floor(asDate(scalar(e))) - Math.floor(asDate(scalar(s))),
  EDATE: ([d, m]) => { const p = partsOf(scalar(d)); const tgt = new Date(Date.UTC(p.y, p.m - 1 + N(m), 1)); const last = new Date(Date.UTC(tgt.getUTCFullYear(), tgt.getUTCMonth() + 1, 0)).getUTCDate(); return serialOf(tgt.getUTCFullYear(), tgt.getUTCMonth() + 1, Math.min(p.d, last)); },
  EOMONTH: ([d, m]) => { const p = partsOf(scalar(d)); return serialOf(p.y, p.m + N(m) + 1, 0); },
  NETWORKDAYS: ([s, e, hol]) => { let a = Math.floor(asDate(scalar(s))), b = Math.floor(asDate(scalar(e))); const sign = a > b ? -1 : 1; if (a > b) [a, b] = [b, a]; const skip = new Set((hol === undefined ? [] : mat(hol).flat()).filter(v => v != null && v !== '').map(v => Math.floor(asDate(v)))); let n = 0; for (let x = a; x <= b; x++) { const wd = partsOf(x).wd; if (wd && wd < 6 && !skip.has(x)) n++; } return sign * n; },
  VLOOKUP: ([v, r, col, approx]) => { const m = mat(r), k = N(col); if (k < 1 || k > m[0].length) fail('#REF!'); const i = lookupIndex(scalar(v), m.map(row => row[0]), approx !== undefined && !toBool(scalar(approx))); return i < 0 ? fail('#N/A') : m[i][k - 1] ?? ''; },
  HLOOKUP: ([v, r, row, approx]) => { const m = mat(r), k = N(row); if (k < 1 || k > m.length) fail('#REF!'); const i = lookupIndex(scalar(v), m[0], approx !== undefined && !toBool(scalar(approx))); return i < 0 ? fail('#N/A') : m[k - 1][i] ?? ''; },
  XLOOKUP: ([v, look, ret, notFound]) => { const l = mat(look).flat(), r = mat(ret).flat(); const i = lookupIndex(scalar(v), l, true); if (i < 0) return notFound === undefined ? fail('#N/A') : scalar(notFound); return r[i] ?? ''; },
  MATCH: ([v, r, type]) => { const l = mat(r).flat(); const t = type === undefined ? 1 : N(type); let i; if (t === 0) i = lookupIndex(scalar(v), l, true); else if (t > 0) i = lookupIndex(scalar(v), l, false); else { i = -1; for (let k = 0; k < l.length; k++) if (compare(l[k], scalar(v)) >= 0) i = k; else break; } return i < 0 ? fail('#N/A') : i + 1; },
  INDEX: ([r, row, col]) => { const m = mat(r); let i = row === undefined ? 1 : N(row), j = col === undefined ? 1 : N(col); if (m.length === 1 && col === undefined) { j = i; i = 1; } if (i < 1 || j < 1 || i > m.length || j > m[0].length) fail('#REF!'); return m[i - 1][j - 1] ?? ''; },
  ROWS: ([r]) => mat(r).length,
  COLUMNS: ([r]) => mat(r)[0].length,
  PMT: ([rate, nper, pv, fv, type]) => { const r = N(rate), n = N(nper), p = N(pv), f = fv === undefined ? 0 : N(fv), t = type === undefined ? 0 : N(type); if (!n) fail('#NUM!'); if (!r) return -(p + f) / n; const q = (1 + r) ** n; return -(r * (p * q + f)) / ((1 + r * t) * (q - 1)); },
  FV: ([rate, nper, pmt, pv, type]) => { const r = N(rate), n = N(nper), m = N(pmt), p = pv === undefined ? 0 : N(pv), t = type === undefined ? 0 : N(type); if (!r) return -(p + m * n); const q = (1 + r) ** n; return -(p * q + (m * (1 + r * t) * (q - 1)) / r); },
  VAT: ([x, rate]) => round(N(x) * (rate === undefined ? 0.15 : N(rate)), 2),
  INCVAT: ([x, rate]) => round(N(x) * (1 + (rate === undefined ? 0.15 : N(rate))), 2),
  EXVAT: ([x, rate]) => round(N(x) / (1 + (rate === undefined ? 0.15 : N(rate))), 2)
};
export const FUNCTION_NAMES = Object.keys(FUNCTIONS).sort();

/* ---------------- workbook evaluation ---------------- */
export function literal(v) { return v === undefined ? null : v; }

/** Evaluate every formula in the book. Returns { get(tab, a), values: { [tab]: { [a]: value } }, errors }. */
const sastNow = () => new Date(Date.now() + 2 * 3600e3); // South Africa: UTC+2 all year
export function evaluateBook(tabs, { today = sastNow().toISOString().slice(0, 10), nowMinutes = (d => d.getUTCHours() * 60 + d.getUTCMinutes())(sastNow()) } = {}) {
  const byName = new Map((tabs || []).map(t => [String(t.name).toLowerCase(), t]));
  const cache = new Map(), visiting = new Set(), asts = new Map();
  const ctx = { today, nowMinutes };
  const maxRow = tab => { let m = (tab.rows || 0) - 1; for (const a of Object.keys(tab.cells || {})) { const p = parseAddr(a); if (p && p.r > m) m = p.r; } return m; };
  const tabOf = (cur, sheet) => (sheet ? byName.get(sheet.toLowerCase()) || fail('#REF!') : cur);
  const astOf = f => { if (!asts.has(f)) { try { asts.set(f, parse(f)); } catch (e) { asts.set(f, { t: 'syntax', msg: e.message }); } } return asts.get(f); };

  function cellValue(tab, a) {
    const key = tab.name + '!' + a;
    if (cache.has(key)) return cache.get(key);
    if (visiting.has(key)) return E('#CIRC!');
    const cell = tab.cells && tab.cells[a];
    let v = null;
    if (cell && cell.f != null && cell.f !== '') {
      visiting.add(key);
      try { v = scalarResult(ev(astOf(cell.f), tab)); } catch (e) { v = e instanceof FErr ? e : E('#VALUE!'); } finally { visiting.delete(key); }
    } else if (cell) v = literal(cell.v);
    cache.set(key, v);
    return v;
  }
  const scalarResult = v => (isMatrix(v) ? (v[0] && v[0].length ? v[0][0] : null) : typeof v === 'number' ? clean(v) : v);
  const rangeValues = (tab, n) => { const r2 = n.r2 == null ? maxRow(tab) : n.r2; const out = []; for (let r = n.r1; r <= Math.max(r2, n.r1); r++) { const row = []; for (let c = n.c1; c <= n.c2; c++) row.push(cellValue(tab, addr(c, r))); out.push(row); } return out; };

  function ev(n, tab) {
    switch (n.t) {
      case 'num': case 'str': case 'bool': return n.v;
      case 'blank': return null; // an empty-but-present argument counts as 0 / FALSE: VLOOKUP(x,r,2,) is an exact match
      case 'errlit': return fail(n.v);
      case 'syntax': return fail('#NAME?');
      case 'name': return fail('#NAME?');
      case 'ref': { const v = cellValue(tabOf(tab, n.sheet), addr(n.c, n.r)); if (v instanceof FErr) throw v; return v; }
      case 'range': return rangeValues(tabOf(tab, n.sheet), n);
      case 'neg': return clean(-N(ev(n.a, tab)));
      case 'pct': return clean(N(ev(n.a, tab)) / 100);
      case 'bin': {
        const a = scalar(ev(n.a, tab)), b = scalar(ev(n.b, tab));
        if (a instanceof FErr) throw a; if (b instanceof FErr) throw b;
        switch (n.op) {
          case '+': return clean(toNum(a) + toNum(b));
          case '-': return clean(toNum(a) - toNum(b));
          case '*': return clean(toNum(a) * toNum(b));
          case '/': { const d = toNum(b); return d === 0 ? fail('#DIV/0!') : clean(toNum(a) / d); }
          case '^': return clean(toNum(a) ** toNum(b));
          case '&': return toStr(a) + toStr(b);
          case '=': return compare(a, b) === 0;
          case '<>': return compare(a, b) !== 0;
          case '<': return compare(a, b) < 0;
          case '>': return compare(a, b) > 0;
          case '<=': return compare(a, b) <= 0;
          case '>=': return compare(a, b) >= 0;
        }
        return fail('#VALUE!');
      }
      case 'fn': {
        const name = n.name.replace(/^_XLFN\./, '');
        if (name === 'IF') { const c = toBool(scalar(ev(n.args[0], tab))); const br = c ? n.args[1] : n.args[2]; return br === undefined ? (c ? true : false) : br.t === 'blank' ? 0 : ev(br, tab); }
        if (name === 'IFERROR' || name === 'IFNA') { try { return ev(n.args[0], tab); } catch (e) { if (!(e instanceof FErr) || (name === 'IFNA' && e.code !== '#N/A')) throw e; return n.args[1] ? ev(n.args[1], tab) : ''; } }
        if (name === 'ISERROR' || name === 'ISNA') { try { const v = scalar(ev(n.args[0], tab)); return v instanceof FErr && (name === 'ISERROR' || v.code === '#N/A'); } catch (e) { if (!(e instanceof FErr)) throw e; return name === 'ISERROR' || e.code === '#N/A'; } }
        if (['ISBLANK', 'ISNUMBER', 'ISTEXT', 'ISLOGICAL', 'ISNONTEXT'].includes(name)) {
          // Excel's IS functions never pass an error through: ISNUMBER(SEARCH("x","abc")) is FALSE
          let v;
          try { const a = n.args[0]; v = !a ? null : a.t === 'ref' ? cellValue(tabOf(tab, a.sheet), addr(a.c, a.r)) : ev(a, tab); if (isMatrix(v)) v = v[0] ? v[0][0] : null; }
          catch (e) { if (!(e instanceof FErr)) throw e; v = e; }
          if (v instanceof FErr) return name === 'ISNONTEXT';
          return name === 'ISBLANK' ? v == null : name === 'ISNUMBER' ? typeof v === 'number' : name === 'ISTEXT' ? typeof v === 'string' : name === 'ISLOGICAL' ? typeof v === 'boolean' : typeof v !== 'string';
        }
        if (name === 'IFS') { for (let i = 0; i < n.args.length; i += 2) if (toBool(scalar(ev(n.args[i], tab)))) return ev(n.args[i + 1], tab); return fail('#N/A'); }
        if (name === 'SWITCH') { const v = scalar(ev(n.args[0], tab)); let i = 1; for (; i + 1 < n.args.length; i += 2) if (compare(v, scalar(ev(n.args[i], tab))) === 0) return ev(n.args[i + 1], tab); return i < n.args.length ? ev(n.args[i], tab) : fail('#N/A'); }
        const fn = FUNCTIONS[name];
        if (!fn) return fail('#NAME?');
        // a plain reference passed to a function behaves like a 1×1 range (Excel: SUM(A1) ignores text in A1)
        return fn(n.args.map(a => (a.t === 'ref' ? [[cellValue(tabOf(tab, a.sheet), addr(a.c, a.r))]] : ev(a, tab))), ctx);
      }
    }
    return fail('#VALUE!');
  }

  const values = {};
  for (const tab of tabs || []) { const o = (values[tab.name] = {}); for (const a of Object.keys(tab.cells || {})) o[a] = cellValue(tab, a); }
  return {
    values,
    get: (tabName, a) => { const t = byName.get(String(tabName).toLowerCase()); return t ? cellValue(t, a) : null; },
    /** Evaluate an ad-hoc formula in the context of a tab (formula bar preview). */
    evaluate: (formula, tabName) => { const t = byName.get(String(tabName).toLowerCase()) || tabs[0]; try { return scalarResult(ev(parse(formula), t)); } catch (e) { return e instanceof FErr ? e : E('#NAME?'); } }
  };
}

/* ---------------- input parsing & display ---------------- */
const pad2 = n => String(n).padStart(2, '0');
/** A real calendar date (no 31/02, no US-format 09/29 read as day 9 of month 29) -> serial, else null. */
const validDate = (y, m, d) => (m >= 1 && m <= 12 && d >= 1 && serialToDate(serialOf(y, m, d)) === `${y}-${pad2(m)}-${pad2(d)}` ? serialOf(y, m, d) : null);
/** What the user typed -> { v } or { f }. decimal ',' reads "1 234,56" as 1234.56 (CSV from comma-decimal Excel). */
export function parseInput(text, { decimal = '.' } = {}) {
  const s = String(text ?? '');
  if (s.startsWith('=') && s.length > 1) return { f: s.slice(1) };
  if (s.trim() === '') return null;
  if (/^(true|false)$/i.test(s.trim())) return { v: s.trim().toUpperCase() === 'TRUE' };
  let t = s.trim().replace(/^R\s?/i, '');
  if (decimal === ',' && /^-?\d{1,3}([ . ]\d{3})*(,\d+)?%?$|^-?\d+(,\d+)?%?$/.test(t)) t = t.replace(/[ . ]/g, '').replace(',', '.');
  if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(t) || /^-?\d{1,3}( \d{3})+(\.\d+)?$/.test(t)) return { v: Number(t.replace(/[ ,]/g, '')), fmt: /^R/i.test(s.trim()) ? 'money' : undefined };
  if (/^-?(\d+\.?\d*|\.\d+)$/.test(t)) return { v: Number(t), fmt: /^R/i.test(s.trim()) ? 'money' : undefined };
  if (/^-?(\d+\.?\d*|\.\d+)%$/.test(t)) return { v: Number(t.slice(0, -1)) / 100, fmt: 'percent' };
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) { const v = validDate(+t.slice(0, 4), +t.slice(5, 7), +t.slice(8, 10)); if (v != null) return { v, fmt: 'date' }; }
  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(t)) { const [d, m, y] = t.split('/').map(Number); const v = validDate(y, m, d); if (v != null) return { v, fmt: 'date' }; }
  return { v: s.startsWith("'") ? s.slice(1) : s };
}
const excelFmt = f => (/%/.test(f) ? 'percent' : /[yd]/i.test(f) ? 'date' : /R|\$/.test(f) ? 'money' : /0\.0/.test(f) ? 'number' : /0/.test(f) ? 'int' : 'general');
// same presentation as the rest of the app (core/format.js): R1,234.56 · -R50.00 · 1,234.56
const group = (n, dp) => { const [i, d] = Math.abs(round(n, dp)).toFixed(dp).split('.'); return (n < 0 ? '-' : '') + i.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (d ? '.' + d : ''); };
/** Display text for a computed value. */
export function formatValue(v, fmt = 'general') {
  if (v instanceof FErr) return v.code;
  if (v == null) return '';
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (typeof v !== 'number') return String(v);
  switch (fmt) {
    case 'money': return (v < 0 ? '-R' : 'R') + group(Math.abs(v), 2);
    case 'number': return group(v, 2);
    case 'int': return group(v, 0);
    case 'percent': return `${+(v * 100).toFixed(2)}%`;
    case 'date': return serialToDate(v) ?? '#NUM!';
    // whole numbers up to 15 digits exactly (SA ID and account numbers must never be rounded)
    default: return Number.isInteger(v) && Math.abs(v) < 1e15 ? String(v) : String(+v.toPrecision(12));
  }
}
/** Cells of a rectangular selection as TSV (copy) using computed display values. */
export function toTSV(values, fmtOf, c1, r1, c2, r2) {
  const lines = [];
  for (let r = r1; r <= r2; r++) { const row = []; for (let c = c1; c <= c2; c++) row.push(formatValue(values[addr(c, r)], fmtOf(addr(c, r))).replace(/[\t\n]/g, ' ')); lines.push(row.join('\t')); }
  return lines.join('\n');
}
/** Sort rows r1..r2 of a tab by column `c` (keeps formulas; relative refs shift with their row). */
export function sortRows(tab, values, r1, r2, c, desc = false) {
  const width = Math.max(tab.cols || 0, ...Object.keys(tab.cells || {}).map(a => (parseAddr(a) || { c: 0 }).c + 1));
  const rows = [];
  for (let r = r1; r <= r2; r++) { const cells = {}; for (let k = 0; k < width; k++) { const a = addr(k, r); if (tab.cells[a]) cells[k] = tab.cells[a]; } rows.push({ r, key: values[addr(c, r)], cells }); }
  rows.sort((x, y) => { const ex = x.key == null || x.key === '', ey = y.key == null || y.key === ''; if (ex !== ey) return ex ? 1 : -1; const d = compare(x.key, y.key); return desc ? -d : d; });
  const next = { ...tab.cells };
  for (let r = r1; r <= r2; r++) for (let k = 0; k < width; k++) delete next[addr(k, r)];
  rows.forEach((row, i) => { const to = r1 + i; for (const [k, cell] of Object.entries(row.cells)) next[addr(Number(k), to)] = cell.f ? { ...cell, f: shiftFormula(cell.f, to - row.r, 0) } : cell; });
  return next;
}
/** Three-way merge for two people editing one workbook: `base` is the last version both saw, `local` has this person's
    unsaved edits, `remote` just arrived. Per cell (and per tab setting) a local change wins, otherwise the remote
    value is taken — so neither person's edit is silently lost. Tabs are matched by name. */
export function mergeBooks(base, local, remote) {
  const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  const pick = (b, l, r) => (same(l, b) ? r : l);
  const byName = list => new Map((list || []).map(t => [t.name, t]));
  const B = byName(base), L = byName(local), R = byName(remote);
  const names = [...(local || []).map(t => t.name), ...(remote || []).map(t => t.name).filter(n => !L.has(n))];
  const out = [];
  for (const name of names) {
    const b = B.get(name), l = L.get(name), r = R.get(name);
    if (!l) { if (!b) out.push(r); continue; }            // added remotely → keep; deleted locally → stay deleted
    if (!r) { if (!b || !same(l, b)) out.push(l); continue; } // deleted remotely → drop unless changed here
    if (!b) { out.push(l); continue; }                      // both created a tab with this name → keep ours
    const tab = { ...r };
    for (const k of new Set([...Object.keys(l), ...Object.keys(r)])) if (k !== 'cells') tab[k] = pick(b[k], l[k], r[k]);
    const cells = {};
    for (const a of new Set([...Object.keys(l.cells || {}), ...Object.keys(r.cells || {}), ...Object.keys(b.cells || {})])) {
      const v = pick((b.cells || {})[a], (l.cells || {})[a], (r.cells || {})[a]);
      if (v != null) cells[a] = v;
    }
    tab.cells = cells;
    out.push(tab);
  }
  return out;
}
/** Insert (count>0) or delete (count<0) rows/cols at `at`, fixing formulas on every tab. */
export function shiftCells(tabs, tabName, axis, at, count) {
  const low = String(tabName).toLowerCase();
  return tabs.map(t => {
    const same = t.name === tabName;
    const cells = {};
    for (const [a, cell] of Object.entries(t.cells || {})) {
      let key = a;
      if (same) { const p = parseAddr(a); const k = axis === 'row' ? p.r : p.c; if (count < 0 && k >= at && k < at - count) continue; if (k >= at) key = axis === 'row' ? addr(p.c, p.r + count) : addr(p.c + count, p.r); }
      cells[key] = cell.f ? { ...cell, f: adjustFormula(cell.f, axis, at, count, x => (x.sheet ? x.sheet.toLowerCase() === low : same)) } : cell;
    }
    return { ...t, cells, rows: same && axis === 'row' ? Math.max(1, (t.rows || 100) + count) : t.rows, cols: same && axis === 'col' ? Math.max(1, (t.cols || 26) + count) : t.cols };
  });
}
