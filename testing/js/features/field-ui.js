(function(){
  'use strict';

  const FIELD_MODE_KEY='r5-atlas-field-mode-v1';
  const DESKTOP_BREAKPOINT=1180;
  const page=document.querySelector('.page');
  const mapSection=document.getElementById('mapSection');
  const content=document.querySelector('main.content');
  const mapSearch=document.querySelector('.map-search');
  const facilityFilters=document.getElementById('facilityCategoryFilters');
  const jobSection=document.getElementById('jobSection');
  const wellsPanel=document.getElementById('wellsPanel');
  const facilitiesSection=document.getElementById('facilitiesSection');
  const historySection=document.getElementById('historySection');
  const fieldModeToggle=document.getElementById('fieldModeToggle');
  const clearJobButton=document.getElementById('clearJob');
  const mapJobBar=document.getElementById('mapJobBar');
  if(!page||!mapSection||!content||!mapSearch)return;

  let desktopActive=false;
  let leftRail=null;
  let rightRail=null;
  let searchSlot=null;
  let savedSlot=null;
  let detailSlot=null;

  function makeRail(className,label){
    const rail=document.createElement('aside');
    rail.className='desktop-rail '+className;
    rail.setAttribute('aria-label',label);
    return rail;
  }

  function ensureDesktopRails(){
    if(leftRail)return;
    leftRail=makeRail('desktop-left-rail','Search and saved locations');
    rightRail=makeRail('desktop-right-rail','Location details');
    searchSlot=document.createElement('div');
    searchSlot.className='desktop-search-slot';
    savedSlot=document.createElement('div');
    savedSlot.className='desktop-saved-slot';
    detailSlot=document.createElement('div');
    detailSlot.className='desktop-detail-slot';
    leftRail.append(searchSlot,savedSlot);
    rightRail.append(detailSlot);
    page.insertBefore(leftRail,mapSection);
    page.appendChild(rightRail);
  }

  function restoreStandardDom(){
    if(mapSearch.parentElement!==mapSection)mapSection.insertBefore(mapSearch,facilityFilters||mapSection.firstChild);
    [jobSection,wellsPanel,facilitiesSection,historySection].forEach(function(section){
      if(section&&section.parentElement!==content)content.appendChild(section);
    });
  }

  function applyDesktopWorkspace(active){
    if(active===desktopActive)return;
    desktopActive=active;
    if(active){
      ensureDesktopRails();
      page.classList.add('desktop-workspace');
      searchSlot.appendChild(mapSearch);
      if(historySection)savedSlot.appendChild(historySection);
      [jobSection,wellsPanel,facilitiesSection].forEach(function(section){
        if(section)detailSlot.appendChild(section);
      });
    }else{
      page.classList.remove('desktop-workspace');
      restoreStandardDom();
    }
    requestAnimationFrame(function(){
      try{globalThis.map?.invalidateSize?.()}catch(_){}
      try{globalThis.R5FieldUI?.announceLayout?.()}catch(_){}
    });
  }

  function currentLayout(){
    if(window.innerWidth>=DESKTOP_BREAKPOINT)return'desktop';
    if(window.innerWidth>=721&&window.matchMedia('(orientation: landscape)').matches)return'tablet-landscape';
    return'mobile';
  }

  function announceLayout(){
    document.documentElement.dataset.r5Layout=currentLayout();
  }

  function refreshLayout(){
    const mode=currentLayout();
    applyDesktopWorkspace(mode==='desktop');
    announceLayout();
    window.setTimeout(function(){try{map.invalidateSize()}catch(_){}},80);
  }

  function fieldModeEnabled(){
    return localStorage.getItem(FIELD_MODE_KEY)==='yes';
  }

  function applyFieldMode(enabled,{persist=true}={}){
    const on=!!enabled;
    document.body.classList.toggle('field-mode',on);
    if(persist)localStorage.setItem(FIELD_MODE_KEY,on?'yes':'no');
    if(fieldModeToggle){
      fieldModeToggle.setAttribute('aria-pressed',String(on));
      fieldModeToggle.setAttribute('aria-label',on?'Turn Field Mode off':'Turn Field Mode on');
      fieldModeToggle.textContent=on?'Field On':'Field Mode';
    }
    document.documentElement.dataset.fieldMode=on?'on':'off';
    window.setTimeout(function(){try{map.invalidateSize()}catch(_){}},80);
    return on;
  }

  if(fieldModeToggle){
    fieldModeToggle.addEventListener('click',function(){
      applyFieldMode(!document.body.classList.contains('field-mode'));
    });
  }

  function enhanceAccessibility(){
    document.querySelectorAll('button:not([type])').forEach(function(button){button.type='button'});
    const mapEl=document.getElementById('map');
    if(mapEl){
      mapEl.setAttribute('role','application');
      mapEl.setAttribute('aria-label','Interactive Alberta field map. Use the search or map controls to select an LSD, well or disposal facility.');
    }
    document.querySelectorAll('.well-card').forEach(function(card,index){
      if(!card.hasAttribute('aria-label'))card.setAttribute('aria-label','Surface well result '+(index+1));
    });
    document.querySelectorAll('.facility').forEach(function(card,index){
      if(!card.hasAttribute('aria-label'))card.setAttribute('aria-label','Disposal facility result '+(index+1));
    });
  }

  function syncMobileMapActions(){
    if(!clearJobButton||!mapJobBar)return;
    const hasActiveJob=!mapJobBar.classList.contains('hidden');
    clearJobButton.classList.toggle('r5-map-action-hidden',!hasActiveJob);
    clearJobButton.setAttribute('aria-hidden',String(!hasActiveJob));
    clearJobButton.tabIndex=hasActiveJob?0:-1;
  }

  const observer=new MutationObserver(function(mutations){
    if(mutations.some(function(m){return m.addedNodes&&m.addedNodes.length}))enhanceAccessibility();
    if(mutations.some(function(m){return m.target===mapJobBar||m.type==='attributes'}))syncMobileMapActions();
  });
  observer.observe(document.body,{childList:true,subtree:true});
  if(mapJobBar)observer.observe(mapJobBar,{attributes:true,attributeFilter:['class']});
  syncMobileMapActions();

  document.addEventListener('keydown',function(event){
    if(event.key!=='Escape')return;
    const detail=document.getElementById('wellDetailBackdrop');
    if(detail&&!detail.classList.contains('hidden'))document.getElementById('wellDetailClose')?.click();
  });

  let resizeTimer=null;
  window.addEventListener('resize',function(){
    clearTimeout(resizeTimer);
    resizeTimer=setTimeout(refreshLayout,90);
  });
  window.addEventListener('orientationchange',function(){setTimeout(refreshLayout,120)});

  applyFieldMode(fieldModeEnabled(),{persist:false});
  enhanceAccessibility();
  refreshLayout();

  globalThis.R5FieldUI=Object.freeze({
    setFieldMode:applyFieldMode,
    getFieldMode:function(){return document.body.classList.contains('field-mode')},
    getLayout:currentLayout,
    refresh:refreshLayout,
    announceLayout:announceLayout,
    status:function(){
      return{
        fieldMode:document.body.classList.contains('field-mode'),
        layout:currentLayout(),
        desktopActive:desktopActive,
        searchParent:mapSearch.parentElement?.className||'',
        savedParent:historySection?.parentElement?.className||''
      };
    }
  });
})();
