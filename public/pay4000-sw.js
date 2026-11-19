// PAY4000 web application worker: intentionally does not cache any private data.
// Offline invoices, background payment sync, and push are NOT enabled.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', event => {
  // Do not intercept requests. Authorization and financial information are always network-only.
});
