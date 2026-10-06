/* =============================================================================
   Admin → Go live: everything the owner needs to move from this computer
   (local mode) to Supabase — the SQL for each step, ready to copy or download
   (built here from js/sql/*.js, nothing is stored as .sql files), and the few
   commands run on a computer (Edge Functions, documents, app settings).
   The full walk-through is docs/SETUP-SUPABASE.html.
   ========================================================================== */
import { h, downloadText, copyText, ensureStyle } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { pageHeader, card, btn, callout, progress } from '../../ui/components.js';
import { toast, showError } from '../../ui/overlays.js';
import { IS_SUPABASE } from '../../config.js';
import { loadPack, loadPackCollection } from '../../core/seed.js';
import { STEPS, loginPeople, PROJECT_REF, EMAIL } from '../../sql/index.js';
import { adminNav } from './nav.js';

ensureStyle('lsi-golive', `
.gl-steps{display:grid;grid-template-columns:minmax(0,1fr);gap:14px}
.gl-cmd{display:flex;align-items:flex-start;gap:8px;margin:6px 0}
.gl-cmd pre{flex:1;min-width:0;margin:0;padding:10px 12px;background:var(--surface-2);border:1px solid var(--border);border-radius:10px;overflow-x:auto;white-space:pre}
.gl-row{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:10px}
.gl-people{display:grid;gap:8px;margin-top:8px}
.gl-person{display:grid;grid-template-columns:minmax(140px,1fr) minmax(200px,2fr);gap:8px;align-items:center}
@media (max-width:640px){.gl-person{grid-template-columns:1fr}}
`);

const GUIDE = 'docs/SETUP-SUPABASE.html';
const guideLink = (label = 'the Supabase setup guide', hash = '') => h('a', { href: GUIDE + hash, target: '_blank', rel: 'noopener' }, label);

/** A command to type on a computer, with a Copy button. */
function command(text) {
  return h('div.gl-cmd', h('pre', text),
    btn({ icon: 'copy', size: 'sm', variant: 'ghost', tip: 'Copy', onClick: () => copyText(text).then(() => toast.success('Copied')).catch(e => showError(e, 'Could not copy')) }));
}

/** Copy + Download buttons for one step. make() builds the SQL when clicked (some of it is large). */
function sqlButtons(step, make, { copy = true } = {}) {
  const run = async (what, el) => {
    let sql;
    try { el.disabled = true; sql = await make(); }
    catch (e) { showError(e, `Step ${step.id} could not be prepared`); return; }
    finally { el.disabled = false; }
    if (!sql) return;
    if (what === 'copy') { await copyText(sql).catch(e => showError(e, 'Could not copy')); toast.success(`Step ${step.id} copied`, { text: 'Paste it into Supabase → SQL Editor → New query, then Run.' }); }
    else { downloadText(sql, step.file, 'application/sql;charset=utf-8'); toast.success(`${step.file} downloaded`); }
  };
  return [
    copy ? btn({ label: 'Copy SQL', icon: 'copy', onClick: e => run('copy', e.currentTarget) }) : null,
    btn({ label: `Download ${step.file}`, icon: 'download', variant: copy ? 'ghost' : 'primary', onClick: e => run('download', e.currentTarget) })
  ];
}

const stepTitle = s => `${s.id} · ${s.title}`;

function plainStep(step) {
  return card({ title: stepTitle(step), icon: 'database', cls: 'solid' }, h('p.muted', step.text), h('div.gl-row', sqlButtons(step, () => step.sql())));
}

function seedStep(step) {
  const bar = h('div');
  const make = async () => {
    bar.replaceChildren(h('div.small.muted', 'Reading the company data pack…'), progress(2));
    const pack = await loadPack(({ done, total, collection }) => bar.replaceChildren(h('div.small.muted', `Reading ${collection}…`), progress(Math.round((done / total) * 100))));
    bar.replaceChildren(h('div.small.muted', `${pack.manifest.collections.reduce((n, c) => n + c.count, 0).toLocaleString()} records · data pack ${pack.manifest.version}`));
    return step.sql(pack);
  };
  return card({ title: stepTitle(step), icon: 'building-2', cls: 'solid' },
    h('p.muted', step.text),
    callout('warn', 'Private company data', 'This file holds client, staff, payroll and medical records. Keep it on your own computer, run it with psql, and delete it afterwards. Never email or upload it anywhere else.', 'lock'),
    h('div.small.muted', { style: 'margin-top:8px' }, 'Built from the data pack exactly as it shipped in the zip (not from changes made on this computer). Run it with:'),
    command('psql "<your connection string>" -f 06_seed.sql'),
    h('div.gl-row', sqlButtons(step, make, { copy: false })), bar);
}

function cronStep(step, onRef) {
  const input = h('input.input', { placeholder: '20 lowercase letters, e.g. from https://<ref>.supabase.co', style: 'max-width:340px', autocomplete: 'off', spellcheck: 'false' });
  const note = h('div.small.muted');
  const buttons = h('div.gl-row');
  const valid = () => PROJECT_REF.test(input.value.trim());
  const draw = () => {
    note.textContent = !input.value.trim() ? 'Type your project ref first.' : valid() ? 'Project ref looks right.' : 'A project ref is exactly 20 lowercase letters (Project Settings → General).';
    buttons.replaceChildren(...sqlButtons(step, () => step.sql({ projectRef: input.value.trim() })));
    buttons.querySelectorAll('button').forEach(b => { b.disabled = !valid(); });
    onRef(valid() ? input.value.trim() : '');
  };
  input.addEventListener('input', draw);
  draw();
  return card({ title: stepTitle(step), icon: 'calendar-clock', cls: 'solid' },
    h('p.muted', step.text),
    h('ol', { style: 'margin:0 0 8px 18px' },
      h('li', 'Supabase → Database → Extensions: enable pg_cron and pg_net.'),
      h('li', 'SQL Editor, with the same value as the CRON_SECRET secret (step 6 of the guide):'),
    ),
    command("select vault.create_secret('<the CRON_SECRET value>', 'agent_cron_secret');"),
    h('div.field', { style: 'margin-top:8px' }, h('label.field-label', 'Your Supabase project ref'), input), note, buttons);
}

function linkStep(step) {
  const box = h('div', h('div.small.muted', 'Reading the staff list from the data pack…'));
  loadPackCollection('profiles').then(profiles => {
    const people = loginPeople(profiles || []);
    if (!people.length) { box.replaceChildren(callout('info', 'Nobody to link', 'The data pack has no staff with old-CRM logins. Add everyone from Admin → Users once live.')); return; }
    const inputs = new Map(people.map(p => [p.id, h('input.input', { type: 'email', placeholder: 'their email address', autocomplete: 'off' })]));
    const make = () => {
      const emails = Object.fromEntries([...inputs].map(([id, el]) => [id, el.value.trim()]).filter(([, v]) => v));
      const bad = Object.values(emails).find(v => !EMAIL.test(v));
      if (bad) throw new Error(`“${bad}” is not an email address`);
      if (!Object.keys(emails).length) throw new Error('Type at least one email address first (the owner’s).');
      return step.sql({ people, emails });
    };
    box.replaceChildren(
      h('div.gl-people', people.map(p => h('div.gl-person', h('div', h('b', p.name), h('div.small.muted', p.role)), inputs.get(p.id)))),
      h('p.small.muted', { style: 'margin-top:8px' }, 'Leave an email empty for anyone who does not need a login yet. Each person must first exist under Supabase → Authentication → Users (Add user, tick Auto Confirm User).'),
      h('div.gl-row', sqlButtons(step, make)));
  }).catch(e => box.replaceChildren(callout('danger', 'Could not read the staff list', e.message)));
  return card({ title: stepTitle(step), icon: 'link', cls: 'solid' }, h('p.muted', step.text), box);
}

export function goLivePage(ctx) {
  let ref = '';
  const refFor = () => ref || '<your project ref>';
  const deployBox = h('div');
  const drawDeploy = () => deployBox.replaceChildren(
    h('p.muted', 'On your own computer, in the landscapers-hq folder, with the Supabase CLI (1.215.0 or newer) installed:'),
    command('supabase login'),
    command(`node tools/deploy-functions.js --project-ref ${refFor()}`),
    h('p.small.muted', 'It deploys all five Edge Functions (plain JavaScript). Then set the secrets as the guide shows (email sending, the schedule secret, the optional AI key).'));
  const settingsBox = h('div');
  const drawSettings = () => settingsBox.replaceChildren(command(`mode: 'supabase',\nSUPABASE_URL: 'https://${refFor()}.supabase.co',\nSUPABASE_ANON_KEY: '<the anon public key>'`));
  drawDeploy(); drawSettings();
  const byId = id => STEPS.find(s => s.id === id);

  return h('div',
    pageHeader({ title: 'Go live', sub: 'Move from this computer to Supabase: a login for everyone, one shared database, file storage and the 24/7 agent.', icon: 'rocket', tile: 't-grass', actions: [adminNav(ctx, 'golive')] }),
    h('div.stack', { style: 'gap:14px' },
      IS_SUPABASE()
        ? callout('success', 'This app is already connected to Supabase', 'Use the steps below again when a new release changes the database (re-run 01–05; they never delete data).', 'cloud')
        : callout('info', 'About an hour, done once by the owner or an administrator', h('span', 'Follow ', guideLink(), ' alongside this page: it explains every step. Here you get the SQL for each step, ready to copy or download.')),
      callout('warn', 'Keys stay off this app', 'The service_role key and the database password never go into this app, a chat message or an email. Nothing on this page contains a key.', 'key-round'),
      card({ title: 'Before the SQL', icon: 'list-checks', cls: 'solid' },
        h('ol', { style: 'margin:0 0 0 18px' },
          h('li', 'Create the project (region Africa (Cape Town) if offered) and keep the database password safe.'),
          h('li', 'Authentication → Providers → Email: turn sign-ups off, keep Confirm email on. Set the Site URL to where the app will live.'),
          h('li', h('span', 'Run the steps below in order in Supabase → SQL Editor (or with psql). Each is safe to run again. Details: ', guideLink('guide, step 3', '#3-create-the-database'), '.')))),
      h('div.gl-steps',
        ...['01', '02', '03', '04', '05'].map(id => plainStep(byId(id))),
        seedStep(byId('06')),
        linkStep(byId('08')),
        card({ title: 'Edge Functions (server code)', icon: 'terminal', cls: 'solid' }, deployBox),
        cronStep(byId('07'), r => { ref = r; drawDeploy(); drawSettings(); }),
        card({ title: 'Original documents to Storage', icon: 'folder-up', cls: 'solid' },
          h('p.muted', 'The 253 documents are already in the data/vault folder of the zip. Upload them once, from your own computer, in PowerShell in the landscapers-hq folder:'),
          command('$env:SUPABASE_URL="https://<your project ref>.supabase.co"; $env:SUPABASE_SERVICE_ROLE_KEY="<service_role key>"; node tools/upload-vault.js'),
          h('p.small.muted', 'Type the service_role key only into that command, and close PowerShell afterwards. It checks every document against its record before uploading; safe to run again.')),
        card({ title: 'Point the app at Supabase', icon: 'settings', cls: 'solid' },
          h('p.muted', 'In js/settings.js (the only file you edit), with the Project URL and the anon public key from Project Settings → API:'),
          settingsBox,
          h('p.small.muted', h('span', 'Then publish the app without data/seed, data/vault and data-tools (', h('a', { href: 'docs/DEPLOY.html', target: '_blank', rel: 'noopener' }, 'hosting guide'), '). Copies opened by double-clicking index.html read js/settings.js too — no rebuild needed.'))))),
    h('p.small.muted', { style: 'margin-top:16px' }, icon('info', 12), ' Developers can write the same SQL to files instead: npm run sql (build/sql/).'));
}
