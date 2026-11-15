// Part 1 (the journal) end to end, on fresh empty copies of the app.
// Every person, quote, and photo here is made up. Nothing real goes in tests.
import { serve, launch, freshPage, ok, eq, wait, report } from './lib.mjs';
import { readFile, mkdir } from 'fs/promises';
import path from 'path';

const { server, url } = await serve();
const browser = await launch();
const OUT = path.join(path.dirname(new URL(import.meta.url).pathname), 'out');
await mkdir(OUT, { recursive: true });

// Make a big made-up test picture (a plain gradient) as PNG bytes.
async function testImage(pg, w, h, hue) {
  const b64 = await pg.evaluate(([w, h, hue]) => {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const x = c.getContext('2d'); const g = x.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, `hsl(${hue},60%,70%)`); g.addColorStop(1, `hsl(${hue + 60},60%,40%)`);
    x.fillStyle = g; x.fillRect(0, 0, w, h);
    return c.toDataURL('image/png').split(',')[1];
  }, [w, h, hue]);
  return { name: `test-${w}x${h}.png`, mimeType: 'image/png', buffer: Buffer.from(b64, 'base64') };
}

const dump = pg => pg.evaluate(async () => {
  const db = await import('./db.js');
  return { people: await db.all('people'), entries: await db.all('entries'), photos: (await db.all('photos')).map(p => ({ id: p.id, personId: p.personId, w: p.w, h: p.h, type: p.type, bytes: p.data.byteLength })) };
});
const cards = pg => pg.$$eval('#timeline .card', els => els.map(e => e.dataset.kind));

async function addPerson(pg, { name, call, songs = [], photo, playlist }) {
  if (await pg.$('#setupAdd')) await pg.click('#setupAdd');
  else { await pg.click('#whoBtn'); await pg.click('#addPerson'); }
  await pg.fill('[name=name]', name);
  if (call) await pg.fill('[name=callName]', call);
  if (playlist) await pg.fill('[name=playlist]', playlist);
  if (photo) { await pg.setInputFiles('[name=file]', photo); await pg.waitForSelector('.face-pick img.face'); }
  for (const s of songs) { await pg.click('#addSong'); await pg.fill('.song-row:last-child [name=song]', s); }
  await pg.click('[data-act=save]');
  await pg.waitForSelector('#sheet', { state: 'hidden' });
}
async function openKind(pg, kind) {
  await pg.click('#addBtn');
  await pg.click(`.kind-tile[data-kind=${kind}]`);
  await pg.waitForSelector('.sheet form');
}
async function save(pg) { await pg.click('[data-act=save]'); await pg.waitForSelector('#sheet', { state: 'hidden' }); }

// ---------- 1. A fresh copy opens empty ----------
console.log('Fresh copy');
let { ctx, pg, errors } = await freshPage(browser, url);
ok(await pg.isVisible('#setupAdd'), 'setup screen shows "Add the person you visit"');
let d = await dump(pg);
eq([d.people.length, d.entries.length, d.photos.length], [0, 0, 0], 'storage starts empty');
ok(!(await pg.$('.card')), 'no made-up sample entries');
await pg.screenshot({ path: path.join(OUT, '01-setup.png') });

// ---------- 2. Add a person ----------
console.log('Add a person');
await addPerson(pg, { name: 'Zinnia Testperson', call: 'Granny Zed', playlist: 'https://music.example.com/playlist/test', songs: ['Test Song One', 'Test Song Two'], photo: await testImage(pg, 900, 1200, 30) });
ok((await pg.textContent('.who-text b')) === 'Granny Zed', 'header shows what I call them');
ok(await pg.isVisible('.empty'), 'empty timeline has a gentle empty state');
d = await dump(pg);
eq(d.people[0].songs, ['Test Song One', 'Test Song Two'], 'song list saved');
ok(d.photos[0].w <= 800 && d.photos[0].h <= 800, 'person photo shrunk');

// ---------- 3. All four kinds ----------
console.log('Four kinds of notes');
await openKind(pg, 'visit');
eq(await pg.inputValue('[name=date]'), await pg.evaluate(() => { const d = new Date(); return new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); }), 'visit date defaults to today');
await pg.fill('[name=date]', '2026-01-05');
await pg.click('[data-chips=moods] [data-word=bright]');
await pg.click('[data-chips=moods] [data-word=calm]');
await pg.fill('[name=moodNote]', 'Laughed at the test parrot.');
await pg.fill('[name=did]', 'Sat by the window');
await pg.fill('[name=whoElse]', 'Test Cousin Pat');
await save(pg);

await openKind(pg, 'song');
await pg.click('[data-chips=song] [data-word="Test Song Two"]');
await pg.click('[data-chips=responses] [data-word="hummed along"]');
await save(pg);
await openKind(pg, 'song');
await pg.fill('[name=newSong]', 'Brand New Test Tune');
await pg.click('[data-chips=responses] [data-word="teared up"]');
await save(pg);
d = await dump(pg);
eq(d.people[0].songs, ['Test Song One', 'Test Song Two', 'Brand New Test Tune'], 'a typed new song joins their song list');

const QUOTE = '  i seen a bluebird teh size of a cat,  honey\nwhar is my pocketbook  ';
await openKind(pg, 'said');
const attrs = await pg.$eval('[name=words]', t => [t.getAttribute('autocorrect'), t.getAttribute('autocapitalize'), t.spellcheck, t.getAttribute('autocomplete')]);
eq(attrs, ['off', 'off', false, 'off'], 'their-words box has autocorrect, capitals, spellcheck, autocomplete off');
await pg.fill('[name=words]', QUOTE);
await pg.fill('[name=note]', 'While we looked out the window.');
await save(pg);
d = await dump(pg);
eq(d.entries.find(e => e.kind === 'said').words, QUOTE, 'their words stored exactly as typed (spaces, spelling, line break)');
const shown = await pg.$eval('.said', el => el.textContent);
eq(shown, QUOTE, 'their words shown exactly as typed');
eq(await pg.$eval('.said', el => [getComputedStyle(el, '::before').content, getComputedStyle(el, '::after').content].join()), 'none,none', 'no quote marks added on screen');

await openKind(pg, 'photo');
await pg.setInputFiles('[name=file]', await testImage(pg, 3200, 2000, 200));
await pg.waitForSelector('.photo-pick img.pic');
await pg.fill('[name=caption]', 'Test photo for the book');
await pg.click('.switch');
await save(pg);
await openKind(pg, 'photo');
await pg.setInputFiles('[name=file]', await testImage(pg, 1000, 1000, 120));
await pg.waitForSelector('.photo-pick img.pic');
await pg.fill('[name=caption]', 'Test photo kept out of the book');
await save(pg);
d = await dump(pg);
const notePhotos = d.photos.filter(p => p.id !== d.people[0].photoId);
ok(notePhotos.every(p => Math.max(p.w, p.h) <= 1600 && p.type === 'image/jpeg'), `photos compressed to JPEG ≤1600px (${notePhotos.map(p => `${p.w}x${p.h} ${Math.round(p.bytes / 1024)}KB`).join(', ')})`);
eq(notePhotos.map(p => Math.max(p.w, p.h)).sort(), [1000, 1600], 'big photo shrunk to 1600, small one left alone');
eq(d.entries.filter(e => e.kind === 'photo').map(e => [e.caption, e.inBook]).sort(), [['Test photo for the book', true], ['Test photo kept out of the book', false]], 'Photo Book switch saved per photo (only the switched-on one is in the book)');
eq(await pg.$$eval('.badge', b => b.length), 1, 'timeline marks one photo "In Photo Book"');
await pg.waitForFunction(() => [...document.querySelectorAll('#timeline img.pic')].every(i => i.naturalWidth > 0));
await pg.screenshot({ path: path.join(OUT, '02-timeline.png'), fullPage: true });

// ---------- 4. Timeline, filters, search ----------
console.log('Timeline, filters, search');
eq((await cards(pg)).length, 6, 'timeline shows all six notes');
eq((await cards(pg)).at(-1), 'visit', 'newest first: the backdated visit is last');
eq(await pg.$$eval('#timeline .day', h => h.length), 2, 'grouped under two dates');
await pg.click('[data-filter=said]');
eq(await cards(pg), ['said'], 'filter "Things they said" shows only that kind');
await pg.click('[data-filter=song]');
eq(await cards(pg), ['song', 'song'], 'filter "Songs" shows only songs');
await pg.click('[data-filter=all]');
await pg.fill('#q', 'teh size of a cat');
eq(await cards(pg), ['said'], 'search finds an exact quote');
await pg.fill('#q', 'Test Cousin Pat');
eq(await cards(pg), ['visit'], 'search finds who else was there');
await pg.fill('#q', 'zzz nothing');
ok(await pg.isVisible('.empty'), 'search with no match says so gently');
await pg.fill('#q', '');

// ---------- 5. Edit ----------
console.log('Edit');
await pg.click('#timeline .card[data-kind=visit]');
eq(await pg.inputValue('[name=whoElse]'), 'Test Cousin Pat', 'edit form opens filled in');
ok(await pg.$eval('[data-chips=moods] [data-word=bright]', c => c.classList.contains('on')), 'chosen mood words stay chosen');
await pg.fill('[name=whoElse]', 'Test Cousin Pat and Test Aunt Lou');
await save(pg);
ok((await pg.textContent('#timeline')).includes('Test Aunt Lou'), 'edit saved');

// ---------- 6. Delete asks first, and Undo works ----------
console.log('Delete + Undo');
await pg.click('#timeline .card[data-kind=said]');
await pg.click('[data-act=delete]');
ok(await pg.isVisible('#dialog .dialog'), 'delete asks first');
await pg.click('#dialog button >> text=Keep it');
ok(await pg.isVisible('.sheet'), '"Keep it" keeps it');
await pg.click('[data-act=delete]');
await pg.click('#dialog button:text-is("Delete")');
await pg.waitForSelector('#sheet', { state: 'hidden' });
eq((await cards(pg)).includes('said'), false, 'note deleted');
ok(await pg.isVisible('#undoBtn'), 'Undo is offered');
await pg.click('#undoBtn');
await wait(pg, 200);
d = await dump(pg);
eq(d.entries.find(e => e.kind === 'said')?.words, QUOTE, 'Undo brings it back exactly');
// A deleted photo note comes back with its picture.
await pg.click('#timeline .card[data-kind=photo] >> nth=0');
await pg.click('[data-act=delete]');
await pg.click('#dialog button:text-is("Delete")');
await pg.waitForSelector('#sheet', { state: 'hidden' });
await pg.click('#undoBtn');
await wait(pg, 200);
await pg.waitForFunction(() => [...document.querySelectorAll('#timeline img.pic')].length === 2 && [...document.querySelectorAll('#timeline img.pic')].every(i => i.naturalWidth > 0));
ok(true, 'Undo brings back a deleted photo with its picture');

// ---------- 7. A second person stays separate ----------
console.log('Separate people');
await addPerson(pg, { name: 'Oswald Testman', call: 'Test Pop' });
ok(await pg.isVisible('.empty'), 'new person starts with an empty timeline');
await openKind(pg, 'said');
await pg.fill('[name=words]', 'Test Pop words only');
await save(pg);
await pg.fill('#q', 'teh size');
ok(await pg.isVisible('.empty'), "search doesn't show another person's notes");
await pg.fill('#q', '');
await pg.click('#whoBtn');
await pg.click('[data-pick] >> text=Granny Zed');
await wait(pg, 150);
eq((await cards(pg)).length, 6, 'switching back shows only her six notes');

// ---------- 8. Export, clear, import ----------
console.log('Export and import');
await pg.click('#backupBtn');
const [dl] = await Promise.all([pg.waitForEvent('download'), pg.click('#exportBtn')]);
const file = path.join(OUT, 'export.json');
await dl.saveAs(file);
ok(/^Mammaws-Notes-Granny-Zed-\d{4}-\d{2}-\d{2}\.json$/.test(dl.suggestedFilename()), `backup file name: ${dl.suggestedFilename()}`);
const exp = JSON.parse(await readFile(file, 'utf8'));
eq([exp.entries.length, exp.photos.length], [6, 3], 'backup holds 6 notes and 3 photos (2 notes + her picture)');
ok(!JSON.stringify(exp).includes('Test Pop'), "backup holds only that one person, nobody else");
await pg.click('[data-act=cancel]');
await pg.screenshot({ path: path.join(OUT, '03-after-backup.png') });

// "Clear the data": a brand-new device with nothing on it.
const before = d;
await ctx.close();
({ ctx, pg, errors } = await freshPage(browser, url));
ok(await pg.isVisible('#setupImport'), 'new empty copy offers "Open a backup file"');
let [chooser] = await Promise.all([pg.waitForEvent('filechooser'), pg.click('#setupImport')]);
await chooser.setFiles(file);
await pg.waitForSelector('#timeline .card');
d = await dump(pg);
eq([d.people.length, d.entries.length, d.photos.length], [1, 6, 3], 'import brings back the person, 6 notes, 3 photos');
eq(d.entries.find(e => e.kind === 'said').words, QUOTE, 'their exact words survive the round trip');
eq(d.people[0].songs, before.people.find(p => p.name === 'Zinnia Testperson').songs, 'song list survives');
eq(d.people[0].playlist, 'https://music.example.com/playlist/test', 'playlist link survives');
await pg.waitForFunction(() => { const i = [...document.querySelectorAll('img.pic, img.face')]; return i.length === 3 && i.every(x => x.naturalWidth > 0); });
ok(true, 'all photos show after import');

// Importing the same person again asks first.
console.log('Import when the person is already here');
await addPerson(pg, { name: 'Oswald Testman', call: 'Test Pop' });
await openKind(pg, 'said');
await pg.fill('[name=words]', 'Test Pop stays put');
await save(pg);
const importAgain = async () => {
  await pg.click('#backupBtn');
  const [c] = await Promise.all([pg.waitForEvent('filechooser'), pg.click('#importBtn')]);
  await c.setFiles(file);
  await pg.waitForSelector('#dialog .dialog');
};
await importAgain();
ok((await pg.textContent('#dialog')).includes('already on this device'), 'asks before touching an existing person');
await pg.click('#dialog button >> text=Cancel');
await pg.click('[data-act=cancel]');
d = await dump(pg);
eq(d.people.length, 2, 'Cancel changes nothing');
await importAgain();
await pg.click('#dialog button >> text=Keep both');
await pg.waitForSelector('#sheet', { state: 'hidden' });
d = await dump(pg);
eq(d.people.length, 3, 'Keep both adds a second copy');
// Two copies now share a name. Give the open copy one more note so they differ,
// then Replace must say which copy each button means, and replace only that one.
await openKind(pg, 'said');
await pg.fill('[name=words]', 'only in the second copy');
await save(pg);
await importAgain();
const askText = await pg.textContent('#dialog');
ok(askText.includes('2 copies') && askText.includes('7 notes') && askText.includes('6 notes'), 'with two copies, the ask tells them apart by notes count');
await pg.click('#dialog button >> text=/with 7 notes/');
ok((await pg.textContent('#dialog')).includes('Go ahead?'), 'Replace asks a second time');
await pg.click('#dialog button:text-is("Replace")');
await pg.waitForSelector('#sheet', { state: 'hidden' });
d = await dump(pg);
eq(d.people.length, 3, 'Replace swaps one copy, does not add');
eq(d.entries.filter(e => e.words === 'only in the second copy').length, 0, 'the picked copy was the one replaced');
eq(d.entries.filter(e => e.words === 'Test Pop stays put').length, 1, "Test Pop's notes untouched by imports");
eq(d.entries.length, 6 + 6 + 1, 'no notes duplicated or lost');

// A wrong file changes nothing.
await pg.click('#backupBtn');
[chooser] = await Promise.all([pg.waitForEvent('filechooser'), pg.click('#importBtn')]);
await chooser.setFiles({ name: 'not-a-backup.json', mimeType: 'application/json', buffer: Buffer.from('{"hello":1}') });
await pg.waitForSelector('#dialog .dialog');
ok((await pg.textContent('#dialog')).includes("isn't a Mammaw's Notes backup"), 'a wrong file is refused');
await pg.click('#dialog button >> text=OK');
eq((await dump(pg)).entries.length, 13, 'and nothing changed');
await pg.click('[data-act=cancel]');

// Deleting a person asks first and can be undone.
console.log('Delete a person');
await pg.click('#whoBtn');
await pg.click('[data-edit] >> nth=0');
await pg.click('[data-act=delete]');
await pg.waitForSelector('#dialog .dialog');
ok((await pg.textContent('#dialog')).includes('Save a backup first'), 'deleting a person asks first and suggests a backup');
await pg.click('#dialog button >> text=Delete everything');
await pg.waitForSelector('#sheet', { state: 'hidden' });
eq((await dump(pg)).people.length, 2, 'person deleted');
await pg.click('#undoBtn');
await wait(pg, 200);
d = await dump(pg);
eq([d.people.length, d.entries.length], [3, 13], 'Undo brings the person and all their notes back');

// ---------- 9. Storage, offline, layout ----------
console.log('Storage, offline, layout');
await pg.click('#backupBtn');
ok(/MB used/.test(await pg.textContent('.sheet')), 'backup screen shows storage used');
await pg.screenshot({ path: path.join(OUT, '04-backup.png') });
await pg.click('[data-act=cancel]');
await pg.evaluate(() => navigator.serviceWorker.ready);
await pg.reload();
await pg.waitForSelector('#timeline');
await ctx.setOffline(true);
await pg.reload();
ok(await pg.isVisible('#timeline'), 'opens with no internet once it has loaded');
await ctx.setOffline(false);
eq(await pg.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'no sideways scrolling at phone width');
await pg.setViewportSize({ width: 1280, height: 900 });
await pg.screenshot({ path: path.join(OUT, '05-mac.png') });
ok(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.join(' / ') : ''));

await ctx.close();
await browser.close();
server.close();
process.exit(report() ? 1 : 0);
