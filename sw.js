// Паричник service worker: offline support + evening notifications.
const CACHE = 'paricnik-v2';
const STATE_CACHE = 'paricnik-state';   // small copy of the data the notification needs, written by the app
const STATE_KEY = './__notify-state.json';
const SHELL = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png', './apple-touch-icon.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('paricnik-v') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.hostname === 'api.anthropic.com') return; // never cache AI calls
  if (url.pathname.endsWith('__notify-state.json')) return;

  // App page: network first so updates arrive, saved copy when offline.
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put('./index.html', copy));
          return res;
        })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  // Icons, fonts, other files: saved copy first, refreshed in the background.
  e.respondWith(
    caches.match(req).then((hit) => {
      const net = fetch(req)
        .then((res) => {
          if (res && (res.ok || res.type === 'opaque')) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => hit);
      return hit || net;
    })
  );
});

/* ---------- notification text ---------- */
const pad = (n) => String(n).padStart(2, '0');
const toS = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const toD = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d, 12); };
const addDays = (s, n) => { const d = toD(s); d.setDate(d.getDate() + n); return toS(d); };
const addMonth = (s) => {
  const d = toD(s), day = d.getDate(); d.setDate(1); d.setMonth(d.getMonth() + 1);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate(); d.setDate(Math.min(day, last)); return toS(d);
};
const usd = (n) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n || 0);

async function readState() {
  try {
    const c = await caches.open(STATE_CACHE);
    const r = await c.match(STATE_KEY);
    return r ? await r.json() : null;
  } catch (e) { return null; }
}

// Builds tonight's message from the copy of the data the app left behind.
function compose(state, now = new Date()) {
  const lang = (state && state.lang) || 'mk';
  const mk = lang === 'mk';
  const today = toS(now), tomorrow = addDays(today, 1);
  const txs = (state && state.txs) || [];
  const spent = txs.filter((x) => x.type === 'expense' && x.date === today).reduce((a, x) => a + (+x.amount || 0), 0);
  const payday = state && Number.isInteger(state.payday) ? state.payday : 5;
  const salaryToday = txs.some((x) => x.type === 'salary' && x.date === today);
  const isPayday = now.getDay() === payday && !salaryToday;

  let body;
  if (isPayday) body = mk ? 'Денеска е плата: внеси ја неа и денешните трошоци.' : 'It’s payday: add your paycheck and today’s expenses.';
  else if (spent > 0) body = mk ? `Внеси ги денешните трошоци. Досега: ${usd(spent)}.` : `Add today’s expenses. So far: ${usd(spent)}.`;
  else body = mk ? 'Внеси ги денешните трошоци.' : 'Add today’s expenses.';

  const due = ((state && state.recurring) || []).filter((r) => {
    if (!r || !r.next) return false;
    let d = r.next, guard = 0;
    while (d < tomorrow && guard++ < 400) d = r.freq === 'weekly' ? addDays(d, 7) : addMonth(d);
    return d === tomorrow;
  });
  if (due.length) body += (mk ? ' Утре: ' : ' Tomorrow: ') + due.map((r) => `${r.name} ${usd(r.amount)}`).join(', ') + '.';
  return body;
}

async function show(kind) {
  const state = await readState();
  const mk = !state || state.lang !== 'en';
  let body = compose(state);
  if (kind === 'test') body = (mk ? 'Пробно известување од GitHub: работи! ' : 'Test from GitHub: it works! ') + body;
  return self.registration.showNotification('Паричник', {
    body,
    icon: 'icon-192.png',
    badge: 'icon-192.png',
    tag: 'paricnik-evening',
    renotify: true,
    data: { url: self.registration.scope },
  });
}

self.addEventListener('push', (e) => {
  let kind = 'daily';
  try { kind = (e.data && e.data.json().kind) || 'daily'; } catch (_) {}
  e.waitUntil(show(kind));
});

// "Preview" button in Settings: shows tonight's message right away.
self.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'preview') e.waitUntil(show('preview'));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || self.registration.scope;
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if (c.url.startsWith(self.registration.scope) && 'focus' in c) {
          c.postMessage({ type: 'go', tab: 'home' });
          return c.focus();
        }
      }
      return self.clients.openWindow(url);
    })
  );
});
