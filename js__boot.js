/* =============================================================================
   Starts the app the right way for how index.html was opened.
   - Served over http(s) (GitHub Pages, Netlify, tools__serve.js): the ES modules
     load straight from js/, with every start-up module fetched in parallel
     (PRELOAD — tools__check.js keeps this list complete).
   - Opened by double-clicking index.html (file://): browsers refuse to load ES
     modules from local files, so js__app.bundle.js — the same code as one
     ordinary script, made by tools__build.js — runs instead.
   A plain script (no modules), loaded by index.html before anything else.
   ========================================================================== */
(function () {
  'use strict';
  var PRELOAD = [
    'js__config.js', 'js__core__bus.js', 'js__core__dates.js', 'js__core__money.js', 'js__core__idb.js', 'js__core__lazy.js', 'js__core__validate.js',
    'js__schema__workspace.js', 'js__schema__business.js', 'js__core__schema.js', 'js__core__perms.js', 'js__apps__registry.js', 'js__core__db.js',
    'js__core__auth.js', 'js__core__seed.js', 'js__core__holidays.js', 'js__core__format.js', 'js__core__recurrence.js', 'js__core__search.js',
    'js__core__files.js', 'js__core__notify.js', 'js__core__router.js', 'js__core__leader.js', 'js__ui__sanitize.js', 'js__ui__dom.js', 'js__ui__icons.js',
    'js__ui__animate.js', 'js__ui__overlays.js', 'js__ui__components.js', 'js__ui__shell.js', 'js__ui__login.js', 'js__apps__home__index.js'
  ];
  var fromFolder = location.protocol === 'file:';

  if (!fromFolder) {
    // phone/PC install (only works when served; from the folder the browser refuses to read it and logs an error)
    var man = document.createElement('link');
    man.rel = 'manifest';
    man.href = 'manifest.webmanifest';
    document.head.appendChild(man);
    // start downloading the modules now, while the rest of the page is still being read
    PRELOAD.forEach(function (href) {
      var l = document.createElement('link');
      l.rel = 'modulepreload';
      l.href = href;
      document.head.appendChild(l);
    });
  }

  function failed() {
    var box = document.getElementById('boot-text');
    if (box) box.textContent = 'The app’s files are incomplete. Unzip the whole zip again (do not open index.html from inside the zip), then open index.html.';
  }

  // after the page and the libraries in index.html (lucide, confetti, signature pad) are ready
  function start() {
    var s = document.createElement('script');
    if (fromFolder) s.src = 'js__app.bundle.js';
    else { s.type = 'module'; s.src = 'js__main.js'; }
    s.onerror = failed;
    document.body.appendChild(s);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
