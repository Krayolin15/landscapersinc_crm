/* =============================================================================
   Slides — pure helpers (no DOM, no db). Tested in tests__slides.test.js.
   A deck is slides.slides: [{ id, layout, title, subtitle, body, body2, image_file_id, notes }]
   Body text is plain text: "- " lines are bullets ("  - " = level 2), "value | label" lines
   feed the stats layout and "a | b | c" lines feed the table layout.
   Deck builders turn real company records into ready-to-present decks.
   ========================================================================== */

import { money, date as fmtDate } from '../../core/format.js';

export const THEMES = {
  forest: { name: 'Forest', bg: '#0f3d2a', bg2: '#1f7a4d', fg: '#ffffff', muted: '#cfe8d6', accent: '#9be15d' },
  sunrise: { name: 'Sunrise', bg: '#fff7ec', bg2: '#ffd9a8', fg: '#2b1d0e', muted: '#7a5a3a', accent: '#e8792b' },
  ocean: { name: 'Ocean', bg: '#0b2a40', bg2: '#1e9bc4', fg: '#ffffff', muted: '#c6e6f2', accent: '#5ee0c8' },
  charcoal: { name: 'Charcoal', bg: '#1d1f22', bg2: '#3a3f45', fg: '#f4f4f4', muted: '#b9bec4', accent: '#f2b42f' },
  paper: { name: 'Paper', bg: '#ffffff', bg2: '#eef5ef', fg: '#1b2a21', muted: '#5d6b62', accent: '#1f7a4d' }
};
export const LAYOUTS = [
  ['title', 'Title slide'], ['section', 'Section header'], ['content', 'Title & bullets'], ['two', 'Two columns'],
  ['image-right', 'Text + picture'], ['image-full', 'Full picture'], ['stats', 'Big numbers'], ['table', 'Table'], ['quote', 'Quote']
];
const LAYOUT_KEYS = new Set(LAYOUTS.map(l => l[0]));

let seq = 0;
export const slideId = () => `s${Date.now().toString(36)}${(seq++).toString(36)}`;
export function blankSlide(layout = 'content', o = {}) {
  return { id: slideId(), layout: LAYOUT_KEYS.has(layout) ? layout : 'content', title: '', subtitle: '', body: '', body2: '', image_file_id: null, notes: '', ...o };
}
/** Make any stored deck safe to render (ids, known layouts, strings). */
export function normaliseDeck(slides) {
  const list = Array.isArray(slides) && slides.length ? slides : [blankSlide('title', { title: 'Untitled presentation' })];
  const seen = new Set();
  return list.map(s => {
    let id = s && s.id ? String(s.id) : slideId();
    if (seen.has(id)) id = slideId();
    seen.add(id);
    return { ...blankSlide(), ...(s || {}), id, layout: LAYOUT_KEYS.has(s && s.layout) ? s.layout : 'content', title: String((s && s.title) ?? ''), subtitle: String((s && s.subtitle) ?? ''), body: String((s && s.body) ?? ''), body2: String((s && s.body2) ?? ''), notes: String((s && s.notes) ?? '') };
  });
}

/** "- a\n  - b\nplain" -> [{ type:'bullet', level:1, text:'a' }, { type:'bullet', level:2, text:'b' }, { type:'text', text:'plain' }] */
export function parseBody(text) {
  return String(text || '').split(/\r?\n/).map(l => l.replace(/\s+$/, '')).filter(l => l.trim() !== '').map(l => {
    const m = /^(\s*)[-*•]\s+(.*)$/.exec(l);
    return m ? { type: 'bullet', level: m[1].length >= 2 ? 2 : 1, text: m[2] } : { type: 'text', level: 0, text: l.trim() };
  });
}
/** "R 21 624 | Expenses in September" lines -> [{ value, label }] (max 4). */
export function parseStats(text) {
  return String(text || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean).slice(0, 4).map(l => { const [value, ...rest] = l.split('|'); return { value: value.trim(), label: rest.join('|').trim() }; });
}
/** "a | b | c" lines -> rows of cells; the first row is the header. */
export function parseTable(text) {
  return String(text || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean).map(l => l.split('|').map(c => c.trim()));
}
/** Words on a slide (for the "too much text" hint). */
export const wordCount = s => [s.title, s.subtitle, s.body, s.body2].join(' ').split(/\s+/).filter(w => /[\p{L}\p{N}]/u.test(w)).length;

/* ---------------- deck builders (all figures come from the records passed in) ---------------- */
const esc = s => String(s ?? '').replace(/\|/g, '/');
const contactLines = co => [co.phone && `- Phone: ${co.phone}`, co.whatsapp && `- WhatsApp: ${co.whatsapp}`, co.email && `- Email: ${co.email}`, co.address && `- ${co.address}`].filter(Boolean).join('\n');

/** Client proposal from a quote (+ its client / site / company profile). */
export function deckFromQuote(quote, { client, site, company: co = {}, services = [] } = {}) {
  const lines = (quote.lines || []).filter(l => l && l.description);
  const total = Number(quote.total ?? 0);
  const who = quote.client_name || (client && (client.name || client.display_name)) || 'our client'; // the addressee written on the quote wins
  const slides = [
    blankSlide('title', { title: quote.title || 'Landscaping proposal', subtitle: `Prepared for ${who}${site && site.address ? ` · ${site.address}` : ''}${quote.issue_date ? ` · ${fmtDate(quote.issue_date, 'long')}` : ''}`, notes: `Proposal generated from quote ${quote.number || quote.legacy_number || quote.id}.` }),
    blankSlide('content', { title: `About ${co.trading_name || 'us'}`, subtitle: co.tagline || '', body: [co.positioning && `- ${co.positioning.split(';').map(s => s.trim()).join('\n- ')}`, co.bbbee_level && `- Level ${co.bbbee_level} B-BBEE contributor`, co.address && `- Based in ${co.address.split(',').slice(-3, -1).join(',').trim() || co.address}`].filter(Boolean).join('\n') })
  ];
  if (lines.length) {
    slides.push(blankSlide('table', { title: 'Scope of work', body: ['Item | Qty | Unit price | Amount', ...lines.map(l => `${esc(l.description)} | ${l.qty ?? 1} | ${money(l.unit_price ?? 0)} | ${money(l.amount ?? (l.qty || 1) * (l.unit_price || 0))}`)].join('\n') }));
  } else {
    slides.push(blankSlide('content', { title: 'Scope of work', body: `- ${quote.title || 'Work as discussed on site'}${quote.notes ? `\n- ${quote.notes}` : ''}` }));
  }
  const subtotal = lines.reduce((s, l) => s + Number(l.amount ?? 0), 0);
  const stats = [`${money(total)} | Total investment${quote.vat_applied ? ' (incl. VAT)' : ''}`];
  if (lines.length && Number(quote.discount) > 0) stats.unshift(`${money(subtotal)} | Value of the work`, `${money(Number(quote.discount))} | Discount`);
  if (co.deposit_pct) stats.push(`${co.deposit_pct}% | Deposit to confirm`);
  slides.push(blankSlide('stats', { title: 'Your investment', body: stats.slice(0, 4).join('\n') }));
  if (services.length) slides.push(blankSlide('two', { title: 'Also available', body: services.slice(0, Math.ceil(Math.min(services.length, 12) / 2)).map(s => `- ${s}`).join('\n'), body2: services.slice(Math.ceil(Math.min(services.length, 12) / 2), 12).map(s => `- ${s}`).join('\n') }));
  slides.push(blankSlide('content', { title: 'Next steps', body: [`- Accept the quotation${co.quote_valid_days ? ` (valid for ${co.quote_valid_days} days)` : ''}`, co.deposit_pct ? `- Pay the ${co.deposit_pct}% deposit to book your start date` : null, '- We confirm the schedule and crew', contactLines(co)].filter(Boolean).join('\n'), notes: co.quote_terms || '' }));
  return slides;
}

/** Monthly business review. m = figures already computed from the records for that month. */
export function deckMonthly(m, co = {}) {
  const label = m.monthLabel || m.month;
  const slides = [
    blankSlide('title', { title: `Monthly business review — ${label}`, subtitle: co.trading_name || 'Landscapers Inc', notes: 'Figures are calculated from invoices, payments, expenses, visits and leads recorded in the system for this month.' }),
    blankSlide('stats', { title: 'Money', body: [`${money(m.invoiced)} | Invoiced`, `${money(m.received)} | Payments recorded`, `${money(m.expenses)} | Expenses`, `${money(m.invoiced - m.expenses)} | Invoiced less expenses`].join('\n') }),
    blankSlide('stats', { title: 'Operations', body: [`${m.visitsDone} | Visits completed`, `${m.visitsPlanned} | Visits scheduled`, `${m.newLeads} | New leads`, `${m.overdue} | Invoices overdue`].join('\n') })
  ];
  if (m.topClients && m.topClients.length) slides.push(blankSlide('table', { title: 'Top clients by value invoiced', body: ['Client | Invoices | Value', ...m.topClients.map(c => `${esc(c.name)} | ${c.count} | ${money(c.total)}`)].join('\n') }));
  if (m.expenseByCat && m.expenseByCat.length) slides.push(blankSlide('table', { title: 'Where the money went', body: ['Category | Amount', ...m.expenseByCat.map(c => `${esc(c.category)} | ${money(c.total)}`)].join('\n') }));
  slides.push(blankSlide('content', { title: 'Discussion', body: '- What went well\n- What slowed us down\n- Priorities for next month' }));
  return slides;
}

/** Toolbox talk deck from a recorded talk. */
export function deckFromTalk(talk) {
  const notes = String(talk.notes || '');
  const topics = (/Topics:\s*([^]*?)(?:\.\s|$)/i.exec(notes) || [])[1];
  const items = topics ? topics.split(/;\s*/).map(s => s.trim()).filter(Boolean) : [];
  const slides = [blankSlide('title', { title: `Toolbox talk: ${talk.topic || 'Safety'}`, subtitle: [talk.presenter && `Presented by ${talk.presenter}`, talk.date && fmtDate(talk.date, 'long')].filter(Boolean).join(' · ') })];
  if (items.length) slides.push(blankSlide('content', { title: 'Today we cover', body: items.map(t => `- ${t}`).join('\n') }));
  items.forEach(t => slides.push(blankSlide('section', { title: t, subtitle: talk.topic || '' })));
  slides.push(blankSlide('content', { title: 'Sign the attendance register', body: '- Every attendee signs the register\n- Ask questions now — safety is everyone’s job', notes: notes }));
  return slides;
}

/** Company profile deck. */
export function deckCompanyProfile(co = {}, servicesByCat = {}) {
  const slides = [
    blankSlide('title', { title: co.trading_name || 'Landscapers Inc', subtitle: co.tagline || '' }),
    blankSlide('content', { title: 'Who we are', body: [co.positioning && co.positioning.split(';').map(s => `- ${s.trim()}`).join('\n'), co.legal_name && `- ${co.legal_name}${co.reg_no ? ` (Reg. ${co.reg_no})` : ''}`, co.bbbee_level && `- Level ${co.bbbee_level} B-BBEE contributor`].filter(Boolean).join('\n') })
  ];
  const cats = Object.entries(servicesByCat).filter(([, list]) => list.length);
  for (let i = 0; i < cats.length; i += 2) {
    const [a, b] = [cats[i], cats[i + 1]];
    slides.push(blankSlide('two', { title: i ? 'Our services (continued)' : 'Our services', body: `${a[0]}\n${a[1].map(s => `- ${s}`).join('\n')}`, body2: b ? `${b[0]}\n${b[1].map(s => `- ${s}`).join('\n')}` : '' }));
  }
  slides.push(blankSlide('content', { title: 'Get in touch', body: contactLines(co) }));
  return slides;
}
