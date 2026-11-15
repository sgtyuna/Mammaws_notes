// Mammaw's Notes: the holder. All personal information comes from on-device storage (db.js).
import * as db from './db.js';

// ---------- Words the app offers (generic, not about any one family) ----------

const KINDS = {
  visit: { label: 'Visit', plural: 'Visits', hint: 'How they were, what you did' },
  song:  { label: 'Song', plural: 'Songs', hint: 'A song they liked' },
  said:  { label: 'Something they said', plural: 'Things they said', hint: 'Their words, exactly' },
  photo: { label: 'Photo', plural: 'Photos', hint: 'A picture from a visit, or an old one' },
};
const MOODS = ['bright', 'calm', 'peaceful', 'tired', 'sleepy', 'confused', 'restless'];
const RESPONSES = ['sang every word', 'hummed along', 'smiled', 'tapped along', 'listened quietly', 'teared up'];

const PHOTO_MAX = 1600;        // longest side for note photos
const FACE_MAX = 800;          // longest side for a person's own photo
const STORAGE_WARN = 0.8;      // warn when this much of the space is used
const BACKUP_NUDGE_DAYS = 7;

const ICON = {
  visit: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/><circle cx="12" cy="7" r="4"/></svg>',
  song:  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/></svg>',
  said:  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1.2-4.6A8 8 0 1 1 21 12z"/></svg>',
  photo: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="15" rx="2"/><circle cx="9" cy="11" r="2"/><path d="M21 17l-5-5-9 8"/></svg>',
  plus:  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  down:  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>',
  box:   '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12M7 10l5 5 5-5"/><path d="M4 17v3h16v-3"/></svg>',
  search:'<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg>',
  book:  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M4 19V5"/></svg>',
};

// ---------- Small helpers ----------

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
const blank = s => !String(s ?? '').trim();
const todayISO = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
const longDate = iso => new Date(iso + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
const shortDate = ms => new Date(ms).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
const mb = bytes => (bytes / 1048576).toFixed(bytes < 10485760 ? 1 : 0) + ' MB';
const nameOf = p => (p && (p.callName || p.name)) || '';
const sameName = (a, b) => String(a).trim().toLowerCase() === String(b).trim().toLowerCase();

// ---------- State ----------

const S = {
  people: [],
  personId: null,
  entries: [],     // entries for the selected person
  filter: 'all',
  query: '',
};
const person = () => S.people.find(p => p.id === S.personId);

// ---------- Photos ----------

const urlCache = new Map();
async function photoURL(id) {
  if (!id) return null;
  if (urlCache.has(id)) return urlCache.get(id);
  const p = await db.get('photos', id);
  if (!p) return null;
  const u = URL.createObjectURL(new Blob([p.data], { type: p.type || 'image/jpeg' }));
  urlCache.set(id, u);
  return u;
}
function forgetPhoto(id) {
  const u = urlCache.get(id);
  if (u) URL.revokeObjectURL(u);
  urlCache.delete(id);
}
// Fill in <img data-photo="id"> after the HTML is on the page.
async function hydratePhotos(root) {
  for (const img of $$('img[data-photo]', root)) {
    const u = await photoURL(img.dataset.photo);
    if (u) img.src = u; else img.remove();
  }
}

// Shrink a picked photo to a JPEG no larger than maxSide on its longest side.
async function compressImage(file, maxSide) {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    try { await img.decode(); }
    catch { throw new Error("This picture couldn't be opened here. Try a JPEG or PNG photo."); }
    const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.85));
    if (!blob) throw new Error("This picture couldn't be saved. Try a smaller photo.");
    return { data: await blob.arrayBuffer(), type: 'image/jpeg', w, h };
  } finally {
    URL.revokeObjectURL(url);
  }
}

// ---------- Loading ----------

async function loadPeople() {
  S.people = (await db.all('people')).sort((a, b) => a.createdAt - b.createdAt);
}
async function loadEntries() {
  S.entries = S.personId ? await db.byPerson('entries', S.personId) : [];
}
async function selectPerson(id) {
  S.personId = id;
  S.filter = 'all';
  S.query = '';
  await db.setMeta('currentPerson', id);
  await loadEntries();
}

// Ask the browser, once, to keep this storage instead of clearing it when space runs low.
async function askToKeepStorage() {
  if (!navigator.storage?.persist) return false;
  if (await navigator.storage.persisted()) return true;
  return navigator.storage.persist();
}

// ---------- Screens ----------

async function render() {
  if (!S.people.length) return renderSetup();
  return renderHome();
}

function renderSetup() {
  $('#app').innerHTML = `
    <section class="setup">
      <div class="setup-mark">${ICON.book}</div>
      <h1>Mammaw's Notes</h1>
      <p class="lead">A gentle place to keep your visits with someone you love: how they were, the songs they liked, the things they said, and the pictures that made them smile.</p>
      <p class="quiet">Everything you write stays on this device. Nothing is sent anywhere.</p>
      <button class="btn primary big" id="setupAdd">Add the person you visit</button>
      <button class="btn plain" id="setupImport">Open a backup file instead</button>
    </section>`;
  $('#setupAdd').onclick = () => personForm();
  $('#setupImport').onclick = pickImport;
}

async function renderHome() {
  const p = person();
  $('#app').innerHTML = `
    <header class="top">
      <button class="who" id="whoBtn" aria-label="Change person">
        ${p.photoId ? `<img class="face" data-photo="${esc(p.photoId)}" alt="">` : `<span class="face initial">${esc(nameOf(p).slice(0, 1).toUpperCase())}</span>`}
        <span class="who-text"><small>Notes for</small><b>${esc(nameOf(p))}</b></span>
        <span class="chev">${ICON.down}</span>
      </button>
      <button class="icon-btn" id="backupBtn" aria-label="Backup and storage">${ICON.box}<span>Backup</span></button>
    </header>
    <div id="banners"></div>
    <label class="search">${ICON.search}<input type="search" id="q" placeholder="Search notes and words" value="${esc(S.query)}" autocomplete="off" autocorrect="off" spellcheck="false"></label>
    <nav class="filters" id="filters" aria-label="Show"></nav>
    <main id="timeline" aria-live="polite"></main>
    <button class="fab" id="addBtn" aria-label="Add a note">${ICON.plus}</button>`;
  $('#whoBtn').onclick = peopleSheet;
  $('#backupBtn').onclick = backupSheet;
  $('#addBtn').onclick = kindPicker;
  $('#q').oninput = e => { S.query = e.target.value; renderTimeline(); };
  hydratePhotos($('.top'));
  renderTimeline();
  renderBanners();
}

function matches(e, q) {
  if (!q) return true;
  const hay = [e.moods?.join(' '), e.moodNote, e.did, e.whoElse, e.song, e.responses?.join(' '), e.responseNote, e.words, e.note, e.caption]
    .filter(Boolean).join('\n').toLowerCase();
  return hay.includes(q.toLowerCase());
}

function renderTimeline() {
  const counts = { all: S.entries.length };
  for (const k in KINDS) counts[k] = S.entries.filter(e => e.kind === k).length;
  $('#filters').innerHTML = [['all', 'All'], ...Object.entries(KINDS).map(([k, v]) => [k, v.plural])]
    .map(([k, label]) => `<button class="chip ${S.filter === k ? 'on' : ''}" data-filter="${k}" aria-pressed="${S.filter === k}">${esc(label)} <span class="count">${counts[k]}</span></button>`).join('');
  $$('#filters [data-filter]').forEach(b => b.onclick = () => { S.filter = b.dataset.filter; renderTimeline(); });

  const q = S.query.trim();
  const list = S.entries
    .filter(e => S.filter === 'all' || e.kind === S.filter)
    .filter(e => matches(e, q))
    .sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.createdAt - a.createdAt);

  const tl = $('#timeline');
  if (!S.entries.length) {
    tl.innerHTML = `<div class="empty"><p class="empty-title">Nothing written yet</p><p>When you visit ${esc(nameOf(person()))}, tap the <b>+</b> button to jot down how they were, a song, something they said, or a photo.</p></div>`;
    return;
  }
  if (!list.length) {
    tl.innerHTML = `<div class="empty"><p class="empty-title">${q ? 'No notes match' : 'None of these yet'}</p><p>${q ? `Nothing has the words “${esc(q)}”.` : 'Tap + to add one.'}</p></div>`;
    return;
  }
  let html = '', lastDate = null;
  for (const e of list) {
    if (e.date !== lastDate) { html += `<h3 class="day">${esc(longDate(e.date))}</h3>`; lastDate = e.date; }
    html += entryCard(e);
  }
  tl.innerHTML = html;
  $$('.card', tl).forEach(c => c.onclick = () => entryForm(c.dataset.kind, S.entries.find(e => e.id === c.dataset.id)));
  hydratePhotos(tl);
}

const pills = list => list?.length ? `<div class="pills">${list.map(w => `<span class="pill">${esc(w)}</span>`).join('')}</div>` : '';
const para = (text, cls = '') => blank(text) ? '' : `<p class="${cls}">${esc(text)}</p>`;

function entryCard(e) {
  let body = '';
  if (e.kind === 'visit') {
    body = pills(e.moods) + para(e.moodNote) + (blank(e.did) ? '' : `<p><span class="lbl">We</span> ${esc(e.did)}</p>`)
      + (blank(e.whoElse) ? '' : `<p class="quiet"><span class="lbl">Also there</span> ${esc(e.whoElse)}</p>`);
    if (!body) body = '<p class="quiet">A visit.</p>';
  } else if (e.kind === 'song') {
    body = `<p class="song-title">${esc(e.song)}</p>` + pills(e.responses) + para(e.responseNote);
  } else if (e.kind === 'said') {
    body = `<blockquote class="said">${esc(e.words)}</blockquote>` + para(e.note, 'quiet');
  } else if (e.kind === 'photo') {
    body = `<img class="pic" data-photo="${esc(e.photoId)}" alt="${esc(e.caption || 'Photo')}">` + para(e.caption)
      + (e.inBook ? `<span class="badge">${ICON.book} In Photo Book</span>` : '');
  }
  return `<article class="card kind-${e.kind}" data-id="${esc(e.id)}" data-kind="${e.kind}" tabindex="0" role="button" aria-label="Edit this ${esc(KINDS[e.kind].label.toLowerCase())}">
    <div class="card-kind">${ICON[e.kind]}<span>${esc(KINDS[e.kind].label)}</span></div>${body}</article>`;
}

async function renderBanners() {
  const box = $('#banners');
  if (!box) return;
  const out = [];
  const st = await storageInfo();
  if (st.quota && st.usage / st.quota > STORAGE_WARN) {
    out.push(`<div class="banner warn"><b>Storage is getting full.</b> ${mb(st.usage)} of about ${mb(st.quota)} is used. Save a backup soon, so nothing is lost. <button class="link" data-go="backup">Back up now</button></div>`);
  }
  const p = person();
  const last = await db.getMeta('lastExport:' + p.id);
  const newest = Math.max(0, ...S.entries.map(e => e.updatedAt || e.createdAt), p.updatedAt || 0);
  // Never backed up: nudge at 3 notes, or once the first note is a week old.
  const oldest = Math.min(Infinity, ...S.entries.map(e => e.createdAt));
  const stale = last
    ? (newest > last && Date.now() - last > BACKUP_NUDGE_DAYS * 864e5)
    : S.entries.length >= 3 || Date.now() - oldest > BACKUP_NUDGE_DAYS * 864e5;
  if (stale) {
    out.push(`<div class="banner"><span>${last ? `Last backup ${esc(shortDate(last))}.` : 'No backup saved yet.'} A backup file keeps these notes safe.</span> <button class="link" data-go="backup">Save one</button></div>`);
  }
  box.innerHTML = out.join('');
  $$('[data-go=backup]', box).forEach(b => b.onclick = backupSheet);
}

// ---------- Sheets, dialogs, toasts ----------

function openSheet(title, html, { save, saveLabel = 'Save', onMount, footer = '' } = {}) {
  const el = $('#sheet');
  el.innerHTML = `
    <div class="sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <header class="sheet-top">
        <button class="text-btn" data-act="cancel">${save ? 'Cancel' : 'Close'}</button>
        <h2>${esc(title)}</h2>
        <span class="spacer"></span>
      </header>
      <div class="sheet-body">${html}</div>
      ${save || footer ? `<footer class="sheet-foot">${footer}${save ? `<button class="btn primary big" data-act="save">${esc(saveLabel)}</button>` : ''}</footer>` : ''}
    </div>`;
  el.hidden = false;
  document.body.classList.add('locked');
  $('[data-act=cancel]', el).onclick = closeSheet;
  if (save) {
    const btn = $('[data-act=save]', el);
    btn.onclick = async () => {
      btn.disabled = true;
      try { if ((await save(el)) !== false) closeSheet(); }
      catch (err) { showError(err); }
      finally { btn.disabled = false; }
    };
  }
  onMount?.(el);
  return el;
}
function closeSheet() {
  const el = $('#sheet');
  el.hidden = true;
  el.innerHTML = '';
  document.body.classList.remove('locked');
}

// A gentle question with buttons. Resolves to the chosen button's value (or null).
function ask(message, buttons) {
  return new Promise(resolve => {
    const el = $('#dialog');
    el.innerHTML = `<div class="dialog" role="alertdialog" aria-modal="true"><p>${message}</p><div class="dialog-btns">
      ${buttons.map((b, i) => `<button class="btn ${b.style || ''}" data-i="${i}">${esc(b.label)}</button>`).join('')}</div></div>`;
    el.hidden = false;
    $$('[data-i]', el).forEach(btn => btn.onclick = () => { el.hidden = true; el.innerHTML = ''; resolve(buttons[+btn.dataset.i].value); });
  });
}
const confirmDelete = what => ask(`Delete ${what}?`, [
  { label: 'Delete', value: true, style: 'danger' },
  { label: 'Keep it', value: false, style: 'primary' },
]);

let toastTimer;
function toast(message, undo) {
  const el = $('#toast');
  clearTimeout(toastTimer);
  el.innerHTML = `<span>${esc(message)}</span>${undo ? '<button class="link" id="undoBtn">Undo</button>' : ''}`;
  el.hidden = false;
  if (undo) $('#undoBtn').onclick = async () => { el.hidden = true; clearTimeout(toastTimer); await undo(); };
  toastTimer = setTimeout(() => { el.hidden = true; }, undo ? 15000 : 4000);
}
function showError(err) {
  console.error(err);
  ask(esc(err?.message || 'Something went wrong. Nothing was changed.'), [{ label: 'OK', value: true, style: 'primary' }]);
}

// Tap-to-choose word chips. Returns the chosen words in the order offered.
function chipGroup(name, words, chosen = [], multi = true) {
  return `<div class="chips" data-chips="${name}" data-multi="${multi}">${words.map(w =>
    `<button type="button" class="chip ${chosen.includes(w) ? 'on' : ''}" aria-pressed="${chosen.includes(w)}" data-word="${esc(w)}">${esc(w)}</button>`).join('')}</div>`;
}
function wireChips(root) {
  $$('[data-chips]', root).forEach(g => {
    const multi = g.dataset.multi === 'true';
    $$('.chip', g).forEach(c => c.onclick = () => {
      const on = !c.classList.contains('on');
      if (!multi) $$('.chip', g).forEach(o => { o.classList.remove('on'); o.setAttribute('aria-pressed', 'false'); });
      c.classList.toggle('on', on);
      c.setAttribute('aria-pressed', String(on));
      g.dispatchEvent(new Event('change'));
    });
  });
}
const chipValues = (root, name) => $$(`[data-chips="${name}"] .chip.on`, root).map(c => c.dataset.word);

// ---------- Adding and editing notes ----------

function kindPicker() {
  openSheet('Add a note', `<div class="kinds">${Object.entries(KINDS).map(([k, v]) =>
    `<button class="kind-tile kind-${k}" data-kind="${k}">${ICON[k]}<b>${esc(v.label)}</b><small>${esc(v.hint)}</small></button>`).join('')}</div>`, {
    onMount: el => $$('[data-kind]', el).forEach(b => b.onclick = () => entryForm(b.dataset.kind)),
  });
}

function entryForm(kind, entry) {
  const e = entry || {};
  const p = person();
  const editing = !!entry;
  const dateField = `<label class="field"><span>Date</span><input type="date" name="date" value="${esc(e.date || todayISO())}" max="${todayISO()}" required></label>`;
  let html = dateField;
  // Photo picked in this form, not yet saved.
  let picked = null;

  if (kind === 'visit') {
    html += `
      <div class="field"><span>How were they?</span>${chipGroup('moods', [...MOODS, ...(e.moods || []).filter(m => !MOODS.includes(m))], e.moods)}</div>
      <label class="field"><span>In your own words</span><textarea name="moodNote" rows="2">${esc(e.moodNote)}</textarea></label>
      <label class="field"><span>What you did</span><textarea name="did" rows="2" placeholder="Looked at pictures, sat outside…">${esc(e.did)}</textarea></label>
      <label class="field"><span>Who else was there</span><input name="whoElse" value="${esc(e.whoElse)}"></label>`;
  } else if (kind === 'song') {
    const songs = p.songs || [];
    const inList = e.song && songs.includes(e.song);
    html += `
      <div class="field"><span>Which song?</span>
        ${songs.length ? chipGroup('song', songs, inList ? [e.song] : [], false) : `<p class="quiet small">${esc(nameOf(p))}'s song list is empty. Type a song below and it will be added.</p>`}
        <input name="newSong" placeholder="${songs.length ? 'Or type a different song' : 'Song name'}" value="${esc(inList ? '' : e.song)}" autocomplete="off">
      </div>
      <div class="field"><span>How did they respond?</span>${chipGroup('responses', [...RESPONSES, ...(e.responses || []).filter(r => !RESPONSES.includes(r))], e.responses)}</div>
      <label class="field"><span>In your own words</span><textarea name="responseNote" rows="2">${esc(e.responseNote)}</textarea></label>`;
  } else if (kind === 'said') {
    html += `
      <label class="field"><span>What they said, exactly</span>
        <textarea name="words" class="words" rows="4" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" data-gramm="false">${esc(e.words)}</textarea>
        <small class="quiet">Saved just as you type it. Nothing gets corrected.</small></label>
      <label class="field"><span>About the moment</span><textarea name="note" rows="2">${esc(e.note)}</textarea></label>`;
  } else if (kind === 'photo') {
    html += `
      <div class="field"><span>Photo</span>
        <div class="photo-pick">
          ${e.photoId ? `<img class="pic" data-photo="${esc(e.photoId)}" alt="">` : '<div class="pic-empty">No photo chosen yet</div>'}
          <label class="btn plain"><input type="file" name="file" accept="image/*" hidden>${e.photoId ? 'Choose a different photo' : 'Choose a photo'}</label>
        </div></div>
      <label class="field"><span>Caption</span><textarea name="caption" rows="2">${esc(e.caption)}</textarea></label>
      <label class="switch"><input type="checkbox" name="inBook" ${e.inBook ? 'checked' : ''}><span class="track"></span><span>Show in Photo Book<small>Only photos with this on are shown to them.</small></span></label>`;
  }

  const footer = editing ? '<button class="btn danger-plain" data-act="delete">Delete</button>' : '';
  openSheet(editing ? `Edit ${KINDS[kind].label.toLowerCase()}` : KINDS[kind].label, `<form class="form" onsubmit="return false">${html}</form>`, {
    footer,
    onMount: el => {
      wireChips(el);
      hydratePhotos(el);
      // Typing a song unselects the list chips, and tapping a chip clears the typed song.
      const ns = $('[name=newSong]', el);
      if (ns) {
        ns.oninput = () => { if (ns.value) $$('[data-chips=song] .chip', el).forEach(c => { c.classList.remove('on'); c.setAttribute('aria-pressed', 'false'); }); };
        $('[data-chips=song]', el)?.addEventListener('change', () => { ns.value = ''; });
      }
      const file = $('[name=file]', el);
      if (file) file.onchange = async () => {
        const f = file.files[0];
        if (!f) return;
        try {
          picked = await compressImage(f, PHOTO_MAX);
          const box = $('.photo-pick', el);
          const u = URL.createObjectURL(new Blob([picked.data], { type: picked.type }));
          box.querySelector('.pic, .pic-empty').outerHTML = `<img class="pic" src="${u}" alt="">`;
        } catch (err) { showError(err); }
      };
      const delBtn = $('[data-act=delete]', el);
      if (delBtn) delBtn.onclick = () => deleteEntry(entry);
    },
    save: async el => {
      const f = $('form', el);
      const val = n => f.elements[n]?.value ?? '';
      const now = Date.now();
      const out = { ...e, id: e.id || uid(), personId: e.personId || p.id, kind, date: val('date') || todayISO(), createdAt: e.createdAt || now, updatedAt: now };
      let newSongFor = null;
      if (kind === 'visit') {
        Object.assign(out, { moods: chipValues(el, 'moods'), moodNote: val('moodNote'), did: val('did'), whoElse: val('whoElse') });
      } else if (kind === 'song') {
        const song = chipValues(el, 'song')[0] || val('newSong').trim();
        if (!song) { showError(new Error('Pick a song from the list, or type one.')); return false; }
        Object.assign(out, { song, responses: chipValues(el, 'responses'), responseNote: val('responseNote') });
        if (!(p.songs || []).some(s => sameName(s, song))) newSongFor = song;
      } else if (kind === 'said') {
        // Their words are stored exactly as typed. No trimming, no fixing.
        if (blank(val('words'))) { showError(new Error('Type what they said first.')); return false; }
        Object.assign(out, { words: val('words'), note: val('note') });
      } else if (kind === 'photo') {
        if (!picked && !e.photoId) { showError(new Error('Choose a photo first.')); return false; }
        Object.assign(out, { caption: val('caption'), inBook: f.elements.inBook.checked });
      }
      const oldPhoto = picked && e.photoId;
      await db.tx(['entries', 'photos', 'people'], 'readwrite', s => {
        if (picked) {
          out.photoId = uid();
          s.photos.put({ id: out.photoId, personId: out.personId, ...picked });
          if (oldPhoto) s.photos.delete(oldPhoto);
        }
        if (newSongFor) s.people.put({ ...p, songs: [...(p.songs || []), newSongFor], updatedAt: now });
        s.entries.put(out);
      });
      if (oldPhoto) forgetPhoto(oldPhoto);
      askToKeepStorage();
      await loadPeople();
      await loadEntries();
      await renderHome();
      if (!editing) toast(`${KINDS[kind].label} saved.`);
    },
  });
}

async function deleteEntry(entry) {
  if (!(await confirmDelete(`this ${KINDS[entry.kind].label.toLowerCase()}`))) return;
  const photo = entry.photoId ? await db.get('photos', entry.photoId) : null;
  await db.tx(['entries', 'photos'], 'readwrite', s => {
    s.entries.delete(entry.id);
    if (photo) s.photos.delete(photo.id);
  });
  if (photo) forgetPhoto(photo.id);
  closeSheet();
  await loadEntries();
  await renderHome();
  toast(`${KINDS[entry.kind].label} deleted.`, async () => {
    await db.tx(['entries', 'photos'], 'readwrite', s => {
      s.entries.put(entry);
      if (photo) s.photos.put(photo);
    });
    await loadEntries();
    await renderHome();
    toast('Brought back.');
  });
}

// ---------- People ----------

function peopleSheet() {
  const rows = S.people.map(p => `
    <div class="person-row ${p.id === S.personId ? 'current' : ''}">
      <button class="person-pick" data-pick="${esc(p.id)}">
        ${p.photoId ? `<img class="face" data-photo="${esc(p.photoId)}" alt="">` : `<span class="face initial">${esc(nameOf(p).slice(0, 1).toUpperCase())}</span>`}
        <span><b>${esc(nameOf(p))}</b>${p.callName && p.callName !== p.name ? `<small>${esc(p.name)}</small>` : ''}</span>
      </button>
      <button class="text-btn" data-edit="${esc(p.id)}">Edit</button>
    </div>`).join('');
  openSheet('People', `<div class="people">${rows}</div><button class="btn plain big" id="addPerson">${ICON.plus} Add a person</button>`, {
    onMount: el => {
      hydratePhotos(el);
      $$('[data-pick]', el).forEach(b => b.onclick = async () => { await selectPerson(b.dataset.pick); closeSheet(); renderHome(); });
      $$('[data-edit]', el).forEach(b => b.onclick = () => personForm(S.people.find(p => p.id === b.dataset.edit)));
      $('#addPerson', el).onclick = () => personForm();
    },
  });
}

function songRow(name = '') {
  return `<div class="song-row"><input name="song" value="${esc(name)}" placeholder="Song name" autocomplete="off"><button type="button" class="icon-x" aria-label="Remove song">×</button></div>`;
}

function personForm(existing) {
  const p = existing || {};
  let picked = null;
  const html = `<form class="form" onsubmit="return false">
    <div class="face-pick">
      ${p.photoId ? `<img class="face big" data-photo="${esc(p.photoId)}" alt="">` : '<span class="face big initial">+</span>'}
      <label class="btn plain"><input type="file" name="file" accept="image/*" hidden>${p.photoId ? 'Change photo' : 'Add a photo'}</label>
    </div>
    <label class="field"><span>Their name</span><input name="name" value="${esc(p.name)}" required autocomplete="off"></label>
    <label class="field"><span>What you call them</span><input name="callName" value="${esc(p.callName)}" autocomplete="off"><small class="quiet">Like Mammaw, Nana, or Grandpa. Leave empty to use their name.</small></label>
    <label class="field"><span>Playlist link</span><input name="playlist" type="url" inputmode="url" value="${esc(p.playlist)}" placeholder="Paste a link from Apple Music, Spotify, or YouTube" autocomplete="off"></label>
    <div class="field"><span>Their songs</span><div id="songs">${(p.songs || []).map(songRow).join('')}</div>
      <button type="button" class="btn plain" id="addSong">${ICON.plus} Add a song</button></div>
  </form>`;
  const footer = existing ? '<button class="btn danger-plain" data-act="delete">Delete person</button>' : '';
  openSheet(existing ? `Edit ${nameOf(p)}` : 'Add a person', html, {
    footer,
    saveLabel: existing ? 'Save' : 'Add',
    onMount: el => {
      hydratePhotos(el);
      const wireX = () => $$('.icon-x', el).forEach(x => x.onclick = () => x.parentElement.remove());
      wireX();
      $('#addSong', el).onclick = () => { $('#songs', el).insertAdjacentHTML('beforeend', songRow()); wireX(); $$('[name=song]', el).at(-1).focus(); };
      $('[name=file]', el).onchange = async ev => {
        const f = ev.target.files[0];
        if (!f) return;
        try {
          picked = await compressImage(f, FACE_MAX);
          const u = URL.createObjectURL(new Blob([picked.data], { type: picked.type }));
          $('.face-pick .face', el).outerHTML = `<img class="face big" src="${u}" alt="">`;
        } catch (err) { showError(err); }
      };
      const delBtn = $('[data-act=delete]', el);
      if (delBtn) delBtn.onclick = () => deletePerson(existing);
    },
    save: async el => {
      const f = $('form', el);
      const name = f.elements.name.value.trim();
      if (!name) { showError(new Error('Type their name first.')); return false; }
      const songs = [];
      for (const s of $$('[name=song]', el).map(i => i.value.trim()).filter(Boolean)) if (!songs.some(x => sameName(x, s))) songs.push(s);
      const now = Date.now();
      const out = { ...p, id: p.id || uid(), name, callName: f.elements.callName.value.trim(), playlist: f.elements.playlist.value.trim(), songs, createdAt: p.createdAt || now, updatedAt: now };
      const oldPhoto = picked && p.photoId;
      await db.tx(['people', 'photos'], 'readwrite', s => {
        if (picked) {
          out.photoId = uid();
          s.photos.put({ id: out.photoId, personId: out.id, ...picked });
          if (oldPhoto) s.photos.delete(oldPhoto);
        }
        s.people.put(out);
      });
      if (oldPhoto) forgetPhoto(oldPhoto);
      askToKeepStorage();
      await loadPeople();
      if (!existing) await selectPerson(out.id);
      await render();
      toast(existing ? 'Saved.' : `${nameOf(out)} added.`);
    },
  });
}

async function deletePerson(p) {
  const entries = await db.byPerson('entries', p.id);
  const photos = await db.byPerson('photos', p.id);
  const ok = await ask(`Delete <b>${esc(nameOf(p))}</b> and all ${entries.length} of their notes? Save a backup first if you might want them later.`, [
    { label: 'Delete everything', value: true, style: 'danger' },
    { label: 'Keep', value: false, style: 'primary' },
  ]);
  if (!ok) return;
  await db.tx(['people', 'entries', 'photos'], 'readwrite', s => {
    s.people.delete(p.id);
    entries.forEach(e => s.entries.delete(e.id));
    photos.forEach(ph => s.photos.delete(ph.id));
  });
  photos.forEach(ph => forgetPhoto(ph.id));
  closeSheet();
  await loadPeople();
  if (S.personId === p.id) await selectPerson(S.people[0]?.id || null);
  await render();
  toast(`${nameOf(p)} deleted.`, async () => {
    await db.tx(['people', 'entries', 'photos'], 'readwrite', s => {
      s.people.put(p);
      entries.forEach(e => s.entries.put(e));
      photos.forEach(ph => s.photos.put(ph));
    });
    await loadPeople();
    await selectPerson(p.id);
    await render();
    toast('Brought back.');
  });
}

// ---------- Backup, moving, and storage ----------

async function storageInfo() {
  try {
    const est = await navigator.storage?.estimate?.();
    const kept = await navigator.storage?.persisted?.();
    return { usage: est?.usage || 0, quota: est?.quota || 0, kept: !!kept };
  } catch { return { usage: 0, quota: 0, kept: false }; }
}

async function backupSheet() {
  const p = person();
  const st = await storageInfo();
  const last = await db.getMeta('lastExport:' + p.id);
  const pct = st.quota ? Math.min(100, Math.round((st.usage / st.quota) * 100)) : 0;
  const html = `
    <section class="panel">
      <h3>Save a backup of ${esc(nameOf(p))}</h3>
      <p>Makes one file with all of ${esc(nameOf(p))}'s notes and photos. Keep it somewhere safe, like Files or iCloud Drive.</p>
      <p class="quiet">${last ? `Last backup: ${esc(shortDate(last))}` : 'No backup saved yet.'}</p>
      <button class="btn primary big" id="exportBtn">Save backup file</button>
    </section>
    <section class="panel">
      <h3>Open a backup file</h3>
      <p>Brings a person's notes back from a backup file. This is also how you move notes between your phone and your Mac: save a backup on one, then open it on the other. Nobody else on this device is changed.</p>
      <button class="btn plain big" id="importBtn">Open backup file</button>
    </section>
    <section class="panel">
      <h3>Storage on this device</h3>
      ${st.quota ? `<div class="meter" role="img" aria-label="${pct}% used"><span style="width:${Math.max(pct, 1)}%"></span></div>
      <p>${mb(st.usage)} used of about ${mb(st.quota)}.</p>` : `<p>${mb(st.usage)} used.</p>`}
      <p>${st.kept ? 'This browser has agreed to keep these notes and not clear them to make room.'
        : 'This browser has not promised to keep these notes. It may clear them if the device runs very low on space, so save a backup regularly.'}</p>
      ${st.kept ? '' : '<button class="btn plain" id="keepBtn">Ask the browser to keep them</button>'}
      <p class="quiet small">On iPhone: open the app from its Home Screen icon every time. The Home Screen app keeps its own notes, separate from Safari, and removing the icon removes its notes too.</p>
    </section>`;
  openSheet('Backup & storage', html, {
    onMount: el => {
      $('#exportBtn', el).onclick = () => exportPerson(p.id);
      $('#importBtn', el).onclick = pickImport;
      const keep = $('#keepBtn', el);
      if (keep) keep.onclick = async () => {
        const ok = await askToKeepStorage();
        toast(ok ? 'The browser will keep these notes.' : "The browser didn't agree yet. It often agrees once the app is on your Home Screen and used regularly.");
        if (ok) backupSheet();
      };
    },
  });
}

function bufToB64(buf) {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function b64ToBuf(b64) {
  const s = atob(b64);
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  return bytes.buffer;
}

async function exportPerson(personId) {
  try {
    const p = await db.get('people', personId);
    const entries = await db.byPerson('entries', personId);
    const photos = await db.byPerson('photos', personId);
    const data = {
      format: 'mammaws-notes-person',
      version: 1,
      exportedAt: new Date().toISOString(),
      person: p,
      entries,
      photos: photos.map(ph => ({ id: ph.id, type: ph.type, w: ph.w, h: ph.h, data: bufToB64(ph.data) })),
    };
    const safe = nameOf(p).replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '') || 'person';
    const filename = `Mammaws-Notes-${safe}-${todayISO()}.json`;
    const file = new File([JSON.stringify(data)], filename, { type: 'application/json' });
    // On a phone the share sheet offers Save to Files and AirDrop. On a computer it downloads.
    if (matchMedia('(pointer: coarse)').matches && navigator.canShare?.({ files: [file] })) {
      try { await navigator.share({ files: [file], title: filename }); }
      catch (err) { if (err.name === 'AbortError') return; throw err; }
    } else {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(file);
      a.download = filename;
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 60000);
    }
    await db.setMeta('lastExport:' + personId, Date.now());
    toast(`Backup saved: ${entries.length} notes, ${photos.length} photos.`);
    if ($('#sheet').hidden) renderBanners(); else backupSheet();
  } catch (err) { showError(err); }
}

function pickImport() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json,application/json';
  input.id = 'importFile';
  input.hidden = true;
  input.onchange = async () => { const f = input.files[0]; input.remove(); if (f) await importFile(f); };
  document.body.append(input);
  input.click();
}

async function importFile(file) {
  try {
    let data;
    try { data = JSON.parse(await file.text()); } catch { data = null; }
    if (data?.format !== 'mammaws-notes-person' || !data.person?.name || !Array.isArray(data.entries)) {
      throw new Error("This file isn't a Mammaw's Notes backup, so nothing was changed.");
    }
    if (data.version > 1) throw new Error('This backup was made by a newer version of the app. Update the app, then try again.');

    let replace = null;
    const matches = S.people.filter(p => sameName(p.name, data.person.name));
    if (matches.length) {
      // After "Keep both" there can be two copies with one name, so each Replace button says which copy it means.
      const copies = await Promise.all(matches.map(async p => {
        const es = await db.byPerson('entries', p.id);
        const changed = Math.max(p.updatedAt || p.createdAt || 0, ...es.map(e => e.updatedAt || e.createdAt));
        return { p, label: `Replace the copy with ${es.length} ${es.length === 1 ? 'note' : 'notes'}, last changed ${shortDate(changed)}` };
      }));
      const one = matches.length === 1;
      const choice = await ask(one
        ? `<b>${esc(nameOf(matches[0]))}</b> is already on this device. What should happen?`
        : `There are ${matches.length} copies of <b>${esc(nameOf(matches[0]))}</b> on this device already. What should happen?`, [
        ...copies.map(c => ({ label: one ? `Replace ${nameOf(c.p)} with the backup` : c.label, value: c.p, style: 'danger' })),
        { label: 'Keep both', value: 'both', style: 'primary' },
        { label: 'Cancel', value: null },
      ]);
      if (!choice) return;
      if (choice !== 'both') {
        const match = choice;
        const ok = await ask(`Replacing removes the notes for ${esc(nameOf(match))} that are on this device now, and puts the backup's notes in their place. Go ahead?`, [
          { label: 'Replace', value: true, style: 'danger' },
          { label: 'Cancel', value: false, style: 'primary' },
        ]);
        if (!ok) return;
        replace = { person: match, entries: await db.byPerson('entries', match.id), photos: await db.byPerson('photos', match.id) };
      }
    }

    // Fresh ids for everything, so an import can never collide with anyone already here.
    const pid = uid();
    const photoIds = new Map();
    const photos = (data.photos || []).map(ph => {
      const id = uid();
      photoIds.set(ph.id, id);
      return { id, personId: pid, type: ph.type || 'image/jpeg', w: ph.w, h: ph.h, data: b64ToBuf(ph.data) };
    });
    const now = Date.now();
    const newPerson = { ...data.person, id: pid, photoId: photoIds.get(data.person.photoId) || null, createdAt: replace ? replace.person.createdAt : now, updatedAt: data.person.updatedAt || now };
    const entries = data.entries.map(e => ({ ...e, id: uid(), personId: pid, ...(e.photoId ? { photoId: photoIds.get(e.photoId) || null } : {}) }));

    await db.tx(['people', 'entries', 'photos'], 'readwrite', s => {
      if (replace) {
        s.people.delete(replace.person.id);
        replace.entries.forEach(e => s.entries.delete(e.id));
        replace.photos.forEach(ph => s.photos.delete(ph.id));
      }
      photos.forEach(ph => s.photos.put(ph));
      entries.forEach(e => s.entries.put(e));
      s.people.put(newPerson);
    });
    replace?.photos.forEach(ph => forgetPhoto(ph.id));
    // A just-opened backup counts as backed up.
    await db.setMeta('lastExport:' + pid, now);
    askToKeepStorage();
    closeSheet();
    await loadPeople();
    await selectPerson(pid);
    await render();
    toast(`Opened ${nameOf(newPerson)}: ${entries.length} notes, ${photos.length} photos.`);
  } catch (err) { showError(err); }
}

// ---------- Start ----------

async function start() {
  try {
    await loadPeople();
    const saved = await db.getMeta('currentPerson');
    await selectPerson(S.people.find(p => p.id === saved)?.id || S.people[0]?.id || null);
    await render();
  } catch (err) {
    $('#app').innerHTML = `<section class="setup"><h1>Mammaw's Notes</h1><p class="lead">This browser won't let the app store notes${location.protocol === 'file:' ? ' when opened as a file' : ''}. Try opening it in Safari or Chrome, not in a private window.</p></section>`;
    console.error(err);
  }
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('./sw.js').catch(err => console.warn('Offline mode unavailable', err));
  }
}

window.addEventListener('keydown', e => {
  if (e.key === 'Escape' && $('#dialog').hidden && !$('#sheet').hidden) closeSheet();
  if ((e.key === 'Enter' || e.key === ' ') && e.target.classList?.contains('card')) { e.preventDefault(); e.target.click(); }
});

start();
