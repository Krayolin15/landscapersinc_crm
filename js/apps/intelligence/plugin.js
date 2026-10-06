import { registerAction } from '../../core/search.js';
import { registerSkill } from '../../ai/skills.js';
import { registerBusinessModels } from './tasks.js';
import { scheduleAutoTrain, allTasks, latestModel, predict, runForecast, allForecasts } from '../../ml/engine.js';
import { formatMoney } from '../../core/money.js';
import { whenLeader } from '../../core/leader.js';

export default function () {
  registerBusinessModels();
  if (typeof window !== 'undefined') whenLeader(scheduleAutoTrain); // one tab trains; the others read the saved models
  registerAction({ id: 'ml-hub', label: 'Neural Learning Hub — models, accuracy and forecasts', icon: 'brain', keywords: 'machine learning ai model predict forecast accuracy', app: 'intelligence', run: () => (location.hash = '#/intelligence') });
  registerSkill({
    id: 'ml-predict', app: 'intelligence', label: 'Predictions & forecasts',
    examples: ['which leads are most likely to win', 'forecast income next month', 'which clients might leave', 'how accurate are the models'],
    keywords: ['predict', 'prediction', 'forecast', 'likely', 'model', 'accuracy', 'accurate', 'might leave', 'churn', 'risk'],
    run: q => {
      const low = q.toLowerCase();
      if (/forecast|next month|next quarter|income|revenue|enquir/.test(low) && !/lead.*win|likely to win/.test(low)) {
        const key = /cost|expens/.test(low) ? 'costs_monthly' : /lead|enquir/.test(low) ? 'leads_monthly' : 'income_monthly';
        const f = runForecast(key); const def = allForecasts().find(x => x.key === key);
        if (!f || f.status !== 'ok') return { text: `Not enough history yet to forecast ${def ? def.label.toLowerCase() : key} (${f ? f.n : 0} months; needs ${def ? def.minPoints : 6}).`, actions: [{ label: 'Open the Learning Hub', href: '#/intelligence' }] };
        const money = def.unit === 'R';
        return { text: `${def.label} forecast: ${f.forecast.map(p => (money ? formatMoney(p.value) : Math.round(p.value))).join(', ')} for the next ${f.forecast.length} months. Back-test error ${money ? formatMoney(f.backtest.metrics.mae) : f.backtest.metrics.mae.toFixed(1)} vs ${money ? formatMoney(f.backtest.naiveMae) : f.backtest.naiveMae.toFixed(1)} for a naive guess.`,
          cards: [{ type: 'chart', chart: { type: 'line', labels: [...f.series.map(p => p.period), ...f.forecast.map((_, i) => `+${i + 1}`)], series: [{ label: 'Actual', data: [...f.series.map(p => p.value), ...f.forecast.map(() => null)] }, { label: 'Forecast', data: [...f.series.map(() => null), ...f.forecast.map(p => p.value)] }], money } }], actions: [{ label: 'See the model', href: `#/intelligence/forecast/${key}` }] };
      }
      const key = /client|leave|churn|retention/.test(low) ? 'client_churn' : /quote/.test(low) ? 'quote_accept' : /invoice|late|pay/.test(low) ? 'invoice_late' : /accura|model/.test(low) ? null : 'lead_win';
      if (!key) {
        const rows = allTasks().map(t => { const m = latestModel(t.key); return { model: t.label, status: m ? `v${m.version} · ${m.algorithm}` : 'learning (not enough data yet)', test: m && m.metrics ? (m.metrics.accuracy != null ? `${(m.metrics.accuracy * 100).toFixed(0)}% acc · AUC ${m.metrics.auc != null ? m.metrics.auc.toFixed(2) : '—'} (baseline ${(m.metrics.baselineAccuracy * 100).toFixed(0)}%)` : `MAE ${formatMoney(m.metrics.mae)}`) : '—' }; });
        return { text: 'Every model is scored on a held-out test set it never saw during training, and compared with a naive baseline.', cards: [{ type: 'table', columns: [{ key: 'model', label: 'Model' }, { key: 'status', label: 'Version' }, { key: 'test', label: 'Test result' }], rows }], actions: [{ label: 'Open the Learning Hub', href: '#/intelligence' }] };
      }
      const t = allTasks().find(x => x.key === key); const m = latestModel(key);
      if (!m) return { text: `The “${t.label}” model is still learning — it needs more records with a known outcome before it can make honest predictions.`, actions: [{ label: 'Open the Learning Hub', href: `#/intelligence/task/${key}` }] };
      const scored = t.unlabelled().map(r => ({ r, p: predict(key, r) })).filter(x => x.p).sort((a, b) => (b.p.probability ?? b.p.value) - (a.p.probability ?? a.p.value)).slice(0, 10);
      return { text: `Top ${scored.length} by “${t.label}” (model v${m.version}, test AUC ${m.metrics && m.metrics.auc != null ? m.metrics.auc.toFixed(2) : '—'}, accuracy ${m.metrics ? (m.metrics.accuracy * 100).toFixed(0) : '—'}% on ${m.n_test} unseen records).`,
        cards: [{ type: 'list', items: scored.map(x => ({ title: `${x.r.name || x.r.client_name || x.r.title || x.r.number} — ${x.p.probability != null ? Math.round(x.p.probability * 100) + '%' : formatMoney(x.p.value)}`, sub: (x.p.drivers || []).map(d => d.feature || d).join(', '), href: `#/record/${t.collection}/${encodeURIComponent(x.r.id)}`, icon: 'sparkles' })) }], actions: [{ label: 'Model details', href: `#/intelligence/task/${key}` }] };
    }
  });
}
