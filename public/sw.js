// Service worker de Matnexa : reçoit les notifications push et ouvre la bonne page au clic. RIEN D'AUTRE.
// Pas de gestionnaire « fetch », aucun cache : l'application reste en ligne uniquement et les pages authentifiées ne sont jamais
// conservées sur l'appareil (docs/pwa.md).

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }
  const title = typeof data.title === "string" && data.title ? data.title.slice(0, 120) : "Matnexa";
  const body = typeof data.body === "string" ? data.body.slice(0, 200) : "";
  // Uniquement un chemin de l'application, jamais une adresse externe.
  // On compare l'origine RÉSOLUE : « /\autre.site » est lu « //autre.site » par l'analyseur d'URL.
  let url = "/";
  try {
    const resolved = typeof data.url === "string" && data.url.startsWith("/") ? new URL(data.url, self.location.origin) : null;
    if (resolved && resolved.origin === self.location.origin) url = resolved.pathname + resolved.search + resolved.hash;
  } catch {
    url = "/";
  }
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: "/icons/icon-192.png",
      badge: "/icons/badge-96.png",
      data: { url },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL((event.notification.data && event.notification.data.url) || "/", self.location.origin);
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      for (const client of windows) {
        if (new URL(client.url).origin === target.origin && "focus" in client) {
          return client.focus().then((c) => ("navigate" in c ? c.navigate(target.href) : c));
        }
      }
      return self.clients.openWindow(target.href);
    }),
  );
});
