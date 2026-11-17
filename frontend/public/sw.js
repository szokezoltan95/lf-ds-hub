self.addEventListener("fetch", event => {
  if (event.request.mode !== "navigate" || !event.request.url.startsWith(self.registration.scope)) return;
  event.respondWith(fetch(event.request).catch(() => new Response(
    "<!doctype html><html lang=sk><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'><title>DroneSoccer LF</title><p>Pripoj sa k internetu a skús to znova.</p></html>",
    {headers: {"Content-Type": "text/html; charset=utf-8"}}
  )));
});
