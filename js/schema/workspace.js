/* =============================================================================
   Workspace collections: people & access, calendar, mail, chat, drive,
   docs/sheets/slides/forms, notes, tasks, contacts, notifications, audit,
   machine-learning registry. (Business collections: ./business.js)
   ========================================================================== */

import { RULES } from '../core/validate.js';

export const ROLES = [
  { value: 'owner', label: 'Owner / Director' },
  { value: 'admin', label: 'Administrator' },
  { value: 'manager', label: 'General Manager' },
  { value: 'finance', label: 'Finance' },
  { value: 'hr', label: 'HR & Safety' },
  { value: 'sales', label: 'Sales' },
  { value: 'operations', label: 'Operations' },
  { value: 'supervisor', label: 'Site Supervisor' },
  { value: 'field', label: 'Field Staff' },
  { value: 'viewer', label: 'Viewer (read-only)' }
];
const ALL = '*';
const ADMINS = ['owner', 'admin'];
const MGMT = ['owner', 'admin', 'manager'];

export const EVENT_CATEGORIES = [
  { value: 'meeting', label: 'Meeting', color: '#1e9bc4' },
  { value: 'site_visit', label: 'Site visit', color: '#5fa83b' },
  { value: 'maintenance', label: 'Maintenance round', color: '#1f7440' },
  { value: 'quote', label: 'Quote / assessment', color: '#f2b42f' },
  { value: 'project', label: 'Project work', color: '#c8733a' },
  { value: 'invoice', label: 'Invoice / payment', color: '#7b61ff' },
  { value: 'training', label: 'Training', color: '#3ab6d9' },
  { value: 'compliance', label: 'Compliance / renewal', color: '#e0525e' },
  { value: 'hr', label: 'HR / people', color: '#de8d4f' },
  { value: 'vehicle', label: 'Vehicle / equipment', color: '#6b7a70' },
  { value: 'deadline', label: 'Deadline', color: '#c73a47' },
  { value: 'personal', label: 'Personal', color: '#a996ff' },
  { value: 'other', label: 'Other', color: '#8e9b93' }
];

export const WORKSPACE = {
  profiles: {
    label: 'People', singular: 'Person', icon: 'user-round', tile: 't-forest',
    display: r => r.name,
    search: ['name', 'email', 'title', 'department', 'phone'],
    sort: 'name',
    perms: { read: ALL, write: ADMINS, delete: ['owner'] },
    fields: {
      name: { type: 'text', label: 'Full name', required: true, list: true },
      email: { type: 'email', label: 'Email', unique: true, list: true },
      phone: { type: 'phone', label: 'Mobile', list: true },
      role: { type: 'enum', label: 'Role', required: true, options: ROLES, list: true, default: 'viewer' },
      title: { type: 'text', label: 'Job title', list: true },
      department: { type: 'enum', label: 'Department', options: ['Management', 'Admin', 'Finance', 'HR', 'Sales', 'Operations', 'Field', 'Legal & Compliance'] },
      employee_id: { type: 'ref', ref: 'employees', label: 'Employee record', softRef: true },
      color: { type: 'color', label: 'Colour' },
      avatar_file_id: { type: 'text', label: 'Photo', hidden: true },
      status: { type: 'enum', label: 'Status', options: ['active', 'suspended', 'invited'], default: 'active', list: true },
      password_hash: { type: 'text', hidden: true, label: 'Password hash (local mode only)' },
      password_salt: { type: 'text', hidden: true },
      must_change_password: { type: 'bool', hidden: true },
      last_login_at: { type: 'datetime', label: 'Last sign-in', readonly: true },
      preferences: { type: 'json', hidden: true },
      signature_html: { type: 'richtext', label: 'Email signature', hidden: true }
    }
  },

  groups: {
    label: 'Groups', singular: 'Group', icon: 'users-round', tile: 't-river',
    display: r => r.name, perms: { read: ALL, write: ADMINS, delete: ADMINS },
    fields: {
      name: { type: 'text', required: true, unique: true, list: true },
      email: { type: 'email', label: 'Group email', list: true },
      description: { type: 'longtext' },
      members: { type: 'refs', ref: 'profiles', label: 'Members', list: true }
    }
  },

  settings: {
    label: 'Settings', singular: 'Setting', icon: 'settings', display: r => r.key,
    perms: { read: ALL, write: ADMINS, delete: ADMINS },
    fields: {
      key: { type: 'text', required: true, unique: true },
      value: { type: 'json' },
      description: { type: 'text' }
    }
  },

  calendars: {
    label: 'Calendars', singular: 'Calendar', icon: 'calendar', tile: 't-river', display: r => r.name,
    perms: { read: ALL, write: ALL, delete: MGMT },
    fields: {
      name: { type: 'text', required: true, list: true },
      color: { type: 'color', default: '#1e9bc4' },
      kind: { type: 'enum', options: ['company', 'team', 'personal', 'system'], default: 'team', list: true },
      owner_id: { type: 'ref', ref: 'profiles', softRef: true },
      members: { type: 'refs', ref: 'profiles' },
      description: { type: 'longtext' },
      visible_by_default: { type: 'bool', default: true }
    }
  },

  events: {
    label: 'Calendar events', singular: 'Event', icon: 'calendar-days', tile: 't-river',
    display: r => r.title,
    search: ['title', 'location', 'description', 'created_by_name'],
    sort: 'start_date',
    perms: { read: ALL, write: ALL, delete: ALL },
    fields: {
      title: { type: 'text', label: 'Title', required: true, list: true },
      category: { type: 'enum', label: 'Type', options: EVENT_CATEGORIES.map(c => ({ value: c.value, label: c.label })), default: 'meeting', list: true },
      calendar_id: { type: 'ref', ref: 'calendars', label: 'Calendar', softRef: true },
      start_date: { type: 'date', label: 'Date', required: true, list: true },
      end_date: { type: 'date', label: 'End date' },
      all_day: { type: 'bool', label: 'All day', default: false },
      start_time: { type: 'time', label: 'Start time', list: true },
      end_time: { type: 'time', label: 'End time' },
      location: { type: 'text', label: 'Location', list: true },
      description: { type: 'longtext', label: 'Notes' },
      attendees: { type: 'refs', ref: 'profiles', label: 'Staff attending' },
      external_attendees: { type: 'text', label: 'Guests (emails)' },
      client_id: { type: 'ref', ref: 'clients', label: 'Client', softRef: true },
      related_collection: { type: 'text', hidden: true },
      related_id: { type: 'text', hidden: true },
      recurrence: { type: 'enum', label: 'Repeats', options: [
        { value: 'none', label: 'Does not repeat' }, { value: 'daily', label: 'Daily' }, { value: 'weekdays', label: 'Every weekday (Mon–Fri)' },
        { value: 'weekly', label: 'Weekly' }, { value: 'fortnightly', label: 'Every 2 weeks' }, { value: 'monthly', label: 'Monthly' },
        { value: 'monthly_nth', label: 'Monthly on the same weekday' }, { value: 'quarterly', label: 'Every 3 months' }, { value: 'yearly', label: 'Yearly' }
      ], default: 'none' },
      recurrence_until: { type: 'date', label: 'Repeat until' },
      recurrence_exceptions: { type: 'json', hidden: true },
      reminders: { type: 'json', label: 'Reminders (minutes before)', hidden: true },
      meet_link: { type: 'url', label: 'Video meeting link' },
      status: { type: 'enum', options: ['confirmed', 'tentative', 'cancelled'], default: 'confirmed' },
      visibility: { type: 'enum', options: ['company', 'private'], default: 'company' },
      color: { type: 'color', label: 'Colour' },
      done: { type: 'bool', label: 'Completed' }
    },
    rules: [RULES.dateOrder('start_date', 'end_date'), rec => (rec.start_time && rec.end_time && (!rec.end_date || rec.end_date === rec.start_date) && rec.end_time < rec.start_time ? { field: 'end_time', message: 'End time is before the start time' } : null)]
  },

  holidays: {
    label: 'Holidays', singular: 'Holiday', icon: 'party-popper', display: r => r.name, sort: 'date',
    perms: { read: ALL, write: MGMT, delete: MGMT },
    fields: {
      date: { type: 'date', required: true, list: true },
      name: { type: 'text', required: true, list: true },
      type: { type: 'enum', options: [{ value: 'public', label: 'Public holiday (declared)' }, { value: 'company', label: 'Company closure' }, { value: 'observance', label: 'Observance' }], default: 'company', list: true },
      notes: { type: 'text' }
    }
  },

  tasks: {
    label: 'Tasks', singular: 'Task', icon: 'list-todo', tile: 't-sun', display: r => r.title,
    search: ['title', 'notes', 'assignee_name'], sort: 'due_date',
    perms: { read: ALL, write: ALL, delete: ALL },
    fields: {
      title: { type: 'text', required: true, list: true },
      notes: { type: 'longtext' },
      list_name: { type: 'text', label: 'List', default: 'My tasks' },
      status: { type: 'enum', options: [{ value: 'todo', label: 'To do' }, { value: 'in_progress', label: 'In progress' }, { value: 'waiting', label: 'Waiting' }, { value: 'done', label: 'Done' }], default: 'todo', list: true },
      priority: { type: 'enum', options: ['low', 'normal', 'high', 'urgent'], default: 'normal', list: true },
      due_date: { type: 'date', label: 'Due', list: true },
      due_time: { type: 'time' },
      assignee_id: { type: 'ref', ref: 'profiles', label: 'Assigned to', softRef: true, list: true },
      related_collection: { type: 'text', hidden: true },
      related_id: { type: 'text', hidden: true },
      completed_at: { type: 'datetime', hidden: true },
      subtasks: { type: 'json', hidden: true },
      recurrence: { type: 'enum', options: ['none', 'daily', 'weekly', 'monthly', 'yearly'], default: 'none' }
    },
    beforeSave: (rec, prev) => ({ ...rec, completed_at: rec.status === 'done' ? (prev && prev.completed_at) || new Date().toISOString() : null })
  },

  notes: {
    label: 'Notes', singular: 'Note', icon: 'sticky-note', tile: 't-sun', display: r => r.title || 'Untitled note',
    search: ['title', 'body_text', 'labels'], sort: '-updated_at',
    perms: { read: ALL, write: ALL, delete: ALL },
    fields: {
      title: { type: 'text' },
      body: { type: 'richtext' },
      body_text: { type: 'longtext', hidden: true },
      color: { type: 'enum', options: ['default', 'green', 'teal', 'blue', 'gold', 'clay', 'rose', 'violet'], default: 'default' },
      pinned: { type: 'bool', default: false },
      archived: { type: 'bool', default: false },
      labels: { type: 'tags' },
      checklist: { type: 'json', hidden: true },
      shared: { type: 'bool', label: 'Shared with the team', default: true },
      related_collection: { type: 'text', hidden: true },
      related_id: { type: 'text', hidden: true }
    }
  },

  contacts: {
    label: 'Contacts', singular: 'Contact', icon: 'contact', tile: 't-clay', display: r => r.name,
    search: ['name', 'company', 'email', 'phone', 'tags', 'notes'], sort: 'name',
    perms: { read: ALL, write: ALL, delete: MGMT },
    fields: {
      name: { type: 'text', required: true, list: true },
      company: { type: 'text', list: true },
      kind: { type: 'enum', label: 'Type', options: ['client', 'lead', 'supplier', 'staff', 'partner', 'authority', 'reference', 'other'], default: 'other', list: true },
      email: { type: 'email', list: true },
      phone: { type: 'phone', list: true, strict: false },
      phone_alt: { type: 'phone', label: 'Other phone', strict: false },
      address: { type: 'longtext' },
      position: { type: 'text', label: 'Position' },
      birthday: { type: 'date' },
      tags: { type: 'tags' },
      notes: { type: 'longtext' },
      related_collection: { type: 'text', hidden: true },
      related_id: { type: 'text', hidden: true }
    }
  },

  notifications: {
    label: 'Notifications', singular: 'Notification', icon: 'bell', display: r => r.title, sort: '-created_at',
    perms: { read: ALL, write: ALL, delete: ALL }, audit: false,
    fields: {
      user_id: { type: 'text', required: true },
      title: { type: 'text', required: true },
      body: { type: 'text' },
      icon: { type: 'text' },
      tile: { type: 'text' },
      link: { type: 'text' },
      kind: { type: 'text' },
      read_at: { type: 'datetime' },
      source_key: { type: 'text' }
    }
  },

  /* ---------------- Mail ---------------- */
  mail_messages: {
    label: 'Mail', singular: 'Message', icon: 'mail', tile: 't-rose', display: r => r.subject || '(no subject)',
    search: ['subject', 'body_text', 'from_name', 'from_email', 'to_text'], sort: '-sent_at',
    perms: { read: ALL, write: ALL, delete: ALL },
    fields: {
      thread_id: { type: 'text' },
      direction: { type: 'enum', options: ['internal', 'outbound', 'inbound'], default: 'internal' },
      from_user_id: { type: 'text' },
      from_name: { type: 'text' },
      from_email: { type: 'email', strict: false },
      to: { type: 'json', label: 'To' },           // [{user_id?, email, name}]
      cc: { type: 'json' },
      bcc: { type: 'json' },
      to_text: { type: 'text', hidden: true },
      subject: { type: 'text' },
      body_html: { type: 'richtext' },
      body_text: { type: 'longtext', hidden: true },
      attachments: { type: 'json' },                // [{file_id, name, size, mime}]
      is_draft: { type: 'bool', default: false },
      sent_at: { type: 'datetime' },
      scheduled_for: { type: 'datetime' },
      status: { type: 'enum', options: ['draft', 'queued', 'sent', 'delivered', 'failed', 'received'], default: 'draft' },
      error: { type: 'text' },
      labels: { type: 'tags' },
      related_collection: { type: 'text', hidden: true },
      related_id: { type: 'text', hidden: true },
      template_key: { type: 'text', hidden: true }
    }
  },
  mail_flags: {
    label: 'Mail flags', singular: 'Mail flag', icon: 'flag', audit: false,
    perms: { read: ALL, write: ALL, delete: ALL },
    fields: {
      message_id: { type: 'text', required: true },
      user_id: { type: 'text', required: true },
      folder: { type: 'enum', options: ['inbox', 'sent', 'drafts', 'archive', 'trash', 'spam', 'scheduled'], default: 'inbox' },
      read: { type: 'bool', default: false },
      starred: { type: 'bool', default: false },
      important: { type: 'bool', default: false },
      snoozed_until: { type: 'datetime' },
      labels: { type: 'tags' }
    }
  },
  mail_templates: {
    label: 'Email templates', singular: 'Template', icon: 'file-text', display: r => r.name,
    perms: { read: ALL, write: MGMT.concat(['sales', 'finance']), delete: MGMT },
    fields: {
      name: { type: 'text', required: true, list: true },
      key: { type: 'text', unique: true },
      subject: { type: 'text', required: true, list: true },
      body_html: { type: 'richtext', required: true },
      category: { type: 'enum', options: ['invoice', 'quote', 'reminder', 'welcome', 'follow_up', 'hr', 'general'], default: 'general', list: true }
    }
  },

  /* ---------------- Chat ---------------- */
  chat_channels: {
    label: 'Chat spaces', singular: 'Space', icon: 'message-square', tile: 't-grass', display: r => r.name,
    perms: { read: ALL, write: ALL, delete: MGMT },
    fields: {
      name: { type: 'text', required: true, list: true },
      kind: { type: 'enum', options: ['space', 'dm', 'group'], default: 'space', list: true },
      description: { type: 'text' },
      members: { type: 'refs', ref: 'profiles' },
      private: { type: 'bool', default: false },
      emoji: { type: 'text', default: '🌿' },
      color: { type: 'color' },
      last_message_at: { type: 'datetime' },
      last_message_preview: { type: 'text' }
    }
  },
  chat_messages: {
    label: 'Chat messages', singular: 'Message', icon: 'message-circle', display: r => (r.body || '').slice(0, 60),
    search: ['body', 'created_by_name'], sort: 'created_at', audit: false,
    perms: { read: ALL, write: ALL, delete: ALL },
    fields: {
      channel_id: { type: 'text', required: true },
      body: { type: 'longtext' },
      attachments: { type: 'json' },
      reply_to: { type: 'text' },
      reactions: { type: 'json' },
      mentions: { type: 'json' },
      edited_at: { type: 'datetime' },
      pinned: { type: 'bool', default: false },
      kind: { type: 'enum', options: ['text', 'system', 'file', 'location', 'meet'], default: 'text' }
    }
  },
  chat_reads: {
    label: 'Chat read markers', singular: 'Read marker', audit: false, perms: { read: ALL, write: ALL, delete: ALL },
    fields: { channel_id: { type: 'text', required: true }, user_id: { type: 'text', required: true }, last_read_at: { type: 'datetime' } }
  },

  /* ---------------- Drive ---------------- */
  drives: {
    label: 'Shared drives', singular: 'Shared drive', icon: 'hard-drive', tile: 't-grass', display: r => r.name, sort: 'name',
    perms: { read: ALL, write: ADMINS, delete: ['owner'] },
    fields: {
      name: { type: 'text', required: true, unique: true, list: true },
      description: { type: 'text' },
      color: { type: 'color' },
      icon: { type: 'text' },
      members: { type: 'json', label: 'Members' },  // [{profile_id, access:'manager'|'editor'|'viewer'}]
      restricted: { type: 'bool', label: 'Restricted', default: false },
      // who may open a restricted drive besides owner/admin/manager and its members (enforced by the RLS, js/sql/schema.js)
      roles: { type: 'multi', label: 'Roles with access', options: ['finance', 'hr', 'operations', 'sales', 'supervisor', 'field', 'viewer'] }
    }
  },
  folders: {
    label: 'Folders', singular: 'Folder', icon: 'folder', display: r => r.name, sort: 'name',
    perms: { read: ALL, write: ALL, delete: MGMT }, // everyone moves things to the trash (an update); only managers delete for good
    fields: {
      name: { type: 'text', required: true, list: true },
      drive_id: { type: 'text' },
      parent_id: { type: 'text' },
      color: { type: 'color' },
      starred_by: { type: 'json', hidden: true }
    }
  },
  files: {
    label: 'Files', singular: 'File', icon: 'file', tile: 't-grass', display: r => r.name,
    search: ['name', 'description', 'tags', 'text_index', 'source_path'], sort: 'name',
    perms: { read: ALL, write: ALL, delete: MGMT }, // everyone moves things to the trash (an update); only managers delete for good
    fields: {
      name: { type: 'text', required: true, list: true },
      drive_id: { type: 'text' },
      folder_id: { type: 'text' },
      owner_id: { type: 'text' },
      mime: { type: 'text', list: true },
      size: { type: 'int', min: 0, list: true },
      storage_path: { type: 'text', hidden: true },
      blob_id: { type: 'text', hidden: true },
      kind: { type: 'enum', options: ['upload', 'doc', 'sheet', 'slides', 'form', 'link', 'vault', 'pending'], default: 'upload' },
      // original company documents (kind 'vault'): where the file sits in the private vault (data/vault/<vault_path>);
      // in Supabase the same file is uploaded to storage_path by tools/upload-vault.js
      vault_path: { type: 'text', hidden: true, readonly: true },
      ref_id: { type: 'text', hidden: true },       // doc/sheet/slides/form id when kind != upload
      description: { type: 'longtext' },
      tags: { type: 'tags' },
      text_index: { type: 'longtext', hidden: true }, // extracted text for full-text search
      source_path: { type: 'text', label: 'Original file', readonly: true },
      linked: { type: 'json', hidden: true },       // [{collection, id}]
      starred_by: { type: 'json', hidden: true },
      shared_with: { type: 'json', hidden: true },
      version: { type: 'int', default: 1 },
      expires_on: { type: 'date', label: 'Document expiry' },
      confidential: { type: 'bool', label: 'Confidential', default: false }
    }
  },

  /* ---------------- Docs / Sheets / Slides / Forms ---------------- */
  docs: {
    label: 'Docs', singular: 'Document', icon: 'file-text', tile: 't-river', display: r => r.title || 'Untitled document',
    search: ['title', 'text', 'category'], sort: '-updated_at',
    perms: { read: ALL, write: ALL, delete: ALL },
    fields: {
      title: { type: 'text', required: true, list: true },
      content: { type: 'richtext' },
      text: { type: 'longtext', hidden: true },
      category: { type: 'enum', options: ['general', 'policy', 'procedure', 'sop', 'job_description', 'contract', 'plan', 'minutes', 'agenda', 'template', 'letter', 'report', 'form', 'checklist', 'profile'], default: 'general', list: true },
      doc_code: { type: 'text', label: 'Document code', list: true },
      revision: { type: 'text' },
      effective_date: { type: 'date' },
      review_date: { type: 'date', label: 'Next review' },
      owner_role: { type: 'text' },
      drive_id: { type: 'text' },
      folder_id: { type: 'text' },
      template: { type: 'bool', default: false },
      locked: { type: 'bool', label: 'Locked (read-only)', default: false },
      acknowledgements: { type: 'json', hidden: true } // [{user_id, at}] staff who read & signed
    }
  },
  sheets: {
    label: 'Sheets', singular: 'Spreadsheet', icon: 'sheet', tile: 't-grass', display: r => r.title || 'Untitled spreadsheet',
    search: ['title'], sort: '-updated_at',
    perms: { read: ALL, write: ALL, delete: ALL },
    fields: {
      title: { type: 'text', required: true, list: true },
      tabs: { type: 'json' },  // [{name, cells:{A1:{v,f,s}}, colWidths, rows, cols, frozen}]
      drive_id: { type: 'text' },
      folder_id: { type: 'text' },
      source_path: { type: 'text', readonly: true },
      restricted_to: { type: 'json', hidden: true } // roles allowed to open it (empty = everyone); set when built from restricted records
    }
  },
  slides: {
    label: 'Slides', singular: 'Presentation', icon: 'presentation', tile: 't-sun', display: r => r.title || 'Untitled presentation',
    search: ['title'], sort: '-updated_at',
    perms: { read: ALL, write: ALL, delete: ALL },
    fields: {
      title: { type: 'text', required: true, list: true },
      theme: { type: 'text', default: 'forest' },
      slides: { type: 'json' }, // [{layout, title, subtitle, body, image_file_id, bg, notes}]
      drive_id: { type: 'text' },
      folder_id: { type: 'text' }
    }
  },
  forms: {
    label: 'Forms', singular: 'Form', icon: 'clipboard-list', tile: 't-violet', display: r => r.title,
    search: ['title', 'description', 'category'], sort: 'title',
    perms: { read: ALL, write: MGMT.concat(['hr', 'operations']), delete: MGMT },
    fields: {
      title: { type: 'text', required: true, list: true },
      description: { type: 'longtext' },
      category: { type: 'enum', options: ['checklist', 'incident', 'hr', 'safety', 'inspection', 'survey', 'request', 'quote_request', 'other'], default: 'other', list: true },
      doc_code: { type: 'text', label: 'Form code', list: true },
      questions: { type: 'json' }, // [{id, type, label, required, options, hint, section}]
      accepting: { type: 'bool', label: 'Accepting responses', default: true },
      require_signature: { type: 'bool', default: false },
      notify_ids: { type: 'refs', ref: 'profiles', label: 'Notify on submit' },
      source_path: { type: 'text', readonly: true }
    }
  },
  form_responses: {
    label: 'Form responses', singular: 'Response', icon: 'clipboard-check', display: r => r.form_title || 'Response', sort: '-created_at',
    // anyone may submit; only reviewers change a response. HR and incident responses are further limited by
    // form_category (copied from the form by a database trigger) — the RLS in js/sql/schema.js, and forms/index.js in the app.
    perms: { read: ALL, write: ALL, update: MGMT.concat(['hr', 'operations']), delete: MGMT },
    fields: {
      form_id: { type: 'text', required: true },
      form_title: { type: 'text', list: true },
      form_category: { type: 'text', hidden: true, readonly: true },
      answers: { type: 'json' },
      signature: { type: 'signature' },
      subject_employee_id: { type: 'text', hidden: true },
      client_id: { type: 'text', hidden: true },
      location: { type: 'text' },
      geo: { type: 'json', hidden: true },
      status: { type: 'enum', options: ['submitted', 'reviewed', 'actioned', 'closed'], default: 'submitted', list: true },
      reviewed_by: { type: 'text', hidden: true }
    }
  },

  comments: {
    label: 'Comments', singular: 'Comment', icon: 'message-square-text', display: r => (r.body || '').slice(0, 60), sort: 'created_at',
    perms: { read: ALL, write: ALL, delete: ALL },
    fields: {
      collection: { type: 'text', required: true },
      record_id: { type: 'text', required: true },
      body: { type: 'longtext', required: true },
      mentions: { type: 'json' },
      resolved: { type: 'bool', default: false }
    }
  },

  audit_log: {
    label: 'Audit log', singular: 'Audit entry', icon: 'scroll-text', display: r => `${r.user_name} ${r.action} ${r.label}`, sort: '-at', audit: false,
    perms: { read: MGMT, write: [], delete: [] },
    fields: {
      at: { type: 'datetime', list: true },
      user_id: { type: 'text' },
      user_name: { type: 'text', list: true },
      action: { type: 'text', list: true },
      collection: { type: 'text', list: true },
      record_id: { type: 'text' },
      label: { type: 'text', list: true },
      changes: { type: 'json' }
    }
  },

  /* ---------------- Machine learning ---------------- */
  ml_models: {
    label: 'Models', singular: 'Model', icon: 'brain', display: r => `${r.key} v${r.version}`, sort: '-trained_at', audit: false,
    perms: { read: ALL, write: ALL, delete: MGMT },
    fields: {
      key: { type: 'text', required: true, list: true },
      version: { type: 'int', min: 1, list: true },
      algorithm: { type: 'text', list: true },
      params: { type: 'json' },
      metrics: { type: 'json' },
      features: { type: 'json' },
      n_train: { type: 'int' },
      n_test: { type: 'int' },
      trained_at: { type: 'datetime', list: true },
      data_hash: { type: 'text' },
      notes: { type: 'longtext' },
      active: { type: 'bool', default: true }
    }
  },
  predictions: {
    label: 'Predictions', singular: 'Prediction', icon: 'sparkles', audit: false, sort: '-created_at',
    perms: { read: ALL, write: ALL, delete: MGMT },
    fields: {
      model_key: { type: 'text', required: true },
      model_version: { type: 'int' },
      record_collection: { type: 'text' },
      record_id: { type: 'text' },
      value: { type: 'json' },
      probability: { type: 'number' },
      actual: { type: 'json' },
      resolved_at: { type: 'datetime' },
      correct: { type: 'bool' }
    }
  },
  ai_conversations: {
    label: 'Assistant chats', singular: 'Conversation', icon: 'sparkles', display: r => r.title || 'Conversation', sort: '-updated_at', audit: false,
    perms: { read: ALL, write: ALL, delete: ALL },
    fields: {
      title: { type: 'text' },
      messages: { type: 'json' }, // [{role, content, at, cards}]
      user_id: { type: 'text' }
    }
  }
};
