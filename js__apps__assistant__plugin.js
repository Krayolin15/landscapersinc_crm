/* Sage AI's own general skills: help, "how many …" for any table, today's date & holidays. */
import { registerSkill, allSkills } from '../../ai/skills.js';
import { db } from '../../core/db.js';
import { can } from '../../core/perms.js';
import { SCHEMA, optionLabel } from '../../core/schema.js';
import { today, nowSA, addDays, sastDay } from '../../core/dates.js';
import { holidaysBetween, isWorkingDay } from '../../core/holidays.js';
import * as fmt from '../../core/format.js';
import { APPS } from '../registry.js';

const plural = w => (w.endsWith('y') ? `${w.slice(0, -1)}ies` : w.endsWith('s') ? w : `${w}s`);
/** Collections the user can read, with the words people use for them. */
function collectionWords() {
  return Object.entries(SCHEMA).filter(([col, def]) => !['audit_log', 'notifications', 'mail_flags', 'chat_reads', 'settings', 'predictions', 'ml_models', 'ai_conversations', 'presence', 'reminder_log'].includes(col) && def.label && can('read', col))
    .map(([col, def]) => ({ col, def, words: [...new Set([def.label, def.singular, def.singular && plural(def.singular), col.replace(/_/g, ' ')].filter(Boolean).map(w => w.toLowerCase()))] }));
}

const SYSTEM_COLS = new Set(['audit_log', 'notifications', 'mail_flags', 'chat_reads', 'settings', 'predictions', 'ml_models', 'ai_conversations', 'presence', 'reminder_log', 'data_issues']);
const sastDate = sastDay;
const sastTime = iso => { const t = Date.parse(iso); return Number.isFinite(t) ? new Date(t + 2 * 3600e3).toISOString().slice(11, 16) : ''; };
const rangeLabel = (from, to) => (from === to ? fmt.date(from, 'long') : `${fmt.date(from)} – ${fmt.date(to)}`);

export default function () {
  /* "What did Wayne add on 10 September?" — every record a person added or changed in a period,
     plus calendar entries they put in for those days (attribution comes from created_by / audit_log). */
  registerSkill({
    id: 'sage-activity', app: 'assistant', label: 'Who added or changed what',
    examples: ['what did Wayne add on 10 September?', 'what has Anthony changed this week', 'who added the Carron Glen meeting'],
    keywords: ['who added', 'who created', 'who changed', 'activity', 'added by'],
    match: (q, ents) => (ents.people.length && /\b(add|added|enter|entered|create|created|change|changed|update|updated|delete|deleted|capture|captured|log|logged|do|did)\b/i.test(q) && /\b(what|anything|which|show)\b/i.test(q) ? 0.97 : /\bwho (added|created|entered|changed|deleted|updated|captured|booked|scheduled)\b/i.test(q) ? 0.92 : 0),
    run: (q, ents) => {
      const people = db.all('profiles').filter(p => ents.people.includes(p.id));
      const isPerson = (id, name) => !people.length || people.some(p => p.id === id || (name && p.name === name));
      const words = people.length ? [] : ents.words.filter(w => w.length > 2 && !['who', 'added', 'created', 'entered', 'changed', 'deleted', 'updated', 'captured', 'booked', 'scheduled', 'the'].includes(w));
      // "who added the Carron Glen meeting?" looks at all time; "what did Wayne add?" defaults to the last 7 days
      const lookup = !people.length && words.length;
      const from = ents.dates ? ents.dates.from : lookup ? '0000-01-01' : addDays(today(), -6), to = ents.dates ? ents.dates.to : today();
      const hitsIn = label => words.filter(w => String(label).toLowerCase().includes(w)).length;
      const need = lookup ? Math.max(1, Math.ceil(words.length * 0.6)) : 0;
      const aboutWords = label => !words.length || hitsIn(label) >= need;
      const rows = [], seen = new Set();
      const push = (col, r, action, at, who) => { const key = `${col}|${r.id}|${action}`; if (seen.has(key)) return; seen.add(key); const def = SCHEMA[col] || {}; const label = db.label(col, r) || r.id; if (!aboutWords(`${label} ${def.singular || ''}`)) return; rows.push({ when: `${fmt.date(sastDate(at))} ${sastTime(at)}`.trim(), who: who || '—', action, record: label, type: def.singular || col, _href: `#/record/${col}/${encodeURIComponent(r.id)}`, _at: at }); };
      for (const [col, def] of Object.entries(SCHEMA)) {
        if (SYSTEM_COLS.has(col) || !can('read', col)) continue;
        for (const r of db.all(col)) {
          const d = sastDate(r.created_at);
          if (d >= from && d <= to && isPerson(r.created_by, r.created_by_name)) push(col, r, 'Added', r.created_at, r.created_by_name);
          const u = r.updated_at && r.updated_at !== r.created_at ? sastDate(r.updated_at) : null;
          if (u && u >= from && u <= to && r.updated_by && isPerson(r.updated_by, r.updated_by_name)) push(col, r, 'Changed', r.updated_at, r.updated_by_name);
        }
        void def;
      }
      for (const a of db.all('audit_log')) {
        const d = sastDate(a.at);
        if (d < from || d > to || !isPerson(a.user_id, a.user_name) || !a.action || /^(insert|create)$/i.test(a.action)) continue;
        const rec = (a.collection && a.record_id && db.get(a.collection, a.record_id)) || { id: a.record_id || a.id };
        if (a.collection && SYSTEM_COLS.has(a.collection)) continue;
        if (a.collection && !can('read', a.collection)) continue;
        push(a.collection || 'audit_log', rec, /delete|trash|remove/i.test(a.action) ? 'Deleted' : 'Changed', a.at, a.user_name);
      }
      // calendar entries FOR those days that this person put in (e.g. Wayne's 10:00 meeting on 10 September)
      const onDays = db.all('events').filter(e => e.status !== 'cancelled' && isPerson(e.created_by, e.created_by_name) && String(e.start_date || e.date || '').slice(0, 10) >= from && String(e.start_date || e.date || '').slice(0, 10) <= to && aboutWords(e.title));
      rows.sort((a, b) => String(b._at).localeCompare(String(a._at)));
      if (lookup) {
        const added = rows.filter(r => r.action === 'Added').sort((a, b) => hitsIn(`${b.record} ${b.type}`) - hitsIn(`${a.record} ${a.type}`) || String(b._at).localeCompare(String(a._at)));
        const events = onDays.length ? onDays : [];
        if (!added.length && !events.length) return { text: `I couldn't find a record matching “${words.join(' ')}”.`, sources: ['audit_log'] };
        const top = added.slice(0, 5);
        return { text: top.map(r => `${r.record} (${r.type.toLowerCase()}) was added by ${r.who} on ${r.when}`).join('. ') + (added.length > 5 ? ` — and ${added.length - 5} more matches.` : '.'), cards: [{ type: 'table', columns: [{ key: 'record', label: 'Record' }, { key: 'type', label: 'Type' }, { key: 'who', label: 'Added by' }, { key: 'when', label: 'When' }], rows: added.slice(0, 30) }], sources: ['audit_log'] };
      }
      const who = people.length ? people.map(p => p.name.split(' ')[0]).join(' & ') : 'Everyone';
      const rel = ents.dates && /^(today|yesterday|tomorrow|this week|last week|next week|last \d+ days)$/.test(ents.dates.label || '') ? ents.dates.label : null;
      const period = rel || (ents.dates ? rangeLabel(from, to) : 'the last 7 days');
      const when = rel ? rel : ents.dates ? (from === to ? `on ${period}` : `between ${period}`) : `in ${period}`;
      const parts = [];
      parts.push(rows.length ? `${who} added or changed ${rows.length} record${rows.length === 1 ? '' : 's'} ${when}` : `${who} added or changed nothing ${when}`);
      if (onDays.length) parts.push(`${onDays.length} calendar entr${onDays.length === 1 ? 'y' : 'ies'} for ${period} ${onDays.length === 1 ? 'was' : 'were'} put in by ${who === 'Everyone' ? 'the team' : who}: ${onDays.slice(0, 3).map(e => `${e.title}${e.start_time ? ` at ${e.start_time}` : ''} (added ${fmt.date(sastDate(e.created_at))})`).join('; ')}`);
      const cards = [];
      if (rows.length) cards.push({ type: 'table', columns: [{ key: 'when', label: 'When' }, { key: 'who', label: 'Who' }, { key: 'action', label: 'Did' }, { key: 'type', label: 'Type' }, { key: 'record', label: 'Record' }], rows: rows.slice(0, 50) });
      if (onDays.length) cards.push({ type: 'list', items: onDays.slice(0, 12).map(e => ({ title: `${e.start_time ? e.start_time + ' · ' : ''}${e.title}`, sub: `${fmt.date(String(e.start_date || e.date).slice(0, 10))} · added by ${e.created_by_name || '—'} on ${fmt.date(sastDate(e.created_at))}`, href: `#/calendar/event/${e.id}?d=${String(e.start_date || e.date).slice(0, 10)}`, icon: 'calendar' })) });
      return { text: `${parts.join('. ')}.`, cards, actions: [{ label: 'Open the audit log', href: '#/admin/audit' }], sources: ['audit_log', 'events'] };
    }
  });

  /* "How is Reach Park doing?" — a one-screen client summary. */
  registerSkill({
    id: 'sage-client', app: 'assistant', label: 'Client summary',
    examples: ['how is Reach Park doing?', 'tell me about Carron Glen Estate', 'Brenton Naidoo summary'],
    keywords: ['client', 'customer'],
    match: (q, ents) => (ents.clients.length && /\b(how is|how's|how are|tell me about|overview|summary|status|doing|profile|dossier|history|details|about|info)\b/i.test(q) ? 0.93 : ents.clients.length ? 0.5 : 0),
    run: async (q, ents) => {
      const biz = await import('../_biz.js');
      const list = ents.clients.map(id => db.get('clients', id)).filter(Boolean);
      if (!list.length) return { text: 'Which client do you mean?' };
      const c = list[0];
      const health = biz.clientHealth(c);
      const monthly = biz.mrr(biz.clientContracts(c.id));
      const bal = biz.clientBalance(c.id), ltv = biz.clientLTV(c.id);
      const sites = db.filter('sites', s => s.client_id === c.id);
      const visits = db.filter('visits', v => v.client_id === c.id || (v.site_id && sites.some(s => s.id === v.site_id))).sort((a, b) => String(a.date).localeCompare(String(b.date)));
      const last = [...visits].reverse().find(v => v.date <= today() && v.status === 'completed'), next = visits.find(v => v.date >= today() && v.status !== 'completed');
      const quotes = db.filter('quotes', x => x.client_id === c.id && ['draft', 'sent'].includes(x.status));
      const text = `${c.name}: ${health.label.toLowerCase()} (score ${health.score}/100). ${monthly ? `Contracts worth ${fmt.money(monthly)} a month.` : 'No active maintenance contract on record.'} ${bal > 0 ? `Owes ${fmt.money(bal)}.` : 'Nothing outstanding.'}${next ? ` Next visit ${fmt.date(next.date)}${next.start_time ? ' at ' + next.start_time : ''}.` : ''}${last ? ` Last completed visit ${fmt.date(last.date)}.` : ''}${list.length > 1 ? ` (Also matched: ${list.slice(1).map(x => x.name).join(', ')}.)` : ''}`;
      return {
        text,
        cards: [{ type: 'kpis', items: [{ label: 'Health', value: `${health.score} · ${health.label}` }, { label: 'Monthly contracts', value: monthly, format: 'money' }, { label: 'Owes us', value: bal, format: 'money' }, { label: 'Billed to date', value: ltv, format: 'money' }] },
          { type: 'list', items: [...health.factors.map(f => ({ title: f, icon: 'activity' })), ...sites.slice(0, 5).map(s => ({ title: s.name || s.address, sub: s.address && s.name ? s.address : 'Site', href: `#/record/sites/${encodeURIComponent(s.id)}`, icon: 'map-pin' })), ...quotes.slice(0, 5).map(x => ({ title: `Open quote: ${x.title || x.number || 'quote'}`, sub: `${fmt.money(x.total || 0)} · ${x.status}`, href: `#/record/quotes/${encodeURIComponent(x.id)}`, icon: 'file-signature' }))] }],
        actions: [{ label: 'Open client dossier', href: `#/clients/c/${encodeURIComponent(c.id)}` }],
        sources: ['clients', 'contracts', 'invoices', 'sites', 'visits', 'quotes']
      };
    }
  });

  /* "Any expiring certificates?" — every dated expiry across the system (licences, certificates, medicals, documents…). */
  registerSkill({
    id: 'sage-expiring', app: 'assistant', label: 'Expiring & expired',
    examples: ['what expires in the next 60 days?', 'any expiring certificates', 'which licences need renewal'],
    keywords: ['expire', 'expiring', 'expiry', 'expired', 'renewal', 'renew', 'lapse'],
    match: q => (/\b(expir\w*|renew\w*|lapse\w*|valid until|out of date|due for renewal)\b/i.test(q) ? 0.93 : 0),
    run: (q, ents) => {
      const horizon = ents.dates && ents.dates.to > today() ? ents.dates.to : addDays(today(), 60);
      const expiring = Object.entries(SCHEMA).filter(([col, def]) => !SYSTEM_COLS.has(col) && can('read', col) && Object.entries(def.fields || {}).some(([k, f]) => f.type === 'date' && /expir|valid_until|renew|expires/.test(k)));
      // "expiring certificates" / "licences" narrows to that kind of record (exact word match on the record type)
      const stem = w => w.replace(/(ies)$/, 'y').replace(/s$/, '');
      const typeWords = ([col, def]) => new Set([def.label, def.singular, col.replace(/_/g, ' '), ...(col === 'vehicles' ? ['licence', 'license', 'vehicle'] : []), ...(col === 'files' ? ['document', 'file'] : [])].filter(Boolean).flatMap(s => s.toLowerCase().split(/\W+/)).map(stem));
      const asked = ents.words.map(w => stem(w.toLowerCase()));
      const focus = expiring.filter(e => asked.some(w => w.length > 3 && typeWords(e).has(w)));
      const rows = [];
      let nextOne = null;
      // quote validity and HR warning periods only when asked about them directly
      for (const [col, def] of focus.length ? focus : expiring.filter(([c]) => !['quotes', 'hr_actions'].includes(c))) {
        const dateFields = Object.entries(def.fields || {}).filter(([k, f]) => f.type === 'date' && /expir|valid_until|renew|expires/.test(k)).map(([k, f]) => [k, f.label || k]);
        for (const r of db.all(col)) for (const [k, lbl] of dateFields) {
          const d = r[k]; if (!d) continue;
          if (String(d) > horizon) { if (!nextOne || String(d) < nextOne.date) nextOne = { date: String(d).slice(0, 10), record: db.label(col, r) || r.id, type: def.singular || col }; continue; }
          const days = Math.round((Date.parse(`${String(d).slice(0, 10)}T00:00:00Z`) - Date.parse(`${today()}T00:00:00Z`)) / 864e5);
          if (days < -365) continue;
          rows.push({ record: db.label(col, r) || r.id, type: def.singular || col, what: lbl, date: String(d).slice(0, 10), status: days < 0 ? `Expired ${-days} day${days === -1 ? '' : 's'} ago` : days === 0 ? 'Expires today' : `In ${days} day${days === 1 ? '' : 's'}`, _href: `#/record/${col}/${encodeURIComponent(r.id)}`, _d: days });
        }
      }
      rows.sort((a, b) => a._d - b._d);
      const expired = rows.filter(r => r._d < 0).length;
      const scope = focus.length ? ` (${focus.map(([, d]) => d.label.toLowerCase()).join(', ')})` : '';
      return { text: rows.length ? `${rows.length} item${rows.length === 1 ? '' : 's'}${scope} ${expired ? `— ${expired} already expired — ` : ''}expire by ${fmt.date(horizon, 'long')}.` : `Nothing${scope} expires before ${fmt.date(horizon, 'long')}.${nextOne ? ` The next is ${nextOne.record} (${nextOne.type.toLowerCase()}) on ${fmt.date(nextOne.date, 'long')}.` : ''}`, cards: rows.length ? [{ type: 'table', columns: [{ key: 'record', label: 'Record' }, { key: 'type', label: 'Type' }, { key: 'what', label: 'Date field' }, { key: 'date', label: 'Date', format: 'date' }, { key: 'status', label: 'Status' }], rows: rows.slice(0, 60).map(({ _d, ...r }) => r) }] : [], sources: [...new Set(rows.map(r => r.type))] };
    }
  });

  registerSkill({
    id: 'sage-help', app: 'assistant', label: 'What Sage can do',
    examples: ['what can you do?', 'help', 'what can I ask you'],
    keywords: ['help', 'what can you do', 'what can i ask', 'how do you work'],
    match: q => (/^\s*(help|hi|hello|hey)\s*[!.?]*\s*$|what can (you|i)|how do you work|what do you know/i.test(q) ? 0.95 : 0),
    run: () => {
      const skills = allSkills().filter(s => s.app !== 'assistant' && (s.examples || []).length);
      const byApp = {};
      skills.forEach(s => { (byApp[s.app] = byApp[s.app] || []).push(s); });
      const appName = id => (APPS.find(a => a.id === id) || {}).name || id;
      return {
        text: `I answer from the company's live records — ${skills.length} kinds of questions across ${Object.keys(byApp).length} apps so far. I never guess: each answer says which records it used, and if I can't answer I search the records instead. Some things you can ask:`,
        cards: [{ type: 'list', items: Object.entries(byApp).slice(0, 18).map(([app, list]) => ({ title: `“${list[0].examples[0]}”`, sub: `${appName(app)} · ${list.map(s => s.label).join(' · ')}`, icon: (APPS.find(a => a.id === app) || {}).icon || 'sparkles' })) }],
        sources: []
      };
    }
  });

  registerSkill({
    id: 'sage-count', app: 'assistant', label: 'Count records',
    examples: ['how many clients do we have?', 'how many vehicles are there', 'number of open tasks'],
    keywords: ['how many', 'number of', 'count', 'total number'],
    match: q => { const t = q.toLowerCase(); if (!/\b(how many|number of|count( of)?|total number of)\b/.test(t)) return 0; return collectionWords().some(c => c.words.some(w => new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(t))) ? 0.8 : 0; },
    run: q => {
      const t = q.toLowerCase();
      const hit = collectionWords().map(c => ({ ...c, len: Math.max(0, ...c.words.filter(w => new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(t)).map(w => w.length)) })).filter(c => c.len > 0).sort((a, b) => b.len - a.len)[0];
      if (!hit) return { text: 'Which records should I count?' };
      const rows = db.all(hit.col);
      const statusField = Object.entries(hit.def.fields || {}).find(([k, f]) => ['status', 'stage'].includes(k) && f.type === 'enum');
      const items = [{ label: `All ${hit.def.label.toLowerCase()}`, value: rows.length }];
      let text = `There ${rows.length === 1 ? 'is' : 'are'} ${fmt.num(rows.length)} ${rows.length === 1 ? (hit.def.singular || 'record').toLowerCase() : hit.def.label.toLowerCase()} in the system`;
      if (statusField) {
        const [k, f] = statusField; const by = {};
        rows.forEach(r => { const v = r[k] || 'not set'; by[v] = (by[v] || 0) + 1; });
        const top = Object.entries(by).sort((a, b) => b[1] - a[1]);
        top.slice(0, 5).forEach(([v, n]) => items.push({ label: fmt.titleCase(String(optionLabel(f, v)).replace(/_/g, ' ')), value: n }));
        text += ` — ${top.slice(0, 3).map(([v, n]) => `${n} ${String(optionLabel(f, v)).replace(/_/g, ' ')}`).join(', ')}`;
      }
      return { text: `${text}.`, cards: [{ type: 'kpis', items: items.slice(0, 6) }], actions: [{ label: `Open ${hit.def.label}`, href: `#/record/${hit.col}` }], sources: [hit.col] };
    }
  });

  registerSkill({
    id: 'sage-today', app: 'assistant', label: 'Date & public holidays',
    examples: ['what is the date today?', 'when is the next public holiday', 'is monday a working day'],
    keywords: ['date', 'public holiday', 'holidays', 'working day', 'day is it'],
    match: q => (/\b(what('?s| is) the date|what day is it|today'?s date|public holiday|next holiday|working day|long weekend)\b/i.test(q) ? 0.85 : 0),
    run: (q, ents) => {
      const t = today();
      const upcoming = holidaysBetween(t, addDays(t, 200)).filter(x => x.type === 'public').slice(0, 5);
      let d = ents.dates && ents.dates.from !== t ? ents.dates.from : null;
      // "is 16 December a working day?" asks about the coming one
      if (d && d < t && /\b(is|will)\b/i.test(q) && !/\b(was|did|last)\b/i.test(q)) d = `${Number(d.slice(0, 4)) + 1}${d.slice(4)}`;
      const now = nowSA();
      let text = `Today is ${fmt.date(t, 'long')}, ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')} SAST.`;
      if (d) text += ` ${fmt.date(d, 'long')} is ${isWorkingDay(d) ? 'a working day' : 'not a working day'}.`;
      if (upcoming.length) text += ` The next public holiday is ${upcoming[0].name} on ${fmt.date(upcoming[0].date, 'long')}.`;
      return { text, cards: upcoming.length ? [{ type: 'table', columns: [{ key: 'date', label: 'Date', format: 'date' }, { key: 'name', label: 'Public holiday' }], rows: upcoming.map(x => ({ date: x.date, name: x.name })) }] : [], actions: [{ label: 'Open the calendar', href: '#/calendar' }], sources: ['holidays'] };
    }
  });
}
