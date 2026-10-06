/* =============================================================================
   Autonomous Core — "Settings" tab. Every control here is wired to something
   the agent actually reads (js/agent/adapters.js:agentSettings /
   js/agent/runner.js / the pure modules) — no decorative toggles.
   ========================================================================== */

import { h } from '../../ui/dom.js';
import { btn, card, callout } from '../../ui/components.js';
import { toast, showError } from '../../ui/overlays.js';
import { agentSettings, saveAgentSettings, JOBS } from '../../agent/adapters.js';
import { JOB_META } from './meta.js';

const STAGES = [3, 7, 14];

function checkboxRow(label, checked, onChange) {
  return h('label.row.gap-8', { style: 'align-items:center;min-height:40px;padding:6px 0;cursor:pointer' },
    h('input', { type: 'checkbox', checked, style: 'width:20px;height:20px;flex:none', onChange: e => onChange(e.target.checked) }), h('span.small', label));
}
function numberField(label, value, onInput, { min, max, step = 1, suffix = '' } = {}) {
  return h('div.field', { style: 'max-width:220px' },
    h('label.field-label', label),
    h('div.row.gap-8', { style: 'align-items:center' },
      h('input.input', { type: 'number', value, min, max, step, onInput: e => onInput(Number(e.target.value)) }),
      suffix ? h('span.small.muted', suffix) : null));
}
function timeField(label, value, onInput) {
  return h('div.field', { style: 'max-width:160px' }, h('label.field-label', label), h('input.input', { type: 'time', value, onInput: e => onInput(e.target.value) }));
}

export function settingsTab(ctx) {
  const s = agentSettings();
  const state = {
    reminderStages: [...s.reminderStages],
    fuelPriceRandPerLitre: s.fuelPriceRandPerLitre,
    defaultFuelL100km: s.defaultFuelL100km,
    workWindow: { ...s.workWindow },
    jobsEnabled: { ...s.jobsEnabled },
    popAutoApplyThreshold: Math.round((s.autoApply.popAutoApplyThreshold ?? 0.95) * 100)
  };

  const saveBtn = btn({
    label: 'Save settings', icon: 'save', variant: 'primary',
    onClick: async e => {
      e.currentTarget.disabled = true;
      try {
        await saveAgentSettings({
          reminderStages: state.reminderStages.length ? [...state.reminderStages].sort((a, b) => a - b) : STAGES,
          fuelPriceRandPerLitre: state.fuelPriceRandPerLitre || 23,
          defaultFuelL100km: state.defaultFuelL100km || 12,
          workWindow: state.workWindow,
          jobsEnabled: state.jobsEnabled,
          autoApply: { ...s.autoApply, popAutoApplyThreshold: Math.min(1, Math.max(0, state.popAutoApplyThreshold / 100)) }
        });
        toast.success('Settings saved');
        ctx.refresh();
      } catch (err) { showError(err, 'Could not save settings'); }
      finally { e.currentTarget.disabled = false; }
    }
  });

  return h('div.stack',
    card({ title: 'Which jobs run', icon: 'toggle-left', cls: 'solid', sub: 'Turned off here, a job is skipped by both the browser runner and the cloud Edge Function.' },
      h('div.stack.tight', JOBS.map(job => checkboxRow(`${JOB_META[job].label} — ${JOB_META[job].schedule}`, state.jobsEnabled[job] !== false, v => { state.jobsEnabled[job] = v; }))) ),
    card({ title: 'Debtor reminders', icon: 'banknote', cls: 'solid', sub: 'Days after an invoice’s due date a reminder goes out (one per invoice per stage, never repeated).' },
      h('div.row.gap-16.wrap', STAGES.map(d => checkboxRow(`${d} days overdue`, state.reminderStages.includes(d), v => { state.reminderStages = v ? [...new Set([...state.reminderStages, d])] : state.reminderStages.filter(x => x !== d); })))),
    card({ title: 'Dispatch planning', icon: 'route', cls: 'solid' },
      h('div.row.wrap.gap-24',
        numberField('Fuel price', state.fuelPriceRandPerLitre, v => (state.fuelPriceRandPerLitre = v), { min: 1, step: 0.5, suffix: 'R / litre' }),
        numberField('Default vehicle consumption', state.defaultFuelL100km, v => (state.defaultFuelL100km = v), { min: 1, step: 0.5, suffix: 'L / 100 km' }),
        timeField('Work day starts', state.workWindow.start, v => (state.workWindow.start = v)),
        timeField('Work day ends', state.workWindow.end, v => (state.workWindow.end = v)))),
    card({ title: 'Payments', icon: 'wallet', cls: 'solid', sub: 'Below this confidence, a matched proof of payment is queued for a person to confirm instead of being applied automatically.' },
      numberField('Auto-apply confidence', state.popAutoApplyThreshold, v => (state.popAutoApplyThreshold = v), { min: 50, max: 100, step: 1, suffix: '%' })),
    h('div', saveBtn),
    callout('info', 'Weather thresholds are fixed', 'Wet (≥70% rain chance and ≥2mm, or ≥5mm regardless), storm (thunderstorm or gusts ≥60 km/h) and windy (≥40 km/h) thresholds are defined in js/core/weather.js and shared with the cloud runner — they are not user-configurable, so every forecast reads the same way everywhere in the system.', 'cloud-lightning'));
}
