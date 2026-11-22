/* AgroControl 6.2 — cofre criptografado para dados locais de fazendas. */
(()=>{
  'use strict';
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const PREFIX='agro_v62_vault_';
  const META='agro_v62_vault_credential';
  const ITERATIONS=310000;
  const userJournalKey=(u,f)=>`agro_v6_journal_${u}_${f}`;
  const userCacheKey=(u,f)=>`agro_v5_cloud_${u}_${f}`;
  const dataKey=(u,f)=>`${PREFIX}${u}_${f}`;
  let currentUser=null;
  let currentKey=null;
  let busy=false;
  const pendingWrites=new Map();
  const b64=b=>{
    const bytes=new Uint8Array(b);let s='';
    for(let i=0;i<bytes.length;i+=8192)s+=String.fromCharCode(...bytes.subarray(i,i+8192));
    return btoa(s);
  };
  const un64=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
  const aad=(u,f)=>encoder.encode(`agrocontrol|local-vault-v1|${u}|${f}`);
  const metadata=()=>{
    try{const v=JSON.parse(localStorage.getItem(META)||'null');return v&&v.version===2?v:null}
    catch{return null}
  };
  function supported(){return Boolean(globalThis.crypto?.subtle&&globalThis.crypto?.getRandomValues&&globalThis.TextEncoder)}
  async function derive(pass,salt,iterations=ITERATIONS){
    if(!supported())throw Error('Este navegador não permite criptografia segura. Use HTTPS ou o aplicativo atualizado.');
    const raw=await crypto.subtle.importKey('raw',encoder.encode(pass),'PBKDF2',false,['deriveKey']);
    return crypto.subtle.deriveKey({name:'PBKDF2',hash:'SHA-256',salt,iterations},raw,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
  }
  async function seal(key,u,f,body){
    const iv=crypto.getRandomValues(new Uint8Array(12));
    const ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:aad(u,f),tagLength:128},key,encoder.encode(JSON.stringify(body)));
    return JSON.stringify({version:1,iv:b64(iv),ciphertext:b64(ciphertext)});
  }
  async function unseal(key,u,f,stored){
    let record;
    try{record=JSON.parse(stored)}catch{throw Error('Conteúdo local criptografado inválido. Não substitua os dados sem backup.')}
    if(record?.version!==1||!record.iv||!record.ciphertext)throw Error('Formato do cofre não reconhecido.');
    try{
      const decrypted=await crypto.subtle.decrypt({name:'AES-GCM',iv:un64(record.iv),additionalData:aad(u,f),tagLength:128},key,un64(record.ciphertext));
      return JSON.parse(decoder.decode(decrypted));
    }catch{throw Error('Senha incorreta ou cofre danificado. Os dados foram preservados.')}
  }
  function legacyFor(u,f){
    const raw=localStorage.getItem(userJournalKey(u,f));
    if(raw){
      let j;try{j=JSON.parse(raw)}catch{throw Error(`Diário antigo da fazenda ${f} está danificado. Faça backup antes de migrar.`)}
      if(!j?.payload||!Array.isArray(j.payload.animals))throw Error('Diário local anterior inválido.');
      return j;
    }
    const cache=localStorage.getItem(userCacheKey(u,f));
    if(!cache)return null;
    let p,m;try{p=JSON.parse(cache);m=JSON.parse(localStorage.getItem(userCacheKey(u,f)+'_meta')||'null')}
    catch{throw Error('Cache anterior inválido. Não foi removido.')}
    if(!p||!Array.isArray(p.animals))throw Error('Cache anterior inválido. Não foi removido.');
    // Se a origem da base remota não for conhecida, nunca declarar a cópia como sincronizada.
    return {version:1,payload:p,revision:Number(m?.revision)||0,dirty:m?Boolean(m.dirty):true,baseline:m?.baseline||null,at:new Date().toISOString()};
  }
  function idsWithLegacy(u,known=[]){
    const result=new Set(known.map(x=>typeof x==='string'?x:x?.id).filter(Boolean));
    const journal=`agro_v6_journal_${u}_`,cache=`agro_v5_cloud_${u}_`;
    for(const k of Object.keys(localStorage)){
      if(k.startsWith(journal))result.add(k.slice(journal.length));
      if(k.startsWith(cache)&&!k.endsWith('_meta'))result.add(k.slice(cache.length));
    }
    return [...result];
  }
  function dropPlain(u){
    const journal=`agro_v6_journal_${u}_`,cache=`agro_v5_cloud_${u}_`;
    for(const k of Object.keys(localStorage))if(k.startsWith(journal)||k.startsWith(cache))localStorage.removeItem(k);
  }
  async function setup(pass,u,email,known=[]){
    if(busy)throw Error('Operação do cofre em andamento.');
    if(metadata())throw Error('Já existe um cofre neste dispositivo. Desbloqueie-o em vez de sobrescrever.');
    if(pass.length<10)throw Error('A nova senha local deve ter pelo menos 10 caracteres.');
    busy=true;
    try{
      const salt=crypto.getRandomValues(new Uint8Array(16));const key=await derive(pass,salt);
      const ids=idsWithLegacy(u,known),staged=[];
      for(const id of ids){
        const legacy=legacyFor(u,id);
        if(!legacy)continue;
        const cipher=await seal(key,u,id,legacy);
        if(JSON.stringify(legacy)!==JSON.stringify(await unseal(key,u,id,cipher)))throw Error('Falha ao verificar os dados cifrados.');
        staged.push([dataKey(u,id),cipher]);
      }
      // Grave tudo antes de ativar a chave. Se falhar, os arquivos legados permanecem intactos.
      for(const [k,v] of staged)localStorage.setItem(k,v);
      const check=await seal(key,u,'__check__',{text:'AgroControlVaultOk',userId:u});
      localStorage.setItem(META,JSON.stringify({version:2,userId:u,email,salt:b64(salt),iterations:ITERATIONS,check,createdAt:new Date().toISOString()}));
      currentUser=u;currentKey=key;
      dropPlain(u);
      localStorage.removeItem('agro_v61_offline_credential');
      return staged.length;
    }finally{busy=false}
  }
  async function unlock(pass){
    const m=metadata();if(!m)throw Error('Não há cofre configurado neste dispositivo.');
    const k=await derive(pass,un64(m.salt),m.iterations);
    const check=await unseal(k,m.userId,'__check__',m.check);
    if(check?.text!=='AgroControlVaultOk'||check?.userId!==m.userId)throw Error('Não foi possível confirmar o cofre.');
    currentKey=k;currentUser=m.userId;
    // Limpa vestígios legados após uma eventual interrupção durante a migração.
    dropPlain(currentUser);
    return {userId:m.userId,email:m.email};
  }
  async function read(u,f){
    if(metadata()?.userId!==u)throw Error('Cofre vinculado a outra conta.');
    if(!currentKey||currentUser!==u)throw Error('Desbloqueie o cofre local antes de abrir esta fazenda.');
    const text=localStorage.getItem(dataKey(u,f));
    return text?await unseal(currentKey,u,f,text):null;
  }
  async function write(u,f,journal){
    if(metadata()?.userId!==u||currentUser!==u||!currentKey)throw Error('Cofre bloqueado. Os dados não foram salvos.');
    const k=dataKey(u,f), previous=pendingWrites.get(k)||Promise.resolve(), key=currentKey;
    // Nunca permitir que uma gravação cifrada anterior termine por último e apague dados recentes.
    const task=previous.catch(()=>{}).then(async()=>{
      if(metadata()?.userId!==u||currentKey!==key)throw Error('Cofre fechado durante o salvamento.');
      const sealed=await seal(key,u,f,journal);
      localStorage.setItem(k,sealed);
    });
    pendingWrites.set(k,task);
    try{await task}finally{if(pendingWrites.get(k)===task)pendingWrites.delete(k)}
  }
  function clearUser(u){
    if(metadata()?.userId===u)localStorage.removeItem(META);
    for(const k of Object.keys(localStorage))if(k.startsWith(`${PREFIX}${u}_`))localStorage.removeItem(k);
    if(currentUser===u){currentUser=null;currentKey=null}
  }
  window.AGRO_VAULT={metadata,setup,unlock,read,write,clearUser,supported,isActive:u=>metadata()?.userId===u,isUnlocked:u=>Boolean(currentKey&&currentUser===u),legacyFor};
})();
