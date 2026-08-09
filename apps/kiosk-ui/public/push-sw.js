// Handler de Web Push, injetado no service worker gerado pelo Workbox via
// `workbox.importScripts` (vite.config.ts) — o generateSW do vite-plugin-pwa
// não dá espaço para eventos custom dentro do próprio config, então este
// arquivo separado é importScripts()'d no sw.js final. Sem isso, o push
// chega no navegador mas nada mostra a notificação com o app fechado.
self.addEventListener("push", (event) => {
  let payload = { title: "Faça Amigos", body: "Dá uma olhadinha no painel." };
  try {
    if (event.data) payload = event.data.json();
  } catch {
    // Payload não veio como JSON — usa o texto puro como corpo.
    if (event.data) payload.body = event.data.text();
  }
  event.waitUntil(
    self.registration.showNotification(payload.title || "Faça Amigos", {
      body: payload.body || "",
      icon: "/icons/pwa-192.png",
      badge: "/icons/pwa-192.png",
      data: { url: payload.url || "/" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data && event.notification.data.url ? event.notification.data.url : "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes(url) && "focus" in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    }),
  );
});
