// Core library tests:  node tests__core.test.js
import assert from 'node:assert/strict';
import { toCents, lineTotal, documentTotals, sum, formatMoney, vatInclusive, allocate, parseMoney } from '../js__core__money.js';
import { publicHolidays, easterSunday, isWorkingDay, observances } from '../js__core__holidays.js';
import { saIdInfo, isPhone, isEmail, isCompanyReg, luhnValid, validateRecord, RULES } from '../js__core__validate.js';
import { addMonths, diffDays, startOfWeek, monthGrid, parseLoose, isoWeek } from '../js__core__dates.js';
import { occurrences } from '../js__core__recurrence.js';
import { trainTestSplit, kFold, classificationMetrics, regressionMetrics, auc, Encoder, wilson } from '../js__ml__core.js';
import { LogisticRegression, RidgeRegression, RandomForest, GaussianNB, HoltWinters, robustZ, DecisionTree } from '../js__ml__models.js';

let passed = 0, failed = 0;
const t = (name, fn) => { try { fn(); passed++; } catch (e) { failed++; console.error('✗', name, '\n ', e.message); } };

// ---------------- money ----------------
t('parse invoice amounts', () => { assert.equal(toCents('R9000.00'), 900000); assert.equal(toCents('R 1 234,50'), 123450); assert.equal(toCents('(150.00)'), -15000); assert.equal(parseMoney('R23,000.00'), 23000); });
t('unrounded per-visit rate rule: 4 × R630.315 = R2,521.26', () => assert.equal(lineTotal(4, 630.315), 2521.26));
t('float-safe sums', () => { assert.equal(sum([0.1, 0.2]), 0.3); assert.equal(sum([9000, 4000, 4000, 6000]), 23000); });
t('discount line', () => assert.equal(lineTotal(3, 150, 10), 405));
t('document totals without VAT', () => assert.deepEqual(documentTotals([{ qty: 1, unit_price: 9000 }, { qty: 1, unit_price: 4000 }]), { subtotal: 13000, discount: 0, net: 13000, vat: 0, total: 13000 }));
t('document totals with 15% VAT', () => assert.equal(documentTotals([{ qty: 2, unit_price: 150 }], { vatRegistered: true }).total, 345));
t('vat inclusive split adds back exactly', () => { const v = vatInclusive(1000); assert.equal(Math.round((v.net + v.vat) * 100), 100000); });
t('allocate adds up', () => { const a = allocate(100, 3); assert.equal(Math.round(a.reduce((x, y) => x + y, 0) * 100), 10000); });
t('money format', () => { assert.equal(formatMoney(89871.74), 'R89,871.74'); assert.equal(formatMoney(-450), '-R450.00'); });

// ---------------- holidays (SA, 2026) ----------------
t('Easter 2026 is 5 April', () => assert.equal(easterSunday(2026), '2026-04-05'));
t('Easter 2027 is 28 March', () => assert.equal(easterSunday(2027), '2027-03-28'));
t('2026 public holidays', () => {
  const h = publicHolidays(2026).map(x => `${x.date} ${x.name}`);
  for (const e of ["2026-01-01 New Year's Day", '2026-03-21 Human Rights Day', '2026-04-03 Good Friday', '2026-04-06 Family Day', '2026-04-27 Freedom Day', "2026-05-01 Workers' Day", '2026-06-16 Youth Day', "2026-08-09 National Women's Day", "2026-08-10 National Women's Day (observed)", '2026-09-24 Heritage Day', '2026-12-16 Day of Reconciliation', '2026-12-25 Christmas Day', '2026-12-26 Day of Goodwill']) assert.ok(h.includes(e), 'missing ' + e);
  assert.equal(h.length, 13);
});
t('2027: Christmas on Saturday, Day of Goodwill Sunday -> Monday 27 Dec', () => { const h = publicHolidays(2027).map(x => x.date); assert.ok(h.includes('2027-12-27')); });
t('working days', () => { assert.equal(isWorkingDay('2026-09-24'), false); assert.equal(isWorkingDay('2026-09-25'), true); assert.equal(isWorkingDay('2026-09-26'), false); });
t('Arbor week present', () => assert.ok(observances(2026).some(o => o.name === 'Arbor Week')));

// ---------------- validation ----------------
t('Luhn', () => { assert.ok(luhnValid('79927398713')); assert.ok(!luhnValid('79927398710')); });
t('SA ID valid sample', () => { const r = saIdInfo('8001015009087'); assert.ok(r.valid, r.reason); assert.equal(r.birthDate, '1980-01-01'); assert.equal(r.gender, 'Male'); });
t('SA ID bad checksum', () => assert.equal(saIdInfo('8001015009088').valid, false));
t('SA ID bad date', () => assert.equal(saIdInfo('8013015009087').valid, false));
t('phones', () => { assert.ok(isPhone('069 131 5387')); assert.ok(isPhone('+27691315387')); assert.ok(!isPhone('12345')); });
t('email', () => { assert.ok(isEmail('accounts@landscapersinc.co.za')); assert.ok(!isEmail('accounts@landscapersinc.')); });
t('company reg', () => { assert.ok(isCompanyReg('2024/786147/07')); assert.ok(!isCompanyReg('2024/78614/07')); });
t('record validation + rules', () => {
  const def = { fields: { name: { type: 'text', required: true }, start: { type: 'date' }, end: { type: 'date' }, phone: { type: 'phone' } }, rules: [RULES.dateOrder('start', 'end')] };
  const r = validateRecord(def, { name: '', start: '2026-09-10', end: '2026-09-01', phone: '123' });
  assert.ok(!r.ok); assert.ok(r.errors.name && r.errors.end && r.errors.phone);
});

// ---------------- dates / recurrence ----------------
t('addMonths clamps 31 Jan -> 28 Feb', () => assert.equal(addMonths('2026-01-31', 1), '2026-02-28'));
t('diffDays', () => assert.equal(diffDays('2026-09-01', '2026-09-10'), 9));
t('week starts Monday', () => assert.equal(startOfWeek('2026-09-10'), '2026-09-07'));
t('month grid 42 cells starting Monday', () => { const g = monthGrid(2026, 8); assert.equal(g.length, 42); assert.equal(g[0], '2026-08-31'); });
t('loose parse SA formats', () => { assert.equal(parseLoose('21 July 2026'), '2026-07-21'); assert.equal(parseLoose('22/05/2026'), '2026-05-22'); assert.equal(parseLoose('2026-08-04'), '2026-08-04'); });
t('iso week', () => assert.equal(isoWeek('2026-01-01'), 1));
t('Wayne meeting on 10 Sep shows on 10 Sep', () => { const o = occurrences({ id: 'e1', start_date: '2026-09-10', start_time: '10:00', title: 'Meeting' }, '2026-09-01', '2026-09-30'); assert.equal(o.length, 1); assert.equal(o[0].date, '2026-09-10'); });
t('weekly recurrence', () => { const o = occurrences({ id: 'e2', start_date: '2026-09-07', recurrence: 'weekly' }, '2026-09-01', '2026-09-30'); assert.deepEqual(o.map(x => x.date), ['2026-09-07', '2026-09-14', '2026-09-21', '2026-09-28']); });
t('monthly on the 31st clamps', () => { const o = occurrences({ id: 'e3', start_date: '2026-01-31', recurrence: 'monthly' }, '2026-01-01', '2026-04-30'); assert.deepEqual(o.map(x => x.date), ['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']); });
t('2nd Tuesday monthly', () => { const o = occurrences({ id: 'e4', start_date: '2026-09-08', recurrence: 'monthly_nth' }, '2026-09-01', '2026-11-30'); assert.deepEqual(o.map(x => x.date), ['2026-09-08', '2026-10-13', '2026-11-10']); });
t('weekdays skip weekend + until', () => { const o = occurrences({ id: 'e5', start_date: '2026-09-11', recurrence: 'weekdays', recurrence_until: '2026-09-15' }, '2026-09-01', '2026-09-30'); assert.deepEqual(o.map(x => x.date), ['2026-09-11', '2026-09-14', '2026-09-15']); });

// ---------------- ML ----------------
t('split is stratified and disjoint', () => {
  const X = Array.from({ length: 40 }, (_, i) => [i]), y = X.map(([i]) => (i % 4 === 0 ? 1 : 0));
  const s = trainTestSplit(X, y, { testSize: 0.25, seed: 5 });
  assert.equal(s.trainIdx.length + s.testIdx.length, 40);
  assert.equal(new Set([...s.trainIdx, ...s.testIdx]).size, 40);
  assert.equal(s.ytest.filter(v => v === 1).length, 3); // 25% of 10 positives rounds to 3 (2.5 -> 3)
});
t('split reproducible with same seed', () => { const X = Array.from({ length: 30 }, (_, i) => [i]), y = X.map(() => 1); assert.deepEqual(trainTestSplit(X, y, { seed: 9 }).testIdx, trainTestSplit(X, y, { seed: 9 }).testIdx); });
t('kfold covers all', () => { const f = kFold(Array.from({ length: 23 }, (_, i) => i % 2), 5); assert.equal(f.reduce((a, x) => a + x.test.length, 0), 23); });
t('AUC perfect / inverted / ties', () => { assert.equal(auc([0, 0, 1, 1], [0.1, 0.2, 0.8, 0.9]), 1); assert.equal(auc([0, 0, 1, 1], [0.9, 0.8, 0.2, 0.1]), 0); assert.equal(auc([0, 1], [0.5, 0.5]), 0.5); });
t('logistic learns a separable problem', () => {
  const X = [], y = [];
  for (let i = 0; i < 120; i++) { const a = (i % 12) - 6, b = ((i * 7) % 11) - 5; X.push([a, b]); y.push(a + 0.5 * b > 0 ? 1 : 0); }
  const s = trainTestSplit(X, y, { seed: 3 });
  const m = new LogisticRegression().fit(s.Xtrain, s.ytrain);
  const met = classificationMetrics(s.ytest, m.predictProba(s.Xtest));
  assert.ok(met.accuracy >= 0.9, 'accuracy ' + met.accuracy); assert.ok(met.auc >= 0.95);
});
t('forest + tree + NB beat baseline on nonlinear data', () => {
  const X = [], y = [];
  for (let i = 0; i < 200; i++) { const a = ((i * 13) % 20) / 2 - 5, b = ((i * 29) % 20) / 2 - 5; X.push([a, b]); y.push(a * a + b * b < 9 ? 1 : 0); }
  const s = trainTestSplit(X, y, { seed: 11 });
  for (const M of [RandomForest, DecisionTree]) { const m = new M({ task: 'classification', maxDepth: 6 }).fit(s.Xtrain, s.ytrain); const met = classificationMetrics(s.ytest, m.predictProba(s.Xtest)); assert.ok(met.accuracy > met.baselineAccuracy, M.name + ' ' + met.accuracy); }
  const nb = new GaussianNB().fit(s.Xtrain, s.ytrain); assert.ok(classificationMetrics(s.ytest, nb.predictProba(s.Xtest)).auc > 0.6);
});
t('ridge recovers linear coefficients', () => {
  const X = Array.from({ length: 50 }, (_, i) => [i / 10, (i % 7) / 3]), y = X.map(([a, b]) => 3 * a - 2 * b + 5);
  const m = new RidgeRegression({ alpha: 1e-6 }).fit(X, y);
  assert.ok(Math.abs(m.w[0] - 3) < 1e-3 && Math.abs(m.w[1] + 2) < 1e-3 && Math.abs(m.b - 5) < 1e-3);
  assert.ok(regressionMetrics(y, m.predict(X)).r2 > 0.9999);
});
t('Holt forecasts a trend', () => { const y = Array.from({ length: 12 }, (_, i) => 100 + 10 * i); const f = new HoltWinters().fit(y).forecast(2); assert.ok(Math.abs(f[0].value - 220) < 5, String(f[0].value)); });
t('robust z flags outlier', () => { const z = robustZ([10, 11, 9, 10, 12, 10, 95]); assert.ok(z[6] > 3.5 && Math.abs(z[0]) < 1); });
t('encoder one-hot + impute', () => { const e = new Encoder([{ name: 'area', type: 'cat' }, { name: 'amt', type: 'num' }]).fit([{ area: 'A', amt: 10 }, { area: 'B', amt: null }, { area: 'A', amt: 30 }]); assert.deepEqual(e.names, ['area=A', 'area=B', 'amt', 'amt_missing']); assert.equal(e.transformOne({ area: 'C', amt: null }).length, 4); });
t('wilson interval', () => { const [lo, hi] = wilson(8, 20); assert.ok(Math.abs(lo - 0.2188) < 1e-3 && Math.abs(hi - 0.6134) < 1e-3); });

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
