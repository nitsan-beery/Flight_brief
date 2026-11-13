// Service worker: האפליקציה עובדת גם בלי רשת. requirements.md, סעיף 6.2.
//
// רשת קודם (בלי מטמון ה-HTTP של הדפדפן), ואם אין רשת – מהמטמון. כך עדכון מגיע מיד כשיש חיבור,
// ובלי חיבור האפליקציה נפתחת מהעותק האחרון. בכל שינוי בקובץ שברשימה, או ברשימה עצמה, מעלים את CACHE
// ואת APP_VERSION ב-js/app.js לאותו מספר. בלי זה האפליקציה המותקנת באייפד עלולה להמשיך להציג את הגרסה הקודמת.

const CACHE = 'flight-brief-v46';
const SHELL = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/app.css',
  'js/app.js',
  'js/brief.js',
  'js/calendar.js',
  'js/sheet.js',
  'js/float.js',
  'js/cold.js',
  'js/store.js',
  'js/opt.js',
  'js/pdf/extract.js',
  'vendor/pdfjs/pdf.mjs',
  'vendor/pdfjs/pdf.worker.mjs',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// רק קבצי האפליקציה נשמרים במטמון. שום קובץ אחר מאותו מקור לא נשמר.
const SHELL_URLS = new Set(SHELL.map((p) => new URL(p, self.location).href));

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  url.search = '';
  url.hash = '';
  if (req.method !== 'GET' || !SHELL_URLS.has(url.href)) return;
  // GitHub Pages שולח max-age=600. no-cache שואל את השרת בכל טעינה (ETag), ומקבל 304 קצר כשלא השתנה דבר.
  event.respondWith(
    fetch(req.url, { cache: 'no-cache', credentials: 'same-origin' })
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }).then((hit) => hit ?? (req.mode === 'navigate' ? caches.match('index.html') : Response.error()))),
  );
});
