/* =============================================================================
   Starts the app the right way for how index.html was opened.
   - Served over http(s) (GitHub Pages, Netlify, tools/serve.js): the ES modules
     load straight from js/, with every start-up module fetched in parallel
     (PRELOAD — tools/check.js keeps this list complete).
   - Opened by double-clicking index.html (file://): browsers refuse to load ES
     modules from local files, so js/app.bundle.js — the same code as one
     ordinary script, made by tools/build.js — runs instead.
   A plain script (no modules), loaded by index.html before anything else.
   ========================================================================== */
(function () {
  'use strict';
  var PRELOAD = [
    'js/config.js', 'js/core/bus.js', 'js/core/dates.js', 'js/core/money.js', 'js/core/idb.js', 'js/core/lazy.js', 'js/core/validate.js',
    'js/schema/workspace.js', 'js/schema/business.js', 'js/core/schema.js', 'js/core/perms.js', 'js/apps/registry.js', 'js/core/db.js',
    'js/core/auth.js', 'js/core/seed.js', 'js/core/holidays.js', 'js/core/format.js', 'js/core/recurrence.js', 'js/core/search.js',
    'js/core/files.js', 'js/core/notify.js', 'js/core/router.js', 'js/core/leader.js', 'js/ui/sanitize.js', 'js/ui/dom.js', 'js/ui/icons.js',
    'js/ui/animate.js', 'js/ui/overlays.js', 'js/ui/components.js', 'js/ui/shell.js', 'js/ui/login.js', 'js/apps/home/index.js'
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
    if (fromFolder) s.src = 'js/app.bundle.js';
    else { s.type = 'module'; s.src = 'js/main.js'; }
    s.onerror = failed;
    document.body.appendChild(s);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
