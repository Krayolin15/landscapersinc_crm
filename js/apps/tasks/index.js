/* =============================================================================
   Tasks (#/tasks) — to-dos for you and the team: lists, a board by status, due
   dates, priorities, assignees, subtasks, repeating tasks (the next one is
   created when you complete it) and links to the record a task is about.
   ========================================================================== */

import { h, ensureStyle } from '../../ui/dom.js';
import { icon } from '../../ui/icons.js';
import { btn, badge, card, pageHeader, emptyState, seg, avatar, attribution } from '../../ui/components.js';
import { drawer, toast, showError, confirm } from '../../ui/overlays.js';
import { fieldInput, refPicker } from '../../ui/form.js';
import { celebrate } from '../../ui/animate.js';
import { db } from '../../core/db.js';
import { store } from '../../core/bus.js';
import { today, addDays, addMonths } from '../../core/dates.js';
import * as fmt from '../../core/format.js';

ensureStyle('lsi-tasks', `
.tk{display:flex;gap:10px;align-items:flex-start;padding:10px 12px;border-radius:14px;background:var(--surface-solid);border:1px solid var(--border);margin-bottom:8px;cursor:pointer;transition:transform .12s}
.tk:hover{transform:translateX(2px)}.tk.done .tt{text-decoration:line-through;opacity:.6}
.tk .ck{width:22px;height:22px;border-radius:50%;border:2px solid var(--border-strong,#9aa);flex:none;display:grid;place-items:center;margin-top:1px}
.tk.done .ck{background:var(--primary);border-color:var(--primary);color:#fff}
.tk .tt{font-weight:600}.tk .ts{font-size:var(--fs-xs);color:var(--muted);margin-top:2px;display:flex;gap:8px;flex-wrap:wrap}
.tk-board{display:grid;grid-auto-flow:column;grid-auto-columns:minmax(260px,1fr);gap:12px;overflow-x:auto}
.tk-col{background:var(--surface-2);border-radius:18px;padding:10px;min-height:200px}.tk-col.over{outline:2px dashed var(--primary)}
.tk-lists{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px}
`);

const STATUS = [['todo', 'To do'], ['in_progress', 'In progress'], ['waiting', 'Waiting'], ['done', 'Done']];
const PRI = { urgent: ['Urgent', 'red'], high: ['High', 'clay'], normal: ['Normal', 'gray'], low: ['Low', 'blue'] };
const me = () => store.get('user') || {};
const nextDue = (d, r) => (!d ? null : r === 'daily' ? addDays(d, 1) : r === 'weekly' ? addDays(d, 7) : r === 'monthly' ? addMonths(d, 1) : r === 'yearly' ? addMonths(d, 12) : null);

export async function toggleDone(t) {
  const done = t.status !== 'done';
  await db.update('tasks', t.id, { status: done ? 'done' : 'todo', completed_at: done ? new Date().toISOString() : null });
  if (done && t.recurrence && t.recurrence !== 'none') {
    const { id, status, completed_at, created_at, created_by, created_by_name, updated_at, updated_by, updated_by_name, _src, _seed, ...rest } = t;
    await db.insert('tasks', { ...rest, status: 'todo', due_date: nextDue(t.due_date || today(), t.recurrence) });
    toast.info('Next repeat created', { text: `Due ${nextDue(t.due_date || today(), t.recurrence)}` });
  }
  if (done) celebrate({ confetti: false, leaves: 10 });
}

function row(t, open) {
  const pr = PRI[t.priority] || PRI.normal;
  const overdue = t.status !== 'done' && t.due_date && t.due_date < today();
  const who = t.assignee_id ? db.get('profiles', t.assignee_id) : null;
  const subs = Array.isArray(t.subtasks) ? t.subtasks : [];
  return h('div', { class: ['tk', t.status === 'done' ? 'done' : ''], draggable: 'true', onDragstart: e => e.dataTransfer.setData('text/task', t.id), onClick: () => open(t) },
    h('button.ck', { title: t.status === 'done' ? 'Mark not done' : 'Complete', onClick: e => { e.stopPropagation(); toggleDone(t).catch(showError); } }, t.status === 'done' ? icon('check', 14) : null),
    h('div', { style: 'flex:1;min-width:0' }, h('div.tt', t.title),
      h('div.ts', t.due_date ? h('span', { style: overdue ? 'color:var(--danger);font-weight:600' : '' }, icon('calendar', 12), ' ', fmt.dueLabel(t.due_date)) : null,
        t.priority && t.priority !== 'normal' ? badge(pr[0], pr[1]) : null, t.list_name ? h('span', icon('list', 12), ' ', t.list_name) : null,
        subs.length ? h('span', icon('list-checks', 12), ` ${subs.filter(s => s.done).length}/${subs.length}`) : null,
        t.recurrence && t.recurrence !== 'none' ? h('span', icon('repeat', 12), ' ', t.recurrence) : null,
        t.related_collection && t.related_id ? h('a', { href: `#/record/${t.related_collection}/${encodeURIComponent(t.related_id)}`, onClick: e => e.stopPropagation() }, icon('link', 12), ' linked') : null)),
    who ? avatar(who) : null);
}

function openTask(t0) {
  const isNew = !t0 || !t0.id;
  const v = { status: 'todo', priority: 'normal', list_name: 'My tasks', recurrence: 'none', subtasks: [], assignee_id: me().id || null, ...(t0 || {}) };
  v.subtasks = (v.subtasks || []).map(s => ({ ...s }));
  const subsBox = h('div.stack.tight');
  const drawSubs = () => subsBox.replaceChildren(...v.subtasks.map((s, i) => h('div.row.gap-8', h('input', { type: 'checkbox', checked: !!s.done, onChange: e => { s.done = e.target.checked; } }), h('input.input', { value: s.title || '', onInput: e => { s.title = e.target.value; } }), btn({ icon: 'x', size: 'sm', variant: 'ghost', title: 'Remove', onClick: () => { v.subtasks.splice(i, 1); drawSubs(); } }))),
    btn({ label: 'Add subtask', icon: 'plus', size: 'sm', variant: 'ghost', onClick: () => { v.subtasks.push({ title: '', done: false }); drawSubs(); } }));
  drawSubs();
  const f = (label, name, def) => h('div.field', h('label.field-label', label), fieldInput(def, v[name], x => { v[name] = x; }));
  const lists = [...new Set(db.all('tasks').map(x => x.list_name).filter(Boolean))];
  const d = drawer({
    title: isNew ? 'New task' : 'Task', icon: 'list-todo', tile: 't-sun',
    body: h('div.stack',
      h('input.input', { value: v.title || '', placeholder: 'What needs doing?', style: 'font-size:1.1rem;font-weight:600', autofocus: true, onInput: e => { v.title = e.target.value; } }),
      h('div.form-grid', f('Status', 'status', { type: 'enum', required: true, options: STATUS.map(([value, label]) => ({ value, label })) }), f('Priority', 'priority', { type: 'enum', required: true, options: ['low', 'normal', 'high', 'urgent'] }),
        f('Due', 'due_date', { type: 'date' }), f('Time', 'due_time', { type: 'time' }),
        h('div.field', h('label.field-label', 'Assigned to'), refPicker({ ref: 'profiles' }, v.assignee_id, x => { v.assignee_id = x; })),
        h('div.field', h('label.field-label', 'List'), h('input.input', { value: v.list_name || '', list: 'tk-lists', onInput: e => { v.list_name = e.target.value; } }), h('datalist#tk-lists', lists.map(l => h('option', { value: l })))),
        f('Repeats', 'recurrence', { type: 'enum', required: true, options: ['none', 'daily', 'weekly', 'monthly', 'yearly'] })),
      h('div.field', h('label.field-label', 'Notes'), fieldInput({ type: 'longtext', rows: 4 }, v.notes, x => { v.notes = x; })),
      h('div.field', h('label.field-label', 'Subtasks'), subsBox),
      !isNew ? h('div.small.muted', attribution(v)) : null),
    footer: h('div.row.gap-8', !isNew ? btn({ label: 'Delete', icon: 'trash-2', variant: 'ghost', onClick: async () => { if (await confirm('Delete this task?', { danger: true, ok: 'Delete' })) { await db.remove('tasks', v.id); d.close(); } } }) : null, h('span.spacer'),
      btn({ label: 'Save', icon: 'check', variant: 'primary', onClick: async () => {
        if (!String(v.title || '').trim()) return toast.error('Give the task a title');
        const { id, created_at, created_by, created_by_name, updated_at, updated_by, updated_by_name, ...rec } = v;
        rec.subtasks = v.subtasks.filter(s => String(s.title || '').trim());
        if (rec.status === 'done' && !rec.completed_at) rec.completed_at = new Date().toISOString();
        try { isNew ? await db.insert('tasks', rec) : await db.update('tasks', id, rec); toast.success('Saved'); d.close(); } catch (e) { showError(e); }
      } }))
  });
}

function page(ctx) {
  let view = ctx.query.view || 'list', scope = ctx.query.scope || 'mine', list = ctx.query.list || null, q = '';
  const body = h('div');
  const listsBox = h('div.tk-lists');
  const rows = () => db.all('tasks').filter(t => (scope === 'mine' ? !t.assignee_id || t.assignee_id === me().id : scope === 'team' ? true : t.created_by === me().id) && (!list || t.list_name === list) && (!q || `${t.title} ${t.notes || ''}`.toLowerCase().includes(q)));
  const draw = () => {
    const all = rows();
    listsBox.replaceChildren(h('button', { class: ['chip', !list ? 'active' : ''], onClick: () => { list = null; draw(); } }, 'All lists'),
      ...[...new Set(db.all('tasks').map(t => t.list_name).filter(Boolean))].sort().map(l => h('button', { class: ['chip', list === l ? 'active' : ''], onClick: () => { list = l; draw(); } }, l)));
    if (view === 'board') {
      body.replaceChildren(h('div.tk-board', STATUS.map(([st, label]) => {
        const col = h('div.tk-col', { onDragover: e => { e.preventDefault(); col.classList.add('over'); }, onDragleave: () => col.classList.remove('over'),
          onDrop: async e => { e.preventDefault(); col.classList.remove('over'); const t = db.get('tasks', e.dataTransfer.getData('text/task')); if (t && t.status !== st) { if (st === 'done' || t.status === 'done') await toggleDone(t); else await db.update('tasks', t.id, { status: st }); } } },
        h('div.row', { style: 'margin-bottom:8px' }, h('strong', label), h('span.spacer'), badge(String(all.filter(t => t.status === st).length), 'gray')),
        ...all.filter(t => t.status === st).sort((a, b) => String(a.due_date || '9').localeCompare(String(b.due_date || '9'))).map(t => row(t, openTask)));
        return col;
      })));
      return;
    }
    const open = all.filter(t => t.status !== 'done');
    const groups = [['Overdue', open.filter(t => t.due_date && t.due_date < today())], ['Today', open.filter(t => t.due_date === today())], ['Next 7 days', open.filter(t => t.due_date > today() && t.due_date <= addDays(today(), 7))], ['Later', open.filter(t => t.due_date > addDays(today(), 7))], ['No date', open.filter(t => !t.due_date)], ['Completed', all.filter(t => t.status === 'done').sort((a, b) => String(b.completed_at).localeCompare(String(a.completed_at))).slice(0, 30)]];
    body.replaceChildren(...(all.length ? groups.filter(g => g[1].length).map(([label, ts]) => card({ title: label, sub: `${ts.length}`, cls: 'solid', icon: label === 'Overdue' ? 'alarm-clock' : label === 'Completed' ? 'circle-check' : 'list-todo' }, ...ts.sort((a, b) => String(a.due_date || '').localeCompare(String(b.due_date || ''))).map(t => row(t, openTask))))
      : [emptyState({ icon: 'party-popper', title: 'No tasks here', text: 'Add one with the button above.' })]));
  };
  ctx.dispose.add(db.on('tasks', draw));
  if (ctx.query.open) setTimeout(() => { const t = db.get('tasks', ctx.query.open); if (t) openTask(t); }, 100);
  draw();
  return h('div',
    pageHeader({ title: 'Tasks', sub: 'Everything that needs doing — yours and the team’s.', icon: 'list-todo', tile: 't-sun', actions: [btn({ label: 'New task', icon: 'plus', variant: 'primary', onClick: () => openTask({ list_name: list || 'My tasks' }) })] }),
    h('div.row.wrap.gap-8', { style: 'margin-bottom:10px' }, seg([{ id: 'mine', label: 'Mine' }, { id: 'team', label: 'Team' }, { id: 'created', label: 'Created by me' }], scope, id => { scope = id; draw(); }),
      seg([{ id: 'list', label: 'List', icon: 'list' }, { id: 'board', label: 'Board', icon: 'kanban' }], view, id => { view = id; draw(); }), h('span.spacer'),
      h('input.input', { placeholder: 'Search tasks…', style: 'max-width:240px', onInput: e => { q = e.target.value.toLowerCase(); draw(); } })),
    listsBox, body);
}

export default { id: 'tasks', routes: { '': page }, detail: { tasks: (id, ctx) => { setTimeout(() => { const t = db.get('tasks', id); if (t) openTask(t); }, 50); return page({ ...ctx, query: {} }); } } };
export { openTask };
