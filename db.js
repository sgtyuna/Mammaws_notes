// On-device storage. Everything personal lives here, in this browser's IndexedDB.
// Nothing is ever sent anywhere; the app code holds no names, notes, or photos.

const DB_NAME = 'mammaws-notes';
const DB_VERSION = 1;

let dbPromise;

export function open() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const r = indexedDB.open(DB_NAME, DB_VERSION);
      r.onupgradeneeded = () => {
        const db = r.result;
        if (!db.objectStoreNames.contains('people')) db.createObjectStore('people', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('entries')) db.createObjectStore('entries', { keyPath: 'id' }).createIndex('personId', 'personId');
        // Photos are kept apart from entries so the timeline loads fast. data = ArrayBuffer (JPEG).
        if (!db.objectStoreNames.contains('photos')) db.createObjectStore('photos', { keyPath: 'id' }).createIndex('personId', 'personId');
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
      };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
      r.onblocked = () => reject(new Error('Storage is busy in another tab. Close other copies of the app and try again.'));
    });
  }
  return dbPromise;
}

const done = r => new Promise((resolve, reject) => {
  r.onsuccess = () => resolve(r.result);
  r.onerror = () => reject(r.error);
});

// Run fn inside one transaction. Everything in it is saved together, or not at all.
export async function tx(stores, mode, fn) {
  const db = await open();
  const names = [].concat(stores);
  return new Promise((resolve, reject) => {
    const t = db.transaction(names, mode);
    const s = Object.fromEntries(names.map(n => [n, t.objectStore(n)]));
    let out;
    t.oncomplete = () => resolve(out);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('Nothing was saved.'));
    out = fn(s, t);
  });
}

export const get = (store, id) => tx(store, 'readonly', s => done(s[store].get(id)));
export const all = store => tx(store, 'readonly', s => done(s[store].getAll()));
export const byPerson = (store, personId) => tx(store, 'readonly', s => done(s[store].index('personId').getAll(personId)));
export const put = (store, value) => tx(store, 'readwrite', s => { s[store].put(value); });
export const del = (store, id) => tx(store, 'readwrite', s => { s[store].delete(id); });

export async function getMeta(key) {
  const row = await get('meta', key);
  return row ? row.value : undefined;
}
export const setMeta = (key, value) => put('meta', { key, value });
