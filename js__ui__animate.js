/* =============================================================================
   Motion helpers: animated counters, ripples, celebrations.
   Everything respects prefers-reduced-motion and the user's motion setting.
   ========================================================================== */

const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.dataset.motion === 'off';

/** Count a number up from 0 when the element scrolls into view. */
export function countUp(el, to, format = v => Math.round(v).toLocaleString(), ms = 1100) {
  if (reduced() || !isFinite(to)) { el.textContent = format(to); return; }
  const start = () => {
    const t0 = performance.now();
    const step = now => {
      const p = Math.min(1, (now - t0) / ms);
      const eased = 1 - Math.pow(1 - p, 4);
      el.textContent = format(p === 1 ? to : to * eased);
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver(entries => { if (entries.some(e => e.isIntersecting)) { io.disconnect(); start(); } });
    queueMicrotask(() => io.observe(el));
  } else start();
}

/** Material-style ripple on any .ripple-host / .btn click. */
export function installRipples() {
  document.addEventListener('pointerdown', e => {
    const host = e.target.closest('.btn, .ripple-host, .nav-item, .launch-app, .chip');
    if (!host || reduced()) return;
    const r = host.getBoundingClientRect();
    const size = Math.max(r.width, r.height);
    const wave = document.createElement('span');
    wave.className = 'ripple-wave';
    wave.style.cssText = `width:${size}px;height:${size}px;left:${e.clientX - r.left - size / 2}px;top:${e.clientY - r.top - size / 2}px`;
    if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
    host.style.overflow = 'hidden';
    host.appendChild(wave);
    setTimeout(() => wave.remove(), 650);
  }, { passive: true });
}

const LEAF_COLORS = ['#5fa83b', '#7cc24e', '#1f7440', '#f2b42f', '#c8733a', '#3ab6d9'];
/** Falling leaves + confetti burst — for paid invoices, won deals, completed goals. */
export function celebrate({ leaves = 26, confetti = true } = {}) {
  if (reduced()) return;
  const layer = document.createElement('div');
  layer.className = 'leaf-layer';
  for (let i = 0; i < leaves; i++) {
    const leaf = document.createElement('i');
    const c = LEAF_COLORS[i % LEAF_COLORS.length];
    leaf.style.left = Math.random() * 100 + 'vw';
    leaf.style.setProperty('--dx', (Math.random() * 160 - 80) + 'px');
    leaf.style.setProperty('--rot', (Math.random() * 720 - 360) + 'deg');
    leaf.style.setProperty('--dur', (2.6 + Math.random() * 2.2) + 's');
    leaf.style.animationDelay = Math.random() * 0.8 + 's';
    leaf.style.background = c;
    leaf.style.borderRadius = '0 70% 0 70%';
    leaf.style.transform = `rotate(${Math.random() * 360}deg)`;
    layer.appendChild(leaf);
  }
  document.body.appendChild(layer);
  setTimeout(() => layer.remove(), 6000);
  if (confetti && typeof window.confetti === 'function') {
    window.confetti({ particleCount: 90, spread: 75, origin: { y: 0.7 }, colors: LEAF_COLORS, disableForReducedMotion: true });
  }
}

/** Typewriter effect for assistant answers. */
export function typewriter(el, text, cps = 90) {
  if (reduced()) { el.textContent = text; return Promise.resolve(); }
  return new Promise(res => {
    let i = 0;
    const step = () => {
      i = Math.min(text.length, i + Math.max(1, Math.round(cps / 30)));
      el.textContent = text.slice(0, i);
      if (i < text.length) setTimeout(step, 33); else res();
    };
    step();
  });
}

/** Animate element height changes smoothly (accordion etc.). */
export function slideToggle(el, open) {
  if (reduced()) { el.style.display = open ? '' : 'none'; return; }
  if (open) {
    el.style.display = ''; const h = el.scrollHeight; el.style.overflow = 'hidden'; el.style.height = '0px';
    requestAnimationFrame(() => { el.style.transition = 'height 280ms var(--ease-out)'; el.style.height = h + 'px'; });
    setTimeout(() => { el.style.height = ''; el.style.overflow = ''; el.style.transition = ''; }, 300);
  } else {
    el.style.height = el.scrollHeight + 'px'; el.style.overflow = 'hidden';
    requestAnimationFrame(() => { el.style.transition = 'height 240ms var(--ease-out)'; el.style.height = '0px'; });
    setTimeout(() => { el.style.display = 'none'; el.style.height = ''; el.style.overflow = ''; el.style.transition = ''; }, 260);
  }
}
