/* =============================================================================
   Charts — thin, themed wrapper over Chart.js (vendored).
   chart({ type, labels, series:[{label, data, color, fill, type, yAxis, dashed}], height, dispose,
           money:true, stacked, horizontal, legend, onClick(index), options })
   Colours come from the CSS tokens so charts follow light/dark theme.
   ========================================================================== */

import { h } from './dom.js';
import { money as fmtMoney, num as fmtNum, moneyCompact } from '../core/format.js';
import { ensureLib } from '../core/lazy.js';

export function palette() {
  const cs = getComputedStyle(document.documentElement);
  return ['--c1', '--c2', '--c3', '--c4', '--c5', '--c6', '--c7', '--c8'].map(v => cs.getPropertyValue(v).trim() || '#1f7440');
}
const cssVar = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

/** 'var(--c2)' -> '#1e9bc4' (Chart.js draws on canvas, which cannot read CSS variables). */
export function resolveColor(c) {
  if (!c) return c;
  const m = /^var\((--[\w-]+)\)$/.exec(String(c).trim());
  return m ? cssVar(m[1]) || c : c;
}

function alpha(hex, a) {
  const m = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(hex || '');
  if (!m) return hex;
  return `rgba(${parseInt(m[1], 16)},${parseInt(m[2], 16)},${parseInt(m[3], 16)},${a})`;
}

export function chart(o) {
  const box = h('div', { class: ['chart-box', o.size || ''], style: o.height ? { height: o.height + 'px' } : undefined });
  const canvas = h('canvas', { role: 'img', 'aria-label': o.aria || o.title || 'Chart' });
  box.appendChild(canvas);
  // the disposer is registered now (not after the library loads) so a view closed while
  // the chart is still loading never leaves a chart behind
  let dead = false, inst = null;
  if (o.dispose) o.dispose.add(() => { dead = true; if (inst) inst.destroy(); });

  ensureLib('chart').then(() => requestAnimationFrame(() => {
    if (dead) return;
    const pal = palette();
    const text = cssVar('--muted'), grid = cssVar('--border');
    const isPie = ['doughnut', 'pie', 'polarArea'].includes(o.type);
    const datasets = (o.series || []).map((s, i) => {
      const color = resolveColor(s.color) || pal[i % pal.length];
      if (s.colors) s.colors = s.colors.map(resolveColor);
      const ds = {
        label: s.label, data: s.data, type: s.type, yAxisID: s.yAxis,
        borderColor: isPie ? cssVar('--surface-solid') : color,
        backgroundColor: isPie ? (s.colors || s.data.map((_, j) => pal[j % pal.length])) : (s.fill || o.type === 'bar' || s.type === 'bar' ? alpha(color, o.type === 'bar' || s.type === 'bar' ? 0.85 : 0.18) : color),
        borderWidth: isPie ? 3 : (o.type === 'bar' || s.type === 'bar' ? 0 : 2.5),
        fill: !!s.fill, tension: 0.38, pointRadius: s.points === false ? 0 : 3, pointHoverRadius: 6,
        pointBackgroundColor: color, borderRadius: o.type === 'bar' || s.type === 'bar' ? 8 : undefined, borderSkipped: false,
        borderDash: s.dashed ? [6, 5] : undefined, hoverOffset: isPie ? 10 : undefined, order: s.order
      };
      if (s.fill && ctxGradient) ds.backgroundColor = ctxGradient(canvas, color);
      return ds;
    });
    const tickFmt = o.money ? v => moneyCompact(v) : o.percent ? v => v + '%' : v => fmtNum(v);
    const tipFmt = o.money ? v => fmtMoney(v) : o.percent ? v => v.toFixed(1) + '%' : v => fmtNum(v, Number.isInteger(v) ? 0 : 2);
    const cfg = {
      type: o.type || 'line',
      data: { labels: o.labels, datasets },
      options: {
        responsive: true, maintainAspectRatio: false, indexAxis: o.horizontal ? 'y' : 'x',
        animation: { duration: 900, easing: 'easeOutQuart' },
        interaction: { mode: isPie ? 'nearest' : 'index', intersect: isPie },
        cutout: o.type === 'doughnut' ? '68%' : undefined,
        plugins: {
          legend: { display: o.legend ?? (datasets.length > 1 || isPie), position: isPie ? 'right' : 'bottom', labels: { color: text, usePointStyle: true, pointStyle: 'circle', boxWidth: 8, padding: 14, font: { family: 'Plus Jakarta Sans', size: 12 } } },
          tooltip: {
            backgroundColor: '#0b2a18', titleColor: '#fff', bodyColor: '#eaf3ec', padding: 12, cornerRadius: 12, displayColors: true, boxPadding: 4,
            titleFont: { family: 'Plus Jakarta Sans', weight: '700' }, bodyFont: { family: 'Plus Jakarta Sans' },
            callbacks: { label: c => ` ${c.dataset.label ? c.dataset.label + ': ' : ''}${tipFmt(c.parsed.y ?? c.parsed.x ?? c.parsed)}` }
          }
        },
        scales: isPie ? {} : {
          x: { stacked: !!o.stacked, grid: { display: !!o.horizontal, color: grid, drawBorder: false }, ticks: { color: text, font: { family: 'Plus Jakarta Sans', size: 11 }, maxRotation: 0, autoSkipPadding: 12, callback: o.horizontal ? function (v) { return tickFmt(v); } : undefined }, border: { display: false } },
          y: { stacked: !!o.stacked, beginAtZero: o.beginAtZero ?? true, grid: { display: !o.horizontal, color: grid }, ticks: { color: text, font: { family: 'Plus Jakarta Sans', size: 11 }, callback: o.horizontal ? undefined : v => tickFmt(v), padding: 6 }, border: { display: false } },
          ...(o.y2 ? { y2: { position: 'right', grid: { display: false }, ticks: { color: text, callback: o.y2Percent ? v => v + '%' : v => fmtNum(v) }, border: { display: false } } } : {})
        },
        onClick: o.onClick ? (_, els) => { if (els && els.length) o.onClick(els[0].index, els[0].datasetIndex); } : undefined,
        ...(o.options || {})
      }
    };
    inst = new window.Chart(canvas, cfg);
    box.chart = inst;
  })).catch(() => { if (!dead) box.replaceChildren(h('div.empty', h('p', 'Charts are unavailable right now — check your connection and reload.'))); });
  return box;
}

function ctxGradient(canvas, color) {
  return context => {
    const { chart: c } = context;
    const area = c.chartArea;
    if (!area) return alpha(color, 0.15);
    const g = c.ctx.createLinearGradient(0, area.top, 0, area.bottom);
    g.addColorStop(0, alpha(color, 0.32));
    g.addColorStop(1, alpha(color, 0.01));
    return g;
  };
}
