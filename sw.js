// Service worker: เก็บไฟล์แอปไว้ในเครื่องเพื่อเปิดใช้งานได้แม้ไม่มีอินเทอร์เน็ต
// มีเน็ต → ดึงไฟล์ล่าสุดจาก server เสมอ (ได้เวอร์ชันใหม่ทันที) / ไม่มีเน็ตหรือช้าเกิน 4 วินาที → ใช้ไฟล์ในเครื่อง
// เมื่อแก้ไฟล์ในแอป ให้เปลี่ยน VERSION ด้วย
const VERSION = 'map-pms-v0.9.27';
const SHELL = [
  './', 'index.html', 'manifest.webmanifest', 'icons/icon.svg', 'css/app.css', 'assets/logo.png', 'assets/brand-logo.png', 'assets/signature.png', 'assets/payment-qr.png',
  'js/main.js', 'js/core/config.js', 'js/core/ui.js', 'js/core/db.js', 'js/core/api.js', 'js/core/auth.js',
  'js/core/sync.js', 'js/core/model.js', 'js/core/docs.js', 'js/core/slip.js', 'js/core/idcard.js', 'js/core/print.js', 'js/core/printframe.js', 'js/data/seed.js',
  'js/modules/login.js', 'js/modules/dashboard.js', 'js/modules/floorplan.js', 'js/modules/parking.js',
  'js/modules/billing.js', 'js/modules/tenants.js', 'js/modules/reports.js', 'js/modules/birthdays.js', 'js/modules/users.js', 'js/modules/settings.js',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.hostname.endsWith('google.com') || url.hostname.endsWith('googleusercontent.com')) return;  // API ไม่แคช
  const same = url.origin === location.origin;
  if (!same && !url.hostname.includes('fonts.') && url.hostname !== 'cdn.jsdelivr.net') return;   // ฟอนต์ + ตัวอ่าน QR (jsQR) เก็บไว้ใช้ตอน offline
  e.respondWith((async () => {
    const cache = await caches.open(VERSION);
    try {
      const res = await Promise.race([
        fetch(e.request, same ? { cache: 'no-cache' } : undefined),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 4000)),
      ]);
      if (res.ok) cache.put(e.request, res.clone());
      return res;
    } catch {
      return (await caches.match(e.request, { ignoreSearch: true })) || Response.error();
    }
  })());
});
