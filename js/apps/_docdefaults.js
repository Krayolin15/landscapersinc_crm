/* Company profile defaults (settings key 'company_profile' fills in the real values). Pure — used by the PDF tests. */
export const COMPANY_DEFAULTS = {
  trading_name: 'Landscapers Inc', legal_name: 'JKN Property Consortium (Pty) Ltd', reg_no: '2024/786147/07',
  address: 'Mount Edgecombe, Durban, KwaZulu-Natal', phone: '', email: '', website: '',
  vat_registered: false, vat_number: '', tax_ref: '', bbbee_level: '1',
  invoice_prefix: 'LSI-', next_invoice_no: 1001, quote_prefix: 'QT-', next_quote_no: 1001,
  default_due_days: 7, quote_valid_days: 30, deposit_pct: 50,
  invoice_terms: 'Monthly maintenance is payable on receipt of invoice. Additional projects or services are invoiced separately from monthly services and are due within 7 days of completion and by the due date indicated. Economical increase effective from 1 March annually.',
  invoice_footer_notes: 'Please use the invoice number as your payment reference and send proof of payment to accounts.',
  quote_terms: 'This quotation is valid for 30 days. A deposit is required to confirm the booking; the balance is due on completion. Prices exclude any items not listed.'
};
