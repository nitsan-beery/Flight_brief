// התדריך הפתוח והנתונים הידניים, על המכשיר בלבד (IndexedDB). requirements.md, סעיפים 5.0 ו-6.2.
// רשומה אחת: {key:'current', fileName, bytes, brief, manual}. שום דבר לא יוצא מהמכשיר.

const DB_NAME = 'flight-brief';
const DB_VERSION = 1;
const STORE = 'state';

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'key' });
    };
    req.onsuccess = () => {
      req.result.onversionchange = () => { req.result.close(); dbPromise = null; };
      resolve(req.result);
    };
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function run(mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(req?.result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

export const loadCurrent = () => run('readonly', (s) => s.get('current')).catch(() => null);
export const saveCurrent = (rec) => run('readwrite', (s) => s.put({ ...rec, key: 'current' }));
