/* AgroControl 6.0 RC — PWA, operação conectada e cache local. Nunca utilize service_role no navegador. */
const $ = id => document.getElementById(id);
const cfg = window.AGRO_CONFIG || {};
const configured = Boolean(cfg.supabaseUrl && cfg.supabasePublishableKey);
let supabase = null, session = null, farm = null, farms = [], revision = 0, dirty = false, syncing = false, demo = false, blocked = false, syncTimer = 0, retryAutomatically = true, baseline = null;
const CACHED_FARMS_PREFIX='agro_v6_farms_';
const knownFarmsKey=userId=>CACHED_FARMS_PREFIX+userId;
const connectedLabel=()=>navigator.onLine?'Online':'Sem internet';
function updateConnectionBanner(){
 const banner=$('connectionBanner');if(!banner)return;
 let title='',detail='',cls='';
 if(demo){title='Demonstração local';detail='Os registros desta demonstração não vão para o Supabase.';cls='warn'}
 else if(!session){title='Entre na sua conta';detail='O primeiro acesso e a recuperação de conta exigem internet.';cls='warn'}
 else if(blocked){title='Conflito de sincronização';detail='Preserve um backup e resolva o conflito antes de continuar.';cls='bad'}
 else if(dirty){title=navigator.onLine?'Existem alterações aguardando envio':'Trabalhando sem internet';detail='Registros locais pendentes: faça backup e sincronize ao reconectar.';cls='warn'}
 else if(!navigator.onLine){title='Sem internet · dados salvos neste dispositivo';detail='Apenas registros já carregados estão disponíveis; a sincronização está suspensa.';cls='warn'}
 else{title='Conectado ao Supabase';detail='Status da fazenda: '+(farm?$('syncState').textContent:'aguardando seleção')}
 banner.className='connection-banner '+cls;$('connectionTitle').textContent=title;$('connectionDetail').textContent=detail;
 $('syncNowBtn').disabled=demo||!session||!farm||syncing||blocked;
}
$('connectionBackup').addEventListener('click',()=>window.AGRO_APP.backup());
$('syncNowBtn').addEventListener('click',async()=>{
 if(demo||!session||!farm)return;
 if(!navigator.onLine)return window.AGRO_APP.notify('Sem internet: alterações permanecem no dispositivo.',true);
 retryAutomatically=true;
 if(dirty)await sync();
 else {
   const {data,error}=await supabase.from('farm_data').select('payload,revision').eq('farm_id',farm.id).single();
   if(error)return window.AGRO_APP.notify('Falha ao consultar a nuvem: '+errText(error),true);
   if(revision!==Number(data.revision)){
     baseline=data.payload;revision=Number(data.revision);dirty=false;
     window.AGRO_SYNC_ENABLED=false;window.AGRO_APP.setFarmState(data.payload,localKey(farm.id));window.AGRO_SYNC_ENABLED=true;
     localStorage.setItem(localKey(farm.id),JSON.stringify(data.payload));saveMeta();
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
  showError('Sessão bloqueada por inatividade. Digite sua senha para continuar.');gate(true);
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
  const prefix=`agro_v5_cloud_${userId}_`;
  for(const key of Object.keys(localStorage))if(key.startsWith(prefix))localStorage.removeItem(key);
  localStorage.removeItem(`agro_v5_lastfarm_${userId}`);localStorage.removeItem(knownFarmsKey(userId));
}
// Confirma a identidade no Supabase antes de ações destrutivas.
window.AGRO_REQUIRE_PASSWORD=async purpose=>{
  if(demo)return true;
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
function getMeta(id){try{return JSON.parse(localStorage.getItem(metaKey(id))||'null')}catch{return null}}
function saveMeta(){if(!farm)return;try{localStorage.setItem(metaKey(farm.id),JSON.stringify({revision,dirty,baseline,at:new Date().toISOString()}));}catch(e){window.AGRO_APP.notify('Não há espaço para guardar o ponto de sincronização local. Faça backup.',true);blocked=true;}}
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
  window.AGRO_SYNC_ENABLED=false;farm=target;blocked=false;retryAutomatically=true;clearTimeout(syncTimer);
  const key=localKey(id),meta=getMeta(id),cache=localStorage.getItem(key);
  const loadCache=()=>{
    if(!cache)throw Error('Não há dados desta fazenda salvos neste dispositivo. Conecte-se à internet.');
    revision=Number(meta?.revision||0);dirty=Boolean(meta?.dirty);
    baseline=meta?.baseline||null;
    window.AGRO_APP.setFarmState(JSON.parse(cache),key);
    if(dirty&&!baseline){blocked=true;setStatus('Backup necessário · alteração antiga','bad');window.AGRO_APP.notify('Alterações locais da versão anterior precisam ser conciliadas antes de sincronizar. Exporte um backup JSON.',true);}
  };
  if(!navigator.onLine){loadCache();setStatus(blocked?'Conflito · backup necessário':dirty?'Offline · pendente':'Offline · cache',blocked?'bad':'warn')}
  else{
    const {data:remote,error}=await supabase.from('farm_data').select('payload,revision').eq('farm_id',id).single();
    if(error){loadCache();if(!blocked)setStatus('Sem conexão · cache','warn');}
    else if(meta?.dirty&&cache){
      loadCache();
      if(!blocked){setStatus('Edições pendentes','warn');scheduleSync()}
    } else {
      revision=Number(remote.revision);dirty=false;baseline=remote.payload;
      window.AGRO_APP.setFarmState(remote.payload,key);localStorage.setItem(key,JSON.stringify(remote.payload));saveMeta();setStatus('Sincronizado','ok');
    }
  }
  window.AGRO_READONLY=target.role==='viewer';window.AGRO_SYNC_ENABLED=true;showFarmUI();gate(false);
}
function conflictNotice(){
  blocked=true;setStatus('Conflito · ação necessária','bad');
  modal('<h2>Alterações simultâneas detectadas</h2><p>Outro dispositivo salvou dados enquanto você editava esta fazenda. Seus dados locais não foram apagados.</p><p><strong>Primeiro baixe um backup local</strong>. Depois você pode descartar as alterações locais e carregar a versão da nuvem. Não há mesclagem automática nesta versão.</p><p class="note">Se você precisar preservar as duas versões, solicite uma conciliação antes de continuar.</p>','Baixar backup',()=>{window.AGRO_APP.backup();});
}
function scheduleSync(){if(!farm||demo||blocked||!session||window.AGRO_READONLY||!retryAutomatically)return;clearTimeout(syncTimer);syncTimer=setTimeout(()=>sync(),900)}
async function sync(){
  if(syncing||!dirty||!farm||demo||blocked||!session)return;
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
      if(error){if(/CONFLITO_REGISTRO|CONFLITO_VERSAO/i.test(error.message)){conflictNotice();return}throw error}
      canonical=data.payload;revision=Number(data.revision);
    }else{
      const {data,error}=await supabase.from('farm_data').select('payload,revision').eq('farm_id',farm.id).single();
      if(error)throw error;canonical=data.payload;revision=Number(data.revision);
    }
    // Preserva qualquer edição feita no navegador enquanto a requisição estava em andamento.
    const later=difference(before,window.AGRO_APP.getFarmState());
    const merged=applyOperations(canonical,later);
    baseline=canonical;dirty=later.length>0;
    window.AGRO_SYNC_ENABLED=false;
    window.AGRO_APP.setFarmState(merged,localKey(farm.id));
    window.AGRO_SYNC_ENABLED=true;
    localStorage.setItem(localKey(farm.id),JSON.stringify(merged));saveMeta();
    setStatus(dirty?'Novas alterações pendentes':'Sincronizado',dirty?'warn':'ok');
  }catch(e){retryAutomatically=false;setStatus('Pendente · erro de sincronização','warn');window.AGRO_APP.notify('Falha ao sincronizar: '+errText(e),true)}
  finally{syncing=false;if(dirty&&!blocked&&retryAutomatically&&navigator.onLine)scheduleSync();}
}
window.addEventListener('agro:changed',()=>{if(!farm||demo)return;retryAutomatically=true;dirty=true;saveMeta();setStatus(navigator.onLine?'Alterações pendentes':'Offline · pendente','warn');scheduleSync()});
window.addEventListener('online',()=>{retryAutomatically=true;if(dirty)scheduleSync();else if(farm)setStatus('Conectado · verifique dados','warn')});
window.addEventListener('offline',()=>{if(farm)setStatus('Offline','warn')});
async function createFarm(name){
  const {data,error}=await supabase.rpc('create_agro_farm',{p_name:name});if(error)throw error;
  await listFarms();await openFarm(data);
}
function promptFarm(){modal('<h2>Nova fazenda</h2><p>Os registros desta propriedade ficarão separados das demais.</p><label>Nome da fazenda<input id="farmNameInput" maxlength="120" placeholder="Fazenda Santa Rosa" required></label>','Criar fazenda',async()=>{const name=$('farmNameInput').value.trim();if(name.length<2)throw Error('Informe um nome com pelo menos 2 caracteres.');await createFarm(name)});}
async function afterLogin(){
  hideError();session=(await supabase.auth.getSession()).data.session;
  if(!session){gate(true);updateConnectionBanner();return}
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
$('loginForm').addEventListener('submit',async e=>{e.preventDefault();if(!configured)return showError('Configure o arquivo config.js com a URL e a chave publicável do seu projeto Supabase.');busy(true);hideError();try{const {data,error}=await supabase.auth.signInWithPassword({email:$('loginEmail').value.trim(),password:$('loginPassword').value});if(error)throw error;
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
  if(farm&&dirty&&!blocked){await sync();if(dirty)return window.AGRO_APP.notify('Sincronização pendente. Faça backup antes de sair.',true)}
  if(farm&&blocked){if(!confirm('Existe conflito de sincronização. Baixe um backup dos dados locais antes de sair. Deseja sair mesmo assim?'))return}
  const oldUser=session?.user?.id;
  if(supabase){const {error}=await supabase.auth.signOut();if(error){window.AGRO_APP.notify('Não foi possível encerrar a sessão: '+errText(error),true);return}}
  window.AGRO_SYNC_ENABLED=false;window.AGRO_READONLY=false;farm=null;farms=[];dirty=false;demo=false;blocked=false;baseline=null;
  clearTimeout(syncTimer);clearInterval(idleHandle);
  window.AGRO_APP.setFarmState(empty(),'agrocontrol_v5_empty');clearLocalFarmCaches(oldUser);
  session=null;localStorage.removeItem(REMEMBER_KEY);resetGate();clearPassword();$('rememberMe').checked=false;
  gate(true);setStatus('Desconectado');
};
async function init(){
  gate(true);window.AGRO_READONLY=false;window.AGRO_SYNC_ENABLED=false;$('rememberMe').checked=remember();
  if(!configured){showError('Supabase ainda não configurado. Você pode explorar a demonstração local ou preencher config.js para ativar login e nuvem.');return}
  try{
    const module=await import('https://esm.sh/@supabase/supabase-js@2');
    supabase=module.createClient(cfg.supabaseUrl,cfg.supabasePublishableKey,{auth:{persistSession:true,storage:authStorage,autoRefreshToken:true,detectSessionInUrl:true}});
    await afterLogin();
  }catch(e){showError('Não foi possível iniciar a autenticação: '+errText(e)+'. Na primeira ativação ou após encerrar a sessão, conecte-se à internet.');}
}
init();
