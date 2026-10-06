/* =============================================================================
   Intelligence engine — how the system learns from its own data over time.

   1. Apps define prediction TASKS (defineTask) and FORECASTS (defineForecast).
   2. train(key):
        · builds the dataset from live records whose outcome is known
        · seeded, stratified TRAIN / TEST split (default 75 / 25)
        · 5-fold cross-validation on the TRAIN set only picks the best model
        · the chosen model is refitted on TRAIN and scored ONCE on the untouched
          TEST set — those are the honest metrics shown to people
        · compared with a naive baseline, so "accuracy" is never flattering
        · saved as a new version in `ml_models` (history is kept)
   3. predict(key, record) scores new records; every prediction is logged.
   4. When the real outcome arrives (invoice paid, lead won/lost...), the logged
      prediction is resolved: live accuracy is tracked month by month.
   5. autoTrain() retrains when enough new outcomes exist or the model is stale
      — so predictions evolve as the company's data grows.
   Forecasts use a time-ordered back-test (never a random split).
   ========================================================================== */

import { CONFIG } from '../config.js';
import { db } from '../core/db.js';
import { bus } from '../core/bus.js';
import { Encoder, trainTestSplit, kFold, classificationMetrics, regressionMetrics, hashData, mean } from './core.js';
import { LogisticRegression, RidgeRegression, GaussianNB, KNN, DecisionTree, RandomForest, HoltWinters, fromJSON } from './models.js';

const tasks = new Map();
const forecasts = new Map();
const cache = new Map(); // key -> { model, encoder, rec }

const CANDIDATES = {
  classification: {
    logistic: () => new LogisticRegression(),
    forest: () => new RandomForest({ task: 'classification' }),
    tree: () => new DecisionTree({ task: 'classification', maxDepth: 3 }),
    nb: () => new GaussianNB(),
    knn: () => new KNN({ k: 7 })
  },
  regression: {
    ridge: () => new RidgeRegression({ alpha: 1 }),
    forest: () => new RandomForest({ task: 'regression', trees: 60, maxDepth: 5 }),
    knn: () => new KNN({ k: 5, task: 'regression' })
  }
};

/**
 * defineTask({
 *   key, label, description, kind:'classification'|'regression', app,
 *   features: [{ name, type:'num'|'cat'|'bool'|'date', get?(rec) }],
 *   labelled(): records whose outcome is known,
 *   target(rec): 0/1 (classification) or number,
 *   unlabelled(): records to score now,
 *   collection: 'invoices' (for linking predictions),
 *   positive: 'Paid late', negative: 'Paid on time', unit: 'R' | 'days' ...,
 *   minRows: 20, candidates: ['logistic','forest',...]
 * })
 */
export function defineTask(t) { tasks.set(t.key, { minRows: 20, candidates: Object.keys(CANDIDATES[t.kind || 'classification']), kind: 'classification', ...t }); }
export function defineForecast(f) { forecasts.set(f.key, { horizon: 3, season: 0, minPoints: 6, ...f }); }
export const allTasks = () => Array.from(tasks.values());
export const allForecasts = () => Array.from(forecasts.values());
export const getTask = k => tasks.get(k);

export function latestModel(key) {
  return db.all('ml_models').filter(m => m.key === key && m.active !== false).sort((a, b) => (b.version || 0) - (a.version || 0))[0] || null;
}
export function modelHistory(key) { return db.all('ml_models').filter(m => m.key === key).sort((a, b) => (a.version || 0) - (b.version || 0)); }

function datasetFor(t) {
  const rows = t.labelled().filter(r => { const y = t.target(r); return y !== null && y !== undefined && (t.kind === 'regression' ? isFinite(y) : y === 0 || y === 1); });
  return { rows, y: rows.map(r => Number(t.target(r))) };
}

// let the page breathe between cross-validation fits (each is a few ms; together they were one long freeze)
const breathe = () => new Promise(r => setTimeout(r, 0));

/** Train (or re-train) a task. Returns a summary; never throws for "not enough data". */
export async function train(key, { seed = CONFIG.ml.seed, testSize = CONFIG.ml.testSize, force = false } = {}) {
  const t = tasks.get(key);
  if (!t) throw new Error(`Unknown task ${key}`);
  const { rows, y } = datasetFor(t);
  const dataHash = hashData(rows.map(r => [r.id, t.target(r), ...t.features.map(f => (f.get ? f.get(r) : r[f.name]))]));
  const prev = latestModel(key);
  if (!force && prev && prev.data_hash === dataHash) return { status: 'unchanged', model: prev };

  const classes = t.kind === 'classification' ? [y.filter(v => v === 1).length, y.filter(v => v === 0).length] : null;
  if (rows.length < t.minRows || (classes && Math.min(...classes) < 4)) {
    return { status: 'insufficient', n: rows.length, needed: t.minRows, classes, message: `Needs at least ${t.minRows} records with a known outcome${classes ? ' and at least 4 of each outcome' : ''} — has ${rows.length}${classes ? ` (${classes[0]} ${t.positive || 'yes'}, ${classes[1]} ${t.negative || 'no'})` : ''}. The model will train itself automatically as data is captured.` };
  }

  // 1. split (the test set is never seen during model selection)
  const encoder = new Encoder(t.features);
  const split = trainTestSplit(rows, y, { testSize, seed, stratify: t.kind === 'classification' });
  encoder.fit(split.Xtrain);
  const Xtr = encoder.transform(split.Xtrain), Xte = encoder.transform(split.Xtest);

  // 2. choose a model by k-fold cross-validation on the training set
  const pool = CANDIDATES[t.kind];
  const folds = kFold(split.ytrain, Math.min(5, Math.max(2, Math.floor(split.ytrain.length / 6))), seed);
  const scored = [];
  for (const name of t.candidates) {
    const make = pool[name];
    if (!make) continue;
    const cvScores = [];
    for (const f of folds) {
      if (!f.test.length || !f.train.length) continue;
      const trY = f.train.map(i => split.ytrain[i]);
      if (t.kind === 'classification' && new Set(trY).size < 2) continue;
      await breathe();
      const m = make().fit(f.train.map(i => Xtr[i]), trY);
      const teY = f.test.map(i => split.ytrain[i]);
      if (t.kind === 'classification') { const p = m.predictProba(f.test.map(i => Xtr[i])); const met = classificationMetrics(teY, p); cvScores.push(met.auc ?? met.accuracy); }
      else { const p = m.predict(f.test.map(i => Xtr[i])); cvScores.push(-regressionMetrics(teY, p).mae); }
    }
    if (cvScores.length) scored.push({ name, label: make().name, cv: mean(cvScores) });
  }
  scored.sort((a, b) => b.cv - a.cv);
  const chosen = scored[0];
  if (!chosen) return { status: 'insufficient', n: rows.length, message: 'Could not form valid cross-validation folds yet.' };

  // 3. refit on the full training set, evaluate once on the held-out test set
  await breathe();
  const model = pool[chosen.name]().fit(Xtr, split.ytrain);
  let metrics;
  if (t.kind === 'classification') metrics = classificationMetrics(split.ytest, model.predictProba(Xte));
  else metrics = regressionMetrics(split.ytest, model.predict(Xte));
  metrics.cv = scored.map(s => ({ model: s.label, score: s.cv }));
  metrics.cvMetric = t.kind === 'classification' ? 'ROC AUC (higher is better)' : 'negative MAE (higher is better)';

  // 4. feature importance / weights for transparency
  const names = encoder.names;
  let importance = [];
  if (model.w) importance = model.w.map((w, i) => ({ feature: names[i], weight: w })).sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight)).slice(0, 12);
  else if (model.importance) importance = Object.entries(model.importance).map(([i, g]) => ({ feature: names[+i], weight: g })).sort((a, b) => b.weight - a.weight).slice(0, 12);

  // 5. version and save
  const version = (prev ? prev.version || 0 : 0) + 1;
  if (prev) await db.update('ml_models', prev.id, { active: false }, { skipValidate: true, silent: true });
  const rec = await db.insert('ml_models', {
    key, version, algorithm: chosen.label, params: { model: model.toJSON(), encoder: encoder.toJSON(), seed, testSize },
    metrics, features: importance, n_train: Xtr.length, n_test: Xte.length, trained_at: new Date().toISOString(), data_hash: dataHash, active: true,
    notes: `${t.label}: ${Xtr.length} training / ${Xte.length} test records (seed ${seed}).`
  }, { skipValidate: true, silent: true });
  cache.delete(key);
  bus.emit('ml:trained', { key, version, metrics });
  return { status: 'trained', model: rec, metrics, chosen, scored };
}

function load(key) {
  if (cache.has(key)) return cache.get(key);
  const t = tasks.get(key), m = latestModel(key);
  if (!t || !m || !m.params) return null;
  const getters = Object.fromEntries(t.features.filter(f => f.get).map(f => [f.name, f.get]));
  const entry = { model: fromJSON(m.params.model), encoder: Encoder.fromJSON(m.params.encoder, getters), rec: m };
  cache.set(key, entry);
  return entry;
}

/** Score one record: { value, probability?, label, drivers, model_version } or null if untrained. */
export function predict(key, rec) {
  const t = tasks.get(key), e = load(key);
  if (!t || !e) return null;
  const x = e.encoder.transformOne(rec);
  if (t.kind === 'classification') {
    const p = e.model.predictProba([x])[0];
    const drivers = e.model.explain ? e.model.explain(x, e.encoder.names).slice(0, 4) : [];
    return { probability: p, value: p >= 0.5 ? 1 : 0, label: p >= 0.5 ? t.positive || 'Yes' : t.negative || 'No', drivers, model_version: e.rec.version, auc: e.rec.metrics && e.rec.metrics.auc };
  }
  const v = e.model.predict([x])[0];
  const mae = e.rec.metrics ? e.rec.metrics.mae : null;
  return { value: v, low: mae != null ? v - mae : null, high: mae != null ? v + mae : null, model_version: e.rec.version, mae };
}

/** Log a prediction so it can later be checked against what really happened. */
export async function logPrediction(key, rec, pred) {
  const t = tasks.get(key);
  if (!pred || !t || !t.collection) return;
  const existing = db.find('predictions', p => p.model_key === key && p.record_id === rec.id && p.model_version === pred.model_version && !p.resolved_at);
  if (existing) return existing;
  return db.insert('predictions', { model_key: key, model_version: pred.model_version, record_collection: t.collection, record_id: rec.id, value: pred.value, probability: pred.probability ?? null }, { skipValidate: true, silent: true });
}

/** Resolve logged predictions whose true outcome is now known. */
export async function resolvePredictions(key) {
  const t = tasks.get(key);
  if (!t || !t.collection) return 0;
  let n = 0;
  const at = new Date().toISOString();
  const changes = [];
  for (const p of db.all('predictions').filter(x => x.model_key === key && !x.resolved_at)) {
    const rec = db.get(t.collection, p.record_id);
    if (!rec) continue;
    const y = t.target(rec);
    if (y === null || y === undefined) continue;
    const correct = t.kind === 'classification' ? Number(p.value) === Number(y) : null;
    changes.push({ id: p.id, patch: { actual: y, resolved_at: at, correct } });
    n++;
  }
  if (changes.length) await db.updateMany('predictions', changes); // one save instead of one per prediction
  return n;
}

/** Live (real-world) accuracy by month, from resolved predictions. */
export function liveAccuracy(key) {
  const rows = db.all('predictions').filter(p => p.model_key === key && p.resolved_at && p.correct != null);
  const byMonth = {};
  rows.forEach(p => { const m = String(p.resolved_at).slice(0, 7); (byMonth[m] = byMonth[m] || { n: 0, ok: 0 }); byMonth[m].n++; if (p.correct) byMonth[m].ok++; });
  return Object.entries(byMonth).sort().map(([month, v]) => ({ month, n: v.n, accuracy: v.ok / v.n }));
}

/** Forecast a series with a time-ordered back-test. */
export function runForecast(key) {
  const f = forecasts.get(key);
  if (!f) return null;
  const series = f.series().filter(p => p && isFinite(p.value));
  if (series.length < f.minPoints) return { status: 'insufficient', n: series.length, needed: f.minPoints, series };
  const y = series.map(p => p.value);
  const h = Math.min(f.horizon, Math.max(1, Math.floor(y.length / 4)));
  // back-test: fit on all but the last h points, forecast them, compare with a naive "last value" forecast
  const bt = new HoltWinters({ season: f.season && y.length - h >= 2 * f.season ? f.season : 0 }).fit(y.slice(0, -h));
  const btPred = bt.forecast(h).map(p => p.value);
  const actual = y.slice(-h);
  const metrics = regressionMetrics(actual, btPred);
  const naive = regressionMetrics(actual, actual.map(() => y[y.length - h - 1]));
  const model = new HoltWinters({ season: f.season && y.length >= 2 * f.season ? f.season : 0 }).fit(y);
  return { status: 'ok', series, forecast: model.forecast(f.horizon), backtest: { h, predicted: btPred, actual, metrics, naiveMae: naive.mae }, model: { name: model.name, alpha: model.alpha, beta: model.beta, gamma: model.gamma } };
}

// Collections the models and forecasts learn from (js/apps/intelligence/tasks.js). Saves anywhere
// else (tasks, notes, calendar, chat…) cannot change a model, so they don't trigger retraining.
const TRAINS_ON = new Set(['leads', 'quotes', 'invoices', 'payments', 'clients', 'contracts', 'jobs', 'expenses', 'financial_periods', 'visits', 'sites']);
let trainData = 0;                 // bumps whenever one of those collections changes
const settled = new Map();         // task key -> trainData when it was last found unchanged / not trainable yet

/** Retrain stale models; called on app start (idle) and after data changes. */
export async function autoTrain() {
  const out = [];
  for (const t of tasks.values()) {
    const m = latestModel(t.key);
    const stale = !m || (Date.now() - new Date(m.trained_at).getTime()) / 864e5 >= CONFIG.ml.retrainEveryDays;
    const { rows } = datasetFor(t);
    const grown = m && rows.length - (m.n_train + m.n_test) >= CONFIG.ml.retrainAfterNewRecords;
    // nothing it learns from has changed since it was last checked: skip re-hashing every run
    if ((!m || stale || grown) && settled.get(t.key) !== trainData) {
      const seen = trainData;
      try {
        const r = await train(t.key);
        if (r.status === 'unchanged' || r.status === 'insufficient') settled.set(t.key, seen); else settled.delete(t.key);
        out.push({ key: t.key, ...r });
      } catch (e) { out.push({ key: t.key, status: 'error', message: e.message }); }
    }
    try { await resolvePredictions(t.key); } catch { /* ignore */ }
  }
  return out;
}

export function scheduleAutoTrain() {
  const run = () => (window.requestIdleCallback || setTimeout)(() => autoTrain().catch(e => console.warn('[ml]', e)), { timeout: 8000 });
  setTimeout(run, 12000);
  let t;
  bus.on('db:change', ({ col }) => { if (!TRAINS_ON.has(col)) return; trainData++; clearTimeout(t); t = setTimeout(run, 60000); });
}
