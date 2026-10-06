/* =============================================================================
   Mail — pure logic (no DOM, no db, no Deno APIs): auto-triage, lead extraction and reply
   drafts. Shared by the Mail app and the inbound-email Edge Function.
   Unit tested in tests__mail.test.js.
   ========================================================================== */

export const TRIAGE = [
  { key: 'emergency', label: 'Emergency / storm', color: 'red', icon: 'siren', words: ['emergency', 'urgent', 'storm', 'fallen tree', 'tree fell', 'tree has fallen', 'flood', 'blocked drain', 'burst', 'dangerous', 'asap', 'immediately', 'hazard', 'collapsed'] },
  { key: 'pop', label: 'Proof of payment', color: 'green', icon: 'receipt', words: ['proof of payment', 'pop', 'payment made', 'paid', 'eft', 'transfer', 'deposit made', 'remittance', 'payment confirmation', 'notification of payment'] },
  { key: 'reschedule', label: 'Reschedule', color: 'gold', icon: 'calendar-clock', words: ['reschedule', 'postpone', 'change the date', 'move the visit', 'not home', "won't be home", 'cancel the visit', 'another day', 'next week instead', 'skip this week'] },
  { key: 'quote', label: 'Quote request', color: 'violet', icon: 'file-signature', words: ['quote', 'quotation', 'estimate', 'how much', 'price', 'pricing', 'cost for', 'interested in', 'looking for someone', 'can you do', 'garden service', 'landscaping', 'paving', 'lawn', 'tree felling', 'maintenance contract'] }
];
const norm = s => ` ${String(s || '').toLowerCase().replace(/[^a-z0-9@.' ]/g, ' ').replace(/\s+/g, ' ')} `;

/** { key, label, color, icon, score, reasons[] } — the strongest category, or 'general'. */
export function triage({ subject = '', body = '', attachments = [] } = {}) {
  const text = norm(`${subject} ${subject} ${body}`); // subject counts double
  let best = null;
  for (const c of TRIAGE) {
    const hits = c.words.filter(w => text.includes(` ${w} `) || text.includes(` ${w}`) && w.length > 5);
    let score = hits.length;
    if (c.key === 'pop' && (attachments || []).some(a => /pop|proof|payment|remit/i.test(a.name || ''))) { score += 2; hits.push('attachment name'); }
    if (c.key === 'emergency' && hits.length) score += 1.5; // safety first
    if (score > 0 && (!best || score > best.score)) best = { ...c, score, reasons: hits };
  }
  if (!best) return { key: 'general', label: 'General', color: 'gray', icon: 'mail', score: 0, reasons: [] };
  const { words, ...rest } = best;
  return rest;
}

/** Pull contact details out of an enquiry so it can become a lead. */
export function extractLead({ from_name = '', from_email = '', subject = '', body = '' } = {}) {
  const text = `${subject}\n${body}`;
  const phones = [...new Set((text.match(/(?:\+27|0)[\s-]?\d{2}[\s-]?\d{3}[\s-]?\d{4}/g) || []).map(p => p.replace(/[\s-]/g, '').replace(/^\+27/, '0')))];
  const emails = [...new Set((text.match(/[\w.+-]+@[\w-]+\.[\w.-]+/g) || []).map(e => e.toLowerCase()))];
  const addr = (text.match(/\b\d{1,4}[A-Za-z]?\s+[A-Z][\w'-]+(?:\s[A-Z][\w'-]+){0,3}\s(?:Road|Rd|Street|St|Drive|Dr|Avenue|Ave|Crescent|Cres|Place|Close|Way|Lane|Estate)\b[^\n,.]*/) || [])[0] || null;
  const suburbs = ['Mount Edgecombe', 'Umhlanga', 'La Lucia', 'Durban North', 'Glen Anil', 'Ballito', 'Zimbali', 'Umdloti', 'Westville', 'Kloof', 'Hillcrest', 'Pinetown', 'Sienna', 'Carron Glen', 'Forestclay', 'Izinga', 'Cornubia', 'Somerset Park', 'Sparks', 'Berea', 'Verulam'];
  const suburb = suburbs.find(s => new RegExp(`\\b${s}\\b`, 'i').test(text)) || null;
  const services = [['lawn', /lawn|grass|turf|sod/i], ['tree', /tree|palm|fell/i], ['hardscape', /pav|brick|rock|stone|hardscap/i], ['design', /design|landscap|makeover/i], ['cleanup', /clean[- ]?up|rubble|refuse/i], ['garden_maintenance', /maintenance|weekly|monthly|garden service/i], ['irrigation', /irrigat|sprinkler/i], ['gutter', /gutter|roof/i]].filter(([, re]) => re.test(text)).map(([k]) => k);
  const name = String(from_name || '').trim() || (from_email ? from_email.split('@')[0].replace(/[._]/g, ' ') : '');
  return { name, email: from_email ? from_email.toLowerCase() : emails[0] || null, phone: phones[0] || null, phones, emails, address: addr ? addr.trim() : null, suburb, services };
}

/** A polite South-African business reply for the triage category (the human edits before sending). */
export function draftReply(msg, cat = triage(msg), company = 'Landscapers Inc') {
  const first = String(msg.from_name || '').split(/\s+/)[0] || 'there';
  const lines = {
    emergency: `Thank you for letting us know — we understand this is urgent. Our team will call you shortly to arrange an emergency call-out. If anyone is in danger, please keep clear of the area and contact emergency services on 112.`,
    quote: `Thank you for your enquiry. We would love to help. Could you please send us the property address, a few photos of the area and the best time for a quick site visit? We usually send quotations within 24 hours of the visit.`,
    reschedule: `Thank you for letting us know. We have noted your request to move the visit and will confirm the new date with you shortly. Please let us know if a particular day suits you best.`,
    pop: `Thank you for your payment and the proof of payment. We will match it to your invoice as soon as it reflects in our account and send you a confirmation.`,
    general: `Thank you for your message. We will get back to you shortly.`
  };
  return `Good day ${first},\n\n${lines[cat.key] || lines.general}\n\nKind regards,\n${company}`;
}

/** Group messages into threads (newest first) by thread_id or normalised subject. */
export function threads(messages) {
  const map = new Map();
  for (const m of messages) {
    const key = m.thread_id || `s:${String(m.subject || '').toLowerCase().replace(/^((re|fwd?|fw):\s*)+/i, '').trim()}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(m);
  }
  return [...map.entries()].map(([key, list]) => { list.sort((a, b) => String(a.sent_at || a.created_at).localeCompare(String(b.sent_at || b.created_at))); return { key, messages: list, last: list[list.length - 1] }; })
    .sort((a, b) => String(b.last.sent_at || b.last.created_at).localeCompare(String(a.last.sent_at || a.last.created_at)));
}
