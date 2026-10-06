/* =============================================================================
   Neural Learning Hub — every model the system trains on the company's own data:
   honest held-out test metrics next to a naive baseline, cross-validation, what
   each model pays attention to, how accuracy evolves version by version and in
   real life (logged predictions checked against what actually happened), the
   ranked predictions for today, and back-tested forecasts.
   ========================================================================== */

import { h } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { btn, badge, card, pageHeader, kpiTile, emptyState, callout, listItem, ring, kv } from '../../ui/components.js';
import { dataTable } from '../../ui/table.js';
import { toast, showError } from '../../ui/overlays.js';
import { chart } from '../../ui/charts.js';
import { busy } from '../../ui/components.js';
import { db } from '../../core/db.js';
import { isManager } from '../../core/perms.js';
import * as fmt from '../../core/format.js';
import { allTasks, allForecasts, latestModel, modelHistory, train, predict, logPrediction, liveAccuracy, runForecast, getTask, autoTrain } from '../../ml/engine.js';
import { wilson } from '../../ml/core.js';

const pct = v => (v == null ? '—' : `${(v * 100).toFixed(1)}%`);
const TASK_ICON = { lead_win: 'target', quote_accept: 'file-signature', invoice_late: 'alarm-clock', client_churn: 'heart-crack', job_value: 'shovel' };
const linkFor = (t, r) => ({ leads: `#/leads/l/${encodeURIComponent(r.id)}`, quotes: `#/quotes/q/${encodeURIComponent(r.id)}`, invoices: `#/invoices/i/${encodeURIComponent(r.id)}`, clients: `#/clients/c/${encodeURIComponent(r.id)}` })[t.collection] || `#/record/${t.collection}/${encodeURIComponent(r.id)}`;
const nameOf = r => r.name || r.client_name || r.title || r.number || r.legacy_number || r.id;

function taskCard(t, ctx) {
  const m = latestModel(t.key);
  const labelled = t.labelled().filter(r => { const y = t.target(r); return y === 0 || y === 1 || (t.kind === 'regression' && isFinite(y)); }).length;
  const met = m && m.metrics;
  return h('a.card.solid.hover', { href: `#/intelligence/task/${t.key}`, style: 'display:block;text-decoration:none;color:inherit;padding:18px' },
    h('div.row.gap-8', h('div', { class: ['li-ico', 't-aurora'], style: 'width:40px;height:40px;border-radius:13px;display:grid;place-items:center;color:#fff' }, icon(TASK_ICON[t.key] || 'brain', 20)), h('div', h('strong', t.label), h('div.small.muted', m ? `v${m.version} · ${m.algorithm}` : 'Learning — not enough outcomes yet')), h('div.spacer'),
      m ? badge(`trained ${fmt.relative(m.trained_at)}`, 'green') : badge(`${labelled} / ${t.minRows} outcomes`, 'gold')),
    h('p.small', { style: 'margin:10px 0' }, t.description),
    met ? (t.kind === 'regression'
      ? h('div.row.wrap.gap-8', badge(`MAE ${fmt.money(met.mae)}`, 'violet'), badge(`baseline ${fmt.money(met.baselineMae)}`, 'gray'), met.r2 != null ? badge(`R² ${met.r2.toFixed(2)}`, 'blue') : null)
      : h('div.row.wrap.gap-8', badge(`Accuracy ${pct(met.accuracy)}`, met.accuracy > met.baselineAccuracy ? 'green' : 'gold'), badge(`Baseline ${pct(met.baselineAccuracy)}`, 'gray'), met.auc != null ? badge(`AUC ${met.auc.toFixed(2)}`, met.auc >= 0.7 ? 'green' : 'gold') : null, badge(`${m.n_test} test records`, 'blue')))
      : h('div', h('div.progress', h('i', { style: { width: `${Math.min(100, (labelled / t.minRows) * 100)}%` } })), h('div.small.muted', { style: 'margin-top:6px' }, `${labelled} records with a known outcome so far — it trains itself once there are ${t.minRows} (with at least 4 of each outcome).`)));
}

function hub(ctx) {
  const tasks = allTasks(), fcs = allForecasts();
  const models = db.all('ml_models');
  const trained = tasks.filter(t => latestModel(t.key));
  const resolved = db.filter('predictions', p => p.resolved_at && p.correct != null);
  const ok = resolved.filter(p => p.correct).length;
  const [lo, hi] = wilson(ok, resolved.length);
  const trainAll = async e => busy(e.currentTarget, async () => { try { const res = await autoTrain(); const n = res.filter(r => r.status === 'trained').length; toast.success(n ? `${n} model${n === 1 ? '' : 's'} retrained` : 'Models are up to date', { text: res.filter(r => r.status === 'insufficient').map(r => `${getTask(r.key).label}: waiting for data`).join(' · ') }); ctx.refresh(); } catch (err) { showError(err, 'Training failed'); } });
  return h('div',
    pageHeader({ title: 'Neural Learning Hub', sub: 'Models that learn from your own records, tested honestly on data they have never seen, and retrained as the business grows.', icon: 'brain', tile: 't-aurora',
      actions: [isManager() ? btn({ label: 'Train all now', icon: 'rotate-cw', variant: 'primary', onClick: trainAll }) : null] }),
    h('div.grid.cols-4.stagger', { style: 'margin-bottom:18px' },
      kpiTile({ label: 'Models live', value: `${trained.length} / ${tasks.length}`, icon: 'brain', tile: 't-aurora' }),
      kpiTile({ label: 'Model versions trained', value: models.length, icon: 'git-commit-vertical', tile: 't-violet', foot: 'every retrain is kept' }),
      kpiTile({ label: 'Real-world accuracy', value: resolved.length ? pct(ok / resolved.length) : 'Waiting', icon: 'target', tile: 't-grass', foot: resolved.length ? `${resolved.length} checked · 95% CI ${pct(lo)}–${pct(hi)}` : 'predictions are checked when outcomes arrive' }),
      kpiTile({ label: 'Forecasts', value: fcs.length, icon: 'telescope', tile: 't-sky' })),
    callout('info', 'How the learning works — and why it is honest', h('span', 'Each model uses a seeded ', h('strong', '75 / 25 train–test split'), '. Five-fold cross-validation on the training part chooses between logistic regression, random forest, decision tree, naive Bayes and k-nearest neighbours; the winner is scored ONCE on the untouched test set and compared with a naive baseline. Every prediction is logged and later checked against what really happened. No model can promise 100% — the numbers below are the true measured accuracy, and they improve automatically as more outcomes are captured.'), 'shield-check'),
    h('h3.section-title', { style: 'margin:22px 0 10px' }, 'Prediction models'),
    h('div.grid.cols-2.stagger', tasks.map(t => taskCard(t, ctx))),
    h('h3.section-title', { style: 'margin:22px 0 10px' }, 'Forecasts'),
    h('div.grid.cols-3.stagger', fcs.map(f => { const r = runForecast(f.key); const money = f.unit === 'R'; return h('a.card.solid.hover', { href: `#/intelligence/forecast/${f.key}`, style: 'display:block;padding:18px;text-decoration:none;color:inherit' },
      h('div.row.gap-8', icon('telescope', 18), h('strong', f.label)),
      r && r.status === 'ok' ? h('div', h('div', { style: 'font-size:1.5rem;font-weight:800;margin:8px 0' }, money ? fmt.money(r.forecast[0].value) : Math.round(r.forecast[0].value)), h('div.small.muted', `next month · back-test error ${money ? fmt.money(r.backtest.metrics.mae) : r.backtest.metrics.mae.toFixed(1)} (naive ${money ? fmt.money(r.backtest.naiveMae) : r.backtest.naiveMae.toFixed(1)})`))
        : h('p.small.muted', `Needs ${f.minPoints} months of history — has ${r ? r.n : 0}.`)); })));
}

function taskPage(ctx) {
  const t = getTask(ctx.params.key);
  if (!t) return emptyState({ icon: 'search-x', title: 'Unknown model' });
  const m = latestModel(t.key), hist = modelHistory(t.key), live = liveAccuracy(t.key);
  const met = m && m.metrics;
  const doTrain = e => busy(e.currentTarget, async () => { try { const r = await train(t.key, { force: true }); if (r.status === 'insufficient') toast.info('Not enough data yet', { text: r.message }); else toast.success(`Trained v${r.model.version}: ${r.chosen.label}`); ctx.refresh(); } catch (err) { showError(err, 'Training failed'); } });
  const scored = m ? t.unlabelled().map(r => ({ r, p: predict(t.key, r) })).filter(x => x.p) : [];
  if (m) scored.slice(0, 200).forEach(x => logPrediction(t.key, x.r, x.p).catch(() => {}));
  scored.sort((a, b) => (b.p.probability ?? b.p.value) - (a.p.probability ?? a.p.value));
  return h('div',
    pageHeader({ title: t.label, sub: t.description, icon: TASK_ICON[t.key] || 'brain', tile: 't-aurora', crumbs: [{ label: 'Learning Hub', href: '#/intelligence' }, { label: t.label }],
      actions: [isManager() ? btn({ label: m ? 'Retrain now' : 'Try training', icon: 'rotate-cw', variant: 'primary', onClick: doTrain }) : null] }),
    !m ? callout('warning', 'Still learning', (() => { const rows = t.labelled(); const pos = rows.filter(r => t.target(r) === 1).length, neg = rows.filter(r => t.target(r) === 0).length; return t.kind === 'regression' ? `${rows.length} records with a known value — needs ${t.minRows}.` : `${rows.length} records with a known outcome (${pos} “${t.positive}”, ${neg} “${t.negative}”). Needs ${t.minRows} in total and at least 4 of each. It trains itself automatically as soon as the data is there.`; })(), 'hourglass')
      : h('div.stack',
        h('div.grid.cols-4.stagger',
          t.kind === 'regression'
            ? [kpiTile({ label: 'Average error (test)', value: met.mae, format: 'money', icon: 'crosshair', tile: 't-violet' }), kpiTile({ label: 'Naive baseline error', value: met.baselineMae, format: 'money', icon: 'minus', tile: 't-slate' }), kpiTile({ label: 'R²', value: met.r2 != null ? met.r2.toFixed(2) : '—', icon: 'sigma', tile: 't-sky' }), kpiTile({ label: 'Train / test', value: `${m.n_train} / ${m.n_test}`, icon: 'split', tile: 't-forest' })]
            : [h('div.card.solid', { style: 'display:grid;place-items:center;padding:14px' }, ring((met.accuracy || 0) * 100, { label: pct(met.accuracy), sub: 'test accuracy', color: met.accuracy > met.baselineAccuracy ? 'var(--c2)' : 'var(--c4)' })),
              kpiTile({ label: 'Naive baseline', value: pct(met.baselineAccuracy), icon: 'minus', tile: 't-slate', foot: 'always guessing the most common outcome' }),
              kpiTile({ label: 'ROC AUC', value: met.auc != null ? met.auc.toFixed(3) : '—', icon: 'chart-spline', tile: 't-violet', foot: '0.5 = coin flip · 1.0 = perfect' }),
              kpiTile({ label: 'Train / test records', value: `${m.n_train} / ${m.n_test}`, icon: 'split', tile: 't-forest', foot: `seed ${m.params && m.params.seed}` })]),
        h('div.grid.cols-2',
          card({ title: 'Model selection (5-fold cross-validation on training data)', icon: 'trophy', cls: 'solid' }, h('div.list.divider-list', (met.cv || []).map((c, i) => listItem({ title: c.model, sub: met.cvMetric, icon: i === 0 ? 'crown' : 'circle', tile: i === 0 ? 't-sun' : 't-slate', right: badge(t.kind === 'regression' ? fmt.money(-c.score) + ' MAE' : c.score.toFixed(3), i === 0 ? 'green' : 'gray') })))),
          t.kind !== 'regression' ? card({ title: 'Test-set results', icon: 'grid-2x2-check', cls: 'solid' }, kv([['Correct “' + t.positive + '”', met.confusion.tp], ['Correct “' + t.negative + '”', met.confusion.tn], ['False alarms', met.confusion.fp], ['Missed', met.confusion.fn], ['Precision', pct(met.precision)], ['Recall', pct(met.recall)], ['F1', met.f1.toFixed(3)], ['Brier score', met.brier.toFixed(3)], ['Log loss', met.logloss.toFixed(3)]]))
            : card({ title: 'Test-set results', icon: 'grid-2x2-check', cls: 'solid' }, kv([['MAE', fmt.money(met.mae)], ['RMSE', fmt.money(met.rmse)], ['MAPE', met.mape != null ? fmt.pct(met.mape) : '—'], ['Skill vs baseline', met.skill != null ? pct(met.skill) : '—']]))),
        (m.features || []).length ? card({ title: 'What the model pays attention to', icon: 'scan-eye', cls: 'solid' }, h('div', { style: 'height:280px' }, chart({ type: 'bar', horizontal: true, labels: m.features.map(f => f.feature), series: [{ label: 'Weight', data: m.features.map(f => Number(f.weight.toFixed(4))) }], dispose: ctx.dispose }))) : null,
        h('div.grid.cols-2',
          card({ title: 'How it evolves (every version)', icon: 'git-commit-vertical', cls: 'solid' }, hist.length > 1 ? h('div', { style: 'height:220px' }, chart({ type: 'line', labels: hist.map(v => `v${v.version}`), series: t.kind === 'regression' ? [{ label: 'Test MAE', data: hist.map(v => (v.metrics ? v.metrics.mae : null)) }] : [{ label: 'Test accuracy %', data: hist.map(v => (v.metrics ? v.metrics.accuracy * 100 : null)) }, { label: 'AUC × 100', data: hist.map(v => (v.metrics && v.metrics.auc != null ? v.metrics.auc * 100 : null)) }], dispose: ctx.dispose })) : h('p.small.muted', 'The first version. Each retrain adds a point here so you can watch it improve.')),
          card({ title: 'Real-world accuracy', icon: 'target', cls: 'solid' }, live.length ? h('div', { style: 'height:220px' }, chart({ type: 'bar', labels: live.map(x => x.month), series: [{ label: 'Accuracy %', data: live.map(x => x.accuracy * 100) }], percent: true, dispose: ctx.dispose })) : h('p.small.muted', 'Predictions made today are logged. When the real outcome arrives (a lead is won or lost, an invoice is paid…) it is checked here automatically.')))),
    m ? card({ title: t.kind === 'regression' ? 'Estimates for records without a value' : `Today’s ranking — ${t.positive.toLowerCase()} first`, icon: 'list-ordered', cls: 'solid', style: 'margin-top:16px', body: dataTable({
      columns: [{ key: 'name', label: 'Record', render: x => h('a', { href: linkFor(t, x.r) }, nameOf(x.r)) },
        { key: 'score', label: t.kind === 'regression' ? 'Estimate' : 'Probability', num: true, render: x => (x.p.probability != null ? h('div.row.gap-8', { style: 'justify-content:flex-end' }, h('div.progress', { style: 'width:80px' }, h('i', { style: { width: `${Math.round(x.p.probability * 100)}%` } })), h('strong', `${Math.round(x.p.probability * 100)}%`)) : fmt.money(x.p.value)), sort: x => x.p.probability ?? x.p.value },
        { key: 'drivers', label: 'Why', render: x => h('span.small.muted', (x.p.drivers || []).slice(0, 3).map(d => `${d.feature}${d.effect != null ? (d.effect > 0 ? ' ↑' : ' ↓') : ''}`).join(' · ')) }],
      rows: scored, pageSize: 20, exportName: `predictions-${t.key}` }) }) : null);
}

function forecastPage(ctx) {
  const f = allForecasts().find(x => x.key === ctx.params.key);
  if (!f) return emptyState({ icon: 'search-x', title: 'Unknown forecast' });
  const r = runForecast(f.key); const money = f.unit === 'R';
  const v = x => (money ? fmt.money(x) : fmt.num(x, 1));
  return h('div',
    pageHeader({ title: f.label, sub: f.description, icon: 'telescope', tile: 't-sky', crumbs: [{ label: 'Learning Hub', href: '#/intelligence' }, { label: f.label }] }),
    !r || r.status !== 'ok' ? callout('warning', 'Not enough history yet', `Needs ${f.minPoints} months — has ${r ? r.n : 0}. It will forecast automatically once there is enough data.`, 'hourglass')
      : h('div.stack',
        card({ title: 'History and forecast', icon: 'chart-line', cls: 'solid' }, h('div', { style: 'height:300px' }, chart({ type: 'line', labels: [...r.series.map(p => p.period), ...r.forecast.map((_, i) => `+${i + 1} mo`)], series: [{ label: 'Actual', data: [...r.series.map(p => p.value), ...r.forecast.map(() => null)], fill: true }, { label: 'Forecast', data: [...r.series.map((p, i) => (i === r.series.length - 1 ? p.value : null)), ...r.forecast.map(p => p.value)], dashed: true }, { label: 'Low', data: [...r.series.map(() => null), ...r.forecast.map(p => p.low ?? null)], dashed: true, points: false }, { label: 'High', data: [...r.series.map(() => null), ...r.forecast.map(p => p.high ?? null)], dashed: true, points: false }], money, dispose: ctx.dispose }))),
        h('div.grid.cols-3.stagger',
          kpiTile({ label: 'Next month', value: v(r.forecast[0].value), icon: 'arrow-right', tile: 't-sky' }),
          kpiTile({ label: 'Back-test error', value: v(r.backtest.metrics.mae), icon: 'crosshair', tile: 't-violet', foot: `last ${r.backtest.h} month(s) predicted blind` }),
          kpiTile({ label: 'Naive forecast error', value: v(r.backtest.naiveMae), icon: 'minus', tile: 't-slate', foot: r.backtest.metrics.mae < r.backtest.naiveMae ? 'the model beats the naive guess' : 'too little history to beat a naive guess yet' })),
        callout('info', 'Method', `${r.model.name} (α ${r.model.alpha != null ? r.model.alpha.toFixed(2) : '—'}, β ${r.model.beta != null ? r.model.beta.toFixed(2) : '—'}). Back-tested in time order — the last months are hidden, predicted, then compared with what really happened. Never a random split for time series.`, 'info')));
}

export default {
  id: 'intelligence',
  routes: { '': hub, 'task/:key': taskPage, 'forecast/:key': forecastPage }
};
