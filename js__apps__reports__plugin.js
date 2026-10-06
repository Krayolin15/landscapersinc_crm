import { registerAction } from '../../core/search.js';

export default function () {
  registerAction({ id: 'rep-radar', label: 'KPI radar — revenue, debt ageing, crews, retention', icon: 'radar', keywords: 'kpi radar dashboard revenue expenses ageing retention ltv', app: 'reports', run: () => (location.hash = '#/reports') });
  registerAction({ id: 'rep-builder', label: 'Build a report', icon: 'wand-sparkles', keywords: 'report builder group sum chart export excel', app: 'reports', run: () => (location.hash = '#/reports/builder') });
}
