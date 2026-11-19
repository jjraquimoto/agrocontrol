/* AgroControl 6.0 RC: cache de arquivos estáticos. Nunca armazene APIs do Supabase. */
const VERSION='agrocontrol-static-v6-rc1';
const LOCAL=['./index.html','./agrocontrol.html','./cloud.js','./config.js','./manifest.webmanifest','./icons/icon-192.png','./icons/icon-512.png'];
self.addEventListener('install',event=>event.waitUntil(caches.open(VERSION).then(cache=>cache.addAll(LOCAL)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil((async()=>{for(const key of await caches.keys())if(key.startsWith('agrocontrol-static-')&&key!==VERSION)await caches.delete(key);await self.clients.claim()})()));
self.addEventListener('fetch',event=>{
 const request=event.request,url=new URL(request.url);
 if(request.method!=='GET')return;
 // Não guardar credenciais, REST, Auth ou respostas do banco.
 if(url.hostname.includes('supabase.co'))return;
 if(url.origin===self.location.origin){
   event.respondWith((async()=>{
     try {const net=await fetch(request);if(net.ok){const c=await caches.open(VERSION);c.put(request,net.clone()).catch(()=>{})}return net}
     catch {return await caches.match(request) || (request.mode==='navigate'?await caches.match('./agrocontrol.html'):Response.error())}
   })());return;
 }
 // Dependências JS públicas do esm.sh: cache após primeiro acesso com internet.
 if(url.hostname==='esm.sh')event.respondWith((async()=>{
   const cached=await caches.match(request);if(cached)return cached;
   const net=await fetch(request);if(net.ok){const c=await caches.open(VERSION);c.put(request,net.clone()).catch(()=>{})}return net;
 })());
});
