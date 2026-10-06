/* =============================================================================
   Universal record links:  #/record/<collection>/<id>   (and #/record/<collection> = list)
   Resolves to the owning app's detail view when that app provides one
   (export `detail: { <collection>: (id, ctx) => Node }` from the app module),
   otherwise shows the generic, schema-driven detail page.
   ========================================================================== */

import { getDef } from '../../core/schema.js';
import { canApp, can } from '../../core/perms.js';
import { entityDetailPage, entityListPage } from '../../ui/entity.js';
import { emptyState } from '../../ui/components.js';

// The apps that render each collection's own page, best first (each exports `detail[col]`).
// The first one the signed-in user may open is used; otherwise the generic record page.
// tests__record-owners.test.js keeps this in step with the apps.
export const OWNERS = {
  events: ['calendar'], clients: ['clients'], contacts: ['contacts'], docs: ['docs'], files: ['drive'], expenses: ['finance'],
  forms: ['forms'], form_responses: ['forms'], invoices: ['invoices'], leads: ['leads'], payments: ['payments'], quotes: ['quotes'],
  visits: ['schedule', 'operations'], sheets: ['sheets'], slides: ['slides'], tasks: ['tasks'],
  assets: ['assets'], asset_maintenance: ['assets', 'operations'], services: ['catalogue', 'marketing'], design_options: ['catalogue', 'marketing'],
  compliance_docs: ['compliance'], bank_accounts: ['compliance'], data_issues: ['compliance'], vehicles: ['fleet'], vehicle_logs: ['fleet'],
  jobs: ['jobs', 'operations'], job_costs: ['jobs'], kpi_definitions: ['kpi'], kpi_entries: ['kpi', 'operations'], meetings: ['kpi', 'strategy'],
  references: ['marketing'], medicals: ['medicals'], employees: ['people'], payroll: ['people'], deductions: ['people'], hr_actions: ['people'],
  incidents: ['safety'], ppe_issues: ['safety'], appointments: ['safety'], toolbox_talks: ['safety', 'training'], goals: ['strategy'],
  suppliers: ['suppliers'], purchases: ['suppliers'], certificates: ['training']
};

export default {
  id: 'record',
  routes: {
    ':col/:id': async ctx => {
      const { col, id } = ctx.params;
      const def = getDef(col);
      if (!def) return emptyState({ icon: 'search-x', title: 'Unknown record type', text: col });
      if (!can('read', col)) return emptyState({ icon: 'lock', title: 'You do not have access to this record' });
      const owner = [def.app, ...(OWNERS[col] || [])].filter(Boolean).find(a => canApp(a));
      if (ctx.setTitle) ctx.setTitle(def.label);
      if (owner) {
        try {
          const mod = await import(`../${owner}/index.js`);
          const app = mod.default || mod;
          if (app.detail && typeof app.detail[col] === 'function') return app.detail[col](decodeURIComponent(id), ctx);
        } catch (e) { console.warn('detail delegate failed', e); }
      }
      return entityDetailPage(col, decodeURIComponent(id), ctx, { backHref: owner ? `#/${owner}` : '#/home', backLabel: def.label });
    },
    ':col': ctx => {
      const def = getDef(ctx.params.col);
      if (!def) return emptyState({ icon: 'search-x', title: 'Unknown record type', text: ctx.params.col });
      if (!can('read', ctx.params.col)) return emptyState({ icon: 'lock', title: 'You do not have access to these records' });
      if (ctx.setTitle) ctx.setTitle(def.label);
      return entityListPage(ctx.params.col, ctx);
    }
  }
};
