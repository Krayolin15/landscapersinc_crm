// =============================================================================
// send-email — Deno Edge Function. Sends one mail_messages row (or one outbox row)
// through Resend and records the result. The browser only passes an id; the
// function reloads the message with the service role, so a caller cannot send
// arbitrary content as the company.
//
//   POST /functions/v1/send-email   body: { message_id } | { outbox_id }
//
// Caller must be signed in; for message_id they must be the sender (from_user_id);
// outbox rows need role owner/admin/manager/finance/sales.
//
// Secrets (`supabase secrets set NAME=value`):
//   RESEND_API_KEY   from resend.com (verify your domain there first)
//   MAIL_FROM        e.g. "Landscapers Inc <accounts@landscapersinc.co.za>"
//   SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY are provided by the platform.
// =============================================================================
import { createClient } from 'npm:@supabase/supabase-js@2';

const URL_ = Deno.env.get('SUPABASE_URL') ?? '';
const ANON = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const RESEND = Deno.env.get('RESEND_API_KEY') ?? '';
const FROM = Deno.env.get('MAIL_FROM') ?? '';
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (b, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const SENDER_ROLES = ['owner', 'admin', 'manager', 'finance', 'sales'];

/** POST one email (Resend's JSON body) to Resend; resolves to Resend's message id (a string). */
async function resend(payload) {
  const r = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${RESEND}`, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body?.message || `Resend error ${r.status}`);
  return body?.id;
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  if (!RESEND || !FROM) return json({ error: 'Email is not configured: set RESEND_API_KEY and MAIL_FROM secrets.' }, 500);
  const auth = req.headers.get('Authorization') || '';
  const token = auth.replace(/^Bearer\s+/i, '');
  if (!token) return json({ error: 'Not signed in' }, 401);
  const caller = createClient(URL_, ANON, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
  const { data: u, error: ue } = await caller.auth.getUser(token);
  if (ue || !u?.user) return json({ error: 'Not signed in' }, 401);
  const admin = createClient(URL_, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: prof } = await admin.from('profiles').select('id,name,role,email,status,deleted_at').eq('id', u.user.id).single();
  if (!prof) return json({ error: 'No profile' }, 403);
  if (prof.deleted_at || (prof.status && prof.status !== 'active')) return json({ error: 'This account is not active' }, 403);

  const { message_id, outbox_id } = await req.json().catch(() => ({}));
  try {
    if (message_id) {
      const { data: m } = await admin.from('mail_messages').select('*').eq('id', message_id).single();
      if (!m) return json({ error: 'Message not found' }, 404);
      if (m.from_user_id !== prof.id) return json({ error: 'You can only send your own messages' }, 403);
      const to = (m.to || []).filter((r) => !r.user_id && r.email).map((r) => r.email);
      if (!to.length) return json({ ok: true, note: 'No external recipients' });
      const attachments = [];
      for (const a of (m.attachments || [])) {
        if (!a.file_id) continue;
        // looked up AS THE CALLER, so the files rules apply: nobody can email out a confidential or restricted-drive
        // document they could not open themselves
        const { data: f } = await caller.from('files').select('name,storage_path').eq('id', a.file_id).maybeSingle();
        if (!f) return json({ error: `You do not have access to the attachment ${a.name || a.file_id}` }, 403);
        if (!f.storage_path) continue;
        const { data: blob } = await admin.storage.from('drive').download(f.storage_path);
        if (!blob) continue;
        const b64 = btoa(String.fromCharCode(...new Uint8Array(await blob.arrayBuffer())));
        attachments.push({ filename: f.name, content: b64 });
      }
      const id = await resend({ from: FROM, to, cc: (m.cc || []).map((r) => r.email).filter(Boolean), reply_to: prof.email || undefined, subject: m.subject, html: m.body_html || undefined, text: m.body_text || undefined, attachments });
      await admin.from('mail_messages').update({ status: 'sent', sent_at: new Date().toISOString(), data: { ...(m.data || {}), provider_id: id } }).eq('id', m.id);
      return json({ ok: true, id });
    }
    if (outbox_id) {
      if (!SENDER_ROLES.includes(prof.role)) return json({ error: 'Not allowed' }, 403);
      const { data: o } = await admin.from('outbox').select('*').eq('id', outbox_id).single();
      if (!o) return json({ error: 'Outbox item not found' }, 404);
      if (o.channel !== 'email') return json({ error: 'Only email items are sent here — WhatsApp items open wa.me on the phone.' }, 400);
      if (o.status === 'sent') return json({ ok: true, note: 'Already sent', id: o.provider_id || null });
      if (o.status === 'cancelled') return json({ error: 'This message was cancelled' }, 409);
      const id = await resend({ from: FROM, to: [o.to], subject: o.subject || 'Landscapers Inc', text: o.body });
      await admin.from('outbox').update({ status: 'sent', sent_at: new Date().toISOString(), provider_id: id, error: null }).eq('id', o.id);
      return json({ ok: true, id });
    }
    return json({ error: 'Pass message_id or outbox_id' }, 400);
  } catch (e) {
    const msg = String(/** @type {Error} */ (e).message || e);
    if (message_id) await admin.from('mail_messages').update({ status: 'failed', error: msg }).eq('id', message_id);
    if (outbox_id) await admin.from('outbox').update({ status: 'failed', error: msg }).eq('id', outbox_id);
    return json({ error: msg }, 502);
  }
});
