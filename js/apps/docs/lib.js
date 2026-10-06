/* Docs — pure helpers (no DOM, no db). Unit tested in tests/docs.test.js. */

/** Fill {{placeholders}} from a map; unknown ones are left visible so nobody sends a half-filled letter unknowingly. */
export const fillTemplate = (html, vars) => String(html || '').replace(/\{\{\s*([\w.]+)\s*\}\}/g, (m, k) => (vars[k] != null && vars[k] !== '' ? String(vars[k]).replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[c]) : m));

/** Headings for the outline panel: [{ level, text, index }]. */
export function outline(html) {
  const out = []; const re = /<h([1-4])[^>]*>([\s\S]*?)<\/h\1>/gi; let m, i = 0;
  while ((m = re.exec(String(html || '')))) out.push({ level: Number(m[1]), text: m[2].replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').trim(), index: i++ });
  return out.filter(o => o.text);
}

/** Keep the last `max` versions, never two identical in a row. */
export function pushVersion(versions, v, max = 30) {
  const list = Array.isArray(versions) ? versions.slice() : [];
  if (list.length && list[list.length - 1].html === v.html) return list;
  list.push(v);
  return list.slice(-max);
}

export const wordCount = text => (String(text || '').trim().match(/\S+/g) || []).length;

/** Review status of a controlled document (policy/SOP): current / review due (≤30 days) / overdue. */
export function reviewStatus(doc, on) {
  if (!doc.review_date) return { key: 'none', label: 'No review date', color: 'gray' };
  if (doc.review_date < on) return { key: 'overdue', label: 'Review overdue', color: 'red' };
  const days = Math.round((new Date(`${doc.review_date}T12:00:00`) - new Date(`${on}T12:00:00`)) / 864e5);
  return days <= 30 ? { key: 'due', label: `Review in ${days} day${days === 1 ? '' : 's'}`, color: 'gold' } : { key: 'current', label: 'Current', color: 'green' };
}

/** Word-compatible .doc (HTML with the Office namespace). */
export const toWordHtml = (title, html) => `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="utf-8"><title>${String(title).replace(/[<>&]/g, '')}</title><style>body{font-family:Calibri,Arial,sans-serif;font-size:11pt}table{border-collapse:collapse}td,th{border:1px solid #999;padding:4px}</style></head><body>${html}</body></html>`;
