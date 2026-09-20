/* Pack 3: universal field search, map-home navigation and compact field status. */
(function(){
  'use strict';

  const RECENT_KEY='r5-atlas-universal-search-recent-v1';
  const MAX_RECENT=10;
  const MAX_RESULTS=14;
  const input=document.getElementById('jobInput');
  const findButton=document.getElementById('findJob');
  const clearButton=document.getElementById('clearUniversalSearch');
  const resultsHost=document.getElementById('universalSearchResults');
  const jobStatus=document.getElementById('jobStatus');
  let results=[];
  let activeIndex=-1;
  let searchTimer=null;
  let searchGeneration=0;
  let st37SurfaceByLicence=null;
  let st37MetaLabel='ST37 cached';
  let gpsPermission='unknown';

  function safeJson(key,fallback){
    try{return R5Storage.getJson(key,fallback)}catch(_){return fallback}
  }

  function loadRecent(){
    const items=safeJson(RECENT_KEY,[]);
    return Array.isArray(items)?items:[];
  }

  function saveRecent(item){
    if(!item||!item.type||!item.label)return;
    const clean={
      type:item.type,
      key:String(item.key||item.value||item.label),
      label:String(item.label),
      value:String(item.value||''),
      subtitle:String(item.subtitle||''),
      payload:item.payload||null,
      at:new Date().toISOString()
    };
    const next=[clean].concat(loadRecent().filter(function(x){
      return !(x&&x.type===clean.type&&String(x.key)===clean.key);
    })).slice(0,MAX_RECENT);
    try{R5Storage.setJson(RECENT_KEY,next)}catch(_){}
  }

  function legalParsed(raw){
    const value=String(raw||'').trim();
    if(/^[1-6]\d{9}$/.test(value)){
      const parsed=globalThis.LSDConverterV2&&globalThis.LSDConverterV2.parsePid
        ?globalThis.LSDConverterV2.parsePid(value):null;
      if(parsed&&parsed.status==='ok'){
        return{
          type:'ats',
          sourceType:'pid',
          lsd:parsed.lsd,
          sec:parsed.section,
          twp:parsed.township,
          rge:parsed.range,
          mer:parsed.meridian,
          normalized:parsed.normalized,
          pid:value
        };
      }
    }
    return parseJobInput(value);
  }

  function detectedType(raw){
    const value=String(raw||'').trim();
    if(!value)return'';
    if(/^-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?$/.test(value))return'GPS';
    if(/^[1-6]\d{9}$/.test(value))return'PID';
    const parsed=legalParsed(value);
    if(parsed&&parsed.type==='ats')return'LSD';
    if(parsed&&parsed.type==='quarter')return'Quarter section';
    return'';
  }

  function directSuggestion(raw){
    const value=String(raw||'').trim();
    if(!value)return null;
    const parsed=legalParsed(value);
    if(!parsed||parsed.type==='invalid')return null;
    if(parsed.type==='gps'){
      return{
        type:'legal',key:'gps:'+parsed.lat+','+parsed.lng,label:parsed.lat.toFixed(6)+', '+parsed.lng.toFixed(6),
        value:value,subtitle:'GPS coordinates • resolve Alberta LSD',tag:'GPS',icon:'◎',score:120,
        payload:{kind:'gps'}
      };
    }
    if(parsed.type==='ats'){
      const isPid=/^[1-6]\d{9}$/.test(value);
      const label=isPid?(parsed.normalized||value):canonical(parsed);
      return{
        type:'legal',key:'legal:'+historyAtsKey(label),label:label,value:value,
        subtitle:isPid?'PID '+value+' • Alberta LSD':'Alberta LSD • exact legal land lookup',
        tag:isPid?'PID':'LSD',icon:'▦',score:125,payload:{kind:isPid?'pid':'lsd'}
      };
    }
    if(parsed.type==='quarter'){
      return{
        type:'legal',key:'quarter:'+String(parsed.normalized||value),label:canonicalQ(parsed),value:value,
        subtitle:'Alberta quarter section • legal land lookup',tag:'Quarter',icon:'◩',score:124,payload:{kind:'quarter'}
      };
    }
    return null;
  }

  function historySuggestions(q){
    const query=String(q||'').toLowerCase().trim();
    return (history||[]).filter(function(h){
      const hay=[h.ats,h.surfaceDls,h.notes,h.licensee,h.uwi,h.selectedWell&&h.selectedWell.licence].filter(Boolean).join(' ').toLowerCase();
      return !query||hay.includes(query);
    }).map(function(h){
      return{
        type:'saved',
        key:h.key||String(h.id),
        label:h.surfaceDls||h.ats,
        value:h.ats,
        subtitle:[h.favorite?'Favourite':'Saved LSD',h.licensee||'',h.notes?String(h.notes).slice(0,70):''].filter(Boolean).join(' • '),
        tag:h.favorite?'Favourite':'Saved',
        icon:h.favorite?'★':'≡',
        score:h.favorite?112:94,
        favorite:!!h.favorite,
        payload:{key:h.key||String(h.id)}
      };
    }).slice(0,8);
  }

  function facilitySuggestions(q){
    const query=String(q||'').toLowerCase().trim();
    if(!query)return[];
    return facilities.filter(function(f){
      return [f.n,f.name,f.place,f.lsd,f.type,f.phone].join(' ').toLowerCase().includes(query);
    }).slice(0,6).map(function(f){
      return{
        type:'facility',key:String(f.n),label:'#'+f.n+' '+f.name,value:f.name,
        subtitle:[f.place,f.type,f.lsd].filter(Boolean).join(' • '),tag:'Disposal',icon:'◆',score:86,
        payload:{n:f.n}
      };
    });
  }

  function loadedWellSuggestions(q){
    const query=String(q||'').toLowerCase().trim();
    if(!query)return[];
    const out=[];
    const companies=new Set();
    for(const p of loadedPads||[]){
      for(let i=0;i<(p.bores||[]).length;i++){
        const b=p.bores[i]||{};
        const company=String(b.licensee||'').trim();
        if(company&&company.toLowerCase().includes(query)&&!companies.has(company.toLowerCase())){
          companies.add(company.toLowerCase());
          out.push({
            type:'company',key:'loaded-company:'+company.toLowerCase(),label:company,value:company,
            subtitle:'Company from wells already loaded around the active location',tag:'Company',icon:'◉',score:104,
            payload:{name:company}
          });
        }
        const hay=[b.uwi,b.rawUwi,b.name,b.licence,b.licensee,b.status,p.surfaceDls].filter(Boolean).join(' ').toLowerCase();
        if(hay.includes(query)){
          out.push({
            type:'well',key:'loaded:'+(b.uwi||b.rawUwi||b.licence)+'|'+p.lat+'|'+p.lng,
            label:b.name||displayUwi(b),value:b.uwi||b.rawUwi||b.licence,
            subtitle:[displayUwi(b),b.licensee,displaySurfaceDls(p.surfaceDls)].filter(Boolean).join(' • '),
            tag:'Well',icon:'●',score:101,
            payload:{uwi:displayUwi(b),licence:b.licence||'',licensee:b.licensee||'',surfaceDls:displaySurfaceDls(p.surfaceDls),lat:p.lat,lng:p.lng}
          });
        }
        if(out.length>=7)return out;
      }
    }
    return out;
  }

  function recentSuggestions(q){
    const query=String(q||'').toLowerCase().trim();
    return loadRecent().filter(function(r){
      if(!query)return true;
      return [r.label,r.value,r.subtitle].filter(Boolean).join(' ').toLowerCase().includes(query);
    }).slice(0,6).map(function(r,index){
      return{
        type:r.type,key:'recent:'+r.type+':'+r.key,label:r.label,value:r.value,subtitle:r.subtitle||'Recent search',
        tag:'Recent',icon:'↺',score:80-index,payload:r.payload||null,recentSource:r
      };
    });
  }

  function dedupeAndRank(items){
    const seen=new Set();
    return items.filter(function(item){
      if(!item)return false;
      const key=item.type+'|'+String(item.key||item.label);
      if(seen.has(key))return false;
      seen.add(key);
      return true;
    }).sort(function(a,b){
      return (Number(b.score)||0)-(Number(a.score)||0)||String(a.label).localeCompare(String(b.label));
    }).slice(0,MAX_RESULTS);
  }

  function renderResults(items,loadingText){
    results=items||[];
    activeIndex=results.length?0:-1;
    if(!results.length&&!loadingText){
      resultsHost.classList.add('hidden');
      resultsHost.innerHTML='';
      return;
    }
    let html='';
    if(loadingText)html+='<div class="search-loading">'+esc(loadingText)+'</div>';
    html+=results.map(function(item,index){
      return '<button type="button" role="option" aria-selected="'+(index===activeIndex)+'" class="search-result '+(item.favorite?'favorite ':'')+(index===activeIndex?'active':'')+'" data-search-index="'+index+'">'+
        '<span class="search-result-icon">'+esc(item.icon||'⌕')+'</span>'+
        '<span class="search-result-main"><span class="search-result-title">'+esc(item.label)+'</span><span class="search-result-sub">'+esc(item.subtitle||'')+'</span></span>'+
        '<span class="search-result-tag">'+esc(item.tag||item.type)+'</span>'+
      '</button>';
    }).join('');
    resultsHost.innerHTML=html;
    resultsHost.classList.remove('hidden');
    resultsHost.querySelectorAll('[data-search-index]').forEach(function(button){
      button.addEventListener('mouseenter',function(){
        setActiveIndex(Number(button.dataset.searchIndex));
      });
      button.addEventListener('click',function(){
        void selectResult(results[Number(button.dataset.searchIndex)]);
      });
    });
  }

  function setActiveIndex(index){
    if(!results.length){activeIndex=-1;return}
    activeIndex=(index+results.length)%results.length;
    resultsHost.querySelectorAll('[data-search-index]').forEach(function(button,i){
      const on=i===activeIndex;
      button.classList.toggle('active',on);
      button.setAttribute('aria-selected',String(on));
      if(on)button.scrollIntoView({block:'nearest'});
    });
  }

  function closeResults(){
    resultsHost.classList.add('hidden');
    activeIndex=-1;
  }

  function sqlEscape(value){
    return String(value||'').replace(/'/g,"''").slice(0,80);
  }

  async function searchAerOnline(q){
    if(navigator.onLine===false)return[];
    const query=sqlEscape(q);
    if(query.length<3)return[];
    const like='%'+query+'%';
    const clauses=[
      "Company_BA_Long_Name LIKE '"+like+"'",
      "UWI LIKE '"+like+"'",
      "Well_Name LIKE '"+like+"'",
      "Surface_Location LIKE '"+like+"'"
    ];
    if(/^\d{3,12}$/.test(query))clauses.push('Well_Licence_Number='+Number(query));
    const params=new URLSearchParams({
      where:clauses.join(' OR '),
      outFields:'Well_Licence_Number,Well_Name,Well_Type,Well_Purpose,UWI,Licence_Status,Licence_Status_Date,Company_BA_Long_Name,Surface_Location,Calculated_Latitude,Calculated_Longitude,Maximum_Estimated_H2S,Is_Well_Sour',
      returnGeometry:'false',
      resultRecordCount:'18',
      f:'json'
    });
    const data=await fetchJson(AER_WELL_LAYER+'?'+params.toString(),12000);
    const rows=(data.features||[]).map(function(f){return f.attributes||{}});
    const out=[];
    const companies=new Set();
    rows.forEach(function(a){
      const company=String(a.Company_BA_Long_Name||'').trim();
      if(company&&!companies.has(company.toLowerCase())){
        companies.add(company.toLowerCase());
        out.push({
          type:'company',key:'company:'+company.toLowerCase(),label:company,value:company,
          subtitle:'AER licensee/operator search • live result',tag:'Company',icon:'◉',score:78,
          payload:{name:company}
        });
      }
      const lat=+a.Calculated_Latitude,lng=+a.Calculated_Longitude;
      const uwi=String(a.UWI||'').trim();
      const licence=String(a.Well_Licence_Number||'').trim();
      const name=String(a.Well_Name||'').trim();
      if((uwi||licence||name)&&Number.isFinite(lat)&&Number.isFinite(lng)){
        out.push({
          type:'well',key:'aer:'+(uwi||licence)+'|'+lat+'|'+lng,label:name||uwi||('Licence '+licence),value:uwi||licence,
          subtitle:[uwi,company,String(a.Surface_Location||'').trim()].filter(Boolean).join(' • '),
          tag:'Well',icon:'●',score:83,
          payload:{
            uwi:uwi,licence:licence,licensee:company,surfaceDls:String(a.Surface_Location||'').trim(),
            lat:lat,lng:lng,name:name,status:String(a.Licence_Status||''),
            type:String(a.Well_Type||a.Well_Purpose||''),h2s:a.Maximum_Estimated_H2S,isSour:String(a.Is_Well_Sour||'')
          }
        });
      }
    });
    return out.slice(0,10);
  }

  async function ensureOfflineSurfaceLookup(){
    await ensureSt37();
    if(st37SurfaceByLicence)return st37SurfaceByLicence;
    const mapByLicence=new Map();
    let buckets=0;
    for(const rows of surfaceGrid.values()){
      for(const r of rows){
        if(r&&r[2]&&!mapByLicence.has(String(r[2]))){
          mapByLicence.set(String(r[2]),{
            lat:r[0],lng:r[1],licence:String(r[2]),licensee:String(r[3]||''),status:String(r[4]||''),
            statusDate:String(r[5]||''),type:String(r[6]||''),surfaceDls:String(r[7]||'')
          });
        }
      }
      if(++buckets%300===0)await new Promise(function(resolve){setTimeout(resolve,0)});
    }
    st37SurfaceByLicence=mapByLicence;
    return mapByLicence;
  }

  async function searchSt37Offline(q){
    const query=String(q||'').toLowerCase().trim();
    if(query.length<3)return[];
    const surfaces=await ensureOfflineSurfaceLookup();
    const out=[];
    const companies=new Set();

    for(const s of surfaces.values()){
      const company=String(s.licensee||'');
      if(company&&company.toLowerCase().includes(query)&&!companies.has(company.toLowerCase())){
        companies.add(company.toLowerCase());
        out.push({
          type:'company',key:'company:'+company.toLowerCase(),label:company,value:company,
          subtitle:'Cached ST37 licensee • offline snapshot',tag:'Company',icon:'◉',score:74,payload:{name:company}
        });
        if(companies.size>=4)break;
      }
    }

    let scanned=0;
    outer:
    for(const [licence,bores] of boresByLicence.entries()){
      const surface=surfaces.get(String(licence));
      for(const b of bores||[]){
        const hay=[b[0],b[1],b[2],licence,surface&&surface.licensee,surface&&surface.surfaceDls].filter(Boolean).join(' ').toLowerCase();
        if(!hay.includes(query))continue;
        if(surface){
          out.push({
            type:'well',key:'st37:'+(b[0]||b[1]||licence)+'|'+surface.lat+'|'+surface.lng,
            label:b[2]||b[0]||b[1]||('Licence '+licence),value:b[0]||b[1]||licence,
            subtitle:[b[0]||b[1],surface.licensee,surface.surfaceDls].filter(Boolean).join(' • '),
            tag:'Well',icon:'●',score:79,
            payload:{
              uwi:b[0]||b[1]||'',licence:String(licence),licensee:surface.licensee,
              surfaceDls:surface.surfaceDls,lat:surface.lat,lng:surface.lng,name:b[2]||'',
              status:surface.status,type:b[10]||surface.type||''
            }
          });
        }
        if(out.filter(function(x){return x.type==='well'}).length>=6)break outer;
      }
      if(++scanned%5000===0)await new Promise(function(resolve){setTimeout(resolve,0)});
    }
    return out.slice(0,10);
  }

  async function remoteOrOfflineSuggestions(q,generation){
    if(String(q||'').trim().length<3)return[];
    try{
      const live=await searchAerOnline(q);
      if(generation!==searchGeneration)return[];
      if(live.length)return live;
    }catch(e){
      console.warn('Universal live AER search failed',e);
    }
    try{
      const cached=await searchSt37Offline(q);
      if(generation!==searchGeneration)return[];
      return cached;
    }catch(e){
      console.warn('Universal cached ST37 search unavailable',e);
      return[];
    }
  }

  async function updateSuggestions(options){
    const force=!!(options&&options.force);
    const q=input.value.trim();
    clearButton.classList.toggle('hidden',!q);
    const generation=++searchGeneration;

    let instant=[];
    const direct=directSuggestion(q);
    if(direct)instant.push(direct);
    instant=instant.concat(historySuggestions(q),facilitySuggestions(q),loadedWellSuggestions(q),recentSuggestions(q));

    if(!q){
      const favs=historySuggestions('').filter(function(x){return x.favorite});
      renderResults(dedupeAndRank(favs.concat(recentSuggestions(''))));
      return;
    }

    const ranked=dedupeAndRank(instant);
    renderResults(ranked,q.length>=3?'Searching wells and companies…':'');
    if(q.length<3&&!force)return;

    const remote=await remoteOrOfflineSuggestions(q,generation);
    if(generation!==searchGeneration)return;
    renderResults(dedupeAndRank(instant.concat(remote)));
  }

  async function runLegal(value){
    const parsed=legalParsed(value);
    if(!parsed||parsed.type==='invalid'){
      throw Error(parsed&&parsed.message||'Search an LSD, PID, quarter section or GPS coordinate.');
    }
    if(parsed.type==='gps'&&navigator.onLine===false){
      throw Error('GPS coordinates were recognized, but resolving GPS back to an Alberta LSD requires a connection. Saved LSDs remain available offline.');
    }
    const kind=parsed.sourceType==='pid'?'PID':parsed.type==='gps'?'GPS':parsed.type==='quarter'?'quarter section':'Alberta ATS';
    jobStatus.textContent='Looking up '+kind+'…';
    jobStatus.className='map-status';
    currentHistoryId=null;
    document.getElementById('jobNotes').value='';
    setNoteSaveState('Saved','saved');
    const resolved=await performJobLookup(parsed);
    await setJob(resolved);
    closeMobileSheets();
    updateNavStates();
    return resolved;
  }

  async function focusWell(payload){
    if(!payload)return;
    let resolved=null;
    const surface=String(payload.surfaceDls||'').trim();
    if(surface){
      const parsed=legalParsed(surface);
      if(parsed&&parsed.type!=='invalid'){
        try{resolved=await performJobLookup(parsed)}catch(_){}
      }
    }
    if(!resolved&&navigator.onLine!==false&&Number.isFinite(+payload.lat)&&Number.isFinite(+payload.lng)){
      try{resolved=await identifyPoint(+payload.lat,+payload.lng)}catch(_){}
    }
    if(resolved){
      await setJob(resolved);
      const targetUwi=String(payload.uwi||'').trim();
      const targetLicence=String(payload.licence||'').trim();
      let pad=null,index=0;
      for(const p of loadedPads||[]){
        const i=(p.bores||[]).findIndex(function(b){
          return (targetUwi&&[b.uwi,b.rawUwi].map(String).includes(targetUwi))||(targetLicence&&String(b.licence)===targetLicence);
        });
        if(i>=0){pad=p;index=i;break}
      }
      if(!pad&&Number.isFinite(+payload.lat)&&Number.isFinite(+payload.lng)){
        pad=(loadedPads||[]).slice().sort(function(a,b){
          return haversineKm(+payload.lat,+payload.lng,a.lat,a.lng)-haversineKm(+payload.lat,+payload.lng,b.lat,b.lng);
        })[0]||null;
      }
      if(pad){
        selectSurfacePad(pad,index);
        map.setView([pad.lat,pad.lng],15);
      }else if(Number.isFinite(+payload.lat)&&Number.isFinite(+payload.lng)){
        map.setView([+payload.lat,+payload.lng],15);
      }
      closeMobileSheets();
      return;
    }
    if(Number.isFinite(+payload.lat)&&Number.isFinite(+payload.lng)){
      map.setView([+payload.lat,+payload.lng],15);
      closeMobileSheets();
      showToast('Well surface shown on the map. Its LSD could not be resolved offline.',5000);
      return;
    }
    throw Error('This well result does not include a usable surface location.');
  }

  async function selectResult(item){
    if(!item)return;
    closeResults();
    if(item.recentSource){
      item=Object.assign({},item.recentSource,{payload:item.recentSource.payload||item.payload});
    }
    try{
      if(item.type==='legal'){
        input.value=item.value||item.label;
        await runLegal(input.value);
        saveRecent(item);
      }else if(item.type==='saved'){
        const key=item.payload&&item.payload.key||item.key;
        await loadHistoryItem(key);
        closeMobileSheets();
        saveRecent(item);
      }else if(item.type==='facility'){
        const n=Number(item.payload&&item.payload.n||item.key);
        const f=facilities.find(function(x){return x.n===n});
        if(!f)throw Error('Disposal facility was not found.');
        activeCats[f.c]=true;
        renderFacilities();
        closeMobileSheets();
        map.flyTo([f.lat,f.lng],12);
        const marker=facilityMarkers.get(f.n);
        if(marker)marker.openPopup();
        jobStatus.textContent='Disposal: #'+f.n+' '+f.name+' • '+f.place;
        jobStatus.className='map-status ok';
        saveRecent(item);
      }else if(item.type==='company'){
        const name=item.payload&&item.payload.name||item.value||item.label;
        await openCompanyProfile(name);
        saveRecent(item);
      }else if(item.type==='well'){
        await focusWell(item.payload||{});
        saveRecent(item);
      }else if(item.type==='recent'){
        input.value=item.value||item.label;
        await updateSuggestions({force:true});
      }
    }catch(e){
      jobStatus.textContent=e&&e.message||String(e);
      jobStatus.className='map-status error';
      showToast(jobStatus.textContent,5000);
    }
    clearButton.classList.toggle('hidden',!input.value.trim());
    updateNavStates();
  }

  async function executeSearch(){
    const q=input.value.trim();
    if(!q){
      input.focus();
      await updateSuggestions({force:false});
      return;
    }
    const direct=directSuggestion(q);
    if(direct){
      await selectResult(direct);
      return;
    }
    await updateSuggestions({force:true});
    if(results.length){
      await selectResult(results[Math.max(0,activeIndex)]);
      return;
    }
    jobStatus.textContent='No matching field location found. Search LSD, PID, GPS, saved LSD, company, UWI/well or disposal facility.';
    jobStatus.className='map-status error';
  }

  function scheduleSuggestions(){
    clearTimeout(searchTimer);
    searchTimer=setTimeout(function(){void updateSuggestions({force:false})},260);
  }

  function classifyPaste(){
    const kind=detectedType(input.value);
    if(kind){
      jobStatus.textContent=kind+' detected. Choose the recognized result or press Find.';
      jobStatus.className='map-status ok';
    }else{
      jobStatus.textContent='Pasted text detected. Searching saved locations, wells, companies and disposals…';
      jobStatus.className='map-status';
    }
    void updateSuggestions({force:true});
  }

  async function readSt37Meta(){
    try{
      const response=await fetch('data/st37-meta.json');
      if(!response.ok)return;
      const meta=await response.json();
      if(meta&&meta.generatedAt){
        const d=new Date(meta.generatedAt);
        if(Number.isFinite(d.getTime()))st37MetaLabel='ST37 '+d.toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'});
      }
    }catch(_){}
  }

  function setChip(id,text,state,title){
    const el=document.getElementById(id);
    if(!el)return;
    el.textContent=text;
    el.className='field-status-chip'+(state?' '+state:'');
    if(title)el.title=title;
  }

  async function updateGpsStatus(){
    if(!navigator.geolocation){
      gpsPermission='blocked';
      setChip('gpsStatus','GPS UNAVAILABLE','bad','This browser does not expose device location.');
      return;
    }
    if(navigator.permissions&&navigator.permissions.query){
      try{
        const status=await navigator.permissions.query({name:'geolocation'});
        gpsPermission=status.state;
        const apply=function(){
          gpsPermission=status.state;
          if(status.state==='granted')setChip('gpsStatus','GPS READY','good','Location permission is granted.');
          else if(status.state==='denied')setChip('gpsStatus','GPS BLOCKED','bad','Location permission is blocked.');
          else setChip('gpsStatus','GPS ASK','warn','Location permission will be requested only when you use My Location or nearby alerts.');
        };
        apply();
        status.onchange=apply;
        return;
      }catch(_){}
    }
    gpsPermission='available';
    setChip('gpsStatus','GPS READY','','Device location is available; permission is requested only when needed.');
  }

  function updateConnectionStatus(){
    if(navigator.onLine===false){
      setChip('connectionStatus','OFFLINE','warn','Network is unavailable. R5 Atlas is using device data and cached resources.');
      setChip('dataSourceStatus',st37MetaLabel,'warn','Cached ST37 is a snapshot and is not implied to be current. Saved LSDs and the offline ATS pack remain device-local.');
    }else{
      setChip('connectionStatus','ONLINE','good','Network connection is available.');
      setChip('dataSourceStatus','AER LIVE','good','Live AER well data is primary while online. Cached ST37 remains fallback data.');
    }
  }

  function updateNavStates(){
    const set=function(id,value,show){
      const el=document.getElementById(id);
      if(!el)return;
      el.textContent=String(value==null?'':value);
      el.classList.toggle('hidden',!show);
    };
    set('navLsdState','1',!!job);
    set('navWellsState',(loadedPads||[]).length,!!job);
    set('navDisposalsState',facilities.filter(function(f){return !!activeCats[f.c]}).length,true);
    set('navSavedState',(history||[]).length,(history||[]).length>0);
    const anyOpen=!!document.querySelector('.content>.section.mobile-open');
    document.querySelectorAll('.mobile-nav button[data-scroll="mapSection"]').forEach(function(b){b.classList.toggle('active',!anyOpen)});
  }

  function bindObservers(){
    ['jobStatus','wellStatus','historyCountBadge','st37Status'].forEach(function(id){
      const el=document.getElementById(id);
      if(!el)return;
      new MutationObserver(function(){
        if(id==='st37Status'){
          const text=el.textContent||'';
          if(/live aer/i.test(text)&&navigator.onLine!==false)setChip('dataSourceStatus','AER LIVE','good',text);
          else if(/offline|st37/i.test(text))setChip('dataSourceStatus',st37MetaLabel,'warn',text+' Cached snapshot data may not be current.');
        }
        updateNavStates();
      }).observe(el,{childList:true,subtree:true,characterData:true,attributes:true});
    });
    document.querySelectorAll('.mobile-nav button').forEach(function(button){
      button.addEventListener('click',function(){setTimeout(updateNavStates,0)});
    });
    const sheet=document.getElementById('sheetBackdrop');
    if(sheet)new MutationObserver(updateNavStates).observe(sheet,{attributes:true,attributeFilter:['class']});
  }

  if(!input||!findButton||!resultsHost)return;

  findButton.onclick=function(){void executeSearch()};
  input.onkeydown=function(e){
    if(e.key==='ArrowDown'&&results.length){e.preventDefault();setActiveIndex(activeIndex+1);return}
    if(e.key==='ArrowUp'&&results.length){e.preventDefault();setActiveIndex(activeIndex-1);return}
    if(e.key==='Escape'){closeResults();return}
    if(e.key==='Enter'){
      e.preventDefault();
      if(!resultsHost.classList.contains('hidden')&&results.length&&activeIndex>=0)void selectResult(results[activeIndex]);
      else void executeSearch();
    }
  };
  input.addEventListener('input',scheduleSuggestions);
  input.addEventListener('focus',function(){void updateSuggestions({force:false})});
  input.addEventListener('paste',function(){setTimeout(classifyPaste,0)});
  clearButton.onclick=function(){
    input.value='';
    clearButton.classList.add('hidden');
    closeResults();
    jobStatus.textContent='Search any field location, or tap the map.';
    jobStatus.className='map-status';
    input.focus();
    void updateSuggestions({force:false});
  };
  document.addEventListener('click',function(e){
    if(!e.target.closest('.map-search'))closeResults();
  });

  window.addEventListener('online',updateConnectionStatus);
  window.addEventListener('offline',updateConnectionStatus);
  document.addEventListener('r5-nearby-settings-changed',updateGpsStatus);

  globalThis.R5UniversalSearch=Object.freeze({
    search:function(query){input.value=String(query||'');return updateSuggestions({force:true})},
    execute:executeSearch,
    getResults:function(){return results.map(function(x){return Object.assign({},x)})},
    getRecent:loadRecent,
    status:function(){return{online:navigator.onLine!==false,gpsPermission:gpsPermission,data:navigator.onLine===false?st37MetaLabel:'AER LIVE'}}
  });

  Promise.resolve(globalThis.R5Pack2Ready).catch(function(){}).then(function(){
    updateNavStates();
    void updateSuggestions({force:false});
  });
  bindObservers();
  void readSt37Meta().then(updateConnectionStatus);
  updateConnectionStatus();
  void updateGpsStatus();
})();