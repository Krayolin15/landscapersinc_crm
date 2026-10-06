/* =============================================================================
   Machine-learning core: reproducible randomness, train/test splitting,
   cross-validation, feature encoding and evaluation metrics.
   Pure JavaScript — runs in the browser and in Node (tests__core.test.js).
   ========================================================================== */

/** Seeded PRNG (mulberry32) so every split and model is reproducible. */
export function rng(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function shuffle(arr, rand = rng(1)) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

/**
 * trainTestSplit(X, y, { testSize=0.25, seed, stratify=true })
 * Stratified for classification so both sets keep the class balance.
 * Returns index arrays too, so predictions can be traced back to records.
 */
export function trainTestSplit(X, y, { testSize = 0.25, seed = 1, stratify = true } = {}) {
  const n = X.length;
  const rand = rng(seed);
  let testIdx = [];
  const isClass = y.every(v => v === 0 || v === 1 || typeof v === 'string');
  if (stratify && isClass) {
    const groups = new Map();
    y.forEach((v, i) => { if (!groups.has(v)) groups.set(v, []); groups.get(v).push(i); });
    for (const idx of groups.values()) {
      const s = shuffle(idx, rand);
      const k = Math.max(idx.length > 1 ? 1 : 0, Math.round(idx.length * testSize));
      testIdx.push(...s.slice(0, k));
    }
  } else {
    testIdx = shuffle([...Array(n).keys()], rand).slice(0, Math.max(1, Math.round(n * testSize)));
  }
  const tset = new Set(testIdx);
  const trainIdx = [...Array(n).keys()].filter(i => !tset.has(i));
  testIdx.sort((a, b) => a - b);
  return {
    Xtrain: trainIdx.map(i => X[i]), ytrain: trainIdx.map(i => y[i]),
    Xtest: testIdx.map(i => X[i]), ytest: testIdx.map(i => y[i]),
    trainIdx, testIdx
  };
}

/** k-fold indices (stratified when labels are classes). */
export function kFold(y, k = 5, seed = 1) {
  const rand = rng(seed);
  const folds = Array.from({ length: k }, () => []);
  const groups = new Map();
  y.forEach((v, i) => { const key = typeof v === 'number' && !(v === 0 || v === 1) ? 'all' : v; if (!groups.has(key)) groups.set(key, []); groups.get(key).push(i); });
  let f = 0;
  for (const idx of groups.values()) for (const i of shuffle(idx, rand)) { folds[f % k].push(i); f++; }
  return folds.map((test, i) => ({ test, train: folds.filter((_, j) => j !== i).flat() }));
}

/* ------------------------------------------------------------ encoding */

/**
 * Feature encoder built from a spec:
 *   [{ name, type:'num'|'cat'|'bool'|'date', get?: rec => value }]
 * fit(records) learns category vocabularies and scaling; transform(records) -> number[][]
 * Missing numbers are imputed with the training median (and a missing flag).
 */
export class Encoder {
  constructor(spec) { this.spec = spec; this.fitted = false; }
  fit(records) {
    this.meta = this.spec.map(f => {
      const vals = records.map(r => (f.get ? f.get(r) : r[f.name]));
      if (f.type === 'cat') {
        const counts = new Map();
        vals.forEach(v => { const k = v == null || v === '' ? '∅' : String(v); counts.set(k, (counts.get(k) || 0) + 1); });
        const cats = [...counts.entries()].filter(([, c]) => c >= (f.minCount || 1)).sort((a, b) => b[1] - a[1]).slice(0, f.maxCats || 20).map(([k]) => k);
        return { ...f, cats };
      }
      const nums = vals.map(v => (f.type === 'bool' ? (v ? 1 : 0) : f.type === 'date' ? (v ? new Date(v).getTime() / 864e5 : NaN) : Number(v))).filter(v => isFinite(v));
      const sorted = nums.slice().sort((a, b) => a - b);
      const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
      const mean = nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
      const sd = nums.length > 1 ? Math.sqrt(nums.reduce((a, b) => a + (b - mean) ** 2, 0) / (nums.length - 1)) : 1;
      const hasMissing = vals.some(v => v == null || v === '' || !isFinite(f.type === 'date' ? new Date(v).getTime() : Number(v)));
      return { ...f, median, mean, sd: sd || 1, hasMissing: f.type !== 'bool' && hasMissing };
    });
    this.fitted = true;
    return this;
  }
  get names() {
    return this.meta.flatMap(m => (m.type === 'cat' ? m.cats.map(c => `${m.name}=${c}`) : [m.name, ...(m.hasMissing ? [`${m.name}_missing`] : [])]));
  }
  transformOne(r) {
    const row = [];
    for (const m of this.meta) {
      const v = m.get ? m.get(r) : r[m.name];
      if (m.type === 'cat') { const k = v == null || v === '' ? '∅' : String(v); m.cats.forEach(c => row.push(c === k ? 1 : 0)); continue; }
      let x = m.type === 'bool' ? (v ? 1 : 0) : m.type === 'date' ? (v ? new Date(v).getTime() / 864e5 : NaN) : Number(v);
      const missing = !isFinite(x) || v == null || v === '';
      if (missing && m.type !== 'bool') x = m.median;
      row.push(m.type === 'bool' ? x : (x - m.mean) / m.sd);
      if (m.hasMissing) row.push(missing ? 1 : 0);
    }
    return row;
  }
  transform(records) { return records.map(r => this.transformOne(r)); }
  toJSON() { return { spec: this.spec.map(({ get, ...s }) => s), meta: this.meta.map(({ get, ...m }) => m) }; }
  static fromJSON(j, getters = {}) { const e = new Encoder(j.spec.map(s => ({ ...s, get: getters[s.name] }))); e.meta = j.meta.map(m => ({ ...m, get: getters[m.name] })); e.fitted = true; return e; }
}

/* ------------------------------------------------------------- metrics */

export function confusion(yTrue, yPred) {
  let tp = 0, tn = 0, fp = 0, fn = 0;
  yTrue.forEach((t, i) => { const p = yPred[i]; if (t === 1 && p === 1) tp++; else if (t === 0 && p === 0) tn++; else if (t === 0 && p === 1) fp++; else if (t === 1 && p === 0) fn++; });
  return { tp, tn, fp, fn };
}
export function classificationMetrics(yTrue, proba, threshold = 0.5) {
  const yPred = proba.map(p => (p >= threshold ? 1 : 0));
  const c = confusion(yTrue, yPred);
  const n = yTrue.length || 1;
  const accuracy = (c.tp + c.tn) / n;
  const precision = c.tp + c.fp ? c.tp / (c.tp + c.fp) : 0;
  const recall = c.tp + c.fn ? c.tp / (c.tp + c.fn) : 0;
  const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
  const eps = 1e-12;
  const logloss = -yTrue.reduce((a, t, i) => a + (t ? Math.log(Math.max(eps, proba[i])) : Math.log(Math.max(eps, 1 - proba[i]))), 0) / n;
  const base = yTrue.reduce((a, b) => a + b, 0) / n;
  const baselineAccuracy = Math.max(base, 1 - base);
  const brier = yTrue.reduce((a, t, i) => a + (proba[i] - t) ** 2, 0) / n;
  return { n: yTrue.length, accuracy, precision, recall, f1, auc: auc(yTrue, proba), logloss, brier, baselineAccuracy, lift: baselineAccuracy ? accuracy / baselineAccuracy : null, confusion: c };
}
/** ROC AUC via the rank-sum (Mann-Whitney) formulation, ties handled. */
export function auc(yTrue, scores) {
  const pairs = yTrue.map((t, i) => [scores[i], t]).sort((a, b) => a[0] - b[0]);
  let rank = 1, sumPos = 0;
  const nPos = yTrue.filter(t => t === 1).length, nNeg = yTrue.length - nPos;
  if (!nPos || !nNeg) return null;
  for (let i = 0; i < pairs.length;) {
    let j = i;
    while (j < pairs.length && pairs[j][0] === pairs[i][0]) j++;
    const avgRank = (rank + rank + (j - i) - 1) / 2;
    for (let k = i; k < j; k++) if (pairs[k][1] === 1) sumPos += avgRank;
    rank += j - i; i = j;
  }
  return (sumPos - (nPos * (nPos + 1)) / 2) / (nPos * nNeg);
}
export function regressionMetrics(yTrue, yPred) {
  const n = yTrue.length || 1;
  const mean = yTrue.reduce((a, b) => a + b, 0) / n;
  const mae = yTrue.reduce((a, t, i) => a + Math.abs(t - yPred[i]), 0) / n;
  const mse = yTrue.reduce((a, t, i) => a + (t - yPred[i]) ** 2, 0) / n;
  const ssTot = yTrue.reduce((a, t) => a + (t - mean) ** 2, 0);
  const nonzero = yTrue.map((t, i) => [t, yPred[i]]).filter(([t]) => t !== 0);
  const mape = nonzero.length ? (nonzero.reduce((a, [t, p]) => a + Math.abs((t - p) / t), 0) / nonzero.length) * 100 : null;
  const baselineMae = yTrue.reduce((a, t) => a + Math.abs(t - mean), 0) / n;
  return { n: yTrue.length, mae, rmse: Math.sqrt(mse), mape, r2: ssTot ? 1 - (mse * n) / ssTot : null, baselineMae, skill: baselineMae ? 1 - mae / baselineMae : null };
}

/* -------------------------------------------------------------- utilities */
export const mean = a => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
export function median(a) { const s = a.slice().sort((x, y) => x - y); const m = Math.floor(s.length / 2); return s.length ? (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) : 0; }
export function std(a) { const m = mean(a); return a.length > 1 ? Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / (a.length - 1)) : 0; }
export function quantile(a, q) { const s = a.slice().sort((x, y) => x - y); if (!s.length) return 0; const pos = (s.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos); return s[lo] + (s[hi] - s[lo]) * (pos - lo); }
/** Stable hash of a dataset so the engine knows when to retrain. */
export function hashData(obj) {
  const s = JSON.stringify(obj);
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(16);
}
/** Wilson score interval for a proportion (honest uncertainty on small samples). */
export function wilson(successes, n, z = 1.96) {
  if (!n) return [0, 0];
  const p = successes / n, d = 1 + (z * z) / n;
  const c = p + (z * z) / (2 * n), m = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [(c - m) / d, (c + m) / d];
}
