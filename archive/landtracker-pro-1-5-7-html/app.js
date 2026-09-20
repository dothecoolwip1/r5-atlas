(() => {
  'use strict';

  const { LandTrackerEngine, formatDls, formatLatLon, formatBcnts, constants } = globalThis.LandTrackerCore;
  const engine = new LandTrackerEngine('data');
  const STORAGE = {
    HISTORY: 'ltpro-html-history',
    FAVORITES: 'ltpro-html-favorites',
    FAVORITE_SORT: 'ltpro-html-favorite-sort',
    DETAILED_LOCATION: 'ltpro-html-detailed-location',
    EXPORT_LABELS: 'ltpro-html-export-labels'
  };
  const MAX_HISTORY = 100;
  const VISIBLE_HISTORY = 15;

  let activeTab = 'dls';
  let currentScreen = 'converter';
  let latestValidResult = null;
  let history = readJson(STORAGE.HISTORY, []);
  let favorites = readJson(STORAGE.FAVORITES, []);
  let favoriteSort = localStorage.getItem(STORAGE.FAVORITE_SORT) || 'date';
  let toastTimer = null;
  let cardMenuResultId = null;

  const $ = id => document.getElementById(id);
  const els = {
    title: $('toolbarTitle'), toolbarIcon: $('toolbarIcon'), back: $('backButton'), actions: $('toolbarActions'),
    converter: $('converterScreen'), favorites: $('favoritesScreen'), settings: $('settingsScreen'),
    dlsPanel: $('dlsPanel'), bcntsPanel: $('bcntsPanel'), reversePanel: $('reversePanel'),
    recent: $('recentResults'), emptyHistory: $('emptyHistory'), favoritesResults: $('favoritesResults'), emptyFavorites: $('emptyFavorites'),
    inputSummary: $('inputSummaryButton'), convert: $('convertButton'), overflow: $('overflowMenu'), cardMenu: $('cardMenu'),
    dialogBackdrop: $('dialogBackdrop'), dialogTitle: $('dialogTitle'), dialogBody: $('dialogBody'), dialogActions: $('dialogActions'), toast: $('toast')
  };

  function readJson(key, fallback) {
    try { const parsed = JSON.parse(localStorage.getItem(key)); return parsed ?? fallback; } catch (_) { return fallback; }
  }
  function saveHistory() {
    history = history.slice(0, MAX_HISTORY);
    localStorage.setItem(STORAGE.HISTORY, JSON.stringify(history));
  }
  function saveFavorites() { localStorage.setItem(STORAGE.FAVORITES, JSON.stringify(favorites)); }
  function uid() { return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`; }
  function clampNumber(value) { const n = Number(String(value).replace(',', '.')); return Number.isFinite(n) ? n : NaN; }
  function escapeHtml(value) { return String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

  function option(select, value, text = value) {
    const o = document.createElement('option'); o.value = value; o.textContent = text; select.appendChild(o);
  }
  function fillRange(id, start, end) {
    const s = $(id); s.textContent = ''; for (let i=start;i<=end;i++) option(s, String(i));
  }
  function fillLetters(id, start, end) {
    const s=$(id); s.textContent=''; for(let code=start.charCodeAt(0);code<=end.charCodeAt(0);code++)option(s,String.fromCharCode(code));
  }
  function initPickers() {
    const q=$('dlsQuarter'); q.textContent=''; option(q,'',''); ['C','SW','SE','NE','NW'].forEach(v=>option(q,v));
    fillRange('dlsLsd',1,16); fillRange('dlsSection',1,36); fillRange('dlsTownship',1,126); fillRange('dlsRange',1,34); fillRange('dlsMeridian',1,6);
    fillLetters('bcntsQuarter','A','D'); fillRange('bcntsCentizone',1,100); fillLetters('bcntsZoneBlock','A','L');
    const mu=$('bcntsMapUnit'); mu.textContent=''; constants.BCNTS_MAP_UNITS.forEach(v=>option(mu,String(v)));
    fillLetters('bcntsMapUnitSub','A','P'); fillRange('bcntsMapSheet',1,16);
  }

  function getDlsInput() {
    return {
      quarter:$('dlsQuarter').value,
      lsd:+$('dlsLsd').value,
      section:+$('dlsSection').value,
      township:+$('dlsTownship').value,
      range:+$('dlsRange').value,
      meridian:+$('dlsMeridian').value
    };
  }
  function setDlsInput(d) {
    $('dlsQuarter').value=d.quarter||''; $('dlsLsd').value=String(d.lsd||1); $('dlsSection').value=String(d.section||1);
    $('dlsTownship').value=String(d.township||1); $('dlsRange').value=String(d.range||1); $('dlsMeridian').value=String(d.meridian||1); updateSummary();
  }
  function getBcntsInput() {
    return {quarter:$('bcntsQuarter').value,centizone:+$('bcntsCentizone').value,zoneBlock:$('bcntsZoneBlock').value,mapUnit:+$('bcntsMapUnit').value,mapUnitSub:$('bcntsMapUnitSub').value,mapSheet:+$('bcntsMapSheet').value};
  }
  function setBcntsInput(b) {
    $('bcntsQuarter').value=b.quarter||'A'; $('bcntsCentizone').value=String(b.centizone||1); $('bcntsZoneBlock').value=b.zoneBlock||'A'; $('bcntsMapUnit').value=String(b.mapUnit||82); $('bcntsMapUnitSub').value=b.mapUnitSub||'A'; $('bcntsMapSheet').value=String(b.mapSheet||1); updateSummary();
  }
  function getReverseInput(){return {lat:Math.abs(clampNumber($('reverseLat').value)),lon:Math.abs(clampNumber($('reverseLon').value))};}
  function setReverseInput(p){$('reverseLat').value=Math.abs(p.lat).toFixed(6);$('reverseLon').value=Math.abs(p.lon).toFixed(6);updateSummary();}

  function updateSummary() {
    if(activeTab==='dls') els.inputSummary.textContent=formatDls(getDlsInput());
    else if(activeTab==='bcnts') els.inputSummary.textContent=formatBcnts(getBcntsInput());
    else {
      const p=getReverseInput();
      els.inputSummary.textContent=Number.isFinite(p.lat)&&Number.isFinite(p.lon)?formatLatLon(p):'Location';
    }
  }

  function switchTab(tab) {
    activeTab=tab;
    document.querySelectorAll('.tab').forEach(b=>b.classList.toggle('active',b.dataset.tab===tab));
    els.dlsPanel.classList.toggle('active-panel',tab==='dls'); els.bcntsPanel.classList.toggle('active-panel',tab==='bcnts'); els.reversePanel.classList.toggle('active-panel',tab==='reverse');
    updateSummary();
  }

  function setScreen(screen) {
    currentScreen=screen;
    [els.converter,els.favorites,els.settings].forEach(el=>el.classList.add('hidden'));
    els.back.classList.toggle('hidden',screen==='converter');
    if(screen==='converter') { els.converter.classList.remove('hidden'); els.title.textContent='LandTracker Pro'; els.actions.classList.remove('hidden'); }
    if(screen==='favorites') { els.favorites.classList.remove('hidden'); els.title.textContent='Favorites'; els.actions.classList.add('hidden'); renderFavorites(); }
    if(screen==='settings') { els.settings.classList.remove('hidden'); els.title.textContent='Settings'; els.actions.classList.add('hidden'); }
    closeMenus(); window.scrollTo(0,0);
  }

  function resultInputKey(r){ return `${r.type}|${r.input}`; }
  function findFavorite(r){ return favorites.find(f=>f.key===resultInputKey(r)); }
  function isFavorite(r){return !!findFavorite(r);}
  function resultLabel(r){ return findFavorite(r)?.name || r.input; }

  function createResult(type,input,output,extra={}) {
    return {id:uid(),type,input,output,createdAt:Date.now(),...extra};
  }
  function addHistory(result) {
    history.unshift(result); saveHistory();
    if(result.type!=='error') latestValidResult=result;
    renderHistory();
  }

  async function withLoading(text, work) {
    const mask=document.createElement('div'); mask.className='loading-mask'; mask.textContent=text||'Loading…'; document.body.appendChild(mask);
    try{return await work();} finally{mask.remove();}
  }

  async function convertCurrent() {
    els.convert.disabled=true;
    try {
      if(activeTab==='dls') {
        const d=getDlsInput(), input=formatDls(d);
        const p=await withLoading('Converting…',()=>engine.convertDls(d));
        if(!p) return addHistory(createResult('error',input,'DLS conversion failed.',{sourceType:'dls',source:d,error:'DLS conversion failed.'}));
        addHistory(createResult('dls',input,formatLatLon(p),{sourceType:'dls',source:d,lat:p.lat,lon:p.lon}));
      } else if(activeTab==='bcnts') {
        const b=getBcntsInput(),input=formatBcnts(b);
        const p=await withLoading('Converting…',()=>engine.convertBcnts(b));
        if(!p)return addHistory(createResult('error',input,'BCNTS conversion failed.',{sourceType:'bcnts',source:b,error:'BCNTS conversion failed.'}));
        addHistory(createResult('bcnts',input,formatLatLon(p),{sourceType:'bcnts',source:b,lat:p.lat,lon:p.lon}));
      } else {
        const p=getReverseInput(),input=Number.isFinite(p.lat)&&Number.isFinite(p.lon)?formatLatLon(p):'Location';
        const d=await withLoading('Converting…',()=>engine.reverse(p.lat,p.lon));
        if(!d)return addHistory(createResult('error',input,'Reverse conversion failed.',{sourceType:'reverse',source:p,error:'Reverse conversion failed.'}));
        addHistory(createResult('reverse',formatDls(d),formatLatLon(p),{sourceType:'reverse',source:p,dls:d,lat:p.lat,lon:p.lon}));
      }
    } catch(err) {
      console.error(err); const input=els.inputSummary.textContent;
      const message=activeTab==='dls'?'DLS conversion failed.':activeTab==='bcnts'?'BCNTS conversion failed.':'Reverse conversion failed.';
      addHistory(createResult('error',input,message,{sourceType:activeTab,error:message}));
    } finally {els.convert.disabled=false;}
  }

  function cardHtml(r, favoriteContext=false) {
    const favorite=isFavorite(r); const displayInput=favoriteContext&&favorite?resultLabel(r):r.input;
    const smallOutput = r.type==='error' ? 'card-small' : '';
    return `<article class="result-card ${escapeHtml(r.type)}" data-id="${escapeHtml(r.id)}">
      <button class="card-icon-button favorite-toggle" aria-label="Favorites"><img src="${LandTrackerAssets[favorite?'favorite.png':'favorite-outline.png']}" alt=""></button>
      <div class="card-content" role="button" tabindex="0"><div class="card-input">${escapeHtml(displayInput)}</div><div class="card-output ${smallOutput}">${escapeHtml(r.output||'')}</div></div>
      <button class="card-icon-button more-card" aria-label="More"><img src="${LandTrackerAssets['more.png']}" alt=""></button>
      <button class="card-icon-button copy-card" aria-label="Copy"><img src="${LandTrackerAssets['copy.png']}" alt=""></button>
    </article>`;
  }

  function wireCards(container, dataset, favoriteContext=false) {
    container.querySelectorAll('.result-card').forEach(card=>{
      const r=dataset.find(x=>x.id===card.dataset.id); if(!r)return;
      card.querySelector('.favorite-toggle').addEventListener('click',()=>toggleFavorite(r));
      card.querySelector('.copy-card').addEventListener('click',()=>copyResult(r));
      card.querySelector('.more-card').addEventListener('click',e=>openCardMenu(e.currentTarget,r));
      const content=card.querySelector('.card-content'); content.addEventListener('click',()=>loadResult(r)); content.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' ')loadResult(r);});
    });
  }

  function renderHistory() {
    const list=history.slice(0,VISIBLE_HISTORY); els.recent.innerHTML=list.map(r=>cardHtml(r,false)).join(''); els.emptyHistory.classList.toggle('hidden',list.length>0); wireCards(els.recent,list,false);
    if(!latestValidResult) latestValidResult=history.find(r=>r.type!=='error')||null;
  }
  function renderFavorites() {
    const sorted=[...favorites].sort((a,b)=>favoriteSort==='name'?(a.name||a.result.input).localeCompare(b.name||b.result.input):b.addedAt-a.addedAt);
    const rows=sorted.map(f=>({...f.result,id:f.result.id||f.key}));
    els.favoritesResults.innerHTML=rows.map(r=>cardHtml(r,true)).join(''); els.emptyFavorites.classList.toggle('hidden',rows.length>0); wireCards(els.favoritesResults,rows,true);
    $('sortFavoritesText').textContent=favoriteSort==='name'?'Sorting by name':'Sorting by date added to favorites';
  }

  function toggleFavorite(r) {
    const key=resultInputKey(r), index=favorites.findIndex(f=>f.key===key);
    if(index>=0) favorites.splice(index,1);
    else favorites.unshift({key,name:r.input,addedAt:Date.now(),result:{...r}});
    saveFavorites(); renderHistory(); if(currentScreen==='favorites')renderFavorites();
  }

  async function copyResult(r) {
    try { await navigator.clipboard.writeText(r.output||''); } catch(_) {
      const t=document.createElement('textarea'); t.value=r.output||''; document.body.appendChild(t);t.select();document.execCommand('copy');t.remove();
    }
    showToast('Copied to clipboard.');
  }

  function loadResult(r) {
    if(r.sourceType==='dls'&&r.source){setDlsInput(r.source);switchTab('dls');setScreen('converter');}
    else if(r.sourceType==='bcnts'&&r.source){setBcntsInput(r.source);switchTab('bcnts');setScreen('converter');}
    else if(r.sourceType==='reverse'&&r.source){setReverseInput(r.source);switchTab('reverse');setScreen('converter');}
  }

  function closeMenus(){els.overflow.classList.add('hidden');els.cardMenu.classList.add('hidden');cardMenuResultId=null;}
  function openCardMenu(anchor,r) {
    closeMenus(); cardMenuResultId=r.id; const fav=findFavorite(r); const actions=[];
    if(fav) actions.push(['rename','Rename']); actions.push(['copy','Copy']); if(fav) actions.push(['remove','Remove from favorites']);
    els.cardMenu.innerHTML=actions.map(([a,t])=>`<button data-card-action="${a}">${escapeHtml(t)}</button>`).join('');
    const rect=anchor.getBoundingClientRect(); els.cardMenu.style.top=`${Math.min(window.innerHeight-150,rect.bottom-4)}px`; els.cardMenu.style.right=`${Math.max(8,window.innerWidth-rect.right+38)}px`; els.cardMenu.classList.remove('hidden');
    els.cardMenu.querySelectorAll('button').forEach(btn=>btn.addEventListener('click',()=>{handleCardAction(btn.dataset.cardAction,r);closeMenus();}));
  }
  function handleCardAction(action,r){if(action==='copy')copyResult(r);if(action==='rename')renameFavorite(r);if(action==='remove')confirmRemoveFavorite(r);}

  function showDialog(title,body,actions) {
    els.dialogTitle.textContent=title; els.dialogBody.innerHTML=body; els.dialogActions.textContent='';
    actions.forEach(a=>{const b=document.createElement('button');b.textContent=a.label;b.addEventListener('click',()=>a.onClick?.());els.dialogActions.appendChild(b);});
    els.dialogBackdrop.classList.remove('hidden');els.dialogBackdrop.setAttribute('aria-hidden','false');
  }
  function closeDialog(){els.dialogBackdrop.classList.add('hidden');els.dialogBackdrop.setAttribute('aria-hidden','true');}
  function renameFavorite(r) {
    const fav=findFavorite(r);if(!fav)return;
    showDialog('Edit Favorite Name',`<input id="favoriteNameInput" value="${escapeHtml(fav.name||r.input)}" maxlength="120">`,[
      {label:'Cancel',onClick:closeDialog},{label:'Save',onClick:()=>{const v=$('favoriteNameInput').value.trim();if(v)fav.name=v;saveFavorites();closeDialog();renderFavorites();renderHistory();}}
    ]); setTimeout(()=>$('favoriteNameInput')?.focus(),0);
  }
  function confirmRemoveFavorite(r) {
    const fav=findFavorite(r);if(!fav)return;
    showDialog('Remove Favorite',`Do you want to remove ${escapeHtml(fav.name||r.input)} from your favorites?`,[
      {label:'Cancel',onClick:closeDialog},{label:'Remove',onClick:()=>{favorites=favorites.filter(f=>f.key!==fav.key);saveFavorites();closeDialog();renderFavorites();renderHistory();}}
    ]);
  }

  function showToast(message){clearTimeout(toastTimer);els.toast.textContent=message;els.toast.classList.remove('hidden');toastTimer=setTimeout(()=>els.toast.classList.add('hidden'),2200);}

  function showInMaps(r=latestValidResult) {
    if(!r||!Number.isFinite(r.lat)||!Number.isFinite(r.lon)){showToast('No location available.');return;}
    const lat=Math.abs(r.lat).toFixed(6),lon=(-Math.abs(r.lon)).toFixed(6); const label=(findFavorite(r)?.name||r.input||'').trim();
    const useLabels=$('exportLabelsToggle').checked;
    const query=useLabels&&label?`${lat},${lon} (${label})`:`${lat},${lon}`;
    window.open(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`,'_blank','noopener');
  }

  async function getCurrentLocation() {
    if(!navigator.geolocation){showToast('Location is not available.');return;}
    $('gpsButton').disabled=true;
    navigator.geolocation.getCurrentPosition(pos=>{
      setReverseInput({lat:Math.abs(pos.coords.latitude),lon:Math.abs(pos.coords.longitude)});$('gpsButton').disabled=false;
    },()=>{$('gpsButton').disabled=false;showToast('Unable to get current location.');},{enableHighAccuracy:$('detailedLocationToggle').checked,timeout:15000,maximumAge:0});
  }

  function exportFavorites() {
    if(!favorites.length){showToast('No favorites available.');return;}
    const payload={application:'LandTracker Pro',version:'1.5.7',favorites:favorites.map(f=>({name:f.name,input:f.result.input,output:f.result.output,type:f.result.type,lat:f.result.lat,lon:f.result.lon,sourceType:f.result.sourceType,source:f.result.source,dls:f.result.dls,addedAt:f.addedAt}))};
    const blob=new Blob([JSON.stringify(payload)],{type:'application/ltpro'}); const url=URL.createObjectURL(blob); const a=document.createElement('a');a.href=url;a.download='LandTrackerProFavorites.ltpro';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  async function importFavorites(file) {
    if(!file)return;
    try {
      const parsed=JSON.parse(await file.text()); const rows=Array.isArray(parsed)?parsed:parsed.favorites; if(!Array.isArray(rows))throw new Error('bad');
      for(const x of rows){
        const result={id:uid(),type:x.type||x.sourceType||'dls',input:x.input||x.name||'',output:x.output||(Number.isFinite(x.lat)&&Number.isFinite(x.lon)?formatLatLon({lat:x.lat,lon:x.lon}):''),sourceType:x.sourceType||x.type,source:x.source||null,dls:x.dls||null,lat:x.lat,lon:x.lon,createdAt:x.addedAt||Date.now()};
        const key=resultInputKey(result); if(!favorites.some(f=>f.key===key))favorites.push({key,name:x.name||result.input,addedAt:x.addedAt||Date.now(),result});
      }
      saveFavorites();renderFavorites();showToast('Done');
    } catch(_){showToast('Import favorites failed.');}
  }

  function bindEvents() {
    document.querySelectorAll('.tab').forEach(b=>b.addEventListener('click',()=>switchTab(b.dataset.tab)));
    ['dlsQuarter','dlsLsd','dlsSection','dlsTownship','dlsRange','dlsMeridian','bcntsQuarter','bcntsCentizone','bcntsZoneBlock','bcntsMapUnit','bcntsMapUnitSub','bcntsMapSheet'].forEach(id=>$(id).addEventListener('change',updateSummary));
    $('dlsQuarter').addEventListener('change',()=>{if($('dlsQuarter').value)$('dlsLsd').value='1';updateSummary();});
    $('dlsLsd').addEventListener('change',()=>{if($('dlsLsd').value!=='1')$('dlsQuarter').value='';updateSummary();});
    $('reverseLat').addEventListener('input',updateSummary);$('reverseLon').addEventListener('input',updateSummary);
    els.convert.addEventListener('click',convertCurrent); els.inputSummary.addEventListener('click',()=>{});
    $('gpsButton').addEventListener('click',getCurrentLocation);
    $('favoritesAction').addEventListener('click',()=>setScreen('favorites'));$('mapAction').addEventListener('click',()=>showInMaps());
    $('overflowAction').addEventListener('click',e=>{e.stopPropagation();els.cardMenu.classList.add('hidden');els.overflow.classList.toggle('hidden');});
    els.back.addEventListener('click',()=>setScreen('converter'));
    els.overflow.querySelectorAll('button').forEach(b=>b.addEventListener('click',()=>{const a=b.dataset.menuAction;closeMenus();if(a==='favorites')setScreen('favorites');if(a==='map')showInMaps();if(a==='settings')setScreen('settings');if(a==='help')window.open('http://www.rocandatech.com/help_Droid.php','_blank','noopener');}));
    document.addEventListener('click',e=>{if(!e.target.closest('.popup-menu')&&!e.target.closest('#overflowAction')&&!e.target.closest('.more-card'))closeMenus();});
    els.dialogBackdrop.addEventListener('click',e=>{if(e.target===els.dialogBackdrop)closeDialog();});
    $('sortFavoritesButton').addEventListener('click',()=>{favoriteSort=favoriteSort==='date'?'name':'date';localStorage.setItem(STORAGE.FAVORITE_SORT,favoriteSort);renderFavorites();});
    $('exportFavoritesButton').addEventListener('click',exportFavorites);$('importFavoritesInput').addEventListener('change',e=>{importFavorites(e.target.files?.[0]);e.target.value='';});
    $('detailedLocationToggle').addEventListener('change',e=>localStorage.setItem(STORAGE.DETAILED_LOCATION,e.target.checked?'1':'0'));
    $('exportLabelsToggle').addEventListener('change',e=>localStorage.setItem(STORAGE.EXPORT_LABELS,e.target.checked?'1':'0'));
  }

  function bootstrap() {
    initPickers();
    $('detailedLocationToggle').checked=localStorage.getItem(STORAGE.DETAILED_LOCATION)==='1';
    $('exportLabelsToggle').checked=localStorage.getItem(STORAGE.EXPORT_LABELS)==='1';
    renderHistory();bindEvents();switchTab('dls');setScreen('converter');
  }
  bootstrap();
})();
