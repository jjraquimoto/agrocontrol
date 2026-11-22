/* Cache exclusivamente estático; nunca guarda autenticação nem dados do Supabase. */
const VERSION='agrocontrol-static-v6-3-2';
const LOCAL=['./','./index.html','./agrocontrol.html','./cloud.js','./config.js','./mobile.css','./mobile.js','./vault.js','./manifest.webmanifest','./icons/icon-192.png','./icons/icon-512.png'];
self.addEventListener('install',event=>event.waitUntil(caches.open(VERSION).then(c=>c.addAll(LOCAL)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil((async()=>{
 for(const k of await caches.keys())if(k.startsWith('agrocontrol-static-')&&k!==VERSION)await caches.delete(k);
 await self.clients.claim();
})()));
self.addEventListener('fetch',event=>{
 const req=event.request;
 if(req.method!=='GET')return;
 const u=new URL(req.url);
 if(u.hostname.includes('supabase.co'))return;
 if(u.origin===self.location.origin){
   event.respondWith((async()=>{
     const cached=await caches.match(req);
     try{
       const result=await fetch(req);
       // Só guardar páginas do próprio app e recursos estáticos. Não guardar respostas de API.
       if(result.ok && (LOCAL.some(p=>new URL(p,self.registration.scope).pathname===u.pathname))){
         const c=await caches.open(VERSION);c.put(req,result.clone()).catch(()=>{});
       }
       return result;
     }catch{return cached||(req.mode==='navigate'?await caches.match('./index.html'):Response.error())}
   })());return;
 }
 // Dependência pública do SDK, guardada para reabrir offline após o primeiro uso online.
 if(u.hostname==='esm.sh'){
   event.respondWith((async()=>{
     const cache=await caches.open(VERSION);const saved=await cache.match(req);
     if(saved)return saved;
     const result=await fetch(req);
     if(result.ok && result.type!=='opaque')cache.put(req,result.clone()).catch(()=>{});
     return result;
   })());
 }
});
