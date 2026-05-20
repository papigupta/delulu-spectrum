const CACHE_NAME = "delulu-spectrum-v2";
const APP_SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./script.js",
  "./manifest.webmanifest",
  "./icon.svg",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))),
  );
  self.clients.claim();
});

// Network-first for same-origin GETs: always try fresh content, fall back to
// cache only when offline. Cross-origin (Supabase, esm.sh) goes straight to network.
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") {
    return;
  }
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) {
    return;
  }
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request)),
  );
});

self.addEventListener("push", (event) => {
  const fallbackUrl = new URL("./", self.location.origin).toString();
  const data = getPushData(event);
  const title = data.title || "Your mirror is ready";
  const options = {
    body: data.body || "Open your private Delulu Spectrum result.",
    data: { url: data.url || fallbackUrl },
    icon: "./icon.svg",
    badge: "./icon.svg",
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

function getPushData(event) {
  if (!event.data) {
    return {};
  }
  try {
    return event.data.json();
  } catch (error) {
    return { body: event.data.text() };
  }
}

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      const url = event.notification.data?.url || new URL("./", self.location.origin).toString();
      const matchingClient = clientList.find((client) => client.url === url);
      if (matchingClient) {
        return matchingClient.focus();
      }
      return self.clients.openWindow(url);
    }),
  );
});
