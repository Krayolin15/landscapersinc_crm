/* =============================================================================
   reset-password.html — set a new password when you have forgotten yours
   (local mode, on the computer that holds the app's data).

   Passwords are only ever stored scrambled (PBKDF2, as js/core/auth.js does),
   so nobody can read one back; this page writes a NEW one for the person you
   choose, straight into this browser's copy of the data. It only works:
   - in local mode (in Supabase mode, use "Forgot password" on the sign-in screen,
     which emails a reset link), and
   - opened from the folder (double-clicked) or from this computer's local server —
     never on a hosted address.
   Anyone who can open the app folder on this computer could use it, so every
   reset is written to the audit log and announced to everyone in the app.
   A plain script (no modules), so it also works opened straight from the folder.
   ========================================================================== */
(function () {
  'use strict';
  var DB_NAME = 'landscapers-hq', DB_VERSION = 1;   // js/config.js → CONFIG.dbName / dbVersion
  var settings = window.LSI_SETTINGS || {};
  var box = document.getElementById('reset');

  function el(tag, attrs, kids) {
    var e = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) { if (k === 'text') e.textContent = attrs[k]; else e.setAttribute(k, attrs[k]); });
    (kids || []).forEach(function (c) { if (c) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return e;
  }
  function show() { box.replaceChildren.apply(box, Array.prototype.slice.call(arguments)); }
  function note(kind, title, text) { return el('blockquote', { class: kind }, [el('p', {}, [el('strong', { text: title }), text ? ' ' + text : null])]); }

  // where this page may work
  var local = location.protocol === 'file:' || /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  if (settings.mode === 'supabase') {
    show(note('', 'This app uses Supabase logins.', 'On the sign-in screen, enter your email and click "Forgot password?": you get an email with a reset link. An administrator can also reset it under Admin → Users.'));
    return;
  }
  if (!local) {
    show(note('', 'Not available on a website.', 'This page only works on the office computer, from the app folder.'));
    return;
  }

  function openDb() {
    return new Promise(function (ok, bad) {
      var r = indexedDB.open(DB_NAME, DB_VERSION);
      r.onupgradeneeded = function () { r.transaction.abort(); }; // no data here yet: do not create an empty database
      r.onsuccess = function () { ok(r.result); };
      r.onerror = function () { bad(r.error); };
    });
  }
  var hex = function (buf) { return Array.prototype.map.call(new Uint8Array(buf), function (b) { return b.toString(16).padStart(2, '0'); }).join(''); };
  // exactly js/core/auth.js hashPassword(): PBKDF2-SHA256, 100 000 iterations, 256 bits, a random hex salt
  function hashPassword(password) {
    var salt = hex(crypto.getRandomValues(new Uint8Array(16)));
    return crypto.subtle.importKey('raw', new TextEncoder().encode(String(password)), 'PBKDF2', false, ['deriveBits'])
      .then(function (key) { return crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: new TextEncoder().encode(salt), iterations: 100000 }, key, 256); })
      .then(function (bits) { return { hash: hex(bits), salt: salt }; });
  }
  function problems(pw) { // as js/core/auth.js passwordProblems()
    var p = [];
    if (!pw || pw.length < 8) p.push('at least 8 characters');
    if (!/[A-Za-z]/.test(pw || '')) p.push('a letter');
    if (!/\d/.test(pw || '')) p.push('a number');
    return p;
  }
  var uid = function () { return (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2)); };

  openDb().then(function (db) {
    var t = db.transaction('records', 'readonly');
    var req = t.objectStore('records').index('col').getAll('profiles');
    req.onsuccess = function () { draw(db, req.result.map(function (r) { return r.v; }).filter(function (p) { return p && !p.deleted_at && p.status !== 'suspended'; })); };
    req.onerror = function () { show(note('', 'Could not read the app’s data.', String(req.error))); };
  }).catch(function () {
    show(note('', 'No app data in this browser yet.', 'Open index.html first in this same browser (the app loads the company records on its first start), then come back to this page.'));
  });

  function draw(db, people) {
    if (!people.length) { show(note('', 'No accounts found in this browser.', 'Open index.html first in this same browser, then come back to this page.')); return; }
    people.sort(function (a, b) { return String(a.name).localeCompare(String(b.name)); });
    var who = el('select', { id: 'who' }, [el('option', { value: '', text: 'Choose your name…' })].concat(people.map(function (p) { return el('option', { value: p.id, text: p.name + (p.role ? ' (' + p.role + ')' : '') }); })));
    var pw1 = el('input', { type: 'password', id: 'pw1', autocomplete: 'new-password' });
    var pw2 = el('input', { type: 'password', id: 'pw2', autocomplete: 'new-password' });
    var msg = el('p', { class: 'msg', role: 'status' });
    var go = el('button', { type: 'submit', class: 'primary', text: 'Set the new password' });
    var form = el('form', { class: 'reset-form' }, [
      el('label', { for: 'who', text: 'Your name' }), who,
      el('label', { for: 'pw1', text: 'New password (at least 8 characters, with a letter and a number)' }), pw1,
      el('label', { for: 'pw2', text: 'The new password again' }), pw2,
      go, msg
    ]);
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var p = people.filter(function (x) { return x.id === who.value; })[0];
      if (!p) { msg.textContent = 'Choose your name first.'; return; }
      var bad = problems(pw1.value);
      if (bad.length) { msg.textContent = 'The password needs ' + bad.join(', ') + '.'; return; }
      if (pw1.value !== pw2.value) { msg.textContent = 'The two passwords are not the same.'; return; }
      go.disabled = true; msg.textContent = 'Saving…';
      hashPassword(pw1.value).then(function (h) {
        var now = new Date().toISOString(), actor = { id: p.id, name: p.name };
        var tx = db.transaction('records', 'readwrite'), store = tx.objectStore('records');
        var updated = Object.assign({}, p, { password_hash: h.hash, password_salt: h.salt, must_change_password: false, password_reset_at: now, updated_at: now, updated_by: actor.id, updated_by_name: actor.name });
        store.put({ k: 'profiles|' + p.id, col: 'profiles', id: p.id, v: updated });
        var auditId = uid();
        store.put({ k: 'audit_log|' + auditId, col: 'audit_log', id: auditId, v: { id: auditId, at: now, user_id: actor.id, user_name: actor.name, action: 'password_reset', collection: 'profiles', record_id: p.id, label: p.name,
          changes: { how: [null, 'reset-password.html on this computer'] }, created_at: now, created_by: actor.id, created_by_name: actor.name, updated_at: now, updated_by: actor.id, updated_by_name: actor.name } });
        // everyone sees it in their bell, so a reset nobody expected is noticed
        people.forEach(function (x) {
          var nid = uid();
          store.put({ k: 'notifications|' + nid, col: 'notifications', id: nid, v: { id: nid, user_id: x.id, title: 'Password reset on this computer', body: p.name + '’s password was reset with reset-password.html (' + now.slice(0, 16).replace('T', ' ') + '). If that was not expected, tell an administrator.',
            icon: 'key-round', tile: 't-sun', link: '#/admin/audit', kind: 'security', source_key: 'pwreset|' + auditId + '|' + x.id, created_at: now, created_by: actor.id, created_by_name: actor.name, updated_at: now, updated_by: actor.id, updated_by_name: actor.name } });
        });
        tx.oncomplete = function () {
          pw1.value = ''; pw2.value = '';
          show(note('ok', 'Done.', 'The new password for ' + p.name + ' is set. Close any open tab of the app, then open index.html and sign in with it.'),
            el('p', {}, [el('a', { href: 'index.html', class: 'button', text: 'Open the app' })]));
        };
        tx.onerror = function () { go.disabled = false; msg.textContent = 'Could not save: ' + (tx.error && tx.error.message); };
      }).catch(function (err) { go.disabled = false; msg.textContent = 'Could not save: ' + err.message; });
    });
    show(form);
  }
})();
