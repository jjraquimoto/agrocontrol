/* AgroControl • navegação mobile e tabelas responsivas.
   Não lê/edita dados do usuário, nem interfere no Supabase. */
(() => {
  'use strict';
  if (window.__AGRO_MOBILE_LOADED__) return;
  window.__AGRO_MOBILE_LOADED__ = true;
  const pages = [
    ['dashboard', 'Início', '⌂'],
    ['herd', 'Rebanho', '🐄'],
    ['lots', 'Lotes', '▦'],
    ['health', 'Sanidade', '✚'],
    ['production', 'Produção', '◈'],
    ['movements', 'Movimentações', '⇄'],
    ['reports', 'Relatórios', '▤'],
    ['backup', 'Dados e backup', '⚙']
  ];
  const quick = ['dashboard', 'herd', 'health', 'production'];
  const app = document.querySelector('#appShell');
  if (!app || !document.querySelector('.sidebar .nav')) return;

  const header = document.createElement('header');
  header.className = 'mobile-header no-print';
  header.innerHTML = '<div class="mobile-header__brand"><span class="mobile-header__symbol" aria-hidden="true">🌾</span><div><div class="mobile-header__name">AgroControl</div><span id="mobileSyncStatus" class="mobile-header__sync" role="status" aria-live="polite">Aguardando</span></div></div><button class="mobile-header__button" type="button" aria-haspopup="dialog" aria-expanded="false">☰ Menu</button>';
  app.prepend(header);

  const dock = document.createElement('nav');
  dock.className = 'mobile-dock no-print';
  dock.setAttribute('aria-label', 'Navegação rápida');
  quick.forEach(id => {
    const p = pages.find(p => p[0] === id);
    const b = document.createElement('button');
    b.type = 'button';b.dataset.mobileTarget = id;
    b.innerHTML = `<span class="mobile-dock__icon" aria-hidden="true">${p[2]}</span><span class="mobile-dock__label">${p[1]}</span>`;
    b.setAttribute('aria-label', p[1]);
    dock.append(b);
  });
  const moreBtn = document.createElement('button');
  moreBtn.type = 'button';moreBtn.dataset.mobileMore = 'true';
  moreBtn.innerHTML = '<span class="mobile-dock__icon" aria-hidden="true">☷</span><span class="mobile-dock__label">Mais</span>';
  dock.append(moreBtn);
  document.body.append(dock);

  const overlay = document.createElement('div');
  overlay.className = 'mobile-more-overlay no-print';
  overlay.setAttribute('aria-hidden', 'true');
  overlay.innerHTML = '<section class="mobile-more-sheet" role="dialog" aria-modal="true" aria-label="Menu do AgroControl"><div class="mobile-more-sheet__head">Todas as áreas <button type="button" data-close-menu aria-label="Fechar menu">×</button></div><div class="mobile-more-grid"></div><div class="mobile-account-section"><strong>Conta e fazendas</strong><div class="mobile-account-actions"></div></div></section>'; 
  const grid = overlay.querySelector('.mobile-more-grid');
  pages.forEach(([id, label, icon]) => {
    const b = document.createElement('button');
    b.type = 'button';b.dataset.mobileTarget = id;
    b.innerHTML = `<span class="mobile-more-grid__icon" aria-hidden="true">${icon}</span><span class="mobile-more-grid__label">${label}</span>`;
    grid.append(b);
  });
  document.body.append(overlay);
  // Ações secundárias ficam no menu em telas pequenas, liberando espaço para o trabalho.
  const toolbar = document.querySelector('.account-toolbar');
  const accountActions = [document.getElementById('newFarmBtn'),document.getElementById('membersBtn'),document.getElementById('logoutBtn')].filter(Boolean);
  const accountSlot = overlay.querySelector('.mobile-account-actions');
  function reorganize(){
    const mobile = window.matchMedia('(max-width: 900px)').matches;
    if(mobile){
      accountActions.forEach(b=>accountSlot.append(b));
    } else {
      const syncState = document.getElementById('syncState');
      if(toolbar){
        accountActions.slice(0,2).forEach(b=>toolbar.insertBefore(b,syncState));
        if(accountActions[2])toolbar.append(accountActions[2]);
      }
      if(isOpen())setOpen(false);
    }
  }
  window.addEventListener('resize',reorganize,{passive:true});
  const isOpen = () => overlay.classList.contains('is-open');
  reorganize();
  function setOpen(yes) {
    overlay.classList.toggle('is-open', yes);
    overlay.setAttribute('aria-hidden', String(!yes));
    header.querySelector('button').setAttribute('aria-expanded', String(yes));
    moreBtn.setAttribute('aria-expanded', String(yes));
    document.documentElement.classList.toggle('agro-menu-open', yes);
    if (yes) overlay.querySelector('[data-close-menu]').focus();
    else header.querySelector('button').focus({preventScroll:true});
  }
  header.querySelector('button').addEventListener('click',()=>setOpen(!isOpen()));
  moreBtn.addEventListener('click',()=>setOpen(!isOpen()));
  overlay.querySelector('[data-close-menu]').addEventListener('click',()=>setOpen(false));
  overlay.addEventListener('click',e=>{if(e.target===overlay || e.target.closest('.mobile-account-actions button'))setOpen(false)});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&isOpen())setOpen(false)});

  function navigate(id) {
    const orig = document.querySelector(`.sidebar .nav button[data-page="${id}"]`);
    if (!orig) return;
    // Dispara o controlador existente do AgroControl: não duplica regras de negócio.
    orig.click();
    if (isOpen()) setOpen(false);
    requestAnimationFrame(updateActive);
  }
  [dock,grid].forEach(el=>el.addEventListener('click',e=>{
    const b=e.target.closest('button[data-mobile-target]');
    if(b)navigate(b.dataset.mobileTarget);
  }));
  function updateActive() {
    const selected=document.querySelector('.sidebar .nav button.active')?.dataset.page||'dashboard';
    for (const b of document.querySelectorAll('[data-mobile-target]')) {
      const active=b.dataset.mobileTarget===selected;
      b.classList.toggle('active',active);
      if(active)b.setAttribute('aria-current','page');
      else b.removeAttribute('aria-current');
    }
    moreBtn.classList.toggle('active',!quick.includes(selected));
  }
  const nav=document.querySelector('.sidebar .nav');
  new MutationObserver(updateActive).observe(nav,{attributes:true,attributeFilter:['class'],subtree:true});

  // O sistema substitui o conteúdo de tbody após cada cadastro: remarca rótulos em tempo real.
  function decorateTables() {
    for(const table of document.querySelectorAll('.table-wrap table')) {
      const heads=[...table.querySelectorAll('thead th')].map(th=>th.textContent.trim().replace(/\s+/g,' '));
      for(const row of table.querySelectorAll('tbody tr')){
        const cells=[...row.children].filter(c=>c.tagName==='TD');
        cells.forEach((cell,index)=>{
          if(cell.colSpan>1) return;
          const title=heads[index]||`Campo ${index+1}`;
          if(cell.dataset.label!==title)cell.dataset.label=title;
          cell.classList.toggle('actions-cell',/^(ações|acao|ações\s*)$/i.test(title));
        });
      }
    }
  }
  let queued=false;
  function scheduleDecorate(){if(queued)return;queued=true;requestAnimationFrame(()=>{queued=false;decorateTables()})}
  new MutationObserver(scheduleDecorate).observe(app,{childList:true,subtree:true});
  decorateTables();updateActive();
})();
