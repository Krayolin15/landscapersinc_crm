/* =============================================================================
   Admin console — Google Admin console class. Owner/admin only (registry.js
   sets roles: []; the router hides the app and its href from everyone else,
   and every write inside still goes through db which enforces perms/RLS).
   ========================================================================== */
import { dashboardPage } from './dashboard.js';
import { usersPage } from './users.js';
import { groupsPage } from './groups.js';
import { rolesPage } from './roles.js';
import { companyPage } from './company.js';
import { auditPage } from './audit.js';
import { dataHealthPage } from './data-health.js';
import { backupPage } from './backup.js';
import { importPage } from './import.js';
import { systemPage } from './system.js';
import { goLivePage } from './golive.js';

export default {
  id: 'admin',
  routes: {
    '': ctx => dashboardPage(ctx),
    'users': ctx => usersPage(ctx),
    'groups': ctx => groupsPage(ctx),
    'roles': ctx => rolesPage(ctx),
    'company': ctx => companyPage(ctx),
    'audit': ctx => auditPage(ctx),
    'data': ctx => dataHealthPage(ctx),
    'backup': ctx => backupPage(ctx),
    'import': ctx => importPage(ctx),
    'import/:col': ctx => importPage(ctx),
    'system': ctx => systemPage(ctx),
    'golive': ctx => goLivePage(ctx)
  }
};
