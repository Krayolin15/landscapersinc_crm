/* =============================================================================
   Display formatting. Views never format by hand — they call these.
   ========================================================================== */

import { formatMoney, numberFormat } from './money.js';
import { parse, iso, MONTHS, MONTHS_SHORT, DAYS, DAYS_SHORT, diffDays, today, nowSA } from './dates.js';

export const money = (v, o) => formatMoney(v, o);
export const moneyCompact = v => formatMoney(v, { compact: true });

export function num(v, d = 0) {
  if (v == null || v === '' || !isFinite(v)) return '—';
  return numberFormat('en-US', d).format(Number(v));
}
export function pct(v, d = 1) {
  if (v == null || !isFinite(v)) return '—';
  return `${Number(v).toFixed(d).replace(/\.0+$/, '')}%`;
}
/** 0..1 ratio -> "42.5%" */
export const ratio = (v, d = 1) => pct(v * 100, d);

/**
 * date('2026-07-21')            -> '21 Jul 2026'
 * date(v, 'long')               -> '21 July 2026'      (invoice style)
 * date(v, 'full')               -> 'Tuesday, 21 July 2026'
 * date(v, 'short')              -> '21 Jul'
 * date(v, 'numeric')            -> '21/07/2026'        (SA DD/MM/YYYY)
 * date(v, 'iso')                -> '2026-07-21'
 */
export function date(v, style = 'medium') {
  const d = parse(v);
  if (!d) return '—';
  const D = d.getDate(), M = d.getMonth(), Y = d.getFullYear();
  switch (style) {
    case 'long': return `${D} ${MONTHS[M]} ${Y}`;
    case 'full': return `${DAYS[d.getDay()]}, ${D} ${MONTHS[M]} ${Y}`;
    case 'short': return `${D} ${MONTHS_SHORT[M]}`;
    case 'dow': return `${DAYS_SHORT[d.getDay()]} ${D} ${MONTHS_SHORT[M]}`;
    case 'numeric': return `${String(D).padStart(2, '0')}/${String(M + 1).padStart(2, '0')}/${Y}`;
    case 'iso': return iso(d);
    case 'month': return `${MONTHS[M]} ${Y}`;
    default: return `${D} ${MONTHS_SHORT[M]} ${Y}`;
  }
}
export function time(v) {
  if (!v) return '';
  if (/^\d{1,2}:\d{2}/.test(v)) return String(v).slice(0, 5);
  const d = parse(v);
  return d ? `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` : '';
}
export const dateTime = v => (v ? `${date(v)} · ${time(v)}` : '—');

/** "just now", "5 min ago", "yesterday", "in 3 days", "12 Aug" */
export function relative(v) {
  const d = parse(v);
  if (!d) return '—';
  const now = nowSA();
  const secs = Math.round((now - d) / 1000);
  const abs = Math.abs(secs);
  const future = secs < 0;
  if (abs < 45) return future ? 'in a moment' : 'just now';
  if (abs < 3600) { const m = Math.round(abs / 60); return future ? `in ${m} min` : `${m} min ago`; }
  if (abs < 86400 && iso(d) === today()) { const h = Math.round(abs / 3600); return future ? `in ${h} h` : `${h} h ago`; }
  const dd = diffDays(today(), iso(d));
  if (dd === -1) return 'yesterday';
  if (dd === 1) return 'tomorrow';
  if (dd < 0 && dd > -7) return `${-dd} days ago`;
  if (dd > 0 && dd < 7) return `in ${dd} days`;
  return date(d, d.getFullYear() === now.getFullYear() ? 'short' : 'medium');
}
/** "due in 3 days" / "3 days overdue" / "due today" */
export function dueLabel(v) {
  const dd = diffDays(today(), v);
  if (dd === 0) return 'due today';
  if (dd === 1) return 'due tomorrow';
  if (dd > 1) return `due in ${dd} days`;
  return `${-dd} day${dd === -1 ? '' : 's'} overdue`;
}

/** South African phone numbers: '0691315387' -> '069 131 5387'; '+27691315387' -> '+27 69 131 5387' */
export function phone(v) {
  if (!v) return '';
  const s = String(v).replace(/[^\d+]/g, '');
  if (/^0\d{9}$/.test(s)) return `${s.slice(0, 3)} ${s.slice(3, 6)} ${s.slice(6)}`;
  if (/^\+27\d{9}$/.test(s)) return `+27 ${s.slice(3, 5)} ${s.slice(5, 8)} ${s.slice(8)}`;
  if (/^27\d{9}$/.test(s)) return `+27 ${s.slice(2, 4)} ${s.slice(4, 7)} ${s.slice(7)}`;
  return String(v);
}
/** For wa.me / tel: links -> '27691315387' */
export function phoneIntl(v) {
  const s = String(v || '').replace(/[^\d]/g, '');
  if (/^0\d{9}$/.test(s)) return '27' + s.slice(1);
  return s;
}

export function initials(name) {
  const parts = String(name || '?').replace(/[^A-Za-zÀ-ɏ\s'-]/g, ' ').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}
export function titleCase(s) { return String(s || '').toLowerCase().replace(/\b([a-z])/g, c => c.toUpperCase()); }
export function plural(n, one, many = one + 's') { return `${num(n)} ${Number(n) === 1 ? one : many}`; }
export function fileSize(bytes) {
  if (!bytes && bytes !== 0) return '—';
  const u = ['B', 'KB', 'MB', 'GB'];
  let i = 0, b = bytes;
  while (b >= 1024 && i < u.length - 1) { b /= 1024; i++; }
  return `${b.toFixed(b >= 10 || i === 0 ? 0 : 1)} ${u[i]}`;
}
export function duration(mins) {
  if (!mins && mins !== 0) return '—';
  const h = Math.floor(mins / 60), m = Math.round(mins % 60);
  return h ? `${h} h${m ? ` ${m} min` : ''}` : `${m} min`;
}
export function truncate(s, n = 80) { s = String(s ?? ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; }
export function greeting() { const h = nowSA().getHours(); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; }
export const yesNo = v => (v ? 'Yes' : 'No');
