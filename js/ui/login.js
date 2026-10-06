/* =============================================================================
   Sign-in screen.
   Local mode: choose your name, type your own password.
   Supabase:   email + password, magic link, or reset password.
   ========================================================================== */

import { h } from './dom.js';
import { icon } from './icons.js';
import { avatar } from './components.js';
import { toast } from './overlays.js';
import { CONFIG, IS_SUPABASE } from '../config.js';
import { db } from '../core/db.js';
import { auth } from '../core/auth.js';
import * as fmt from '../core/format.js';

const css = `
.login-wrap{min-height:100vh;display:grid;grid-template-columns:1.05fr 1fr;}
.login-hero{position:relative;overflow:hidden;background:linear-gradient(160deg,#0b2a18 0%,#175a33 45%,#0f6f91 100%);color:#eaf3ec;padding:48px;display:flex;flex-direction:column;justify-content:space-between}
.login-hero h1{color:#fff;font-size:clamp(2rem,3.4vw,3.2rem);max-width:12ch;line-height:1.05}
.login-hero p{color:rgba(234,243,236,.82);max-width:44ch;font-size:1.05rem}
.login-hero .logo{width:92px;height:92px;border-radius:26px;box-shadow:0 18px 40px rgba(0,0,0,.35);animation:popIn .8s var(--ease-spring) both}
.login-hero .hill{position:absolute;left:-10%;right:-10%;border-radius:50% 50% 0 0;}
.login-hero .h1{bottom:-58%;height:90%;background:rgba(95,168,59,.35);animation:float 9s ease-in-out infinite}
.login-hero .h2{bottom:-66%;height:90%;left:-30%;background:rgba(31,116,64,.55);animation:float 12s ease-in-out infinite reverse}
.login-hero .sun{position:absolute;top:12%;right:12%;width:130px;height:130px;border-radius:50%;background:radial-gradient(circle,#ffd978,#f2b42f 60%,transparent 62%);filter:drop-shadow(0 0 40px rgba(242,180,47,.6));animation:pulse 6s ease-in-out infinite}
.login-hero .feat{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;position:relative;z-index:1;max-width:520px}
.login-hero .feat div{display:flex;gap:10px;align-items:center;padding:10px 12px;border-radius:14px;background:rgba(255,255,255,.08);backdrop-filter:blur(8px);font-size:.86rem}
.login-panel{display:flex;align-items:center;justify-content:center;padding:32px 20px}
.login-card{width:min(440px,100%)}
.user-pick{display:grid;grid-template-columns:repeat(auto-fill,minmax(118px,1fr));gap:10px;margin:18px 0}
.user-pick button{display:flex;flex-direction:column;align-items:center;gap:8px;padding:16px 8px;border-radius:18px;border:1px solid var(--border);background:var(--surface-solid);transition:all var(--t-med) var(--ease-spring)}
.user-pick button:hover{transform:translateY(-3px);box-shadow:var(--shadow-md)}
.user-pick button.sel{border-color:var(--primary);box-shadow:0 0 0 3px var(--primary-soft)}
.user-pick small{color:var(--muted);font-size:.72rem;text-align:center}
@media(max-width:900px){.login-wrap{grid-template-columns:1fr}.login-hero{padding:28px;min-height:auto}.login-hero .feat{display:none}.login-hero h1{font-size:1.8rem}}
`;

export function loginScreen({ onSignedIn }) {
  const style = h('style', css);
  const panel = h('div.login-card.anim-in');
  const hero = h('section.login-hero',
    h('span.sun'), h('span.hill.h1'), h('span.hill.h2'),
    h('div', { style: 'position:relative;z-index:1' },
      h('img.logo', { src: 'assets/landscapers-logo.jpg', alt: 'Landscapers Inc. logo' }),
      h('h1', { style: 'margin-top:26px' }, 'Landscapers Inc. HQ'),
      h('p', CONFIG.tagline),
      h('p', { style: 'font-size:.92rem' }, 'Mail · Calendar · Drive · Docs · Sheets · Chat · Clients · Quotes · Invoices · Operations · HR & Safety · Finance · AI')),
    h('div.feat', [['sparkles', 'Sage AI answers from your live data'], ['calendar-days', 'Shared calendar with SA holidays'], ['receipt', 'Invoice on site from your phone'], ['brain', 'Predictions that learn over time'], ['shield-check', 'Every change audited'], ['wifi-off', 'Works offline in the field']].map(([i, t]) => h('div', icon(i, 18), t))));

  if (IS_SUPABASE()) drawSupabase(panel, onSignedIn); else drawLocal(panel, onSignedIn);
  return h('div', style, h('div.aurora', h('span'), h('span'), h('span'), h('span')), h('div.login-wrap', hero, h('section.login-panel', panel)));
}

async function drawLocal(panel, onSignedIn) {
  const people = db.all('profiles').filter(p => p.status !== 'suspended').sort((a, b) => (roleRank(a.role) - roleRank(b.role)) || a.name.localeCompare(b.name));
  const last = await auth.lastUser();
  let selected = people.find(p => p.id === last) || null;
  const pw = h('input.input', { type: 'password', placeholder: 'Your password', autocomplete: 'current-password' });
  const remember = h('input', { type: 'checkbox' });
  const err = h('div.field-error', { style: 'display:none' });
  const signBtn = h('button.btn.btn-brand.btn-lg.btn-block', { type: 'submit' }, icon('log-in', 18), 'Sign in');
  const grid = h('div.user-pick');
  const drawGrid = () => grid.replaceChildren(...people.map(p => h('button', { type: 'button', class: selected && selected.id === p.id ? 'sel' : '', onClick: () => { selected = p; drawGrid(); pw.focus(); } }, avatar(p, { size: 'lg' }), h('b', { style: 'font-size:.9rem' }, p.name.split(' ')[0]), h('small', p.title || fmt.titleCase(p.role)))));
  drawGrid();
  const form = h('form.stack', {
    onSubmit: async e => {
      e.preventDefault();
      if (!selected) { err.style.display = ''; err.textContent = 'Tap your name first'; return; }
      signBtn.disabled = true;
      try {
        const u = await auth.signInLocal(selected.id, pw.value, { remember: remember.checked });
        await auth.rememberLastUser(selected.id);
        onSignedIn(u);
      } catch (ex) {
        err.style.display = ''; err.textContent = ex.message;
        panel.classList.remove('anim-shake'); void panel.offsetWidth; panel.classList.add('anim-shake');
        pw.value = ''; pw.focus();
      } finally { signBtn.disabled = false; }
    }
  },
  h('div.field', h('label.field-label', 'Password'), pw), err,
  h('label.check.small', remember, 'Stay signed in on this device'),
  signBtn);
  panel.replaceChildren(
    h('h2', 'Welcome back'), h('p.muted', 'Tap your name and enter your password.'),
    people.length ? grid : h('div.callout.warn', icon('triangle-alert'), h('div', 'No accounts exist yet. The company data pack did not load — reload the page.')),
    form,
    h('p.xs.faint', { style: 'margin-top:18px' }, icon('hard-drive', 12), ' Local mode — data is stored on this device. Forgot your password? Ask an administrator to reset it in Admin → Users.'));
  if (selected) setTimeout(() => pw.focus(), 200);
}

function drawSupabase(panel, onSignedIn) {
  const email = h('input.input', { type: 'email', placeholder: 'you@landscapersinc.co.za', autocomplete: 'username', inputmode: 'email' });
  const pw = h('input.input', { type: 'password', placeholder: 'Password', autocomplete: 'current-password' });
  const err = h('div.field-error', { style: 'display:none' });
  const btn = h('button.btn.btn-brand.btn-lg.btn-block', { type: 'submit' }, icon('log-in', 18), 'Sign in');
  panel.replaceChildren(
    h('h2', 'Sign in'), h('p.muted', 'Use your Landscapers Inc. account.'),
    h('form.stack', {
      onSubmit: async e => {
        e.preventDefault(); btn.disabled = true; err.style.display = 'none';
        try { onSignedIn(await auth.signInSupabase(email.value, pw.value)); }
        catch (ex) { err.style.display = ''; err.textContent = ex.message; panel.classList.remove('anim-shake'); void panel.offsetWidth; panel.classList.add('anim-shake'); }
        finally { btn.disabled = false; }
      }
    }, h('div.field', h('label.field-label', 'Email'), email), h('div.field', h('label.field-label', 'Password'), pw), err, btn),
    h('div.row.between', { style: 'margin-top:14px' },
      h('button.btn.btn-ghost.btn-sm', { onClick: async () => { if (!email.value) return toast.warn('Type your email first'); try { await auth.sendMagicLink(email.value); toast.success('Check your email', { text: 'We sent you a sign-in link.' }); } catch (ex) { toast.error(ex.message); } } }, icon('wand-sparkles', 15), 'Email me a sign-in link'),
      h('button.btn.btn-ghost.btn-sm', { onClick: async () => { if (!email.value) return toast.warn('Type your email first'); try { await auth.sendPasswordReset(email.value); toast.success('Password reset email sent'); } catch (ex) { toast.error(ex.message); } } }, 'Forgot password?')),
    h('p.xs.faint', { style: 'margin-top:18px' }, icon('shield-check', 12), ' Secured by Supabase Auth · Row Level Security on every table.'));
  setTimeout(() => email.focus(), 200);
}

const roleRank = r => ['owner', 'admin', 'manager', 'finance', 'hr', 'sales', 'operations', 'supervisor', 'field', 'viewer'].indexOf(r);
