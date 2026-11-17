self.addEventListener("fetch", event => {
  if (event.request.mode !== "navigate" || !event.request.url.startsWith(self.registration.scope)) return;
  event.respondWith(fetch(event.request).catch(() => new Response(
    "<!doctype html><html lang=sk><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'><title>DroneSoccer LF</title><p>Pripoj sa k internetu a skús to znova.</p></html>",
    {headers: {"Content-Type": "text/html; charset=utf-8"}}
  )));
});

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", event => event.waitUntil(self.clients.claim()));
self.addEventListener("push", event => {
  event.waitUntil((async () => {
    try {
      const payload=event.data?.json();
      if(!Number.isSafeInteger(payload?.id)) return;
      // Recheck authentication, audience, current preferences, and whether the item still exists.
      const response=await fetch(new URL("api/push/notifications/"+payload.id,self.registration.scope),{credentials:"include",cache:"no-store"});
      if(!response.ok) return;
      const notice=await response.json();
      const names={messages:"Správy",calendar:"Kalendár",announcements:"Oznamy"};
      await self.registration.showNotification("DroneSoccer LF · "+names[notice.channel],{
        body:notice.title,icon:new URL("icon-blue-192.png",self.registration.scope).href,
        tag:notice.channel+"-"+payload.id,data:{path:notice.path},lang:"sk",
      });
    } catch(error) { console.error("Push notification could not be displayed",error); }
  })());
});
self.addEventListener("notificationclick",event=>{
  event.notification.close();
  event.waitUntil((async()=>{
    const destination=new URL(event.notification.data?.path || "#page=home",self.registration.scope);
    if(destination.origin!==self.location.origin || !destination.href.startsWith(self.registration.scope)) return;
    const tabs=await self.clients.matchAll({type:"window",includeUncontrolled:true});
    const tab=tabs.find(client=>client.url.startsWith(self.registration.scope));
    if(tab){await tab.navigate(destination.href);await tab.focus();}
    else await self.clients.openWindow(destination.href);
  })());
});
