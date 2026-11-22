/* AgroControl 6.2 — sincronização por registros, cofre cifrado opcional e uso desconectado. */
const $ = id => document.getElementById(id);
const cfg = window.AGRO_CONFIG || {};
const configured = Boolean(cfg.supabaseUrl && cfg.supabasePublishableKey);
let supabase = null, session = null, farm = null, farms = [], revision = 0, dirty = false, syncing = false, demo = false, blocked = false, syncTimer = 0, retryAutomatically = true, baseline = null, retryCount = 0, retryTimer = 0, offlineOnly = false, cloudVerified = false;
const CACHED_FARMS_PREFIX='agro_v6_farms_';
const knownFarmsKey=userId=>CACHED_FARMS_PREFIX+userId;
const connectedLabel=()=>navigator.onLine?'Online':'Sem internet';
function updateConnectionBanner(){
 const banner=$('connectionBanner');if(!banner)return;
 const online=navigator.onLine;
 let title='',detail='',cls='',label='',action='';
 if(demo){title='Demonstração local';detail='Os registros desta demonstração não vão para o Supabase.';cls='warn';label='Demonstração'}
 else if(offlineOnly){title='Trabalhando com dados locais';detail='Entre na sua conta assim que tiver internet para enviar as alterações.';cls='warn';label=dirty?'Pendente no aparelho':'Acesso offline';action=online?'Conectar online':''}
 else if(!session){title='Entre na sua conta';detail='O primeiro acesso e a recuperação de conta exigem internet.';cls='warn';label='Sem sessão'}
 else if(blocked){title='Conflito entre dispositivos';detail='As edições locais foram preservadas. Faça backup e escolha como resolver.';cls='bad';label='Atenção: conflito';action=online?'Resolver conflito':''}
 else if(dirty){title=online?(syncing?'Enviando alterações...':'Alterações aguardando envio'):'Salvo neste aparelho';detail=online?'O AgroControl tentará enviar automaticamente.':'As alterações serão enviadas depois que a conexão voltar e você estiver autenticado.';cls='warn';label=syncing?'Enviando...':online?'Aguardando envio':'Pendente no aparelho';if(online&&!syncing)action='Tentar agora'}
 else if(!online){title='Sem internet';detail='Os dados já carregados estão disponíveis neste aparelho.';cls='warn';label='Sem internet'}
 else if(syncing){title='Atualizando dados...';detail='Conferindo alterações com a nuvem.';cls='warn';label='Atualizando...'}
 else if(!cloudVerified){title='Aguardando confirmação da nuvem';detail='Os dados do aparelho estão preservados, mas ainda não foi possível confirmar a conexão.';cls='warn';label='Aguardando nuvem';if(online&&farm)action='Verificar agora'}
 else{title='Tudo salvo';detail='Registros atualizados na nuvem.';cls='ok';label=farm?'Tudo salvo':'Aguardando fazenda'}
 const quiet=!!session && !!farm && !dirty && !blocked && !offlineOnly && online && !syncing && !demo && cloudVerified;
 banner.className='connection-banner '+cls+(quiet?' is-quiet':'');
 $('connectionTitle').textContent=title;$('connectionDetail').textContent=detail;
 const actionBtn=$('connectionAction');actionBtn.hidden=!action;actionBtn.textContent=action||'';
 const backupBtn=$('connectionBackup');backupBtn.hidden=!(blocked || (dirty&&!online));
 const tools=banner.querySelector('.connection-tools');if(tools)tools.hidden=!action&&backupBtn.hidden;
 const manual=$('syncNowBtn');manual.disabled=demo||syncing||(!offlineOnly&&(!session||!farm));
 manual.textContent=offlineOnly?'Conectar online':blocked?'Resolver conflito':'↻ Atualizar agora';
 const compact=$('mobileSyncStatus');if(compact){compact.textContent=label;compact.className='mobile-header__sync '+(cls||'ok');compact.setAttribute('aria-label','Estado da sincronização: '+label)}
}
$('connectionBackup').addEventListener('click',()=>window.AGRO_APP.backup());
$('connectionAction').addEventListener('click',()=>{if(!$('syncNowBtn').disabled)$('syncNowBtn').click()});
$('syncNowBtn').addEventListener('click',async()=>{
 if(offlineOnly){if(!navigator.onLine)return window.AGRO_APP.notify('Ainda não há internet para conectar à conta.',true);gate(true);farm=null;farms=[];session=null;offlineOnly=false;resetGate();showError('Entre com seu e-mail e senha do Supabase para sincronizar suas edições offline.');await init();return}
 if(demo||!session||!farm)return;
 if(!navigator.onLine)return window.AGRO_APP.notify('Sem internet: alterações permanecem no dispositivo.',true);
 retryAutomatically=true;
 if(blocked){conflictNotice();return}
 if(dirty)await sync();
 else {
   const {data,error}=await supabase.from('farm_data').select('payload,revision').eq('farm_id',farm.id).single();
   if(error){cloudVerified=false;updateConnectionBanner();return window.AGRO_APP.notify('Falha ao consultar a nuvem: '+errText(error),true);}
   cloudVerified=true;
   if(revision!==Number(data.revision)){
     baseline=data.payload;revision=Number(data.revision);dirty=false;
     window.AGRO_SYNC_ENABLED=false;window.AGRO_APP.setFarmState(data.payload,localKey(farm.id));window.AGRO_SYNC_ENABLED=true;
     await saveMeta();
   }
   setStatus('Sincronizado','ok');
 }
 updateConnectionBanner();
});
const empty = () => ({version:4,animals:[],lots:[],health:[],production:[],movements:[]});
// Por padrão a sessão dura apenas até o fechamento da aba/janela. A persistência
// entre sessões só é usada com consentimento explícito via 'Manter conectado'.
const REMEMBER_KEY='agro_v5_remember';
const IDLE_MS=20*60*1000;
let idleHandle=null, locked=false, lastActivity=Date.now(), lastActivityCheck=0;
const remember=()=>localStorage.getItem(REMEMBER_KEY)==='yes';
const authStorage={
  getItem(key){return (remember()?localStorage:sessionStorage).getItem(key)},
  setItem(key,value){(remember()?localStorage:sessionStorage).setItem(key,value)},
  removeItem(key){sessionStorage.removeItem(key);localStorage.removeItem(key)}
};
function setRemember(value){
  // Transfer only a currently active Supabase token, not other stored records.
  const storageKey=`sb-${new URL(cfg.supabaseUrl).hostname.split('.')[0]}-auth-token`;
  const from=remember()?localStorage:sessionStorage;
  const token=from.getItem(storageKey);
  if(value)localStorage.setItem(REMEMBER_KEY,'yes');else localStorage.removeItem(REMEMBER_KEY);
  if(token)(value?localStorage:sessionStorage).setItem(storageKey,token);
  (value?sessionStorage:localStorage).removeItem(storageKey);
}
function clearPassword(){$('loginPassword').value=''}
function resetGate(){locked=false;document.body.classList.remove('lock-enabled');$('loginEmail').readOnly=false;$('loginSubmit').textContent='Entrar';$('signUpBtn').disabled=false;$('resetPasswordBtn').disabled=false;$('demoBtn').disabled=false;$('rememberMe').disabled=false;}
function lockApp(){
  if(!session||demo||locked)return;
  locked=true;document.body.classList.add('lock-enabled');
  $('loginEmail').value=session.user.email||'';$('loginEmail').readOnly=true;
  $('loginSubmit').textContent='Desbloquear';$('signUpBtn').disabled=true;
  $('resetPasswordBtn').disabled=true;$('demoBtn').disabled=true;
  $('rememberMe').disabled=true;clearPassword();
  showError(offlineOnly?'Sessão offline bloqueada. Digite a senha local para continuar.':'Sessão bloqueada por inatividade. Digite sua senha para continuar.');gate(true);
}
function trackActivity(){
  const now=Date.now();if(now-lastActivityCheck<1000)return;lastActivityCheck=now;
  if(!locked&&session&&!demo&&now-lastActivity>=IDLE_MS){lockApp();return}
  if(!locked)lastActivity=now;
}
for(const event of ['pointerdown','keydown','touchstart'])window.addEventListener(event,trackActivity,{passive:true});
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&session&&!locked&&!demo&&Date.now()-lastActivity>=IDLE_MS)lockApp()});
function beginIdleMonitoring(){
  clearInterval(idleHandle);lastActivity=Date.now();
  idleHandle=setInterval(()=>{if(session&&!locked&&!demo&&Date.now()-lastActivity>=IDLE_MS)lockApp()},10000);
}
function clearLocalFarmCaches(userId){
  if(!userId)return;
  const prefix=`agro_v5_cloud_${userId}_`,journalPrefix=`agro_v6_journal_${userId}_`;
  for(const key of Object.keys(localStorage))if(key.startsWith(prefix)||key.startsWith(journalPrefix))localStorage.removeItem(key);
  localStorage.removeItem(`agro_v5_lastfarm_${userId}`);localStorage.removeItem(knownFarmsKey(userId));
  window.AGRO_VAULT?.clearUser(userId);
}
// Confirma a identidade no Supabase antes de ações destrutivas.
window.AGRO_REQUIRE_PASSWORD=async purpose=>{
  if(demo)return true;
  if(offlineOnly){window.AGRO_APP.notify('Ações destrutivas exigem confirmação de senha online.',true);return false}
  if(!supabase||!session||locked)return false;
  const input=window.prompt(`Por segurança, digite sua senha do AgroControl para ${purpose}:`);
  if(input===null)return false;
  if(!input){window.AGRO_APP.notify('Digite sua senha para confirmar.',true);return false}
  const currentUser=session.user.id;
  const {data,error}=await supabase.auth.signInWithPassword({email:session.user.email,password:input});
  if(error||data?.user?.id!==currentUser){window.AGRO_APP.notify('Senha incorreta. Operação cancelada.',true);return false}
  return true;
};

const esc = v => String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const setStatus = (text,cls='')=>{ $('syncState').textContent=text; $('syncState').className='sync-state '+cls; $('syncTiny').textContent=text; updateConnectionBanner(); };
const errText = err => (err?.message||String(err||'Erro desconhecido')).replace(/^CONFLITO_VERSAO.*/, 'Conflito de alterações entre dispositivos.');
function gate(open){$('accessGate').classList.toggle('hidden',!open);$('appShell').style.display=open?'none':'';}
function busy(b){$('loginSubmit').disabled=b; $('signUpBtn').disabled=b;}
function showError(msg){$('configAlert').textContent=msg;$('configAlert').classList.remove('hidden');}
function hideError(){$('configAlert').classList.add('hidden');}
function modal(html,confirmText='Salvar',onConfirm){$('dialogBody').innerHTML=html;$('dialogConfirm').textContent=confirmText;$('dialog').classList.remove('hidden');$('dialogConfirm').onclick=async()=>{if(!onConfirm)return closeDialog();try{$('dialogConfirm').disabled=true;await onConfirm();closeDialog()}catch(e){window.AGRO_APP.notify(errText(e),true)}finally{$('dialogConfirm').disabled=false}};}
function closeDialog(){$('dialog').classList.add('hidden')}
$('dialogCancel').onclick=closeDialog;
// Registro-a-registro: compara o estado editado com o último estado confirmado no servidor.
// Só envia alterações efetivas; campos de outros usuários ficam intactos.
const RECORD_TYPES=['lots','animals','health','production','movements'];
const sameRecord=(a,b)=>JSON.stringify(a??null)===JSON.stringify(b??null);
function difference(before,after){
  const operations=[];
  for(const type of RECORD_TYPES){
    const oldMap=new Map((before?.[type]||[]).map(r=>[r.id,r]));
    const newMap=new Map((after?.[type]||[]).map(r=>[r.id,r]));
    for(const [id,previous] of oldMap)if(!newMap.has(id))operations.push({type,id,expected:previous,value:null});
    for(const [id,value] of newMap){const expected=oldMap.get(id)??null;if(!sameRecord(expected,value))operations.push({type,id,expected,value});}
  }
  return operations;
}
function applyOperations(payload,ops){
  const copy=structuredClone(payload);
  for(const op of ops){
    const arr=copy[op.type],i=arr.findIndex(r=>r.id===op.id);
    if(op.value===null){if(i!==-1)arr.splice(i,1)}
    else if(i===-1)arr.push(op.value);
    else arr[i]=op.value;
  }
  return copy;
}
function localKey(id){return `agro_v5_cloud_${session.user.id}_${id}`;}
function metaKey(id){return localKey(id)+'_meta';}
function journalKey(id){return `agro_v6_journal_${session.user.id}_${id}`;}
async function getJournal(id){
 if(window.AGRO_VAULT?.isActive(session.user.id))return await window.AGRO_VAULT.read(session.user.id,id);
 try {const j=JSON.parse(localStorage.getItem(journalKey(id))||'null');
   return j&&j.version===1&&j.payload&&Array.isArray(j.payload.animals)&&Array.isArray(j.payload.lots)?j:null;
 }catch{return null}
}
async function getMeta(id,alreadyLoaded){
 const j=alreadyLoaded===undefined?await getJournal(id):alreadyLoaded;
 if(j)return {revision:j.revision,dirty:j.dirty,baseline:j.baseline};
 if(window.AGRO_VAULT?.isActive(session.user.id))return null;
 try{return JSON.parse(localStorage.getItem(metaKey(id))||'null')}catch{return null}
}
// Um único registro cifrado contém os dados, a revisão e a base de sincronização.
// Não existe fallback para JSON em claro quando o cofre está ativo.
async function saveSnapshot(serialized){
 if(!farm||!session)throw Error('Nenhuma fazenda autorizada.');
 const payload=JSON.parse(serialized);
 const journal={version:1,payload,revision,dirty,baseline,at:new Date().toISOString()};
 if(window.AGRO_VAULT?.isActive(session.user.id)){
   await window.AGRO_VAULT.write(session.user.id,farm.id,journal);
   return;
 }
 localStorage.setItem(journalKey(farm.id),JSON.stringify(journal));
 try {localStorage.setItem(localKey(farm.id),serialized);
   localStorage.setItem(metaKey(farm.id),JSON.stringify({revision,dirty,baseline,at:new Date().toISOString()}));
 } catch(e){window.AGRO_APP.notify('O diário foi salvo, mas o armazenamento está próximo do limite. Faça backup.',true)}
}
window.AGRO_PERSIST_FARM=async serialized=>{
 if(demo||!session||!farm)return;
 const wasDirty=dirty;dirty=true;
 try{await saveSnapshot(serialized)}catch(e){dirty=wasDirty;throw e}
};
async function saveMeta(){
 if(!farm||!session)return;
 try{await saveSnapshot(JSON.stringify(window.AGRO_APP.getFarmState()))}
 catch(e){blocked=true;setStatus('Falha de armazenamento · faça backup','bad');window.AGRO_APP.notify('Não foi possível preservar o estado de sincronização. Faça backup.',true);throw e}
}
function showFarmUI(){
  $('farmSwitcher').innerHTML=farms.map(f=>`<option value="${esc(f.id)}">${esc(f.name)} (${f.role==='owner'?'Proprietário':f.role==='manager'?'Gerente':f.role==='worker'?'Funcionário':'Consulta'})</option>`).join('');
  $('farmSwitcher').value=farm?.id||'';
  $('newFarmBtn').style.display=demo?'none':'';
  $('membersBtn').style.display=demo||farm?.role!=='owner'?'none':'';
  $('farmSwitcher').disabled=demo;
}
async function listFarms(){
  const {data:membership,error:e}=await supabase.from('farm_members').select('farm_id,role');if(e)throw e;
  if(!membership?.length){farms=[];return}
  const ids=membership.map(x=>x.farm_id);
  const {data:rows,error}=await supabase.from('farms').select('id,name').in('id',ids);if(error)throw error;
  farms=(rows||[]).map(f=>({...f,role:membership.find(m=>m.farm_id===f.id)?.role||'viewer'})).sort((a,b)=>a.name.localeCompare(b.name,'pt-BR'));try{localStorage.setItem(knownFarmsKey(session.user.id),JSON.stringify(farms))}catch{}
}
async function openFarm(id){
  if(syncing){window.AGRO_APP.notify('Aguarde o fim da sincronização.',true);return}
  if(farm&&dirty&&!blocked){await sync();if(dirty){window.AGRO_APP.notify('Antes de trocar de fazenda, resolva a sincronização pendente.',true);return}}
  const target=farms.find(x=>x.id===id);if(!target)return;
  window.AGRO_SYNC_ENABLED=false;farm=target;blocked=false;cloudVerified=false;retryAutomatically=true;clearTimeout(syncTimer);
  const key=localKey(id),saved=await getJournal(id),meta=await getMeta(id,saved),cache=saved?JSON.stringify(saved.payload):(window.AGRO_VAULT?.isActive(session.user.id)?null:localStorage.getItem(key));
  const loadCache=()=>{
    if(!cache)throw Error('Não há dados desta fazenda salvos neste dispositivo. Conecte-se à internet.');
    revision=Number(meta?.revision||0);dirty=Boolean(meta?.dirty);
    baseline=meta?.baseline||null;
    window.AGRO_APP.setFarmState(JSON.parse(cache),key);
    if(dirty&&!baseline){blocked=true;setStatus('Backup necessário · alteração antiga','bad');window.AGRO_APP.notify('Alterações locais da versão anterior precisam ser conciliadas antes de sincronizar. Exporte um backup JSON.',true);}
  };
  if(offlineOnly||!navigator.onLine){loadCache();setStatus(blocked?'Conflito · backup necessário':dirty?'Offline · pendente':'Offline · cache',blocked?'bad':'warn')}
  else{
    const {data:remote,error}=await supabase.from('farm_data').select('payload,revision').eq('farm_id',id).single();
    if(error){cloudVerified=false;loadCache();if(!blocked)setStatus('Sem conexão · cache','warn');}
    else if(meta?.dirty&&cache){
      cloudVerified=true;loadCache();
      if(!blocked){setStatus('Edições pendentes','warn');scheduleSync()}
    } else {
      cloudVerified=true;revision=Number(remote.revision);dirty=false;baseline=remote.payload;
      window.AGRO_APP.setFarmState(remote.payload,key);await saveMeta();setStatus('Sincronizado','ok');
    }
  }
  window.AGRO_READONLY=target.role==='viewer';window.AGRO_SYNC_ENABLED=true;showFarmUI();gate(false);
}
function conflictNotice(){
  blocked=true;setStatus('Conflito · ação necessária','bad');
  modal('<h2>Conflito entre dispositivos</h2><p>As alterações locais permanecem preservadas. Faça backup antes de decidir.</p><p class="note">É possível recuperar a cópia da nuvem, mas isso descarta as alterações pendentes deste dispositivo.</p><button type="button" id="recoverCloudBtn" class="btn secondary">Descartar edições locais e recuperar a nuvem</button>', 'Baixar backup local', ()=>{window.AGRO_APP.backup();});
  $('recoverCloudBtn').addEventListener('click',async()=>{
    if(!navigator.onLine)return window.AGRO_APP.notify('Reconecte-se à internet antes de recuperar a nuvem.',true);
    if(!confirm('ATENÇÃO: você já fez backup? As alterações locais pendentes serão DESCARTADAS. Deseja continuar?'))return;
    const {data,error}=await supabase.from('farm_data').select('payload,revision').eq('farm_id',farm.id).single();
    if(error)return window.AGRO_APP.notify('Não foi possível recuperar a nuvem: '+errText(error),true);
    baseline=data.payload;revision=Number(data.revision);dirty=false;blocked=false;retryAutomatically=true;
    window.AGRO_SYNC_ENABLED=false;window.AGRO_APP.setFarmState(data.payload,localKey(farm.id));window.AGRO_SYNC_ENABLED=true;
    await saveMeta();cloudVerified=true;closeDialog();setStatus('Sincronizado','ok');
  });
}
function scheduleSync(){if(offlineOnly||!farm||demo||blocked||!session||window.AGRO_READONLY||!retryAutomatically)return;clearTimeout(syncTimer);clearTimeout(retryTimer);syncTimer=setTimeout(()=>sync(),900)}
async function sync(){
  if(syncing||!dirty||!farm||demo||blocked||!session||offlineOnly)return;
  if(window.AGRO_SAVING){scheduleSync();return}
  if(!navigator.onLine){setStatus('Offline · pendente','warn');return}
  if(!baseline){blocked=true;setStatus('Backup necessário','bad');return}
  syncing=true;setStatus('Sincronizando registros...','warn');
  const before=window.AGRO_APP.getFarmState();
  const ops=difference(baseline,before);
  try{
    let canonical;
    if(ops.length){
      // Uma transação PostgreSQL aplica todas as alterações ou nenhuma.
      const {data,error}=await supabase.rpc('agro_apply_changes_v54',{p_farm:farm.id,p_operations:ops});
      if(error){
        if(/CONFLITO_REGISTRO|CONFLITO_VERSAO/i.test(error.message)){
          // Uma requisição pode ter sido aplicada e a resposta pode ter se perdido.
          // Se TODOS os valores já estiverem no servidor, reconheça o envio como concluído.
          const check=await supabase.from('farm_data').select('payload,revision').eq('farm_id',farm.id).single();
          const reflected=!check.error&&ops.every(op=>{
            const record=check.data.payload?.[op.type]?.find(r=>r.id===op.id)??null;
            return sameRecord(record,op.value);
          });
          if(!reflected){conflictNotice();return}
          canonical=check.data.payload;revision=Number(check.data.revision);
        } else throw error;
      } else {canonical=data.payload;revision=Number(data.revision)}
    }else{
      const {data,error}=await supabase.from('farm_data').select('payload,revision').eq('farm_id',farm.id).single();
      if(error)throw error;canonical=data.payload;revision=Number(data.revision);
    }
    // Preserva qualquer edição feita no navegador enquanto a requisição estava em andamento.
    const later=difference(before,window.AGRO_APP.getFarmState());
    const merged=applyOperations(canonical,later);
    baseline=canonical;dirty=later.length>0;cloudVerified=true;
    window.AGRO_SYNC_ENABLED=false;
    window.AGRO_APP.setFarmState(merged,localKey(farm.id));
    window.AGRO_SYNC_ENABLED=true;
    await saveMeta();retryCount=0;clearTimeout(retryTimer);
    setStatus(dirty?'Novas alterações pendentes':'Sincronizado',dirty?'warn':'ok');
  }catch(e){
    cloudVerified=false;setStatus('Alterações salvas · envio pendente','warn');
    window.AGRO_APP.notify('Não foi possível enviar agora: '+errText(e),true);
    // Tentativa com espera progressiva; não descarta alterações nem faz loop agressivo.
    retryCount=Math.min(retryCount+1,6);retryAutomatically=false;
    clearTimeout(retryTimer);
    if(dirty&&!blocked&&navigator.onLine)retryTimer=setTimeout(()=>{retryAutomatically=true;sync()},Math.min(60000,2500*2**(retryCount-1)));
  }finally{syncing=false;updateConnectionBanner();if(dirty&&!blocked&&retryAutomatically&&navigator.onLine)scheduleSync();}
}
window.addEventListener('agro:changed',()=>{if(!farm||demo)return;retryAutomatically=true;setStatus(navigator.onLine?'Alterações pendentes':'Offline · pendente','warn');scheduleSync()});
window.addEventListener('online',()=>{
  cloudVerified=false;retryAutomatically=true;retryCount=0;clearTimeout(retryTimer);
  if(offlineOnly){setStatus('Online disponível · faça login','warn');return}
  if(dirty)scheduleSync();
  else if(farm&&!demo&&!syncing){setStatus('Conectado · atualizando','warn');$('syncNowBtn').click()}
});
window.addEventListener('offline',()=>{cloudVerified=false;if(farm)setStatus('Offline','warn')});
// Consulta periodicamente alterações de outros dispositivos sem sobrescrever edições locais pendentes.
let lastBackgroundCheck=0;
function refreshInBackground(){
 if(document.hidden||locked||offlineOnly||demo||!navigator.onLine||!session||!farm||dirty||blocked||syncing||window.AGRO_SAVING)return;
 const now=Date.now();if(now-lastBackgroundCheck<90000)return;lastBackgroundCheck=now;
 $('syncNowBtn').click();
}
setInterval(refreshInBackground,120000);
window.addEventListener('focus',refreshInBackground);
async function createFarm(name){
  const {data,error}=await supabase.rpc('create_agro_farm',{p_name:name});if(error)throw error;
  await listFarms();await openFarm(data);
}
function promptFarm(){modal('<h2>Nova fazenda</h2><p>Os registros desta propriedade ficarão separados das demais.</p><label>Nome da fazenda<input id="farmNameInput" maxlength="120" placeholder="Fazenda Santa Rosa" required></label>','Criar fazenda',async()=>{const name=$('farmNameInput').value.trim();if(name.length<2)throw Error('Informe um nome com pelo menos 2 caracteres.');await createFarm(name)});}
async function afterLogin(){
  hideError();session=(await supabase.auth.getSession()).data.session;
  if(!session){gate(true);updateConnectionBanner();return}
  offlineOnly=false;$('newFarmBtn').disabled=false;$('membersBtn').disabled=false;
  if(window.AGRO_VAULT?.metadata())await unlockVaultForUser(session.user.id);
  beginIdleMonitoring();
  $('logoutBtn').textContent='Sair';
  if(!navigator.onLine){
    const raw=localStorage.getItem(knownFarmsKey(session.user.id));
    try{farms=raw?JSON.parse(raw):[]}catch{farms=[]}
    if(!farms.length)throw Error('Nenhuma fazenda foi sincronizada neste dispositivo. Entre com internet.');
  }else {try{await listFarms()}catch(err){
     const raw=localStorage.getItem(knownFarmsKey(session.user.id));
     if(!raw)throw err;farms=JSON.parse(raw);setStatus('Sem acesso à nuvem · cache','warn');
   }}
  if(!farms.length){gate(false);window.AGRO_READONLY=true;window.AGRO_SYNC_ENABLED=false;farm=null;window.AGRO_APP.setFarmState(empty(),'agrocontrol_v5_empty');setStatus('Crie sua fazenda','warn');showFarmUI();promptFarm();return}
  const stored=localStorage.getItem(`agro_v5_lastfarm_${session.user.id}`);
  await openFarm(farms.find(f=>f.id===stored)?.id||farms[0].id);
}
$('loginForm').addEventListener('submit',async e=>{e.preventDefault();if(offlineOnly)return showError('No modo offline, utilize a senha local abaixo.');if(!configured)return showError('Configure o arquivo config.js com a URL e a chave publicável do seu projeto Supabase.');busy(true);hideError();try{const {data,error}=await supabase.auth.signInWithPassword({email:$('loginEmail').value.trim(),password:$('loginPassword').value});if(error)throw error;
    if(locked && data.user?.id!==session?.user?.id)throw Error('A conta informada não corresponde à sessão bloqueada.');
    if(!locked)setRemember($('rememberMe').checked);
    resetGate();clearPassword();await afterLogin()
  }catch(err){showError('Falha no login: '+errText(err))}finally{busy(false)}});
$('signUpBtn').onclick=async()=>{if(!configured)return showError('Configure o Supabase primeiro.');const email=$('loginEmail').value.trim(),password=$('loginPassword').value;if(!email||!password)return showError('Informe e-mail e senha (mínimo de 6 caracteres) para criar conta.');busy(true);try{const {data,error}=await supabase.auth.signUp({email,password});if(error)throw error;if(!data.session)showError('Conta criada! Confira seu e-mail para confirmar a conta antes de entrar.');else {setRemember($('rememberMe').checked);clearPassword();await afterLogin()}}catch(e){showError(errText(e))}finally{busy(false)}};
$('resetPasswordBtn').onclick=async()=>{if(!configured)return showError('Configure o Supabase primeiro.');const email=$('loginEmail').value.trim();if(!email)return showError('Informe seu e-mail para recuperar a senha.');const {error}=await supabase.auth.resetPasswordForEmail(email,{redirectTo:location.origin+location.pathname});showError(error?errText(error):'Se a conta existir, você receberá as instruções de recuperação por e-mail.');};
$('demoBtn').onclick=()=>{demo=true;farm=null;session=null;window.AGRO_READONLY=false;window.AGRO_APP.clearDemo();gate(false);$('farmSwitcher').innerHTML='<option>DEMONSTRAÇÃO LOCAL</option>';showFarmUI();setStatus('Demonstração · local','warn');};
$('newFarmBtn').onclick=()=>{if(!session)return;promptFarm()};
$('farmSwitcher').onchange=async e=>{try{await openFarm(e.target.value);if(farm)localStorage.setItem(`agro_v5_lastfarm_${session.user.id}`,farm.id)}catch(err){window.AGRO_APP.notify(errText(err),true);showFarmUI()}};
$('membersBtn').onclick=()=>{if(!farm||farm.role!=='owner')return;modal('<h2>Conceder acesso à equipe</h2><p>O colaborador precisa ter criado e confirmado sua conta antes.</p><label>E-mail do colaborador<input id="memberEmail" type="email" placeholder="colaborador@exemplo.com"></label><label>Permissão<select id="memberRole"><option value="manager">Gerente — pode editar</option><option value="worker">Funcionário — pode editar</option><option value="viewer">Consulta — somente leitura</option></select></label><p class="note">Nesta versão, gerente e funcionário possuem o mesmo direito de editar dados; o proprietário controla os convites.</p>','Conceder acesso',async()=>{const {error}=await supabase.rpc('add_agro_member',{p_farm:farm.id,p_email:$('memberEmail').value.trim(),p_role:$('memberRole').value});if(error)throw error;window.AGRO_APP.notify('Acesso atualizado com sucesso.')})};
$('logoutBtn').onclick=async()=>{
  if(offlineOnly)return window.AGRO_APP.notify('Entre na conta online antes de sair ou faça backup das edições pendentes.',true);
  if(farm&&dirty&&!blocked){await sync();if(dirty)return window.AGRO_APP.notify('Sincronização pendente. Faça backup antes de sair.',true)}
  if(farm&&blocked){if(!confirm('Existe conflito de sincronização. Baixe um backup dos dados locais antes de sair. Deseja sair mesmo assim?'))return}
  const oldUser=session?.user?.id;
  if(supabase){const {error}=await supabase.auth.signOut();if(error){window.AGRO_APP.notify('Não foi possível encerrar a sessão: '+errText(error),true);return}}
  window.AGRO_SYNC_ENABLED=false;window.AGRO_READONLY=false;farm=null;farms=[];dirty=false;demo=false;blocked=false;baseline=null;cloudVerified=false;
  clearTimeout(syncTimer);clearTimeout(retryTimer);clearInterval(idleHandle);
  window.AGRO_APP.setFarmState(empty(),'agrocontrol_v5_empty');clearLocalFarmCaches(oldUser);
  session=null;localStorage.removeItem(REMEMBER_KEY);localStorage.removeItem(OFFLINE_CREDENTIAL_KEY);refreshOfflineAccess();resetGate();clearPassword();$('rememberMe').checked=false;
  gate(true);setStatus('Desconectado');
};

// Cofre local: AES-256-GCM, chave derivada de senha com PBKDF2.
// Não envia a senha local ao Supabase; a revogação de permissões só é verificada online.
const OFFLINE_CREDENTIAL_KEY='agro_v61_offline_credential';
const bytesTo64=b=>btoa(String.fromCharCode(...new Uint8Array(b)));
const base64ToBytes=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
async function deriveOfflinePassword(pass,salt){
 const material=await crypto.subtle.importKey('raw',new TextEncoder().encode(pass),'PBKDF2',false,['deriveBits']);
 return new Uint8Array(await crypto.subtle.deriveBits({name:'PBKDF2',salt,iterations:260000,hash:'SHA-256'},material,256));
}
function refreshOfflineAccess(){
 const box=$('offlineUnlockBox');if(!box)return;
 const active=Boolean(window.AGRO_VAULT?.metadata());
 box.classList.toggle('hidden',!active&&!localStorage.getItem(OFFLINE_CREDENTIAL_KEY));
 if($('offlineSetBtn'))$('offlineSetBtn').textContent=active?'Cofre criptografado ativo':'Ativar cofre criptografado offline';
}
function requestVaultPassword(){
 return new Promise((resolve,reject)=>{
  const dialog=$('dialog'),body=$('dialogBody'),yes=$('dialogConfirm'),no=$('dialogCancel');
  let finished=false;
  const close=(err)=>{if(finished)return;finished=true;dialog.classList.add('hidden');no.onclick=closeDialog;yes.onclick=null;err?reject(err):resolve()};
  body.innerHTML='<h2>Desbloquear cofre local</h2><p>Digite a senha LOCAL cadastrada neste aparelho para proteger e recuperar os dados da fazenda.</p><label>Senha local<input id="vaultPromptPass" type="password" autocomplete="off" style="width:100%;padding:12px;margin-top:6px"></label><p id="vaultPromptError" class="note" aria-live="polite"></p>';
  yes.textContent='Desbloquear';yes.disabled=false;
  yes.onclick=async()=>{
   yes.disabled=true;
   try{await window.AGRO_VAULT.unlock($('vaultPromptPass').value);$('vaultPromptPass').value='';close()}
   catch(e){$('vaultPromptError').textContent=errText(e);yes.disabled=false}
  };
  no.onclick=()=>close(new Error('Cofre bloqueado. Abra-o para carregar os dados locais.'));
  dialog.classList.remove('hidden');$('vaultPromptPass').focus();
  $('vaultPromptPass').onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();yes.click()}};
 });
}
async function unlockVaultForUser(id){
 const info=window.AGRO_VAULT?.metadata();if(!info)return;
 if(info.userId!==id)throw Error('Este dispositivo possui um cofre de outra conta. Faça backup antes de trocar de usuário.');
 if(!window.AGRO_VAULT.isUnlocked(id))await requestVaultPassword();
}
$('offlineSetBtn').addEventListener('click',async()=>{
 if(window.AGRO_SAVING||syncing)return window.AGRO_APP.notify('Aguarde o salvamento ou a sincronização terminar antes de ativar o cofre.',true);
 if(!session||offlineOnly||demo||!farm||!configured)return window.AGRO_APP.notify('Entre online e abra uma fazenda antes de configurar a proteção local.',true);
 if(window.AGRO_VAULT.metadata())return window.AGRO_APP.notify('O cofre já está ativo. Os dados estão protegidos neste aparelho.');
 if(!window.AGRO_VAULT.supported())return window.AGRO_APP.notify('Criptografia não disponível neste dispositivo.',true);
 modal('<h2>Proteger dados deste aparelho</h2><p>Esta senha local serve para criptografar os registros já armazenados. Ela não é recuperável: faça backup e guarde-a em um lugar seguro.</p><label>Nova senha local (mínimo 10 caracteres)<input id="newVaultPass" type="password" autocomplete="new-password" minlength="10"></label><label>Confirme a senha local<input id="confirmVaultPass" type="password" autocomplete="new-password" minlength="10"></label>', 'Ativar cofre', async()=>{
  const pass=$('newVaultPass').value;
  if(pass.length<10)throw Error('Use pelo menos 10 caracteres.');
  if(pass!==$('confirmVaultPass').value)throw Error('As senhas não correspondem.');
  await saveMeta();
  const count=await window.AGRO_VAULT.setup(pass,session.user.id,session.user.email,farms);
  $('newVaultPass').value='';$('confirmVaultPass').value='';
  refreshOfflineAccess();$('offlineSetBtn').textContent='Cofre criptografado ativo';
  window.AGRO_APP.notify(`Cofre ativado: ${count} fazenda(s) cifrada(s). Guarde a senha e faça backup externo.`);
 });
});
let offlineWrongTries=0;
$('offlineUnlockBtn').addEventListener('click',async()=>{
 const btn=$('offlineUnlockBtn');if(offlineWrongTries>=5)return showError('Muitas tentativas. Feche e reabra o aplicativo mais tarde.');
 const pass=$('offlinePass').value;
 btn.disabled=true;
 try{
  if(!window.AGRO_VAULT.supported())throw Error('Criptografia indisponível neste dispositivo.');
  let cred=window.AGRO_VAULT.metadata();
  if(cred){await window.AGRO_VAULT.unlock(pass)}
  else{
   const raw=localStorage.getItem(OFFLINE_CREDENTIAL_KEY);if(!raw)throw Error('Nenhuma senha local cadastrada.');
   const legacy=JSON.parse(raw),test=await deriveOfflinePassword(pass,base64ToBytes(legacy.salt)),expected=base64ToBytes(legacy.verifier);
   if(test.length!==expected.length||test.some((v,i)=>v!==expected[i]))throw Error('Senha local incorreta.');
   const cached=JSON.parse(localStorage.getItem(knownFarmsKey(legacy.userId))||'[]');
   if(pass.length<10)throw Error('Esta senha antiga tem menos de 10 caracteres. Entre online e configure um novo cofre antes de usar offline.');
   await window.AGRO_VAULT.setup(pass,legacy.userId,legacy.email,cached);
   cred=window.AGRO_VAULT.metadata();
  }
  const rawFarms=localStorage.getItem(knownFarmsKey(cred.userId));const list=rawFarms?JSON.parse(rawFarms):[];
  if(!list.length)throw Error('Nenhuma fazenda salva neste aparelho. Faça login online.');
  offlineWrongTries=0;demo=false;offlineOnly=true;locked=false;
  clearPassword();$('offlinePass').value='';session={user:{id:cred.userId,email:cred.email}};supabase=null;farms=list;
  beginIdleMonitoring();
  const preferred=localStorage.getItem(`agro_v5_lastfarm_${cred.userId}`);
  await openFarm(farms.some(f=>f.id===preferred)?preferred:farms[0].id);
  $('newFarmBtn').disabled=true;$('membersBtn').disabled=true;
  document.body.classList.remove('lock-enabled');hideError();gate(false);setStatus(dirty?'Offline · alterações pendentes':'Offline · dados cifrados','warn');updateConnectionBanner();
 }catch(e){offlineWrongTries++;showError(errText(e))}finally{btn.disabled=false}
});
$('offlinePass').addEventListener('keydown',e=>{if(e.key==='Enter'){$('offlineUnlockBtn').click();e.preventDefault()}});
async function init(){
  gate(true);window.AGRO_READONLY=false;window.AGRO_SYNC_ENABLED=false;$('rememberMe').checked=remember();refreshOfflineAccess();
  if(!configured){showError('Supabase ainda não configurado. Você pode explorar a demonstração local ou preencher config.js para ativar login e nuvem.');return}
  try{
    // O service worker deve controlar esta aba antes do primeiro import online.
    // Isso permite que as dependências sejam armazenadas para o uso subsequente offline.
    if(window.AGRO_SW_READY)await Promise.race([window.AGRO_SW_READY,new Promise(resolve=>setTimeout(resolve,4000))]);
    const module=await import('https://esm.sh/@supabase/supabase-js@2');
    supabase=module.createClient(cfg.supabaseUrl,cfg.supabasePublishableKey,{auth:{persistSession:true,storage:authStorage,autoRefreshToken:true,detectSessionInUrl:true}});
    await afterLogin();
  }catch(e){showError('Autenticação online indisponível. Se você configurou uma senha local, use o acesso offline abaixo. Detalhe: '+errText(e));refreshOfflineAccess();}
}
init();
