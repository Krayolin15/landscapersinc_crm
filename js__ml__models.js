/* =============================================================================
   Models. Every model: fit(X, y) · predict(X) · (classifiers) predictProba(X)
   · toJSON() · static fromJSON(). X is number[][] (from Encoder), y number[].
   Deliberately small, transparent models — with a business this size the data
   is measured in hundreds of rows, where simple regularised models generalise
   better than anything deep.
   ========================================================================== */

import { rng, mean, median } from './core.js';

const sigmoid = z => (z >= 0 ? 1 / (1 + Math.exp(-z)) : Math.exp(z) / (1 + Math.exp(z)));
const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };

/* ------------------------------------------------ logistic regression */
export class LogisticRegression {
  constructor({ lr = 0.1, epochs = 1500, l2 = 0.05, classWeight = 'balanced' } = {}) { Object.assign(this, { lr, epochs, l2, classWeight }); this.name = 'Logistic regression'; }
  fit(X, y) {
    const n = X.length, d = X[0] ? X[0].length : 0;
    const pos = y.filter(v => v === 1).length, neg = n - pos;
    const wPos = this.classWeight === 'balanced' && pos ? n / (2 * pos) : 1, wNeg = this.classWeight === 'balanced' && neg ? n / (2 * neg) : 1;
    let w = new Array(d).fill(0), b = Math.log((pos + 1) / (neg + 1));
    const mw = new Array(d).fill(0), vw = new Array(d).fill(0); let mb = 0, vb = 0;
    const b1 = 0.9, b2 = 0.999, eps = 1e-8;
    for (let t = 1; t <= this.epochs; t++) {
      const gw = new Array(d).fill(0); let gb = 0;
      for (let i = 0; i < n; i++) {
        const err = (sigmoid(dot(w, X[i]) + b) - y[i]) * (y[i] === 1 ? wPos : wNeg);
        for (let j = 0; j < d; j++) gw[j] += err * X[i][j];
        gb += err;
      }
      for (let j = 0; j < d; j++) {
        const g = gw[j] / n + this.l2 * w[j];
        mw[j] = b1 * mw[j] + (1 - b1) * g; vw[j] = b2 * vw[j] + (1 - b2) * g * g;
        w[j] -= this.lr * (mw[j] / (1 - b1 ** t)) / (Math.sqrt(vw[j] / (1 - b2 ** t)) + eps);
      }
      const g = gb / n; mb = b1 * mb + (1 - b1) * g; vb = b2 * vb + (1 - b2) * g * g;
      b -= this.lr * (mb / (1 - b1 ** t)) / (Math.sqrt(vb / (1 - b2 ** t)) + eps);
    }
    this.w = w; this.b = b;
    return this;
  }
  predictProba(X) { return X.map(x => sigmoid(dot(this.w, x) + this.b)); }
  predict(X) { return this.predictProba(X).map(p => (p >= 0.5 ? 1 : 0)); }
  /** Per-feature contribution for one row (explains a prediction). */
  explain(x, names) { return this.w.map((wi, j) => ({ feature: names ? names[j] : j, effect: wi * x[j] })).sort((a, b) => Math.abs(b.effect) - Math.abs(a.effect)); }
  toJSON() { return { type: 'LogisticRegression', w: this.w, b: this.b, l2: this.l2 }; }
  static fromJSON(j) { const m = new LogisticRegression({ l2: j.l2 }); m.w = j.w; m.b = j.b; return m; }
}

/* ------------------------------------------------ ridge (linear) regression */
function solve(A, bvec) {
  const n = A.length, M = A.map((r, i) => [...r, bvec[i]]);
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    if (Math.abs(M[c][c]) < 1e-12) continue;
    for (let r = 0; r < n; r++) { if (r === c) continue; const f = M[r][c] / M[c][c]; for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; }
  }
  return M.map((r, i) => (Math.abs(r[i]) < 1e-12 ? 0 : r[n] / r[i]));
}
export class RidgeRegression {
  constructor({ alpha = 1 } = {}) { this.alpha = alpha; this.name = 'Ridge regression'; }
  fit(X, y) {
    const d = X[0] ? X[0].length : 0;
    const Xa = X.map(r => [1, ...r]);
    const A = Array.from({ length: d + 1 }, (_, i) => Array.from({ length: d + 1 }, (_, j) => Xa.reduce((s, r) => s + r[i] * r[j], 0) + (i === j && i > 0 ? this.alpha : 0)));
    const bv = Array.from({ length: d + 1 }, (_, i) => Xa.reduce((s, r, k) => s + r[i] * y[k], 0));
    const coef = solve(A, bv);
    this.b = coef[0]; this.w = coef.slice(1);
    return this;
  }
  predict(X) { return X.map(x => dot(this.w, x) + this.b); }
  toJSON() { return { type: 'RidgeRegression', w: this.w, b: this.b, alpha: this.alpha }; }
  static fromJSON(j) { const m = new RidgeRegression({ alpha: j.alpha }); m.w = j.w; m.b = j.b; return m; }
}

/* ------------------------------------------------ Gaussian naive Bayes */
export class GaussianNB {
  constructor() { this.name = 'Naive Bayes'; }
  fit(X, y) {
    const d = X[0] ? X[0].length : 0;
    this.stats = [0, 1].map(c => {
      const rows = X.filter((_, i) => y[i] === c);
      const prior = (rows.length + 1) / (X.length + 2);
      const mu = Array.from({ length: d }, (_, j) => mean(rows.map(r => r[j])));
      const v = Array.from({ length: d }, (_, j) => Math.max(1e-3, mean(rows.map(r => (r[j] - mu[j]) ** 2))));
      return { prior, mu, v };
    });
    return this;
  }
  predictProba(X) {
    return X.map(x => {
      const ll = this.stats.map(s => Math.log(s.prior) + x.reduce((a, xi, j) => a - 0.5 * Math.log(2 * Math.PI * s.v[j]) - ((xi - s.mu[j]) ** 2) / (2 * s.v[j]), 0));
      const m = Math.max(...ll);
      const e = ll.map(l => Math.exp(l - m));
      return e[1] / (e[0] + e[1]);
    });
  }
  predict(X) { return this.predictProba(X).map(p => (p >= 0.5 ? 1 : 0)); }
  toJSON() { return { type: 'GaussianNB', stats: this.stats }; }
  static fromJSON(j) { const m = new GaussianNB(); m.stats = j.stats; return m; }
}

/* ------------------------------------------------ k nearest neighbours */
export class KNN {
  constructor({ k = 7, task = 'classification' } = {}) { Object.assign(this, { k, task }); this.name = `k-nearest neighbours (k=${k})`; }
  fit(X, y) { this.X = X; this.y = y; return this; }
  _near(x) {
    return this.X.map((r, i) => [r.reduce((a, v, j) => a + (v - x[j]) ** 2, 0), this.y[i]]).sort((a, b) => a[0] - b[0]).slice(0, Math.min(this.k, this.X.length));
  }
  predictProba(X) { return X.map(x => { const nn = this._near(x); const w = nn.map(([d]) => 1 / (1 + Math.sqrt(d))); return nn.reduce((a, [, v], i) => a + v * w[i], 0) / w.reduce((a, b) => a + b, 0); }); }
  predict(X) { const p = this.predictProba(X); return this.task === 'classification' ? p.map(v => (v >= 0.5 ? 1 : 0)) : p; }
  toJSON() { return { type: 'KNN', k: this.k, task: this.task, X: this.X, y: this.y }; }
  static fromJSON(j) { const m = new KNN({ k: j.k, task: j.task }); m.X = j.X; m.y = j.y; return m; }
}

/* ------------------------------------------------ decision tree (CART) */
export class DecisionTree {
  constructor({ maxDepth = 4, minLeaf = 3, task = 'classification', featureFrac = 1, seed = 1 } = {}) { Object.assign(this, { maxDepth, minLeaf, task, featureFrac, seed }); this.name = 'Decision tree'; }
  _impurity(ys) {
    if (!ys.length) return 0;
    if (this.task === 'classification') { const p = ys.reduce((a, b) => a + b, 0) / ys.length; return 1 - p * p - (1 - p) * (1 - p); }
    const m = mean(ys); return ys.reduce((a, v) => a + (v - m) ** 2, 0) / ys.length;
  }
  _leaf(ys) { return { leaf: true, value: ys.length ? mean(ys) : 0, n: ys.length }; }
  _build(X, y, idx, depth, rand) {
    const ys = idx.map(i => y[i]);
    if (depth >= this.maxDepth || idx.length < 2 * this.minLeaf || this._impurity(ys) === 0) return this._leaf(ys);
    const d = X[0].length;
    let feats = [...Array(d).keys()];
    if (this.featureFrac < 1) feats = feats.filter(() => rand() < this.featureFrac).concat(feats.length ? [Math.floor(rand() * d)] : []);
    let best = null;
    const parent = this._impurity(ys) * idx.length;
    for (const f of new Set(feats)) {
      const vals = [...new Set(idx.map(i => X[i][f]))].sort((a, b) => a - b);
      if (vals.length < 2) continue;
      const step = Math.max(1, Math.floor(vals.length / 24));
      for (let k = 0; k < vals.length - 1; k += step) {
        const thr = (vals[k] + vals[k + 1]) / 2;
        const L = [], R = [];
        for (const i of idx) (X[i][f] <= thr ? L : R).push(i);
        if (L.length < this.minLeaf || R.length < this.minLeaf) continue;
        const gain = parent - this._impurity(L.map(i => y[i])) * L.length - this._impurity(R.map(i => y[i])) * R.length;
        if (!best || gain > best.gain) best = { f, thr, L, R, gain };
      }
    }
    if (!best || best.gain <= 1e-12) return this._leaf(ys);
    this.importance[best.f] = (this.importance[best.f] || 0) + best.gain;
    return { f: best.f, thr: best.thr, left: this._build(X, y, best.L, depth + 1, rand), right: this._build(X, y, best.R, depth + 1, rand) };
  }
  fit(X, y, idx) { this.importance = {}; this.root = this._build(X, y, idx || [...Array(X.length).keys()], 0, rng(this.seed)); return this; }
  _one(x) { let n = this.root; while (!n.leaf) n = x[n.f] <= n.thr ? n.left : n.right; return n.value; }
  predictProba(X) { return X.map(x => this._one(x)); }
  predict(X) { const p = this.predictProba(X); return this.task === 'classification' ? p.map(v => (v >= 0.5 ? 1 : 0)) : p; }
  toJSON() { return { type: 'DecisionTree', task: this.task, root: this.root, importance: this.importance }; }
  static fromJSON(j) { const m = new DecisionTree({ task: j.task }); m.root = j.root; m.importance = j.importance; return m; }
}

/* ------------------------------------------------ random forest */
export class RandomForest {
  constructor({ trees = 60, maxDepth = 5, minLeaf = 2, task = 'classification', seed = 7 } = {}) { Object.assign(this, { nTrees: trees, maxDepth, minLeaf, task, seed }); this.name = `Random forest (${trees} trees)`; }
  fit(X, y) {
    const rand = rng(this.seed);
    const d = X[0] ? X[0].length : 1;
    this.trees = Array.from({ length: this.nTrees }, (_, t) => {
      const idx = Array.from({ length: X.length }, () => Math.floor(rand() * X.length));
      return new DecisionTree({ maxDepth: this.maxDepth, minLeaf: this.minLeaf, task: this.task, featureFrac: Math.max(0.3, Math.sqrt(d) / d), seed: this.seed + t + 1 }).fit(X, y, idx);
    });
    this.importance = {};
    this.trees.forEach(t => Object.entries(t.importance).forEach(([f, g]) => (this.importance[f] = (this.importance[f] || 0) + g)));
    return this;
  }
  predictProba(X) { return X.map(x => mean(this.trees.map(t => t._one(x)))); }
  predict(X) { const p = this.predictProba(X); return this.task === 'classification' ? p.map(v => (v >= 0.5 ? 1 : 0)) : p; }
  toJSON() { return { type: 'RandomForest', task: this.task, trees: this.trees.map(t => t.toJSON()), importance: this.importance }; }
  static fromJSON(j) { const m = new RandomForest({ task: j.task, trees: j.trees.length }); m.trees = j.trees.map(DecisionTree.fromJSON); m.importance = j.importance; return m; }
}

/* ------------------------------------------------ k-means (k-means++) */
export class KMeans {
  constructor({ k = 4, iters = 60, seed = 3 } = {}) { Object.assign(this, { k, iters, seed }); this.name = `k-means (k=${k})`; }
  fit(X) {
    const rand = rng(this.seed);
    const dist = (a, b) => a.reduce((s, v, i) => s + (v - b[i]) ** 2, 0);
    const C = [X[Math.floor(rand() * X.length)]];
    while (C.length < Math.min(this.k, X.length)) {
      const d = X.map(x => Math.min(...C.map(c => dist(x, c))));
      const sum = d.reduce((a, b) => a + b, 0);
      let r = rand() * sum, i = 0;
      while (r > d[i] && i < d.length - 1) { r -= d[i]; i++; }
      C.push(X[i]);
    }
    let labels = [];
    for (let it = 0; it < this.iters; it++) {
      labels = X.map(x => { let b = 0, bd = Infinity; C.forEach((c, j) => { const dd = dist(x, c); if (dd < bd) { bd = dd; b = j; } }); return b; });
      const next = C.map((c, j) => { const pts = X.filter((_, i) => labels[i] === j); return pts.length ? c.map((_, f) => mean(pts.map(p => p[f]))) : c; });
      if (next.every((c, j) => dist(c, C[j]) < 1e-9)) break;
      next.forEach((c, j) => (C[j] = c));
    }
    this.centroids = C; this.labels = labels;
    return this;
  }
  predict(X) { return X.map(x => { let b = 0, bd = Infinity; this.centroids.forEach((c, j) => { const d = c.reduce((s, v, i) => s + (v - x[i]) ** 2, 0); if (d < bd) { bd = d; b = j; } }); return b; }); }
}

/* ------------------------------------------------ time series */
/**
 * Holt's linear exponential smoothing with optional additive seasonality (Holt-Winters).
 * Grid-searches alpha/beta/gamma on one-step-ahead error. forecast(h) returns
 * point forecasts with an approximate 80% interval from in-sample residuals.
 */
export class HoltWinters {
  constructor({ season = 0 } = {}) { this.season = season; this.name = season ? `Holt-Winters (season ${season})` : "Holt's linear trend"; }
  _run(y, a, b, g) {
    const m = this.season;
    let level = y[0], trend = y.length > 1 ? y[1] - y[0] : 0;
    const seas = m && y.length >= 2 * m ? Array.from({ length: m }, (_, i) => y[i] - mean(y.slice(0, m))) : null;
    const fitted = [y[0]];
    for (let t = 1; t < y.length; t++) {
      const s = seas ? seas[t % m] : 0;
      fitted.push(level + trend + s);
      const prevLevel = level;
      level = a * (y[t] - s) + (1 - a) * (level + trend);
      trend = b * (level - prevLevel) + (1 - b) * trend;
      if (seas) seas[t % m] = g * (y[t] - level) + (1 - g) * seas[t % m];
    }
    return { level, trend, seas, fitted };
  }
  fit(y) {
    this.y = y.slice();
    let best = null;
    const grid = [0.1, 0.2, 0.3, 0.5, 0.7, 0.9];
    for (const a of grid) for (const b of [0.01, 0.05, 0.1, 0.2, 0.4]) for (const g of this.season ? [0.1, 0.3, 0.5] : [0]) {
      const r = this._run(y, a, b, g);
      const sse = y.slice(1).reduce((s, v, i) => s + (v - r.fitted[i + 1]) ** 2, 0);
      if (!best || sse < best.sse) best = { a, b, g, sse, r };
    }
    Object.assign(this, { alpha: best.a, beta: best.b, gamma: best.g, state: best.r });
    const resid = y.slice(1).map((v, i) => v - best.r.fitted[i + 1]);
    this.sigma = Math.sqrt(resid.reduce((s, e) => s + e * e, 0) / Math.max(1, resid.length - 1));
    return this;
  }
  forecast(h = 3) {
    const { level, trend, seas } = this.state;
    const n = this.y.length, m = this.season;
    return Array.from({ length: h }, (_, i) => {
      const v = level + (i + 1) * trend + (seas ? seas[(n + i) % m] : 0);
      const band = 1.28 * this.sigma * Math.sqrt(1 + i * 0.5);
      return { step: i + 1, value: v, low: v - band, high: v + band };
    });
  }
}

/** Robust anomaly score: |x - median| / (1.4826 * MAD). > 3.5 is a strong outlier. */
export function robustZ(values) {
  const med = median(values);
  const mad = median(values.map(v => Math.abs(v - med))) * 1.4826 || 1e-9;
  return values.map(v => (v - med) / mad);
}

export function fromJSON(j) {
  switch (j.type) {
    case 'LogisticRegression': return LogisticRegression.fromJSON(j);
    case 'RidgeRegression': return RidgeRegression.fromJSON(j);
    case 'GaussianNB': return GaussianNB.fromJSON(j);
    case 'KNN': return KNN.fromJSON(j);
    case 'DecisionTree': return DecisionTree.fromJSON(j);
    case 'RandomForest': return RandomForest.fromJSON(j);
    default: throw new Error('Unknown model type ' + j.type);
  }
}
