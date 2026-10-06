// =============================================================================
// inbound-email — Deno Edge Function (webhook). Your inbound email provider
// (Resend inbound, Postmark, Mailgun or Cloudflare Email Worker) POSTs each
// received email here; it is filed into Mail for the right people and triaged
// (Emergency / Quote / Reschedule / Proof of payment). Emergencies notify
// every manager immediately.
//
//   POST /functions/v1/inbound-email      header  x-inbound-secret: <INBOUND_SECRET>
//   body (JSON): { from: "Name <a@b.c>" | {name,email}, to: [...] | "x@y", subject, html?, text?, attachments?: [{filename, contentType, content(base64)}] }
//
// Secrets: INBOUND_SECRET (any long random string, also set in the provider),
//          SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (platform).
// Deploy with node tools/deploy-functions.js — it deploys this one with JWT verification OFF
// (--no-verify-jwt: the provider has no Supabase login; the secret header protects it).
// =============================================================================
import { createClient } from 'npm:@supabase/supabase-js@2';
import { triage } from '../_shared/mail/logic.js';

const admin = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', { auth: { persistSession: false } });
const SECRET = Deno.env.get('INBOUND_SECRET') ?? '';
const parseAddr = (a) => { if (!a) return null; if (typeof a === 'object') return { name: a.name || a.email, email: String(a.email || '').toLowerCase() }; const m = /^(.*?)<([^>]+)>$/.exec(String(a).trim()); return m ? { name: m[1].replace(/"/g, '').trim() || m[2], email: m[2].toLowerCase() } : { name: String(a), email: String(a).toLowerCase() }; };
const strip = (html) => html.replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

Deno.serve(async req => {
  if (req.method !== 'POST') return new Response('POST only', { status: 405 });
  if (!SECRET || req.headers.get('x-inbound-secret') !== SECRET) return new Response('Forbidden', { status: 403 });
  const p = await req.json().catch(() => null);
  if (!p) return new Response('Bad JSON', { status: 400 });
  const from = parseAddr(p.from);
  const to = (Array.isArray(p.to) ? p.to : [p.to]).map(parseAddr).filter(Boolean);
  const text = p.text || (p.html ? strip(p.html) : '');
  const { data: profiles } = await admin.from('profiles').select('id,email,role,status');
  const active = (profiles || []).filter((x) => x.status !== 'suspended');
  let recipients = active.filter((x) => x.email && to.some((t) => t.email === String(x.email).toLowerCase()));
  if (!recipients.length) recipients = active.filter((x) => ['owner', 'admin', 'manager', 'sales'].includes(x.role)); // company inbox

  // attachments → Storage (drive bucket) + files rows
  const atts = [];
  for (const a of (p.attachments || []).slice(0, 10)) {
    try {
      const bytes = Uint8Array.from(atob(a.content || ''), c => c.charCodeAt(0));
      const path = `inbound/${crypto.randomUUID()}/${a.filename || 'attachment'}`;
      await admin.storage.from('drive').upload(path, bytes, { contentType: a.contentType || 'application/octet-stream' });
      const { data: f } = await admin.from('files').insert({ name: a.filename || 'attachment', mime: a.contentType, size: bytes.length, storage_path: path, kind: 'upload', description: `Attachment from ${from?.email}` }).select('id').single();
      atts.push({ file_id: f?.id, name: a.filename, size: bytes.length });
    } catch (_) { /* skip a bad attachment, keep the mail */ }
  }
  const cat = triage({ subject: p.subject, body: text, attachments: atts });
  const { data: msg, error } = await admin.from('mail_messages').insert({
    thread_id: crypto.randomUUID(), direction: 'inbound', from_name: from?.name, from_email: from?.email, to, to_text: to.map((t) => t.email).join(', '),
    subject: p.subject || '(no subject)', body_html: p.html || null, body_text: text, attachments: atts, sent_at: new Date().toISOString(), status: 'received', labels: cat.key !== 'general' ? [cat.label] : []
  }).select('id').single();
  if (error || !msg) return new Response(`Could not store: ${error?.message}`, { status: 500 });
  await admin.from('mail_flags').insert(recipients.map((r) => ({ message_id: msg.id, user_id: r.id, folder: 'inbox', read: false, labels: cat.key !== 'general' ? [cat.label] : [] })));
  await admin.from('notifications').insert(recipients.map((r) => ({ user_id: r.id, title: cat.key === 'emergency' ? `EMERGENCY email from ${from?.name}` : `New email from ${from?.name}`, body: p.subject, icon: cat.key === 'emergency' ? 'siren' : 'mail', tile: cat.key === 'emergency' ? 't-rose' : 't-sky', link: `#/mail?m=${msg.id}`, kind: 'mail', source_key: `mail|${msg.id}|${r.id}` })));
  return new Response(JSON.stringify({ ok: true, id: msg.id, triage: cat.key }), { headers: { 'Content-Type': 'application/json' } });
});
