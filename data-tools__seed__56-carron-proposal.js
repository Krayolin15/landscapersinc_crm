// Carron Glen Estate proposal (landscapers_data.zip, sent after the main company export): the Word version of the
// project plan with the once-off rehabilitation quote, plus 13 site images.
// The quote and job already exist (55-fleet.js, from "Project plan Carron.pdf"). This mapper only records that the
// proposal is a second source for them (so Drive links the .docx to both) and notes where the two documents disagree —
// it never changes an amount. The disagreement itself becomes a Data health issue (99-issues.js, CGP-D01).
// Source: knowledge/carron_glen_proposal.json.

export async function build(ctx) {
  if (!ctx.has('carron_glen_proposal')) return {};
  const K = ctx.k('carron_glen_proposal');
  const P = K.entities.proposal;
  const src = P.file;
  const out = { quotes: [], jobs: [] };

  const quote = ctx.records.quotes && ctx.records.quotes.get('qt-carron-rehab');
  if (quote) {
    const sameLines = P.rehab_quote.lines.length === (quote.lines || []).length &&
      P.rehab_quote.lines.every((l, i) => quote.lines[i] && quote.lines[i].description === l.description && Number(quote.lines[i].amount) === l.amount);
    const note = `The Carron Glen proposal (Carron_Glen_Estate_Proposal.docx) lists ${sameLines ? 'the same 8 items' : 'these items'} at R${P.rehab_quote.total_printed.toLocaleString('en-ZA')} with no discount; the project plan shows the same total discounted to R0.00. The quote follows the project plan until this is confirmed (Data health CGP-D01).`;
    // (re-running on an already-updated data pack must not add the note twice)
    const notes = String(quote.notes || '').includes('Carron_Glen_Estate_Proposal.docx') ? quote.notes : [quote.notes, note].filter(Boolean).join('\n\n');
    out.quotes.push({ id: quote.id, notes, _src: src });
    if (!sameLines) ctx.notes.push('Carron Glen: the proposal lines differ from the project-plan quote — check CGP-D01');
  } else ctx.notes.push('Carron Glen proposal: quote qt-carron-rehab not found — the proposal is filed in Drive without a quote link');

  const job = ctx.records.jobs && ctx.records.jobs.get('job-carron-glen-plan');
  if (job) out.jobs.push({ id: job.id, _src: src });
  return out;
}
