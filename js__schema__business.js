/* =============================================================================
   Business collections for Landscapers Inc. — derived from the company's own
   records (CRM workbooks, income statements, schedules, registers, invoices,
   sales workbook, KPI trackers, HR / H&S / compliance documents).
   Every seeded record keeps `_src` pointing at the exact source file and cell/page.
   ========================================================================== */

import { RULES } from '../core/validate.js';
import { documentTotals, toCents } from '../core/money.js';

const ALL = '*';
const MGMT = ['manager'];
const OFFICE = ['manager', 'finance', 'hr', 'sales', 'operations'];
const OPS = ['manager', 'operations', 'supervisor'];
const SALES = ['manager', 'sales'];
const FIN = ['manager', 'finance'];
const HR = ['manager', 'hr'];

/* ---------------- shared option lists ---------------- */
export const REGIONS = ['Mount Edgecombe', 'Umhlanga', 'La Lucia', 'Durban North', 'Glen Anil', 'Somerset Park', 'Sparks', 'Berea', 'Verulam', 'Ballito', 'Zimbali', 'Umdloti', 'Westville', 'Kloof', 'Hillcrest', 'Pinetown', 'Durban Central', 'Broadlands', 'Cornubia', 'Other'];
export const SERVICE_TYPES = [
  { value: 'garden_maintenance', label: 'Garden maintenance' }, { value: 'garden_pool', label: 'Garden maintenance & pool' }, { value: 'pool', label: 'Pool' },
  { value: 'lawn', label: 'Lawn installation / dressing' }, { value: 'design', label: 'Garden design & landscaping' }, { value: 'hardscape', label: 'Paving / rock work / hardscaping' },
  { value: 'tree', label: 'Tree felling / palm removal' }, { value: 'cleanup', label: 'Clean-up / rubble removal' }, { value: 'pressure_cleaning', label: 'Pressure cleaning' },
  { value: 'gutter', label: 'Roof & gutter cleaning' }, { value: 'irrigation', label: 'Irrigation' }, { value: 'planting', label: 'Planting / hedges' }, { value: 'indoor_plants', label: 'Indoor plants' }, { value: 'other', label: 'Other' }
];
export const FREQUENCIES = [
  { value: 'daily', label: 'Daily (working days)', perMonth: 20 }, { value: 'three_weekly', label: '3 × a week', perMonth: 12 }, { value: 'twice_weekly', label: '2 × a week', perMonth: 8 },
  { value: 'weekly', label: 'Weekly', perMonth: 4 }, { value: 'fortnightly', label: 'Fortnightly', perMonth: 2 }, { value: 'monthly', label: 'Monthly (ONCE)', perMonth: 1 }, { value: 'custom', label: 'Custom', perMonth: null }
];
export const visitsPerMonth = (freq, custom) => { const f = FREQUENCIES.find(x => x.value === freq); return f && f.perMonth ? f.perMonth : Number(custom) || null; };
export const LEAD_STAGES = [
  { value: 'new', label: 'New enquiry' }, { value: 'qualified', label: 'Qualified' }, { value: 'site_visit', label: 'Site visit' }, { value: 'quote_sent', label: 'Quote sent' },
  { value: 'follow_up', label: 'Follow-up' }, { value: 'won', label: 'Won' }, { value: 'lost', label: 'Lost' }, { value: 'nurture', label: 'Nurture (not now)' }, { value: 'closed_no_opportunity', label: 'Closed – no opportunity' }
];
export const LEAD_SOURCES = ['Referral', 'Google', 'Website', 'Repeat Client', 'Social Media', 'Walk-in', 'Cold call', 'Email', 'Other'];
export const SEGMENTS = ['Residential', 'Estate / HOA', 'Body corporate', 'Office park', 'Commercial / industrial', 'Estate agent', 'Property manager', 'School', 'Church', 'Hospitality', 'Retirement village', 'Retail', 'Government', 'Other'];
export const EXPENSE_CATEGORIES = [
  'Staff wages & overtime', 'Fuel & transit', 'Machinery servicing & blades', 'Vehicle repairs', 'Vehicle purchase', 'Equipment', 'Chemical & fertilizer stock', 'Nursery plants',
  'Protective gear (PPE)', 'Insurance', 'Medicals', 'Printing & branding', 'Telephone & internet', 'Storage', 'Bags & consumables', 'SARS / tax', 'Access / site fees', 'Trailer', 'Design & consulting', 'Miscellaneous'
];
const lineSum = rec => (Array.isArray(rec.lines) ? documentTotals(rec.lines, { vatRegistered: !!rec.vat_applied, docDiscount: rec.discount || 0 }).total : null);

/* =============================================================================
   CUSTOMERS & SALES
   ========================================================================== */
export const BUSINESS = {
  clients: {
    label: 'Clients', singular: 'Client', icon: 'users', tile: 't-forest', app: 'clients',
    display: r => r.name, subtitle: r => [r.legacy_code, r.suburb].filter(Boolean).join(' · '),
    search: ['name', 'legacy_code', 'company', 'contact_name', 'phone', 'email', 'address', 'suburb', 'notes'], sort: 'name',
    perms: { read: ALL, write: ['manager', 'sales', 'operations', 'finance', 'supervisor'], delete: MGMT },
    fields: {
      legacy_code: { type: 'text', label: 'Client code', list: true, hint: 'Code from the old CRM, e.g. GN003', group: 'Account' },
      name: { type: 'text', label: 'Client name', required: true, list: true, group: 'Account' },
      company: { type: 'text', label: 'Company / managing agent', list: true, group: 'Account' },
      client_type: { type: 'enum', label: 'Type', options: [{ value: 'residential', label: 'Residential' }, { value: 'commercial', label: 'Commercial' }, { value: 'body_corporate', label: 'Body corporate / estate' }, { value: 'managing_agent', label: 'Managing agent' }], default: 'residential', list: true, group: 'Account' },
      segment: { type: 'enum', label: 'Segment', options: SEGMENTS, group: 'Account' },
      status: { type: 'enum', label: 'Status', options: [{ value: 'active', label: 'Active' }, { value: 'paused', label: 'Paused' }, { value: 'adhoc', label: 'Ad-hoc / project only' }, { value: 'left', label: 'Left' }, { value: 'prospect', label: 'Prospect' }, { value: 'unverified', label: 'Needs review (found on invoices only)' }], default: 'active', list: true, group: 'Account' },
      contact_name: { type: 'text', label: 'Contact person', group: 'Contact' },
      position: { type: 'text', label: 'Contact position', group: 'Contact' },
      phone: { type: 'phone', label: 'Mobile', list: true, strict: false, group: 'Contact' },
      phone_alt: { type: 'phone', label: 'Other phone', strict: false, group: 'Contact' },
      email: { type: 'email', label: 'Email', strict: false, group: 'Contact' },
      billing_email: { type: 'email', label: 'Billing email', strict: false, group: 'Contact' },
      preferred_channel: { type: 'enum', label: 'Preferred channel', options: ['whatsapp', 'email', 'phone', 'sms'], default: 'whatsapp', group: 'Contact' },
      address: { type: 'text', label: 'Address', list: true, group: 'Location' },
      suburb: { type: 'text', label: 'Suburb / estate', list: true, group: 'Location' },
      region: { type: 'enum', label: 'Region', options: REGIONS, group: 'Location' },
      lat: { type: 'number', label: 'Latitude', hidden: true },
      lng: { type: 'number', label: 'Longitude', hidden: true },
      salesperson: { type: 'text', label: 'Salesperson', group: 'Account' },
      source: { type: 'enum', label: 'How they found us', options: LEAD_SOURCES, group: 'Account' },
      since_date: { type: 'date', label: 'Client since', group: 'Account' },
      left_date: { type: 'date', label: 'Left on', group: 'Account' },
      left_reason: { type: 'text', label: 'Reason for leaving', group: 'Account' },
      standing_instructions: { type: 'longtext', label: 'Standing instructions for crews', hint: 'e.g. NO CUTTING unless absolutely required · start 08:00 · finish by 10:30', group: 'Property dossier' },
      gate_code: { type: 'text', label: 'Gate / access code', group: 'Property dossier' },
      guardhouse: { type: 'longtext', label: 'Guardhouse protocol', group: 'Property dossier' },
      pets: { type: 'text', label: 'Pet alerts', group: 'Property dossier' },
      irrigation: { type: 'longtext', label: 'Irrigation zones', group: 'Property dossier' },
      power_water: { type: 'text', label: 'Electrical outlets / water points', group: 'Property dossier' },
      parking: { type: 'text', label: 'Parking & vehicle notes', group: 'Property dossier' },
      grass_type: { type: 'enum', label: 'Grass type', options: ['LM / Berea', 'Kikuyu', 'Buffalo', 'Cynodon', 'Mixed', 'Unknown'], group: 'Property dossier' },
      property_size_m2: { type: 'number', label: 'Garden size (m²)', min: 0, group: 'Property dossier' },
      slope: { type: 'enum', label: 'Slope', options: ['flat', 'gentle', 'steep'], group: 'Property dossier' },
      notes: { type: 'longtext', label: 'Notes' },
      tags: { type: 'tags', label: 'Tags' },
      drive_folder_id: { type: 'text', hidden: true }
    },
    rules: [rec => (!rec.phone && !rec.email && rec.status === 'active' ? { field: 'phone', message: 'An active client needs a phone number or an email', level: 'warning' } : null)]
  },

  sites: {
    label: 'Sites', singular: 'Site', icon: 'map-pin', tile: 't-grass', app: 'clients',
    display: r => r.name || r.address, subtitle: r => r.suburb || '',
    search: ['name', 'address', 'suburb', 'estate', 'contact_name'], sort: 'name',
    perms: { read: ALL, write: ['manager', 'sales', 'operations', 'supervisor'], delete: MGMT },
    fields: {
      client_id: { type: 'ref', ref: 'clients', label: 'Client', required: true, list: true },
      name: { type: 'text', label: 'Site name', required: true, list: true, hint: 'e.g. 11 SIENNA or Handsworth Estate' },
      address: { type: 'text', label: 'Address', list: true },
      suburb: { type: 'text', label: 'Suburb / estate', list: true },
      estate: { type: 'text', label: 'Estate / complex' },
      region: { type: 'enum', label: 'Region', options: REGIONS },
      contact_name: { type: 'text', label: 'Site contact' },
      contact_phone: { type: 'phone', label: 'Site contact phone', strict: false },
      instructions: { type: 'longtext', label: 'Standing instructions' },
      finish_by: { type: 'time', label: 'Must finish by' },
      start_at: { type: 'time', label: 'Start at' },
      gate_code: { type: 'text', label: 'Gate / access code' },
      pets: { type: 'text', label: 'Pet alerts' },
      video_required: { type: 'bool', label: 'Video / photo proof required' },
      lat: { type: 'number', hidden: true }, lng: { type: 'number', hidden: true },
      status: { type: 'enum', options: ['active', 'suspended', 'vacant', 'inactive'], default: 'active', list: true }
    }
  },

  contracts: {
    label: 'Maintenance contracts', singular: 'Contract', icon: 'file-check', tile: 't-forest', app: 'clients',
    display: r => r.name || r.legacy_code, subtitle: r => r.frequency || '',
    search: ['name', 'legacy_code', 'site_name', 'notes'], sort: 'name',
    perms: { read: ALL, write: ['manager', 'sales', 'finance', 'operations'], delete: MGMT },
    sensitiveRoles: ['manager', 'finance', 'sales', 'operations'],
    fields: {
      client_id: { type: 'ref', ref: 'clients', label: 'Client', required: true, list: true },
      site_id: { type: 'ref', ref: 'sites', label: 'Site', softRef: true },
      legacy_code: { type: 'text', label: 'Client code' },
      name: { type: 'text', label: 'Contract / site', required: true, list: true },
      site_name: { type: 'text', hidden: true },
      service_type: { type: 'enum', label: 'Service', options: SERVICE_TYPES, default: 'garden_maintenance', list: true },
      frequency: { type: 'enum', label: 'Frequency', options: FREQUENCIES.map(({ value, label }) => ({ value, label })), required: true, list: true },
      visits_per_month: { type: 'number', label: 'Visits per month', min: 0, hint: 'Used to work out the per-visit rate (weekly = 4, fortnightly = 2, daily = 20)' },
      monthly_value: { type: 'money', label: 'Monthly value (R)', min: 0, list: true, sensitive: true },
      per_visit_rate: { type: 'money', label: 'Per-visit rate (R)', precise: true, min: 0, sensitive: true, hint: 'Kept unrounded (e.g. R630.315); invoices round once' },
      status: { type: 'enum', label: 'Status', options: [{ value: 'active', label: 'Active' }, { value: 'paused', label: 'Paused' }, { value: 'suspended', label: 'Suspended' }, { value: 'left', label: 'Left' }], default: 'active', list: true },
      start_date: { type: 'date', label: 'Start date' },
      end_date: { type: 'date', label: 'End date' },
      pause_from: { type: 'date', label: 'Paused from' },
      pause_until: { type: 'date', label: 'Paused until' },
      pause_reason: { type: 'text', label: 'Pause reason' },
      preferred_days: { type: 'multi', label: 'Visit days', options: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] },
      preferred_time: { type: 'time', label: 'Fixed time' },
      crew_id: { type: 'ref', ref: 'crews', label: 'Usual crew', softRef: true },
      billing_status: { type: 'enum', label: 'Invoice status (legacy sheet)', options: ['invoice_sent', 'invoice_not_sent', 'paid', 'not_paid', 'unknown'] },
      annual_increase_month: { type: 'int', label: 'Annual increase month', min: 1, max: 12, default: 3, hint: 'Invoices state: economical increase effective from 1 March annually' },
      salesperson: { type: 'text', label: 'Sold by' },
      notes: { type: 'longtext', label: 'Notes' }
    },
    rules: [RULES.dateOrder('start_date', 'end_date'), RULES.dateOrder('pause_from', 'pause_until', 'Pause end')],
    beforeSave: rec => {
      const vpm = rec.visits_per_month || visitsPerMonth(rec.frequency);
      if (rec.monthly_value != null && vpm && rec.per_visit_rate == null) return { ...rec, visits_per_month: vpm, per_visit_rate: Number(rec.monthly_value) / vpm };
      return vpm && !rec.visits_per_month ? { ...rec, visits_per_month: vpm } : rec;
    }
  },

  contract_changes: {
    label: 'Contract changes', singular: 'Contract change', icon: 'git-compare-arrows', tile: 't-forest', app: 'clients', sort: '-effective_date',
    display: r => r.summary || 'Change',
    perms: { read: OFFICE, write: ['manager', 'sales', 'finance'], delete: MGMT },
    fields: {
      contract_id: { type: 'ref', ref: 'contracts', label: 'Contract', required: true, list: true },
      effective_date: { type: 'date', label: 'Effective from', required: true, list: true },
      summary: { type: 'text', label: 'Change', required: true, list: true },
      new_frequency: { type: 'enum', label: 'New frequency', options: FREQUENCIES.map(({ value, label }) => ({ value, label })) },
      new_monthly_value: { type: 'money', label: 'New monthly value', min: 0 },
      status: { type: 'enum', options: ['planned', 'applied', 'cancelled'], default: 'planned', list: true },
      notes: { type: 'longtext' }
    }
  },

  leads: {
    label: 'Leads', singular: 'Lead', icon: 'target', tile: 't-sun', app: 'leads',
    display: r => r.name, subtitle: r => [r.legacy_id, r.stage].filter(Boolean).join(' · '),
    search: ['name', 'legacy_id', 'contact_name', 'phone', 'email', 'address', 'notes', 'next_action'], sort: '-enquiry_date',
    perms: { read: ['manager', 'sales', 'finance'], write: SALES, delete: MGMT },
    fields: {
      legacy_id: { type: 'text', label: 'Lead ID (old register)', list: true },
      name: { type: 'text', label: 'Client / company', required: true, list: true },
      segment: { type: 'enum', label: 'Segment', options: SEGMENTS },
      contact_name: { type: 'text', label: 'Contact name', list: true },
      phone: { type: 'phone', label: 'Phone', strict: false },
      email: { type: 'email', label: 'Email', strict: false },
      address: { type: 'text', label: 'Address / area' },
      source: { type: 'enum', label: 'Lead source', options: LEAD_SOURCES, list: true },
      value: { type: 'money', label: 'Estimated value', min: 0, list: true },
      stage: { type: 'enum', label: 'Stage', options: LEAD_STAGES, default: 'new', required: true, list: true },
      listed_by: { type: 'text', label: 'Listed by', list: true },
      owner_id: { type: 'ref', ref: 'profiles', label: 'Owner', softRef: true },
      enquiry_date: { type: 'date', label: 'Enquiry date', list: true },
      last_contact: { type: 'date', label: 'Last contact' },
      follow_up_date: { type: 'date', label: 'Follow-up date', list: true },
      next_action: { type: 'text', label: 'Next action' },
      lost_reason: { type: 'text', label: 'Lost reason' },
      client_id: { type: 'ref', ref: 'clients', label: 'Converted client', softRef: true },
      notes: { type: 'longtext', label: 'Notes' },
      raw: { type: 'json', hidden: true }
    },
    rules: [rec => (['new', 'qualified', 'site_visit', 'quote_sent', 'follow_up'].includes(rec.stage) && !rec.follow_up_date ? { field: 'follow_up_date', message: 'Open leads should have a follow-up date', level: 'warning' } : null)]
  },

  prospects: {
    label: 'Prospects', singular: 'Prospect', icon: 'phone-call', tile: 't-sun', app: 'leads',
    display: r => r.name, subtitle: r => r.area || r.category || '',
    search: ['name', 'area', 'phone', 'email', 'category', 'last_outcome', 'notes'], sort: 'name',
    perms: { read: ['manager', 'sales'], write: SALES, delete: MGMT },
    fields: {
      name: { type: 'text', label: 'Name', required: true, list: true },
      category: { type: 'enum', label: 'Category', options: SEGMENTS, list: true },
      campaign: { type: 'text', label: 'Campaign / list', list: true },
      area: { type: 'text', label: 'Area', list: true },
      phone: { type: 'phone', label: 'Phone', strict: false, list: true },
      phones_all: { type: 'tags', label: 'All numbers' },
      email: { type: 'email', label: 'Email', strict: false },
      care_type: { type: 'text', label: 'Accommodation / care type' },
      status: { type: 'enum', label: 'Status', options: ['not_called', 'in_progress', 'callback', 'interested', 'converted', 'declined', 'unreachable', 'verify_details'], default: 'not_called', list: true },
      attempts: { type: 'int', label: 'Call attempts', min: 0 },
      last_outcome: { type: 'text', label: 'Last outcome' },
      callback_date: { type: 'date', label: 'Call back on' },
      lead_id: { type: 'ref', ref: 'leads', label: 'Lead', softRef: true },
      notes: { type: 'longtext', label: 'Notes' }
    }
  },

  call_attempts: {
    label: 'Call attempts', singular: 'Call attempt', icon: 'phone-outgoing', tile: 't-sun', app: 'leads', sort: '-date',
    display: r => `${r.channel || 'call'} · ${r.outcome || ''}`,
    perms: { read: ['manager', 'sales'], write: SALES, delete: MGMT },
    fields: {
      prospect_id: { type: 'ref', ref: 'prospects', label: 'Prospect', softRef: true, list: true },
      lead_id: { type: 'ref', ref: 'leads', label: 'Lead', softRef: true },
      attempt_no: { type: 'int', label: 'Attempt #', min: 1, list: true },
      date: { type: 'date', label: 'Date', list: true },
      channel: { type: 'enum', label: 'Channel', options: ['call', 'email', 'whatsapp', 'visit', 'sms', 'meeting'], default: 'call', list: true },
      outcome: { type: 'text', label: 'Outcome', list: true },
      outcome_class: { type: 'enum', options: ['no_answer', 'email_sent', 'whatsapp_sent', 'callback', 'meeting', 'declined', 'routing_issue', 'site_visit', 'interested', 'other'] },
      notes: { type: 'longtext' }
    }
  },

  services: {
    label: 'Services & pricing', singular: 'Service', icon: 'tag', tile: 't-grass', app: 'catalogue',
    display: r => r.name, search: ['name', 'code', 'category', 'description'], sort: 'name',
    perms: { read: ALL, write: ['manager', 'sales', 'finance'], delete: MGMT },
    fields: {
      code: { type: 'text', label: 'Code', unique: true, list: true },
      name: { type: 'text', label: 'Service', required: true, list: true },
      category: { type: 'enum', label: 'Category', options: SERVICE_TYPES, list: true },
      unit: { type: 'enum', label: 'Unit', options: ['visit', 'month', 'm2', 'hour', 'each', 'job', 'metre', 'load'], default: 'each', list: true },
      rate: { type: 'money', label: 'Standard rate (R)', min: 0, list: true, precise: true },
      min_charge: { type: 'money', label: 'Minimum charge', min: 0 },
      est_minutes: { type: 'int', label: 'Estimated minutes per unit', min: 0 },
      weather_sensitive: { type: 'bool', label: 'Weather sensitive (postpone in rain)', default: false },
      description: { type: 'longtext', label: 'Description (prints on quotes)' },
      price_history: { type: 'json', hidden: true },
      active: { type: 'bool', default: true, list: true }
    }
  },

  quotes: {
    label: 'Quotes', singular: 'Quote', icon: 'file-signature', tile: 't-clay', app: 'quotes',
    display: r => r.number || r.legacy_number || 'Quote', subtitle: r => r.client_name || '',
    search: ['number', 'legacy_number', 'client_name', 'title', 'notes'], sort: '-issue_date',
    perms: { read: ['manager', 'sales', 'finance', 'operations'], write: ['manager', 'sales', 'finance'], delete: MGMT },
    fields: {
      number: { type: 'text', label: 'Quote number', unique: true, list: true },
      legacy_number: { type: 'text', label: 'Old quote number' },
      lead_id: { type: 'ref', ref: 'leads', label: 'Lead', softRef: true },
      client_id: { type: 'ref', ref: 'clients', label: 'Client', softRef: true },
      client_name: { type: 'text', label: 'Client', required: true, list: true },
      title: { type: 'text', label: 'Description', required: true, list: true },
      issue_date: { type: 'date', label: 'Issued', recommended: true, list: true, hint: 'Required for new quotes; a few legacy quotes have unreadable dates (kept in "Date as written")' },
      issue_date_raw: { type: 'text', label: 'Date as written', readonly: true },
      valid_until: { type: 'date', label: 'Valid until', list: true },
      status: { type: 'enum', label: 'Status', options: ['draft', 'sent', 'viewed', 'accepted', 'rejected', 'expired', 'superseded'], default: 'draft', list: true },
      lines: { type: 'json', label: 'Line items' },
      discount: { type: 'money', label: 'Discount (R)', min: 0 },
      vat_applied: { type: 'bool', label: 'Add VAT', default: false },
      total: { type: 'money', label: 'Total (R)', min: 0, list: true },
      deposit_pct: { type: 'percent', label: 'Deposit %', default: 50 },
      deposit_amount: { type: 'money', label: 'Deposit (R)', min: 0 },
      deposit_status: { type: 'enum', label: 'Deposit', options: ['not_required', 'requested', 'paid', 'overdue'], default: 'requested' },
      salesperson: { type: 'text', label: 'Salesperson' },
      terms: { type: 'longtext', label: 'Terms' },
      notes: { type: 'longtext', label: 'Notes' },
      version: { type: 'int', default: 1, min: 1 },
      parent_id: { type: 'ref', ref: 'quotes', softRef: true, hidden: true },
      approval_token: { type: 'text', hidden: true },
      approved_at: { type: 'datetime', label: 'Approved at' },
      approved_name: { type: 'text', label: 'Approved by (client)' },
      signature: { type: 'signature', label: 'Client signature' },
      job_id: { type: 'ref', ref: 'jobs', softRef: true, hidden: true }
    },
    rules: [RULES.dateOrder('issue_date', 'valid_until', 'Valid-until'), RULES.totalMatches('total', rec => (Array.isArray(rec.lines) && rec.lines.length ? lineSum(rec) : null))]
  },

  invoices: {
    label: 'Invoices', singular: 'Invoice', icon: 'receipt', tile: 't-violet', app: 'invoices',
    display: r => r.number || r.legacy_number || 'Invoice', subtitle: r => r.client_name || '',
    search: ['number', 'legacy_number', 'reference', 'client_name', 'period', 'notes'], sort: '-issue_date',
    perms: { read: ['manager', 'finance', 'sales', 'supervisor'], write: ['manager', 'finance', 'sales', 'supervisor'], delete: FIN },
    fields: {
      number: { type: 'text', label: 'Invoice number', unique: true, list: true },
      legacy_number: { type: 'text', label: 'Number printed on original', hint: 'Old invoices reused numbers per client — kept here exactly as printed' },
      reference: { type: 'text', label: 'Payment reference', list: true },
      client_id: { type: 'ref', ref: 'clients', label: 'Client', softRef: true },
      client_name: { type: 'text', label: 'Client', required: true, list: true },
      bill_to: { type: 'longtext', label: 'Bill-to details' },
      kind: { type: 'enum', label: 'Type', options: [{ value: 'maintenance', label: 'Monthly maintenance' }, { value: 'adhoc', label: 'Ad-hoc / project' }, { value: 'deposit', label: 'Deposit' }, { value: 'balance', label: 'Balance' }, { value: 'credit_note', label: 'Credit note' }], default: 'maintenance', list: true },
      period: { type: 'text', label: 'Service month', pattern: '^\\d{4}-\\d{2}$', patternHint: 'should be YYYY-MM' },
      issue_date: { type: 'date', label: 'Invoice date', required: true, list: true },
      due_date: { type: 'date', label: 'Due date', list: true },
      lines: { type: 'json', label: 'Line items' },
      discount: { type: 'money', label: 'Discount (R)', min: 0 },
      vat_applied: { type: 'bool', label: 'VAT charged', default: false },
      subtotal: { type: 'money', label: 'Subtotal' },
      vat: { type: 'money', label: 'VAT' },
      total: { type: 'money', label: 'Total (R)', required: true, list: true },
      amount_paid: { type: 'money', label: 'Paid (R)', min: 0, default: 0, list: true },
      status: { type: 'enum', label: 'Status', options: [{ value: 'draft', label: 'Draft' }, { value: 'unpaid', label: 'Unpaid' }, { value: 'partially_paid', label: 'Partially paid' }, { value: 'awaiting_pop', label: 'Awaiting POP verification' }, { value: 'paid', label: 'Paid' }, { value: 'overdue', label: 'Overdue' }, { value: 'void', label: 'Void' }, { value: 'not_recorded', label: 'Payment not recorded (legacy)' }], default: 'draft', list: true },
      total_override_reason: { type: 'text', label: 'Why the total differs from the lines', hint: 'Only for legacy invoices whose printed total disagrees with their own lines' },
      sent_at: { type: 'datetime', label: 'Sent' },
      sent_via: { type: 'tags', label: 'Sent via' },
      quote_id: { type: 'ref', ref: 'quotes', softRef: true, hidden: true },
      job_id: { type: 'ref', ref: 'jobs', softRef: true, hidden: true },
      contract_id: { type: 'ref', ref: 'contracts', softRef: true, hidden: true },
      terms: { type: 'longtext', label: 'Terms' },
      notes: { type: 'longtext', label: 'Notes' },
      signature: { type: 'signature', label: 'Client signature (on site)' },
      reminders_sent: { type: 'json', hidden: true },
      source_file: { type: 'text', label: 'Original PDF', readonly: true }
    },
    rules: [
      RULES.dateOrder('issue_date', 'due_date', 'Due date'),
      rec => (rec.total_override_reason ? null : RULES.totalMatches('total', r => (Array.isArray(r.lines) && r.lines.length ? lineSum(r) : null))(rec)),
      rec => (rec.amount_paid != null && rec.total != null && toCents(rec.amount_paid) > toCents(rec.total) + 0 ? { field: 'amount_paid', message: 'Paid amount is more than the invoice total' } : null),
      rec => (rec.status === 'paid' && rec.total != null && toCents(rec.amount_paid || 0) < toCents(rec.total) ? { field: 'status', message: 'Marked paid but the payments do not cover the total', level: 'warning' } : null)
    ]
  },

  payments: {
    label: 'Payments', singular: 'Payment', icon: 'wallet', tile: 't-rose', app: 'payments',
    display: r => `${r.client_name || 'Payment'} · R${Number(r.amount || 0).toFixed(2)}`, sort: '-date',
    search: ['client_name', 'reference', 'notes'],
    perms: { read: FIN, write: FIN.concat(['sales']), delete: FIN },
    fields: {
      date: { type: 'date', label: 'Date received', required: true, list: true },
      client_id: { type: 'ref', ref: 'clients', label: 'Client', softRef: true },
      client_name: { type: 'text', label: 'Client', list: true },
      invoice_id: { type: 'ref', ref: 'invoices', label: 'Invoice', softRef: true, list: true },
      amount: { type: 'money', label: 'Amount (R)', required: true, min: 0.01, list: true },
      method: { type: 'enum', label: 'Method', options: ['eft', 'cash', 'card', 'cheque', 'other'], default: 'eft', list: true },
      reference: { type: 'text', label: 'Bank reference', list: true },
      status: { type: 'enum', label: 'Verification', options: [{ value: 'verified', label: 'Verified' }, { value: 'awaiting_verification', label: 'Awaiting verification (POP)' }, { value: 'rejected', label: 'Rejected' }], default: 'verified', list: true },
      pop_file_id: { type: 'text', label: 'Proof of payment file', hidden: true },
      matched_by: { type: 'enum', options: ['manual', 'auto_reference', 'auto_amount', 'auto_name'], default: 'manual' },
      match_confidence: { type: 'percent' },
      notes: { type: 'longtext' }
    }
  },

  /* =============================================================================
     OPERATIONS
     ========================================================================== */
  crews: {
    label: 'Crews', singular: 'Crew', icon: 'users-round', tile: 't-river', app: 'schedule',
    display: r => r.name, sort: 'name',
    perms: { read: ALL, write: OPS, delete: MGMT },
    fields: {
      name: { type: 'text', label: 'Crew name', required: true, unique: true, list: true },
      leader_id: { type: 'ref', ref: 'employees', label: 'Team leader / driver', softRef: true, list: true },
      members: { type: 'refs', ref: 'employees', label: 'Members', list: true },
      vehicle_id: { type: 'ref', ref: 'vehicles', label: 'Vehicle', softRef: true, list: true },
      color: { type: 'color', label: 'Colour' },
      capacity_per_day: { type: 'int', label: 'Visits per day (capacity)', min: 1, default: 10 },
      active: { type: 'bool', default: true, list: true },
      notes: { type: 'longtext' }
    }
  },

  visits: {
    label: 'Visits', singular: 'Visit', icon: 'route', tile: 't-river', app: 'schedule',
    display: r => `${r.site_name || 'Visit'} · ${r.date || ''}`, sort: 'date',
    search: ['site_name', 'client_name', 'crew_names', 'notes', 'instructions'],
    perms: { read: ALL, write: ALL, delete: OPS },
    fields: {
      date: { type: 'date', label: 'Date', required: true, list: true },
      site_id: { type: 'ref', ref: 'sites', label: 'Site', softRef: true },
      site_name: { type: 'text', label: 'Site', required: true, list: true },
      client_id: { type: 'ref', ref: 'clients', label: 'Client', softRef: true },
      client_name: { type: 'text', label: 'Contact', list: true },
      contract_id: { type: 'ref', ref: 'contracts', softRef: true, hidden: true },
      job_id: { type: 'ref', ref: 'jobs', softRef: true, hidden: true },
      kind: { type: 'enum', label: 'Type', options: ['maintenance', 'project', 'quote_visit', 'callback', 'inspection'], default: 'maintenance' },
      crew_id: { type: 'ref', ref: 'crews', label: 'Crew', softRef: true },
      crew_names: { type: 'text', label: 'Crew (names)', list: true },
      start_time: { type: 'time', label: 'Start' },
      finish_by: { type: 'time', label: 'Finish by' },
      planned_minutes: { type: 'int', label: 'Planned minutes', min: 0 },
      instructions: { type: 'text', label: 'Instructions', list: true },
      status: { type: 'enum', label: 'Status', options: [{ value: 'scheduled', label: 'Scheduled' }, { value: 'in_progress', label: 'In progress' }, { value: 'completed', label: 'Completed' }, { value: 'skipped', label: 'Skipped' }, { value: 'no_access', label: 'No access' }, { value: 'rescheduled', label: 'Rescheduled' }, { value: 'weather_postponed', label: 'Weather postponed' }, { value: 'cancelled', label: 'Cancelled' }], default: 'scheduled', list: true },
      check_in_at: { type: 'datetime', label: 'Checked in' },
      check_out_at: { type: 'datetime', label: 'Checked out' },
      actual_minutes: { type: 'int', label: 'Actual minutes', min: 0 },
      site_check: { type: 'json', label: 'Site check' },
      photos_before: { type: 'json', hidden: true },
      photos_after: { type: 'json', hidden: true },
      client_signature: { type: 'signature', label: 'Client sign-off' },
      quality_score: { type: 'int', label: 'Quality score', min: 0, max: 100 },
      complaint: { type: 'text', label: 'Complaint' },
      rescheduled_from: { type: 'date', label: 'Moved from' },
      reschedule_reason: { type: 'text', label: 'Reason moved' },
      geo: { type: 'json', hidden: true },
      notes: { type: 'longtext', label: 'Notes' }
    }
  },

  jobs: {
    label: 'Jobs & projects', singular: 'Job', icon: 'shovel', tile: 't-clay', app: 'jobs',
    display: r => `${r.number ? r.number + ' · ' : ''}${r.title || 'Job'}`, subtitle: r => r.client_name || '',
    search: ['number', 'title', 'client_name', 'site_address', 'notes', 'service_type'], sort: '-start_date',
    perms: { read: ALL, write: ['manager', 'operations', 'sales', 'supervisor', 'finance'], delete: MGMT },
    sensitiveRoles: ['manager', 'finance', 'sales', 'operations'],
    fields: {
      number: { type: 'text', label: 'Job number', list: true },
      title: { type: 'text', label: 'Job', required: true, list: true },
      client_id: { type: 'ref', ref: 'clients', label: 'Client', softRef: true },
      client_name: { type: 'text', label: 'Client', list: true },
      site_address: { type: 'text', label: 'Site address' },
      suburb: { type: 'text', label: 'Suburb' },
      service_type: { type: 'enum', label: 'Service', options: SERVICE_TYPES, list: true },
      quote_id: { type: 'ref', ref: 'quotes', label: 'Quote', softRef: true },
      status: { type: 'enum', label: 'Status', options: [{ value: 'quoted', label: 'Quoted' }, { value: 'awaiting_deposit', label: 'Awaiting deposit' }, { value: 'scheduled', label: 'Scheduled' }, { value: 'in_progress', label: 'In progress' }, { value: 'on_hold', label: 'On hold' }, { value: 'completed', label: 'Completed' }, { value: 'invoiced', label: 'Invoiced' }, { value: 'closed_paid', label: 'Closed — paid' }, { value: 'cancelled', label: 'Cancelled' }], default: 'scheduled', list: true },
      month: { type: 'text', label: 'Month', hint: 'YYYY-MM when only the month is known' },
      booked_date: { type: 'date', label: 'Booked' },
      start_date: { type: 'date', label: 'Start', list: true },
      est_finish: { type: 'date', label: 'Estimated finish' },
      completed_date: { type: 'date', label: 'Completed' },
      value: { type: 'money', label: 'Job value (R)', min: 0, list: true, sensitive: true },
      deposit: { type: 'money', label: 'Deposit (R)', min: 0, sensitive: true },
      deposit_status: { type: 'enum', label: 'Deposit status', options: ['not_required', 'requested', 'paid', 'awaiting_payment'] },
      cost: { type: 'money', label: 'Direct cost (R)', min: 0, sensitive: true },
      profit: { type: 'money', label: 'Profit (R)', sensitive: true },
      owing: { type: 'money', label: 'Owing (R)', sensitive: true },
      est_hours: { type: 'number', label: 'Estimated crew-hours', min: 0 },
      actual_hours: { type: 'number', label: 'Actual crew-hours', min: 0 },
      supervisor: { type: 'text', label: 'Supervisor' },
      team: { type: 'text', label: 'Team' },
      vehicle_id: { type: 'ref', ref: 'vehicles', label: 'Vehicle', softRef: true },
      salesperson: { type: 'text', label: 'Salesperson' },
      invoice_status: { type: 'text', label: 'Invoice status (legacy)' },
      notes: { type: 'longtext', label: 'Notes' }
    },
    rules: [RULES.dateOrder('start_date', 'completed_date', 'Completed date')]
  },

  job_costs: {
    label: 'Job costs', singular: 'Job cost', icon: 'coins', tile: 't-clay', app: 'jobs', sort: '-date',
    display: r => r.description, perms: { read: OFFICE, write: ['manager', 'operations', 'finance'], delete: FIN },
    fields: {
      job_id: { type: 'ref', ref: 'jobs', label: 'Job', required: true, list: true },
      date: { type: 'date', label: 'Date', list: true },
      category: { type: 'enum', label: 'Category', options: ['materials', 'plants', 'labour', 'fuel', 'equipment_hire', 'dumping', 'subcontractor', 'other'], list: true },
      description: { type: 'text', label: 'Description', required: true, list: true },
      amount: { type: 'money', label: 'Amount (R)', required: true, min: 0, list: true },
      supplier: { type: 'text', label: 'Supplier' }
    }
  },

  vehicles: {
    label: 'Vehicles', singular: 'Vehicle', icon: 'truck', tile: 't-slate', app: 'fleet',
    display: r => r.name, subtitle: r => r.registration || '', search: ['name', 'registration', 'make', 'model', 'vin'], sort: 'name',
    perms: { read: ALL, write: ['manager', 'operations', 'finance'], delete: MGMT },
    fields: {
      name: { type: 'text', label: 'Vehicle', required: true, unique: true, list: true, hint: 'e.g. H100, NP 200, Trailer' },
      kind: { type: 'enum', label: 'Type', options: ['bakkie', 'truck', 'trailer', 'car', 'other'], default: 'bakkie', list: true },
      registration: { type: 'text', label: 'Registration', list: true },
      make: { type: 'text', label: 'Make' }, model: { type: 'text', label: 'Model' }, year: { type: 'int', label: 'Year', min: 1980, max: 2100 },
      vin: { type: 'text', label: 'VIN' }, engine_no: { type: 'text', label: 'Engine number' }, colour: { type: 'text', label: 'Colour' },
      purchase_date: { type: 'date', label: 'Purchased' },
      purchase_price: { type: 'money', label: 'Purchase price (R)', min: 0 },
      seller: { type: 'text', label: 'Bought from' },
      odometer_km: { type: 'int', label: 'Odometer (km)', min: 0, list: true },
      last_service_date: { type: 'date', label: 'Last service', list: true },
      last_service_km: { type: 'int', label: 'Km at last service', min: 0 },
      next_service_date: { type: 'date', label: 'Next service due', list: true },
      next_service_km: { type: 'int', label: 'Next service at (km)', min: 0 },
      service_interval_km: { type: 'int', label: 'Service interval (km)', min: 0 },
      service_interval_months: { type: 'int', label: 'Service interval (months)', min: 0 },
      licence_expiry: { type: 'date', label: 'Licence disc expiry', list: true },
      insurance_note: { type: 'text', label: 'Insurance' },
      fuel_l_per_100km: { type: 'number', label: 'Fuel use (L/100 km)', min: 0 },
      driver_id: { type: 'ref', ref: 'employees', label: 'Usual driver', softRef: true },
      status: { type: 'enum', options: ['active', 'in_service', 'broken_down', 'sold'], default: 'active', list: true },
      notes: { type: 'longtext' }
    },
    rules: [rec => (rec.last_service_date && rec.next_service_date && rec.next_service_date < rec.last_service_date ? { field: 'next_service_date', message: 'Next service date is before the last service — check the year', level: 'warning' } : null)]
  },

  vehicle_logs: {
    label: 'Vehicle log', singular: 'Log entry', icon: 'fuel', tile: 't-slate', app: 'fleet', sort: '-date',
    display: r => `${r.type} · ${r.date}`, perms: { read: ALL, write: ['manager', 'operations', 'supervisor', 'finance', 'field'], delete: MGMT },
    fields: {
      vehicle_id: { type: 'ref', ref: 'vehicles', label: 'Vehicle', required: true, list: true },
      date: { type: 'date', label: 'Date', required: true, list: true },
      type: { type: 'enum', label: 'Type', options: ['fuel', 'service', 'repair', 'trip', 'licence', 'breakdown', 'inspection', 'tyres'], required: true, list: true },
      odometer_km: { type: 'int', label: 'Odometer (km)', min: 0, list: true },
      litres: { type: 'number', label: 'Litres', min: 0 },
      amount: { type: 'money', label: 'Amount (R)', min: 0, list: true },
      supplier: { type: 'text', label: 'Supplier / garage' },
      description: { type: 'text', label: 'Description', list: true },
      next_due_date: { type: 'date', label: 'Next due' },
      next_due_km: { type: 'int', label: 'Next due (km)', min: 0 }
    }
  },

  assets: {
    label: 'Assets & equipment', singular: 'Asset', icon: 'wrench', tile: 't-slate', app: 'assets',
    display: r => `${r.asset_no ? '#' + r.asset_no + ' ' : ''}${r.name}`, search: ['name', 'asset_no', 'brand', 'model', 'serial_no', 'assigned_to', 'category'], sort: 'name',
    perms: { read: ALL, write: ['manager', 'operations', 'supervisor', 'finance'], delete: MGMT },
    fields: {
      asset_no: { type: 'text', label: 'Asset #', list: true },
      name: { type: 'text', label: 'Item', required: true, list: true },
      category: { type: 'enum', label: 'Category', options: ['machine', 'manual_tool', 'hand_tool', 'ppe', 'vehicle', 'trailer', 'branding', 'office', 'design', 'other'], list: true },
      brand: { type: 'text', label: 'Brand' }, model: { type: 'text', label: 'Model' }, serial_no: { type: 'text', label: 'Serial number' },
      quantity: { type: 'number', label: 'Quantity', min: 0, default: 1 },
      purchase_date: { type: 'date', label: 'Purchased' },
      cost: { type: 'money', label: 'Cost (R)', min: 0, list: true },
      cost_raw: { type: 'text', label: 'Cost as recorded', readonly: true },
      vat_basis: { type: 'enum', label: 'VAT basis', options: ['incl', 'excl', 'unknown'], default: 'unknown' },
      supplier: { type: 'text', label: 'Supplier' },
      assigned_to: { type: 'text', label: 'Assigned to (crew / location)', list: true },
      location: { type: 'text', label: 'Location' },
      condition: { type: 'enum', label: 'Condition', options: ['good', 'fair', 'service', 'broken', 'lost', 'retired'], default: 'good', list: true },
      status: { type: 'enum', label: 'Status', options: ['active', 'inactive', 'disposed'], default: 'active', list: true },
      warranty_expiry: { type: 'date', label: 'Warranty expiry' },
      hours_used: { type: 'number', label: 'Engine hours', min: 0 },
      service_interval_days: { type: 'int', label: 'Service every (days)', min: 0 },
      service_interval_hours: { type: 'int', label: 'Service every (hours)', min: 0 },
      next_service_date: { type: 'date', label: 'Next service', list: true },
      register: { type: 'enum', label: 'Register', options: ['ops_register', 'costing_sheet', 'both'], hidden: true },
      notes: { type: 'longtext' }
    }
  },

  asset_maintenance: {
    label: 'Maintenance tickets', singular: 'Maintenance ticket', icon: 'hammer', tile: 't-slate', app: 'assets', sort: '-reported_date',
    display: r => `${r.type || 'Service'} · ${r.asset_name || ''}`,
    perms: { read: ALL, write: ['manager', 'operations', 'supervisor'], delete: MGMT },
    fields: {
      asset_id: { type: 'ref', ref: 'assets', label: 'Asset', softRef: true, list: true },
      asset_name: { type: 'text', label: 'Asset', list: true },
      type: { type: 'enum', label: 'Type', options: ['service', 'repair', 'cleaning', 'inspection', 'blades'], default: 'service', list: true },
      description: { type: 'text', label: 'Description' },
      reported_date: { type: 'date', label: 'Reported', list: true },
      completed_date: { type: 'date', label: 'Completed', list: true },
      performed_by: { type: 'text', label: 'Performed by' },
      cost: { type: 'money', label: 'Cost (R)', min: 0, list: true },
      next_due: { type: 'date', label: 'Next due', list: true },
      status: { type: 'enum', options: ['open', 'in_progress', 'closed'], default: 'open', list: true },
      notes: { type: 'longtext' }
    },
    rules: [RULES.dateOrder('reported_date', 'completed_date', 'Completed date')]
  },

  suppliers: {
    label: 'Suppliers', singular: 'Supplier', icon: 'store', tile: 't-clay', app: 'suppliers', display: r => r.name, sort: 'name',
    search: ['name', 'contact_name', 'phone', 'email', 'category'],
    perms: { read: ALL, write: ['manager', 'operations', 'finance'], delete: MGMT },
    fields: {
      name: { type: 'text', label: 'Supplier', required: true, unique: true, list: true },
      category: { type: 'text', label: 'Supplies', list: true },
      contact_name: { type: 'text', label: 'Contact' }, phone: { type: 'phone', label: 'Phone', strict: false, list: true }, email: { type: 'email', label: 'Email', strict: false },
      address: { type: 'text', label: 'Address' }, account_no: { type: 'text', label: 'Our account number' }, notes: { type: 'longtext' }
    }
  },

  purchases: {
    label: 'Purchases', singular: 'Purchase', icon: 'shopping-cart', tile: 't-clay', app: 'suppliers', sort: '-date',
    display: r => r.description, search: ['description', 'supplier_name', 'reference'],
    perms: { read: OFFICE, write: ['manager', 'operations', 'finance'], delete: FIN },
    fields: {
      date: { type: 'date', label: 'Date', required: true, list: true },
      supplier_id: { type: 'ref', ref: 'suppliers', label: 'Supplier', softRef: true },
      supplier_name: { type: 'text', label: 'Supplier', list: true },
      description: { type: 'text', label: 'What was bought', required: true, list: true },
      amount: { type: 'money', label: 'Amount (R)', min: 0, list: true },
      reference: { type: 'text', label: 'Reference / proforma no.' },
      status: { type: 'enum', options: ['quoted', 'ordered', 'paid', 'received'], default: 'paid', list: true },
      asset_id: { type: 'ref', ref: 'assets', softRef: true, hidden: true },
      vehicle_id: { type: 'ref', ref: 'vehicles', softRef: true, hidden: true },
      notes: { type: 'longtext' }
    }
  },

  /* =============================================================================
     PEOPLE & SAFETY
     ========================================================================== */
  employees: {
    label: 'Employees', singular: 'Employee', icon: 'id-card', tile: 't-forest', app: 'people',
    display: r => r.full_name || [r.first_name, r.last_name].filter(Boolean).join(' ') || r.known_as, subtitle: r => [r.known_as, r.position].filter(Boolean).join(' · '),
    search: ['full_name', 'first_name', 'last_name', 'known_as', 'position', 'phone', 'employee_no', 'aliases'], sort: 'full_name',
    perms: { read: ['manager', 'hr', 'operations', 'supervisor', 'finance'], write: HR, delete: ['owner'] },
    sensitiveRoles: ['manager', 'hr', 'finance'],
    fields: {
      employee_no: { type: 'text', label: 'Employee #', list: true, group: 'Identity' },
      full_name: { type: 'text', label: 'Full name', required: true, list: true, group: 'Identity' },
      first_name: { type: 'text', label: 'First name', group: 'Identity' },
      last_name: { type: 'text', label: 'Surname', group: 'Identity' },
      known_as: { type: 'text', label: 'Known as (on schedules)', list: true, group: 'Identity', hint: 'e.g. ZULU, JUICE, MKIZE' },
      aliases: { type: 'tags', label: 'Other spellings', group: 'Identity', hint: 'e.g. SINOKO / SKOKO / SINKONKE' },
      id_number: { type: 'sa_id', label: 'SA ID number', sensitive: true, strict: false, group: 'Identity' },
      passport_no: { type: 'text', label: 'Passport / permit', sensitive: true, group: 'Identity' },
      date_of_birth: { type: 'date', label: 'Date of birth', sensitive: true, group: 'Identity' },
      gender: { type: 'enum', label: 'Gender', options: ['Male', 'Female', 'Other'], group: 'Identity' },
      phone: { type: 'phone', label: 'Mobile', strict: false, list: true, group: 'Contact' },
      email: { type: 'email', label: 'Email', strict: false, group: 'Contact' },
      address: { type: 'longtext', label: 'Home address', sensitive: true, group: 'Contact' },
      next_of_kin: { type: 'text', label: 'Next of kin / emergency contact', sensitive: true, group: 'Contact' },
      position: { type: 'text', label: 'Position', list: true, group: 'Employment' },
      department: { type: 'enum', label: 'Department', options: ['Management', 'Admin', 'Sales', 'Operations', 'Field', 'Finance', 'HR'], group: 'Employment' },
      employment_type: { type: 'enum', label: 'Employment type', options: ['permanent', 'fixed_term', 'casual', 'ad_hoc', 'contractor', 'director'], group: 'Employment' },
      start_date: { type: 'date', label: 'Start date', group: 'Employment' },
      end_date: { type: 'date', label: 'End date', group: 'Employment' },
      status: { type: 'enum', label: 'Status', options: [{ value: 'active', label: 'Active' }, { value: 'on_leave', label: 'On leave' }, { value: 'resigned', label: 'Resigned' }, { value: 'dismissed', label: 'Dismissed' }, { value: 'contract_ended', label: 'Contract ended' }, { value: 'left', label: 'Left (reason not recorded)' }], default: 'active', list: true, group: 'Employment' },
      reason_for_leaving: { type: 'text', label: 'Reason for leaving', group: 'Employment' },
      ppe_returned: { type: 'enum', label: 'PPE returned on exit', options: ['yes', 'partial', 'no', 'n/a'], group: 'Employment' },
      pay_basis: { type: 'enum', label: 'Pay basis', options: ['monthly', 'weekly', 'daily', 'hourly'], sensitive: true, group: 'Pay' },
      pay_rate: { type: 'money', label: 'Pay rate (R)', min: 0, sensitive: true, group: 'Pay' },
      bank_name: { type: 'text', label: 'Bank', sensitive: true, group: 'Pay' },
      bank_account: { type: 'bank_account', label: 'Account number', sensitive: true, strict: false, group: 'Pay' },
      crew_id: { type: 'ref', ref: 'crews', label: 'Crew', softRef: true, group: 'Employment' },
      is_driver: { type: 'bool', label: 'Driver / team leader', group: 'Employment' },
      profile_id: { type: 'ref', ref: 'profiles', label: 'System login', softRef: true, hidden: true },
      photo_file_id: { type: 'text', hidden: true },
      notes: { type: 'longtext', label: 'Notes' }
    },
    rules: [RULES.dateOrder('start_date', 'end_date')]
  },

  payroll: {
    label: 'Payroll', singular: 'Pay line', icon: 'banknote', tile: 't-forest', app: 'finance', sort: '-period',
    display: r => `${r.employee_name} · ${r.period}`, search: ['employee_name', 'period'],
    perms: { read: ['manager', 'finance', 'hr'], write: ['manager', 'finance', 'hr'], delete: FIN },
    fields: {
      period: { type: 'text', label: 'Month', required: true, pattern: '^\\d{4}-\\d{2}$', patternHint: 'should be YYYY-MM', list: true },
      employee_id: { type: 'ref', ref: 'employees', label: 'Employee', softRef: true },
      employee_name: { type: 'text', label: 'Employee', required: true, list: true },
      gross: { type: 'money', label: 'Gross (R)', min: 0, list: true },
      deductions: { type: 'money', label: 'Deductions (R)', min: 0, default: 0, list: true },
      net: { type: 'money', label: 'Net (R)', list: true },
      overtime_hours: { type: 'number', label: 'Overtime hours', min: 0 },
      notes: { type: 'text' }
    }
  },

  deductions: {
    label: 'Staff deductions', singular: 'Deduction', icon: 'minus-circle', tile: 't-rose', app: 'people', sort: '-date',
    display: r => `${r.employee_name} · R${r.amount}`, perms: { read: ['manager', 'finance', 'hr'], write: ['manager', 'finance', 'hr'], delete: FIN },
    fields: {
      employee_id: { type: 'ref', ref: 'employees', softRef: true, label: 'Employee' },
      employee_name: { type: 'text', label: 'Employee', required: true, list: true },
      date: { type: 'date', label: 'Date', list: true }, period: { type: 'text', label: 'Month' },
      amount: { type: 'money', label: 'Amount (R)', required: true, min: 0, list: true },
      reason: { type: 'text', label: 'Reason', list: true }
    }
  },

  certificates: {
    label: 'Training & certificates', singular: 'Certificate', icon: 'graduation-cap', tile: 't-river', app: 'training',
    display: r => `${r.course} · ${r.person_name}`, search: ['person_name', 'course', 'provider', 'certificate_no'], sort: 'expiry_date',
    perms: { read: ['manager', 'hr', 'operations', 'supervisor'], write: HR.concat(['operations']), delete: HR },
    sensitiveRoles: ['manager', 'hr'], // ID numbers on certificates: HR keeps the training records
    fields: {
      employee_id: { type: 'ref', ref: 'employees', label: 'Employee', softRef: true },
      person_name: { type: 'text', label: 'Name on certificate', required: true, list: true },
      id_number: { type: 'text', label: 'ID number on certificate', sensitive: true },
      course: { type: 'text', label: 'Course / qualification', required: true, list: true },
      course_type: { type: 'enum', label: 'Type', options: ['first_aid', 'fire_fighting', 'working_at_heights', 'she_rep', 'horticulture', 'machinery', 'driver', 'other'], list: true },
      level: { type: 'text', label: 'Level' },
      provider: { type: 'text', label: 'Training provider', list: true },
      accreditation: { type: 'text', label: 'Accreditation (SETA / SAQA)' },
      unit_standards: { type: 'text', label: 'Unit standards / credits' },
      certificate_no: { type: 'text', label: 'Certificate number' },
      issue_date: { type: 'date', label: 'Issued / completed', list: true },
      expiry_date: { type: 'date', label: 'Expires', list: true },
      validity_rule: { type: 'text', label: 'How expiry was set', hint: 'e.g. printed on certificate, or provider standard of 3 years' },
      result: { type: 'text', label: 'Result' },
      file_id: { type: 'text', hidden: true },
      notes: { type: 'longtext' }
    },
    rules: [RULES.dateOrder('issue_date', 'expiry_date', 'Expiry')]
  },

  medicals: {
    label: 'Medical certificates', singular: 'Medical', icon: 'heart-pulse', tile: 't-rose', app: 'medicals',
    display: r => `${r.person_name} · ${r.exam_type || 'Medical'}`, search: ['person_name', 'practitioner', 'outcome'], sort: 'expiry_date',
    perms: { read: HR, write: HR, delete: HR },
    fields: {
      employee_id: { type: 'ref', ref: 'employees', label: 'Employee', softRef: true },
      person_name: { type: 'text', label: 'Employee', required: true, list: true },
      exam_type: { type: 'enum', label: 'Exam type', options: ['pre_employment', 'periodic', 'exit', 'return_to_work', 'working_at_heights', 'other'], list: true },
      exam_date: { type: 'date', label: 'Exam date', list: true },
      practitioner: { type: 'text', label: 'Clinic / practitioner', list: true },
      outcome: { type: 'enum', label: 'Outcome', options: [{ value: 'fit', label: 'Fit' }, { value: 'fit_with_restrictions', label: 'Fit with restrictions' }, { value: 'temporarily_unfit', label: 'Temporarily unfit' }, { value: 'unfit', label: 'Unfit' }, { value: 'unknown', label: 'Not stated' }], list: true },
      restrictions: { type: 'text', label: 'Restrictions / conditions' },
      tests: { type: 'json', label: 'Tests performed' },
      expiry_date: { type: 'date', label: 'Next medical due', list: true },
      confidential_note: { type: 'text', label: 'Clinical details', default: 'Confidential clinical details present — retained in source document only' },
      file_id: { type: 'text', hidden: true }
    },
    rules: [RULES.dateOrder('exam_date', 'expiry_date', 'Next medical')]
  },

  appointments: {
    label: 'Legal appointments', singular: 'Appointment', icon: 'badge-check', tile: 't-rose', app: 'safety',
    display: r => `${r.appointment} · ${r.person_name}`, sort: 'appointment',
    perms: { read: ALL, write: HR.concat(['operations']), delete: HR },
    fields: {
      employee_id: { type: 'ref', ref: 'employees', label: 'Employee', softRef: true },
      person_name: { type: 'text', label: 'Appointee', required: true, list: true },
      appointment: { type: 'text', label: 'Appointment', required: true, list: true, hint: 'e.g. Section 16(2) assistant, First aider, Fire fighter, SHE representative' },
      legal_reference: { type: 'text', label: 'Legal reference', list: true, hint: 'e.g. OHS Act 85 of 1993 s16(2); GSR 3' },
      appointed_by: { type: 'text', label: 'Appointed by' },
      appointment_date: { type: 'date', label: 'Date', list: true },
      review_date: { type: 'date', label: 'Review / expiry', list: true },
      duties: { type: 'longtext', label: 'Duties' },
      file_id: { type: 'text', hidden: true }
    }
  },

  incidents: {
    label: 'Incidents', singular: 'Incident', icon: 'siren', tile: 't-rose', app: 'safety',
    display: r => `${r.number ? r.number + ' · ' : ''}${r.type || 'Incident'}`, search: ['number', 'description', 'location', 'people_involved'], sort: '-date',
    perms: { read: ALL, write: ALL, delete: HR },
    fields: {
      number: { type: 'text', label: 'Incident #', list: true },
      date: { type: 'date', label: 'Date', required: true, list: true, notFuture: true },
      time: { type: 'time', label: 'Time' },
      location: { type: 'text', label: 'Location / site', list: true },
      site_id: { type: 'ref', ref: 'sites', softRef: true, hidden: true },
      type: { type: 'enum', label: 'Type', options: [{ value: 'injury', label: 'Injury' }, { value: 'near_miss', label: 'Near miss' }, { value: 'property_damage', label: 'Property damage (client)' }, { value: 'vehicle', label: 'Vehicle' }, { value: 'equipment', label: 'Equipment' }, { value: 'environmental', label: 'Environmental / spill' }, { value: 'security', label: 'Security' }, { value: 'complaint', label: 'Client complaint' }], required: true, list: true },
      severity: { type: 'enum', label: 'Severity', options: ['low', 'medium', 'high', 'critical'], default: 'low', list: true },
      people_involved: { type: 'text', label: 'Employee(s) involved' },
      description: { type: 'longtext', label: 'What happened', required: true },
      immediate_action: { type: 'longtext', label: 'Immediate action taken' },
      root_cause: { type: 'longtext', label: 'Root cause' },
      corrective_action: { type: 'longtext', label: 'Corrective action' },
      investigation: { type: 'json', hidden: true },
      reportable: { type: 'bool', label: 'Reportable (COIDA / Dept of Labour)' },
      status: { type: 'enum', label: 'Status', options: ['open', 'investigating', 'closed'], default: 'open', list: true },
      photos: { type: 'json', hidden: true }
    }
  },

  ppe_issues: {
    label: 'PPE issues', singular: 'PPE issue', icon: 'hard-hat', tile: 't-sun', app: 'safety', sort: '-date',
    display: r => `${r.employee_name} · ${r.date}`, perms: { read: ['manager', 'hr', 'operations', 'supervisor'], write: HR.concat(['operations', 'supervisor']), delete: HR },
    fields: {
      employee_id: { type: 'ref', ref: 'employees', softRef: true, label: 'Employee' },
      employee_name: { type: 'text', label: 'Employee', required: true, list: true },
      date: { type: 'date', label: 'Date issued', required: true, list: true },
      items: { type: 'json', label: 'Items (item, size, qty)' },
      items_text: { type: 'text', label: 'Items', list: true },
      signature: { type: 'signature', label: 'Employee signature' },
      returned: { type: 'enum', options: ['no', 'partial', 'yes'], default: 'no', list: true }
    }
  },

  hr_actions: {
    label: 'Counselling, warnings & grievances', singular: 'HR action', icon: 'gavel', tile: 't-clay', app: 'people', sort: '-date',
    display: r => `${r.type} · ${r.employee_name}`, perms: { read: HR, write: HR, delete: HR },
    fields: {
      employee_id: { type: 'ref', ref: 'employees', softRef: true, label: 'Employee' },
      employee_name: { type: 'text', label: 'Employee', required: true, list: true },
      type: { type: 'enum', label: 'Type', options: ['counselling', 'verbal_warning', 'written_warning', 'final_warning', 'grievance', 'hearing', 'commendation'], required: true, list: true },
      date: { type: 'date', label: 'Date', required: true, list: true },
      description: { type: 'longtext', label: 'Details', required: true },
      outcome: { type: 'longtext', label: 'Outcome' },
      valid_until: { type: 'date', label: 'Warning valid until' },
      status: { type: 'enum', options: ['open', 'closed'], default: 'open', list: true }
    }
  },

  toolbox_talks: {
    label: 'Toolbox talks', singular: 'Toolbox talk', icon: 'megaphone', tile: 't-sun', app: 'safety', sort: '-date',
    display: r => r.topic, perms: { read: ALL, write: ['manager', 'operations', 'supervisor', 'hr'], delete: HR },
    fields: {
      date: { type: 'date', label: 'Date', required: true, list: true },
      topic: { type: 'text', label: 'Topic', required: true, list: true },
      presenter: { type: 'text', label: 'Presented by', list: true },
      attendees: { type: 'refs', ref: 'employees', label: 'Attendees' },
      attendee_names: { type: 'text', label: 'Attendees (names)' },
      notes: { type: 'longtext', label: 'Content / notes' }
    }
  },

  compliance_docs: {
    label: 'Company compliance', singular: 'Compliance document', icon: 'scale', tile: 't-slate', app: 'compliance',
    display: r => r.name, search: ['name', 'doc_type', 'number', 'issuer'], sort: 'expiry_date',
    perms: { read: OFFICE, write: ['manager', 'finance', 'hr'], delete: MGMT },
    fields: {
      name: { type: 'text', label: 'Document', required: true, list: true },
      doc_type: { type: 'enum', label: 'Type', options: ['company_registration', 'bbbee', 'tax_clearance', 'coida', 'insurance', 'bank_confirmation', 'director_id', 'contract', 'minutes', 'proxy', 'profile', 'pricing_schedule', 'letter', 'other'], list: true },
      number: { type: 'text', label: 'Number / reference', list: true },
      issuer: { type: 'text', label: 'Issued by', list: true },
      issue_date: { type: 'date', label: 'Issued' },
      expiry_date: { type: 'date', label: 'Expires / renew by', list: true },
      status: { type: 'enum', options: ['valid', 'expiring', 'expired', 'unknown'], default: 'unknown', list: true },
      key_facts: { type: 'json', label: 'Key facts' },
      summary: { type: 'longtext', label: 'Summary' },
      file_id: { type: 'text', hidden: true }
    }
  },

  /* =============================================================================
     FINANCE
     ========================================================================== */
  expenses: {
    label: 'Expenses', singular: 'Expense', icon: 'receipt-text', tile: 't-forest', app: 'finance',
    display: r => `${r.description} · ${r.period || r.date || ''}`, search: ['description', 'category', 'category_raw', 'supplier'], sort: '-period',
    perms: { read: FIN, write: FIN, delete: FIN },
    fields: {
      period: { type: 'text', label: 'Month', required: true, pattern: '^\\d{4}-\\d{2}$', patternHint: 'should be YYYY-MM', list: true },
      date: { type: 'date', label: 'Date' },
      category: { type: 'enum', label: 'Category', options: EXPENSE_CATEGORIES, required: true, list: true },
      category_raw: { type: 'text', label: 'Category as recorded', readonly: true },
      description: { type: 'text', label: 'Description', required: true, list: true },
      amount: { type: 'money', label: 'Amount (R)', required: true, list: true },
      supplier: { type: 'text', label: 'Supplier' },
      is_capital: { type: 'bool', label: 'Capital purchase (one-off)', default: false, list: true },
      vehicle_id: { type: 'ref', ref: 'vehicles', softRef: true, label: 'Vehicle' },
      job_id: { type: 'ref', ref: 'jobs', softRef: true, label: 'Job' },
      receipt_file_id: { type: 'text', hidden: true },
      version_note: { type: 'text', label: 'Source version note', readonly: true }
    }
  },

  financial_periods: {
    label: 'Monthly statements', singular: 'Month', icon: 'landmark', tile: 't-forest', app: 'finance',
    display: r => r.period, sort: 'period',
    perms: { read: FIN, write: FIN, delete: ['owner'] },
    fields: {
      period: { type: 'text', label: 'Month', required: true, unique: true, pattern: '^\\d{4}-\\d{2}$', list: true },
      income_recorded: { type: 'money', label: 'Income (as recorded)', list: true },
      income_captured: { type: 'bool', label: 'Income captured', default: true },
      staff_costs: { type: 'money', label: 'Staff costs', list: true },
      operation_costs_recorded: { type: 'money', label: 'Operation costs (sheet total)' },
      operation_costs_lines: { type: 'money', label: 'Operation costs (sum of lines)', list: true },
      net_recorded: { type: 'money', label: 'Net profit / loss (sheet)', list: true },
      owner_funding: { type: 'money', label: 'Owner investment in', list: true },
      status: { type: 'enum', options: ['open', 'closed'], default: 'closed', list: true },
      notes: { type: 'longtext', label: 'Notes / reconciliation' }
    }
  },

  owner_funding: {
    label: 'Owner funding', singular: 'Capital injection', icon: 'piggy-bank', tile: 't-sun', app: 'finance', sort: '-date',
    display: r => `R${r.amount} · ${r.period || r.date}`, perms: { read: FIN, write: FIN, delete: ['owner'] },
    fields: {
      date: { type: 'date', label: 'Date' }, period: { type: 'text', label: 'Month', list: true },
      amount: { type: 'money', label: 'Amount (R)', required: true, list: true },
      kind: { type: 'enum', label: 'Type', options: ['loan', 'equity', 'unknown'], default: 'unknown', list: true },
      notes: { type: 'text' }
    }
  },

  bank_accounts: {
    label: 'Bank accounts', singular: 'Bank account', icon: 'building-2', tile: 't-slate', app: 'finance', display: r => `${r.bank} · ${r.account_no}`,
    perms: { read: OFFICE.concat(['supervisor']), write: ['manager', 'finance'], delete: ['owner'] },
    fields: {
      account_name: { type: 'text', label: 'Account name', required: true, list: true }, bank: { type: 'text', label: 'Bank', required: true, list: true },
      account_no: { type: 'bank_account', label: 'Account number', required: true, list: true }, branch_code: { type: 'branch_code', label: 'Branch code', list: true },
      account_type: { type: 'text', label: 'Account type' }, is_default: { type: 'bool', label: 'Print on invoices', default: true },
      confirmation_file_id: { type: 'text', hidden: true }, notes: { type: 'text' }
    }
  },

  /* =============================================================================
     PERFORMANCE & STRATEGY
     ========================================================================== */
  kpi_definitions: {
    label: 'KPI definitions', singular: 'KPI', icon: 'gauge', tile: 't-sun', app: 'kpi', display: r => r.name, sort: 'name',
    perms: { read: ALL, write: MGMT, delete: MGMT },
    fields: {
      key: { type: 'text', label: 'Key', required: true, unique: true },
      name: { type: 'text', label: 'KPI', required: true, list: true },
      owner_role: { type: 'text', label: 'Owner', list: true },
      tracker: { type: 'text', label: 'Tracker', list: true, hint: 'e.g. Sales KPI (Wayne), GM KPI (Anthony), Operations weekly' },
      unit: { type: 'enum', options: ['count', 'rand', 'percent', 'score', 'days', 'hours'], default: 'count', list: true },
      target: { type: 'number', label: 'Target', list: true },
      target_period: { type: 'enum', options: ['day', 'week', 'month', 'quarter', 'year'], default: 'week' },
      direction: { type: 'enum', options: ['higher', 'lower'], default: 'higher' },
      weight: { type: 'number', label: 'Scoring weight' },
      scoring: { type: 'json', label: 'Scoring bands' },
      auto_source: { type: 'text', label: 'Calculated automatically from', hint: 'Leave empty for manual capture' },
      description: { type: 'longtext' }
    }
  },

  kpi_entries: {
    label: 'KPI entries', singular: 'KPI entry', icon: 'chart-no-axes-column', tile: 't-sun', app: 'kpi', sort: '-date',
    display: r => `${r.kpi_name} · ${r.date}`, search: ['kpi_name', 'person_name', 'notes'],
    perms: { read: ALL, write: ['manager', 'sales', 'operations', 'finance', 'hr'], delete: MGMT },
    fields: {
      kpi_key: { type: 'text', label: 'KPI', required: true },
      kpi_name: { type: 'text', label: 'KPI', list: true },
      person_name: { type: 'text', label: 'Person', list: true },
      profile_id: { type: 'ref', ref: 'profiles', softRef: true, hidden: true },
      date: { type: 'date', label: 'Date / week ending', required: true, list: true },
      period: { type: 'enum', options: ['day', 'week', 'month'], default: 'week' },
      value: { type: 'number', label: 'Value', required: true, list: true },
      target: { type: 'number', label: 'Target', list: true },
      score: { type: 'number', label: 'Score' },
      notes: { type: 'text', label: 'Notes' }
    }
  },

  goals: {
    label: 'Goals & plan', singular: 'Goal', icon: 'flag', tile: 't-clay', app: 'strategy', display: r => r.title, sort: 'due_date',
    search: ['title', 'description', 'owner_name', 'pillar'],
    perms: { read: OFFICE, write: MGMT.concat(['sales', 'operations', 'finance', 'hr']), delete: MGMT },
    fields: {
      title: { type: 'text', label: 'Goal / milestone', required: true, list: true },
      pillar: { type: 'text', label: 'Focus area / pillar', list: true },
      plan: { type: 'text', label: 'Plan', hint: 'e.g. 12-month plan, Key focus areas Jul–Sep 2026' },
      phase: { type: 'text', label: 'Phase / quarter' },
      owner_name: { type: 'text', label: 'Owner', list: true },
      start_date: { type: 'date', label: 'Start' },
      due_date: { type: 'date', label: 'Due', list: true },
      status: { type: 'enum', options: ['not_started', 'on_track', 'at_risk', 'behind', 'done', 'dropped'], default: 'not_started', list: true },
      progress: { type: 'percent', label: 'Progress %', default: 0, list: true },
      measure: { type: 'text', label: 'How success is measured' },
      target_value: { type: 'number', label: 'Target value' },
      current_value: { type: 'number', label: 'Current value' },
      parent_id: { type: 'ref', ref: 'goals', softRef: true, hidden: true },
      description: { type: 'longtext' }
    }
  },

  meetings: {
    label: 'Meetings', singular: 'Meeting', icon: 'presentation', tile: 't-river', app: 'strategy', sort: '-date',
    display: r => `${r.title} · ${r.date}`, perms: { read: OFFICE.concat(['supervisor']), write: OFFICE, delete: MGMT },
    fields: {
      title: { type: 'text', label: 'Meeting', required: true, list: true },
      kind: { type: 'enum', options: ['weekly_operations', 'weekly_sales', 'management', 'client', 'site', 'board', 'other'], list: true },
      date: { type: 'date', label: 'Date', required: true, list: true },
      time: { type: 'time', label: 'Time' },
      attendees: { type: 'text', label: 'Attendees' },
      agenda: { type: 'json', label: 'Agenda' },
      minutes: { type: 'richtext', label: 'Minutes' },
      actions: { type: 'json', label: 'Action items' },
      event_id: { type: 'text', hidden: true }
    }
  },

  design_options: {
    label: 'Design & paving options', singular: 'Design option', icon: 'palette', tile: 't-sun', app: 'catalogue', display: r => r.name, sort: 'deck',
    search: ['name', 'deck', 'description'],
    perms: { read: ALL, write: ['manager', 'sales'], delete: MGMT },
    fields: {
      deck: { type: 'text', label: 'Collection', list: true, hint: 'Garden design options / Paving options' },
      slide_no: { type: 'int', label: 'Slide', min: 1, list: true },
      name: { type: 'text', label: 'Option', required: true, list: true },
      description: { type: 'longtext', label: 'Description' },
      price_hint: { type: 'text', label: 'Price guide' },
      image_paths: { type: 'json', hidden: true }
    }
  },

  references: {
    label: 'Client references', singular: 'Reference', icon: 'award', tile: 't-sun', app: 'marketing', display: r => r.from_name,
    perms: { read: ALL, write: ['manager', 'sales'], delete: MGMT },
    fields: {
      from_name: { type: 'text', label: 'From', required: true, list: true },
      organisation: { type: 'text', label: 'Organisation', list: true },
      date: { type: 'date', label: 'Date', list: true },
      contact: { type: 'text', label: 'Contact details' },
      summary: { type: 'longtext', label: 'What they say' },
      quote: { type: 'longtext', label: 'Highlight quote' },
      file_id: { type: 'text', hidden: true }
    }
  },

  /* =============================================================================
     AUTONOMOUS CORE (24/7 agent) & COMMUNICATIONS
     ========================================================================== */
  agent_runs: {
    label: 'Agent runs', singular: 'Agent run', icon: 'bot', tile: 't-aurora', app: 'agent', sort: '-started_at', audit: false,
    display: r => `${r.kind} · ${r.started_at || ''}`,
    perms: { read: ['manager', 'operations', 'finance'], write: ALL, delete: MGMT },
    fields: {
      kind: { type: 'enum', label: 'Job', options: ['morning_dispatch', 'executive_briefing', 'payment_reminders', 'pop_matching', 'mail_triage', 'learning', 'expiry_watch', 'client_care', 'equipment_watch', 'manual'], required: true, list: true },
      runner: { type: 'enum', label: 'Ran on', options: ['cloud', 'browser'], default: 'browser', list: true },
      started_at: { type: 'datetime', label: 'Started', list: true },
      finished_at: { type: 'datetime', label: 'Finished' },
      status: { type: 'enum', options: ['running', 'ok', 'warning', 'failed'], default: 'running', list: true },
      summary: { type: 'longtext', label: 'Summary', list: true },
      stats: { type: 'json' },
      error: { type: 'text' }
    }
  },

  agent_decisions: {
    label: 'Agent decisions', singular: 'Decision', icon: 'sparkles', tile: 't-aurora', app: 'agent', sort: '-created_at',
    display: r => r.title, search: ['title', 'detail', 'kind'],
    perms: { read: ['manager', 'operations', 'finance', 'sales'], write: ALL, delete: MGMT },
    fields: {
      run_id: { type: 'ref', ref: 'agent_runs', softRef: true, hidden: true },
      kind: { type: 'enum', label: 'Type', options: ['weather_reschedule', 'crew_assignment', 'route_plan', 'payment_reminder', 'pop_match', 'invoice_draft', 'mail_triage', 'reply_draft', 'lead_created', 'maintenance_due', 'client_outreach', 'expiry_alert', 'other'], list: true },
      title: { type: 'text', label: 'Decision', required: true, list: true },
      detail: { type: 'longtext', label: 'Why' },
      affected: { type: 'json', hidden: true },
      requires_approval: { type: 'bool', label: 'Needs owner approval', default: false, list: true },
      status: { type: 'enum', label: 'Status', options: [{ value: 'applied', label: 'Applied' }, { value: 'pending', label: 'Awaiting approval' }, { value: 'approved', label: 'Approved' }, { value: 'rejected', label: 'Rejected' }, { value: 'reverted', label: 'Reverted' }, { value: 'suggested', label: 'Suggestion' }], default: 'applied', list: true },
      decided_by: { type: 'text', label: 'Approved / rejected by' },
      decided_at: { type: 'datetime' },
      revert: { type: 'json', hidden: true }
    }
  },

  briefings: {
    label: 'Daily briefings', singular: 'Briefing', icon: 'sunrise', tile: 't-sun', app: 'home', sort: '-date', audit: false,
    display: r => `Briefing · ${r.date}`,
    perms: { read: ['manager', 'operations', 'finance', 'sales', 'hr'], write: ALL, delete: MGMT },
    fields: {
      date: { type: 'date', label: 'Date', required: true, list: true },
      generated_at: { type: 'datetime', label: 'Generated', list: true },
      runner: { type: 'enum', options: ['cloud', 'browser'], default: 'browser' },
      headline: { type: 'text', label: 'Headline', list: true },
      sections: { type: 'json', label: 'Sections' },
      weather: { type: 'json', hidden: true },
      sent_to: { type: 'json', hidden: true }
    }
  },

  outbox: {
    label: 'Message outbox', singular: 'Message', icon: 'send', tile: 't-rose', app: 'mail', sort: '-created_at',
    display: r => `${r.channel} → ${r.to_name || r.to}`, search: ['to', 'to_name', 'subject', 'body'],
    perms: { read: OFFICE, write: ALL, delete: MGMT },
    fields: {
      channel: { type: 'enum', label: 'Channel', options: ['email', 'whatsapp', 'sms'], required: true, list: true },
      to: { type: 'text', label: 'To', required: true, list: true },
      to_name: { type: 'text', label: 'Name', list: true },
      subject: { type: 'text', label: 'Subject' },
      body: { type: 'longtext', label: 'Message', required: true },
      attachments: { type: 'json', hidden: true },
      status: { type: 'enum', options: ['draft', 'queued', 'needs_approval', 'sent', 'failed', 'cancelled', 'opened_link'], default: 'queued', list: true },
      scheduled_for: { type: 'datetime', label: 'Send at' },
      sent_at: { type: 'datetime', label: 'Sent', list: true },
      provider_id: { type: 'text', hidden: true },
      error: { type: 'text' },
      related_collection: { type: 'text', hidden: true }, related_id: { type: 'text', hidden: true },
      template_key: { type: 'text', hidden: true }
    }
  },

  data_issues: {
    label: 'Data health issues', singular: 'Data issue', icon: 'shield-alert', tile: 't-rose', app: 'admin', sort: '-severity',
    display: r => r.title, search: ['title', 'detail', 'source_group'],
    perms: { read: OFFICE, write: OFFICE, delete: MGMT },
    fields: {
      code: { type: 'text', label: 'Code', list: true },
      source_group: { type: 'text', label: 'Found in', list: true },
      severity: { type: 'enum', options: ['high', 'medium', 'low'], default: 'medium', list: true },
      title: { type: 'text', label: 'Issue', required: true, list: true },
      detail: { type: 'longtext', label: 'Evidence' },
      question: { type: 'longtext', label: 'Question for the owner' },
      status: { type: 'enum', options: ['open', 'answered', 'fixed', 'wont_fix'], default: 'open', list: true },
      resolution: { type: 'longtext', label: 'Resolution' },
      related: { type: 'json', hidden: true }
    }
  }
};
