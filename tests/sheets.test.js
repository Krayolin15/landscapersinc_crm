// Sheets formula engine tests:  node tests/sheets.test.js
import assert from 'node:assert/strict';
import { colName, colIndex, parse, evaluateBook, shiftFormula, adjustFormula, shiftCells, sortRows, parseInput, formatValue, isErr, dateToSerial, serialToDate, FUNCTION_NAMES, normaliseFormula, renameSheetRefs, mergeBooks } from '../js/apps/sheets/engine.js';

let passed = 0, failed = 0;
const t = (name, fn) => { try { fn(); passed++; } catch (e) { failed++; console.error('✗', name, '\n ', e.message); } };
const book = (cells, extra = []) => [{ name: 'Sheet1', cells: Object.fromEntries(Object.entries(cells).map(([a, v]) => [a, typeof v === 'string' && v.startsWith('=') ? { f: v.slice(1) } : { v }])) }, ...extra];
const val = (cells, a = 'Z1', f, opts) => evaluateBook(book(f ? { ...cells, [a]: f } : cells), { today: '2026-09-29', ...opts }).get('Sheet1', a);

t('column names', () => { assert.equal(colName(0), 'A'); assert.equal(colName(25), 'Z'); assert.equal(colName(26), 'AA'); assert.equal(colName(701), 'ZZ'); assert.equal(colIndex('AA'), 26); assert.equal(colIndex('zz'), 701); });
t('precedence', () => { assert.equal(val({}, 'A1', '=2+3*4^2'), 50); assert.equal(val({}, 'A1', '=-2^2'), 4); assert.equal(val({}, 'A1', '=(2+3)*4'), 20); assert.equal(val({}, 'A1', '=50%*10'), 5); assert.equal(val({}, 'A1', '=1+2&"x"'), '3x'); assert.equal(val({}, 'A1', '=1+1=2'), true); });
t('float noise cleaned; per-visit micro precision', () => { assert.equal(val({}, 'A1', '=0.1+0.2'), 0.3); assert.equal(val({ A1: 630.315 }, 'B1', '=A1*4'), 2521.26); assert.equal(val({ A1: 2521.26 }, 'B1', '=ROUND(A1/4,2)'), 630.32); });
t('references, ranges, cross-tab', () => {
  const b = book({ A1: 10, A2: 20, A3: 'x', A4: '=SUM(A1:A3)', B1: "=Costs!B2*2", C1: "='Crew costs'!A1+1" }, [{ name: 'Costs', cells: { B2: { v: 7 } } }, { name: 'Crew costs', cells: { A1: { v: 99 } } }]);
  const r = evaluateBook(b); assert.equal(r.get('Sheet1', 'A4'), 30); assert.equal(r.get('Sheet1', 'B1'), 14); assert.equal(r.get('Sheet1', 'C1'), 100);
});
t('whole-column range', () => assert.equal(val({ A1: 1, A2: 2, A9: 3 }, 'B1', '=SUM(A:A)'), 6));
t('SUM(A1) ignores text but A1+1 errors', () => { assert.equal(val({ A1: 'abc' }, 'B1', '=SUM(A1)'), 0); assert.equal(val({ A1: 'abc' }, 'B1', '=A1+1').code, '#VALUE!'); });
t('errors', () => {
  assert.equal(val({}, 'A1', '=1/0').code, '#DIV/0!');
  assert.equal(val({}, 'A1', '=NOPE(1)').code, '#NAME?');
  assert.equal(val({}, 'A1', '=Missing!A1').code, '#REF!');
  assert.equal(val({}, 'A1', '=SUM(1,').code, '#NAME?');
  assert.equal(val({ A1: '=1/0' }, 'B1', '=A1+1').code, '#DIV/0!');
  assert.equal(val({ A1: '=1/0' }, 'B1', '=IFERROR(A1,"none")'), 'none');
  assert.equal(val({ A1: '=1/0' }, 'B1', '=ISERROR(A1)'), true);
});
t('circular references', () => { const r = evaluateBook(book({ A1: '=B1+1', B1: '=A1+1' })); assert.ok(isErr(r.get('Sheet1', 'A1'))); assert.ok(isErr(r.get('Sheet1', 'B1'))); });
t('aggregates', () => {
  const c = { A1: 4, A2: 8, A3: '', A4: 'n/a', A5: 6 };
  assert.equal(val(c, 'B1', '=AVERAGE(A1:A5)'), 6); assert.equal(val(c, 'B1', '=COUNT(A1:A5)'), 3); assert.equal(val(c, 'B1', '=COUNTA(A1:A5)'), 4);
  assert.equal(val(c, 'B1', '=MAX(A1:A5)'), 8); assert.equal(val(c, 'B1', '=MIN(A1:A5)'), 4); assert.equal(val(c, 'B1', '=MEDIAN(A1:A5)'), 6); assert.equal(val(c, 'B1', '=COUNTBLANK(A1:A5)'), 1);
});
t('IF / AND / OR / IFS / SWITCH', () => {
  assert.equal(val({ A1: 5 }, 'B1', '=IF(A1>3,"big","small")'), 'big'); assert.equal(val({ A1: 5 }, 'B1', '=IF(A1>9,"big")'), false);
  assert.equal(val({ A1: 5 }, 'B1', '=AND(A1>1,A1<10)'), true); assert.equal(val({ A1: 5 }, 'B1', '=OR(A1>9,A1<0)'), false);
  assert.equal(val({ A1: 75 }, 'B1', '=IFS(A1>=80,"A",A1>=70,"B",TRUE,"C")'), 'B'); assert.equal(val({ A1: 'wed' }, 'B1', '=SWITCH(A1,"mon",1,"wed",3,0)'), 3);
});
t('SUMIF / COUNTIF / SUMIFS / AVERAGEIF with criteria + wildcards', () => {
  const c = { A1: 'Mowing', B1: 450, A2: 'Hedging', B2: 300, A3: 'Mowing', B3: 550, A4: 'Clean-up', B4: 1200, C1: 'Umhlanga', C2: 'Umhlanga', C3: 'Ballito', C4: 'Umhlanga' };
  assert.equal(val(c, 'D1', '=SUMIF(A1:A4,"mowing",B1:B4)'), 1000); assert.equal(val(c, 'D1', '=SUMIF(B1:B4,">=500")'), 1750);
  assert.equal(val(c, 'D1', '=COUNTIF(A1:A4,"M*")'), 2); assert.equal(val(c, 'D1', '=COUNTIF(B1:B4,"<>300")'), 3);
  assert.equal(val(c, 'D1', '=SUMIFS(B1:B4,A1:A4,"Mowing",C1:C4,"Umhlanga")'), 450); assert.equal(val(c, 'D1', '=COUNTIFS(A1:A4,"Mowing",B1:B4,">500")'), 1);
  assert.equal(val(c, 'D1', '=AVERAGEIF(A1:A4,"Mowing",B1:B4)'), 500);
});
t('VLOOKUP / XLOOKUP / INDEX-MATCH / HLOOKUP', () => {
  const c = { A1: 'Small', B1: 450, A2: 'Medium', B2: 650, A3: 'Large', B3: 950, E1: 0, E2: 1000, E3: 5000, F1: 'Bronze', F2: 'Silver', F3: 'Gold' };
  assert.equal(val(c, 'D1', '=VLOOKUP("medium",A1:B3,2,FALSE)'), 650); assert.equal(val(c, 'D1', '=VLOOKUP("Huge",A1:B3,2,FALSE)').code, '#N/A');
  assert.equal(val(c, 'D1', '=VLOOKUP(2500,E1:F3,2)'), 'Silver'); assert.equal(val(c, 'D1', '=XLOOKUP("Large",A1:A3,B1:B3)'), 950); assert.equal(val(c, 'D1', '=XLOOKUP("Huge",A1:A3,B1:B3,"-")'), '-');
  assert.equal(val(c, 'D1', '=INDEX(B1:B3,MATCH("Large",A1:A3,0))'), 950); assert.equal(val(c, 'D1', '=INDEX(A1:B3,2,2)'), 650); assert.equal(val({ A1: 'x', B1: 'y', A2: 1, B2: 2 }, 'D1', '=HLOOKUP("y",A1:B2,2,FALSE)'), 2);
});
t('text functions', () => {
  assert.equal(val({ A1: '  mount   edgecombe ' }, 'B1', '=PROPER(TRIM(A1))'), 'Mount Edgecombe'); assert.equal(val({}, 'A1', '=LEFT("Landscapers",5)&MID("Landscapers",6,3)&RIGHT("Inc",1)'), 'Landscapc');
  assert.equal(val({}, 'A1', '=LEN("abc")+FIND("c","abc")'), 6); assert.equal(val({}, 'A1', '=SUBSTITUTE("a-b-c","-","/")'), 'a/b/c'); assert.equal(val({}, 'A1', '=TEXTJOIN(", ",TRUE,"a","","b")'), 'a, b');
  assert.equal(val({}, 'A1', '=TEXT(1234.5,"R #,##0.00")'), 'R1,234.50');
});
t('dates are Excel serials', () => {
  assert.equal(dateToSerial('2026-09-29'), 46294); assert.equal(serialToDate(46294), '2026-09-29');
  assert.equal(val({}, 'A1', '=TODAY()'), 46294); assert.equal(val({}, 'A1', '=DATE(2026,12,25)-TODAY()'), 87);
  assert.equal(val({}, 'A1', '=YEAR(DATE(2026,2,28)+1)*100+MONTH(DATE(2026,2,28)+1)'), 202603);
  assert.equal(val({}, 'A1', '=EDATE(DATE(2026,1,31),1)'), dateToSerial('2026-02-28')); assert.equal(val({}, 'A1', '=EOMONTH(DATE(2026,9,10),0)'), dateToSerial('2026-09-30'));
  assert.equal(val({}, 'A1', '=WEEKDAY(DATE(2026,9,29))'), 3); // Tuesday
  assert.equal(val({ H1: dateToSerial('2026-09-24') }, 'A1', '=NETWORKDAYS(DATE(2026,9,21),DATE(2026,9,30),H1)'), 7); // Heritage Day excluded
});
t('money helpers: VAT at 15%, PMT', () => {
  assert.equal(val({}, 'A1', '=VAT(1000)'), 150); assert.equal(val({}, 'A1', '=INCVAT(1000)'), 1150); assert.equal(val({}, 'A1', '=EXVAT(1150)'), 1000);
  assert.equal(Math.round(val({}, 'A1', '=PMT(0.1/12,36,-250000)') * 100) / 100, 8066.80);
  assert.equal(val({}, 'A1', '=ROUND(2.345,2)'), 2.35); assert.equal(val({}, 'A1', '=ROUND(-2.345,2)'), -2.35); assert.equal(val({}, 'A1', '=ROUNDUP(2.301,1)'), 2.4); assert.equal(val({}, 'A1', '=ROUNDDOWN(2.399,1)'), 2.3); assert.equal(val({}, 'A1', '=MOD(-3,5)'), 2);
});
t('copy/fill shifts relative refs only', () => {
  assert.equal(shiftFormula('SUM(A1:B2)*$C$1+C$2+$D3', 2, 1), 'SUM(B3:C4)*$C$1+D$2+$D5');
  assert.equal(shiftFormula('A1+1', -1, 0), '#REF!+1');
  assert.equal(shiftFormula("'Crew costs'!A1+Other!B2", 1, 0), "'Crew costs'!A2+Other!B3");
});
t('insert / delete rows fix formulas on every tab', () => {
  assert.equal(adjustFormula('SUM(A1:A10)+A12', 'row', 4, 2), 'SUM(A1:A12)+A14');
  assert.equal(adjustFormula('A5+A3', 'row', 4, -1), '#REF!+A3');
  const tabs = shiftCells([{ name: 'Data', cells: { A1: { v: 1 }, A2: { v: 2 }, A3: { v: 3 }, A4: { f: 'SUM(A1:A3)' } } }, { name: 'Summary', cells: { A1: { f: 'Data!A4*2' } } }], 'Data', 'row', 1, 1);
  assert.equal(tabs[0].cells.A5.f, 'SUM(A1:A4)'); assert.equal(tabs[0].cells.A3.v, 2); assert.equal(tabs[1].cells.A1.f, 'Data!A5*2');
  assert.equal(evaluateBook(tabs).get('Summary', 'A1'), 12);
});
t('sort rows keeps formulas pointing at their own row', () => {
  const tab = { name: 'S', cells: { A1: { v: 'c' }, B1: { v: 3 }, C1: { f: 'B1*2' }, A2: { v: 'a' }, B2: { v: 1 }, C2: { f: 'B2*2' }, A3: { v: 'b' }, B3: { v: 2 }, C3: { f: 'B3*2' } } };
  const r = evaluateBook([tab]); const cells = sortRows(tab, r.values.S, 0, 2, 0);
  assert.deepEqual([cells.A1.v, cells.A2.v, cells.A3.v], ['a', 'b', 'c']); assert.equal(cells.C1.f, 'B1*2');
  assert.equal(evaluateBook([{ name: 'S', cells }]).get('S', 'C3'), 6);
});
t('input parsing', () => {
  assert.deepEqual(parseInput('=A1+1'), { f: 'A1+1' }); assert.equal(parseInput('R 1 250.50').v, 1250.5); assert.equal(parseInput('R 1 250.50').fmt, 'money');
  assert.equal(parseInput('1,234').v, 1234); assert.equal(parseInput('15%').v, 0.15); assert.equal(parseInput('2026-09-29').v, 46294); assert.equal(parseInput('29/09/2026').v, 46294);
  assert.equal(parseInput("'0831234567").v, '0831234567'); assert.equal(parseInput('0831234567').v, 831234567); assert.equal(parseInput(''), null);
});
t('display formats', () => { assert.equal(formatValue(1234567.5, 'money'), 'R1,234,567.50'); assert.equal(formatValue(-50, 'money'), '-R50.00'); assert.equal(formatValue(0.155, 'percent'), '15.5%'); assert.equal(formatValue(46294, 'date'), '2026-09-29'); assert.equal(formatValue(1 / 3), '0.333333333333'); });
t('parser rejects junk; LOG10-style names are not refs', () => { assert.throws(() => parse('1 +* 2')); assert.equal(parse('ABS10(1)').t, 'fn'); assert.ok(FUNCTION_NAMES.length >= 70); });
t('review fixes: whole-column refs follow inserts, deletes and fills', () => {
  const tabs = shiftCells([{ name: 'Data', cells: { C1: { v: 100 }, C2: { v: 200 }, B1: { v: 1 }, E1: { f: 'SUM(C:C)' } } }], 'Data', 'col', 1, 1);
  assert.equal(tabs[0].cells.F1.f, 'SUM(D:D)'); assert.equal(evaluateBook(tabs).get('Data', 'F1'), 300);
  assert.equal(adjustFormula('SUM(C:C)+D1', 'col', 2, -1), 'SUM(#REF!)+C1');
  assert.equal(shiftFormula('SUM(B:B)', 5, 1), 'SUM(C:C)'); assert.equal(shiftFormula('SUM($B:B)', 0, 1), 'SUM($B:C)');
  assert.equal(adjustFormula('SUM(C:C)', 'row', 0, 3), 'SUM(C:C)');
});
t('review fixes: deleting the first/last row of a range shrinks it', () => {
  assert.equal(adjustFormula('SUM(D2:D10)', 'row', 9, -1), 'SUM(D2:D9)');
  assert.equal(adjustFormula('SUM(D2:D10)', 'row', 1, -1), 'SUM(D2:D9)');
  assert.equal(adjustFormula('SUM(D2:D10)', 'row', 4, -2), 'SUM(D2:D8)');
  assert.equal(adjustFormula('SUM(D2:D3)', 'row', 1, -2), 'SUM(#REF!)');
  assert.equal(adjustFormula('SUM(A1:B1)', 'col', 1, -1), 'SUM(A1:A1)');
});
t('review fixes: CEILING/FLOOR, blank lookup args, IS functions, criteria with errors', () => {
  assert.equal(val({}, 'A1', '=CEILING(1.11,0.01)'), 1.11); assert.equal(val({}, 'A1', '=FLOOR(0.3,0.1)'), 0.3); assert.equal(val({}, 'A1', '=FLOOR(1.15,0.05)'), 1.15);
  const c = { A1: 'Small', B1: 450, A2: 'Medium', B2: 650, A3: 'Large', B3: 950 };
  assert.equal(val(c, 'D1', '=VLOOKUP("Tiny",A1:B3,2,)').code, '#N/A'); assert.equal(val(c, 'D1', '=VLOOKUP("Medium",A1:B3,2,)'), 650); assert.equal(val(c, 'D1', '=MATCH("Medium",A1:A3,)'), 2);
  assert.equal(val({}, 'A1', '=ISNUMBER(SEARCH("x","abc"))'), false); assert.equal(val({ A1: 'Hedging' }, 'B1', '=IF(ISNUMBER(SEARCH("mow",A1)),1,0)'), 0);
  assert.equal(val({ A1: '=1/0' }, 'B1', '=ISTEXT(A1)'), false); assert.equal(val({}, 'A1', '=ISBLANK(Z9)'), true); assert.equal(val({ A2: '' }, 'B1', '=ISBLANK(A2)'), false);
  const e = { A1: 'Mowing', A2: '=NA()', A3: 'Mowing', C1: 1, C2: 2, C3: 3 };
  assert.equal(val(e, 'D1', '=COUNTIF(A1:A3,"Mowing")'), 2); assert.equal(val(e, 'D1', '=SUMIF(A1:A3,"Mowing",C1:C3)'), 4);
  assert.equal(val({ A1: 5, A2: 'Apple', A3: 'Zulu' }, 'D1', '=COUNTIF(A1:A3,"<M")'), 1);
});
t('review fixes: dates, big integers, NOW', () => {
  assert.equal(formatValue(831234567, 'date'), '#NUM!');
  assert.equal(formatValue(8001015009087), '8001015009087');
  assert.equal(parseInput('09/29/2026').v, '09/29/2026'); assert.equal(parseInput('31/02/2026').v, '31/02/2026'); assert.equal(parseInput('2026-02-30').v, '2026-02-30');
  assert.equal(parseInput('1234,56', { decimal: ',' }).v, 1234.56); assert.equal(parseInput('12,500', { decimal: ',' }).v, 12.5); assert.equal(parseInput('1 234,56', { decimal: ',' }).v, 1234.56);
  assert.equal(val({}, 'A1', '=ROUND((NOW()-TODAY())*1440,0)', { nowMinutes: 615 }), 615);
});
t('three-way merge keeps both people\'s edits', () => {
  const base = [{ name: 'S', cells: { A1: { v: 1 }, B1: { v: 2 }, C1: { v: 3 } }, frozen: 0 }];
  const local = [{ name: 'S', cells: { A1: { v: 10 }, B1: { v: 2 }, C1: { v: 3 } }, frozen: 1 }];        // I changed A1 and froze a row
  const remote = [{ name: 'S', cells: { A1: { v: 1 }, B1: { v: 20 } }, frozen: 0 }, { name: 'New', cells: { A1: { v: 'x' } } }]; // they changed B1, cleared C1, added a tab
  const m = mergeBooks(base, local, remote);
  assert.deepEqual(m[0].cells, { A1: { v: 10 }, B1: { v: 20 } }); assert.equal(m[0].frozen, 1); assert.equal(m[1].name, 'New');
  assert.deepEqual(mergeBooks(base, base, [{ name: 'S', cells: {} }])[0].cells, {});
});
t('normalise case + rename tab refs', () => {
  assert.equal(normaliseFormula(`sum(a1:b2)+"abc"&'crew costs'!c3`), `SUM(A1:B2)+"abc"&'crew costs'!C3`);
  assert.equal(renameSheetRefs(`Data!A1+'Old tab'!B2+A3`, 'Old tab', 'New'), 'Data!A1+New!B2+A3');
  assert.equal(renameSheetRefs('Data!A1', 'Data', 'Crew costs'), `'Crew costs'!A1`);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
