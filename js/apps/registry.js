/* =============================================================================
   App registry — every app in Landscapers Inc. HQ.
   Drives the launcher grid, the sidebar, the phone bottom bar, the command
   palette and role-based access. Each app lives in js/apps/<id>/index.js and
   is loaded on first use.

   roles: '*' = everyone signed in; otherwise the roles allowed (owner & admin
   always pass). Admin → Roles can override any of these at runtime.
   ========================================================================== */

const ALL = '*';
const MGMT = ['manager'];
const OFFICE = ['manager', 'finance', 'hr', 'sales', 'operations'];

export const GROUPS = [
  { id: 'workspace', label: 'Workspace' },
  { id: 'customers', label: 'Customers & Sales' },
  { id: 'operations', label: 'Operations' },
  { id: 'people', label: 'People & Safety' },
  { id: 'finance', label: 'Finance & Insight' },
  { id: 'admin', label: 'Administration' }
];

export const APPS = [
  // ---------------- Workspace (the Google Workspace equivalents) ----------------
  { id: 'home', name: 'Daily Briefing', icon: 'sunrise', tile: 't-brand', group: 'workspace', roles: ALL, desc: 'Your 05:30 executive briefing: decisions made overnight, today’s dispatch, approvals, money and alerts', keywords: 'home dashboard today overview briefing command centre' },
  { id: 'agent', name: 'Autonomous Core', icon: 'bot', tile: 't-aurora', group: 'workspace', roles: ['manager', 'operations', 'finance'], desc: '24/7 agent: weather-aware dispatch, reminders, POP matching, mail triage, approvals queue', keywords: 'agent autonomous automation robot cron dispatch approvals decisions' },
  { id: 'assistant', name: 'Sage AI', icon: 'sparkles', tile: 't-aurora', group: 'workspace', roles: ALL, desc: 'Ask anything about the business — answers from your live data', keywords: 'ai gemini assistant ask question help predict' },
  { id: 'mail', name: 'Mail', icon: 'mail', tile: 't-rose', group: 'workspace', roles: ALL, desc: 'Team and client email', keywords: 'gmail email inbox send compose' },
  { id: 'calendar', name: 'Calendar', icon: 'calendar-days', tile: 't-river', group: 'workspace', roles: ALL, desc: 'Everything that is happening, who added it, SA holidays and reminders', keywords: 'schedule events meetings holidays reminders' },
  { id: 'drive', name: 'Drive & Vault', icon: 'hard-drive', tile: 't-grass', group: 'workspace', roles: ALL, desc: 'Shared drives, the document vault and before/after photo galleries', keywords: 'files documents storage upload folders shared drives vault photos' },
  { id: 'docs', name: 'Docs', icon: 'file-text', tile: 't-river', group: 'workspace', roles: ALL, desc: 'Write documents, policies and letters', keywords: 'word document write letter policy' },
  { id: 'sheets', name: 'Sheets', icon: 'sheet', tile: 't-grass', group: 'workspace', roles: ALL, desc: 'Spreadsheets with formulas', keywords: 'excel spreadsheet table formulas workbook' },
  { id: 'slides', name: 'Slides', icon: 'presentation', tile: 't-sun', group: 'workspace', roles: ALL, desc: 'Presentations and client proposals', keywords: 'powerpoint deck presentation pitch' },
  { id: 'forms', name: 'Forms', icon: 'clipboard-list', tile: 't-violet', group: 'workspace', roles: ALL, desc: 'Checklists, inspections, incident and HR forms', keywords: 'form checklist survey inspection' },
  { id: 'chat', name: 'Chat', icon: 'message-square', tile: 't-grass', group: 'workspace', roles: ALL, desc: 'Team spaces and direct messages', keywords: 'chat message whatsapp team talk' },
  { id: 'meet', name: 'Meet', icon: 'video', tile: 't-clay', group: 'workspace', roles: ALL, desc: 'Video meetings', keywords: 'video call zoom meeting conference' },
  { id: 'keep', name: 'Keep', icon: 'sticky-note', tile: 't-sun', group: 'workspace', roles: ALL, desc: 'Quick notes and checklists', keywords: 'notes memo checklist keep' },
  { id: 'tasks', name: 'Tasks', icon: 'list-todo', tile: 't-sun', group: 'workspace', roles: ALL, desc: 'To-dos for you and the team', keywords: 'todo task assign due' },
  { id: 'contacts', name: 'Contacts', icon: 'contact', tile: 't-clay', group: 'workspace', roles: ALL, desc: 'Everyone you deal with', keywords: 'people phone book address contacts' },

  // ---------------- Customers & sales ----------------
  { id: 'clients', name: 'Clients', icon: 'users', tile: 't-forest', group: 'customers', roles: ALL, mobile: true, desc: 'Maintenance and project clients, history, health and value', keywords: 'customers crm accounts maintenance' },
  { id: 'leads', name: 'Leads & Pipeline', icon: 'target', tile: 't-sun', group: 'customers', roles: ['manager', 'sales'], desc: 'Prospects, calls, follow-ups and the sales pipeline', keywords: 'sales prospects pipeline funnel calls follow up' },
  { id: 'quotes', name: 'Quotes', icon: 'file-signature', tile: 't-clay', group: 'customers', roles: ['manager', 'sales', 'finance', 'operations'], desc: 'Build, send and track quotations', keywords: 'quote quotation estimate proposal' },
  { id: 'invoices', name: 'Invoices', icon: 'receipt', tile: 't-violet', group: 'customers', roles: ['manager', 'finance', 'sales', 'supervisor'], mobile: true, desc: 'Create invoices anywhere — office or on site', keywords: 'invoice bill payment statement pdf' },
  { id: 'payments', name: 'Payments & Debtors', icon: 'wallet', tile: 't-rose', group: 'customers', roles: ['manager', 'finance'], desc: 'Receipts, outstanding balances, ageing and statements', keywords: 'payments outstanding debtors ageing overdue collections' },
  { id: 'catalogue', name: 'Services & Pricing', icon: 'tag', tile: 't-grass', group: 'customers', roles: ALL, desc: 'Service catalogue, price lists and design options', keywords: 'price list services rates catalogue options paving garden design' },

  // ---------------- Operations ----------------
  { id: 'schedule', name: 'Live Dispatch', icon: 'route', tile: 't-river', group: 'operations', roles: ALL, mobile: true, desc: 'Daily run-sheets, crews, routes, visit check-in and weather rescheduling', keywords: 'schedule dispatch visits rounds routes crew roster run sheet' },
  { id: 'jobs', name: 'Jobs & Projects', icon: 'shovel', tile: 't-clay', group: 'operations', roles: ['manager', 'operations', 'sales', 'supervisor', 'finance'], desc: 'Projects, ad-hoc jobs, job cards and project plans', keywords: 'jobs projects job card ad hoc carron glen' },
  { id: 'operations', name: 'Ops Registers', icon: 'clipboard-check', tile: 't-forest', group: 'operations', roles: ['manager', 'operations', 'supervisor'], desc: 'Operations workbook: job, maintenance, inspection and weekly KPI registers', keywords: 'operations register workbook weekly kpi' },
  { id: 'fleet', name: 'Fleet', icon: 'truck', tile: 't-slate', group: 'operations', roles: ['manager', 'operations', 'finance', 'supervisor'], desc: 'Vehicles, logbooks, services and licences', keywords: 'vehicle bakkie truck service licence fleet' },
  { id: 'assets', name: 'Assets & Equipment', icon: 'wrench', tile: 't-slate', group: 'operations', roles: ['manager', 'operations', 'finance', 'supervisor'], desc: 'Asset register, equipment, maintenance and value', keywords: 'assets equipment tools mower register depreciation' },
  { id: 'suppliers', name: 'Suppliers & Purchases', icon: 'shopping-cart', tile: 't-clay', group: 'operations', roles: ['manager', 'operations', 'finance'], desc: 'Suppliers, purchases and proof of payment', keywords: 'supplier purchase order buy proof of payment' },

  // ---------------- People & safety ----------------
  { id: 'people', name: 'Employees', icon: 'id-card', tile: 't-forest', group: 'people', roles: ['manager', 'hr', 'operations'], desc: 'Staff records, contracts, ex-employees and documents', keywords: 'hr employees staff workers contracts people' },
  { id: 'training', name: 'Training & Certificates', icon: 'graduation-cap', tile: 't-river', group: 'people', roles: ['manager', 'hr', 'operations'], desc: 'Training matrix, certificates and expiries', keywords: 'training certificate first aid fire fighting heights she rep skills' },
  { id: 'medicals', name: 'Medicals', icon: 'heart-pulse', tile: 't-rose', group: 'people', roles: ['manager', 'hr'], desc: 'Occupational medical fitness and renewals', keywords: 'medical fitness certificate occupational health' },
  { id: 'safety', name: 'Health & Safety', icon: 'shield-check', tile: 't-rose', group: 'people', roles: ALL, mobile: true, desc: 'Incidents, PPE, inspections, toolbox talks, appointments', keywords: 'health safety incident ppe toolbox talk inspection hse sherq' },
  { id: 'compliance', name: 'Compliance & Legal', icon: 'scale', tile: 't-slate', group: 'people', roles: ['manager', 'hr', 'finance'], desc: 'Company documents, registrations and renewals', keywords: 'compliance legal cipc bbbee coida tax clearance insurance' },
  { id: 'sops', name: 'SOPs & Policies', icon: 'book-open', tile: 't-grass', group: 'people', roles: ALL, desc: 'Every SOP, policy, procedure and job description', keywords: 'sop policy procedure handbook knowledge manual code of conduct' },

  // ---------------- Finance & insight ----------------
  { id: 'finance', name: 'Finance', icon: 'landmark', tile: 't-forest', group: 'finance', roles: ['manager', 'finance'], desc: 'Income statement, expenses, cash flow and budgets', keywords: 'finance income statement profit loss expenses cash flow budget' },
  { id: 'kpi', name: 'KPIs & Performance', icon: 'gauge', tile: 't-sun', group: 'finance', roles: ALL, desc: 'Sales and management KPI trackers, scores and meetings', keywords: 'kpi performance targets scorecard tracker' },
  { id: 'strategy', name: 'Strategy & Goals', icon: 'mountain', tile: 't-clay', group: 'finance', roles: ['manager', 'sales', 'operations', 'finance', 'hr'], desc: '12-month plan, focus areas and goal tracking', keywords: 'strategy plan goals okr focus areas 12 month' },
  { id: 'reports', name: 'Reports & BI', icon: 'chart-pie', tile: 't-violet', group: 'finance', roles: ['manager', 'finance', 'sales', 'operations'], desc: 'Dashboards, analysis and exports', keywords: 'reports analytics bi dashboard charts' },
  { id: 'intelligence', name: 'Neural Learning Hub', icon: 'brain', tile: 't-aurora', group: 'finance', roles: ['manager', 'finance', 'sales', 'operations'], desc: 'Models that learn from your data: payment risk, lead scoring, job velocity, pricing, equipment wear, forecasts', keywords: 'machine learning ml predictions forecast model accuracy neural learning' },
  { id: 'marketing', name: 'Marketing', icon: 'palette', tile: 't-sun', group: 'finance', roles: ['manager', 'sales'], desc: 'Business profile, design & paving options, references', keywords: 'marketing brochure profile references options' },

  // ---------------- Administration ----------------
  { id: 'admin', name: 'Admin console', icon: 'shield', tile: 't-slate', group: 'admin', roles: [], desc: 'Users, roles, security, audit, data health, backups, company profile', keywords: 'admin console users roles security audit backup settings' },
  { id: 'settings', name: 'My settings', icon: 'settings', tile: 't-slate', group: 'admin', roles: ALL, desc: 'Your profile, password, theme and notifications', keywords: 'settings profile password theme preferences' }
];

/** Launcher "favourites" defaults (like Google's app grid). */
export const DEFAULT_FAVOURITES = ['home', 'schedule', 'invoices', 'mail', 'calendar', 'drive', 'clients', 'chat', 'assistant', 'agent', 'intelligence', 'admin'];

/** Bottom navigation on phones, by role. */
export const MOBILE_NAV = {
  default: ['home', 'calendar', 'clients', 'invoices', 'chat'],
  field: ['home', 'schedule', 'safety', 'chat', 'calendar'],
  supervisor: ['home', 'schedule', 'invoices', 'safety', 'chat'],
  sales: ['home', 'leads', 'quotes', 'calendar', 'chat'],
  finance: ['home', 'invoices', 'payments', 'finance', 'mail']
};

export const appById = id => APPS.find(a => a.id === id);
