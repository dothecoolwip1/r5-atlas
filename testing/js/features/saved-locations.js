/* Pack 2: canonical saved LSD records, IndexedDB persistence and device-first field memory. */
(function(){
  'use strict';

  const LEGACY_HISTORY_KEY='albertaOilfieldFieldMapHistoryV15';
  const LEGACY_NOTES_KEY='albertaOilfieldFieldMapNotesV17';
  const NEARBY_ALERTS_KEY='r5-atlas-nearby-alerts-v1';
  const NEARBY_RADIUS_KEY='r5-atlas-nearby-radius-km-v1';
  const VISIT_LIMIT=100;
  let deviceStoreAvailable=true;
  let nearbyWatchId=null;
  let nearbySeen=new Set();
  let pack2Ready=null;

  historyAtsKey=function(v){
    return String(v||'').trim().toUpperCase().replace(/\s+/g,'');
  };

  function timeValue(v){
    const t=Date.parse(v||'');
    return Number.isFinite(t)?t:0;
  }

  function formatVisit(v){
    const t=timeValue(v);
    if(!t)return 'Unknown';
    try{
      return new Date(t).toLocaleString(undefined,{year:'numeric',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
    }catch(_){
      return String(v||'Unknown');
    }
  }

  function normalizeVisits(visits){
    return (Array.isArray(visits)?visits:[])
      .map(function(v){
        if(typeof v==='string')return{at:v,source:'legacy'};
        return{at:v&&v.at||v&&v.timestamp||'',source:v&&v.source||'lookup'};
      })
      .filter(function(v){return timeValue(v.at)})
      .sort(function(a,b){return timeValue(a.at)-timeValue(b.at)})
      .slice(-VISIT_LIMIT);
  }

  function canonicalRecord(raw){
    raw=raw||{};
    const now=new Date().toISOString();
    const ats=String(raw.ats||'').trim();
    const key=String(raw.key||historyAtsKey(ats)||raw.id||'').trim();
    if(!key)return null;
    const visits=normalizeVisits(raw.visits);
    const createdAt=raw.createdAt||raw.created||raw.firstVisitedAt||raw.firstSearched||(visits[0]&&visits[0].at)||now;
    const firstVisitedAt=raw.firstVisitedAt||raw.firstSearched||(visits[0]&&visits[0].at)||createdAt;
    const lastVisitedAt=raw.lastVisitedAt||raw.lastSearched||(visits.length&&visits[visits.length-1].at)||createdAt;
    const selectedWell=raw.selectedWell||((raw.surfaceDls||raw.uwi||raw.licensee)?{
      surfaceDls:raw.surfaceDls||'',
      uwi:raw.uwi||'',
      licence:raw.licence||'',
      licensee:raw.licensee||'',
      lat:Number.isFinite(+raw.wellLat)?+raw.wellLat:null,
      lng:Number.isFinite(+raw.wellLng)?+raw.wellLng:null,
      boreIndex:Number(raw.selectedSurfaceBore)||0
    }:null);
    const visitCount=Math.max(0,Number(raw.visitCount)||Number(raw.searchCount)||visits.length||0);
    return Object.assign({},raw,{
      key:key,
      id:raw.id!=null?raw.id:Date.now()+Math.floor(Math.random()*1000000),
      ats:ats,
      lat:Number(raw.lat),
      lng:Number(raw.lng),
      geometry:compactGeometry(raw.geometry),
      notes:String(raw.notes||''),
      notesUpdatedAt:raw.notesUpdatedAt||raw.updatedAt||'',
      favorite:!!raw.favorite,
      tags:Array.isArray(raw.tags)?raw.tags.slice(0,30):[],
      hazards:Array.isArray(raw.hazards)?raw.hazards.slice(0,30):[],
      offlineAvailable:raw.offlineAvailable!==false,
      locationRecordVersion:1,
      selectedDisposal:raw.selectedDisposal==null?null:raw.selectedDisposal,
      selectedWell:selectedWell?Object.assign({},selectedWell):null,
      surfaceDls:selectedWell&&selectedWell.surfaceDls||raw.surfaceDls||'',
      uwi:selectedWell&&selectedWell.uwi||raw.uwi||'',
      licensee:selectedWell&&selectedWell.licensee||raw.licensee||'',
      firstVisitedAt:firstVisitedAt,
      lastVisitedAt:lastVisitedAt,
      visitCount:visitCount,
      visits:visits,
      createdAt:createdAt,
      updatedAt:raw.updatedAt||lastVisitedAt||createdAt,
      firstSearched:firstVisitedAt,
      lastSearched:lastVisitedAt,
      searchCount:visitCount
    });
  }

  function mergeRecords(records){
    const merged=new Map();
    (records||[]).forEach(function(raw){
      const h=canonicalRecord(raw);
      if(!h)return;
      const x=merged.get(h.key);
      if(!x){
        merged.set(h.key,h);
        return;
      }
      const newer=timeValue(h.updatedAt||h.lastVisitedAt)>=timeValue(x.updatedAt||x.lastVisitedAt)?h:x;
      const older=newer===h?x:h;
      const visits=normalizeVisits((older.visits||[]).concat(newer.visits||[]));
      const first=timeValue(older.firstVisitedAt)&&timeValue(older.firstVisitedAt)<timeValue(newer.firstVisitedAt)?older.firstVisitedAt:newer.firstVisitedAt;
      const last=timeValue(older.lastVisitedAt)>timeValue(newer.lastVisitedAt)?older.lastVisitedAt:newer.lastVisitedAt;
      merged.set(h.key,canonicalRecord(Object.assign({},older,newer,{
        notes:newer.notes||older.notes||'',
        favorite:!!(older.favorite||newer.favorite),
        selectedDisposal:newer.selectedDisposal==null?older.selectedDisposal:newer.selectedDisposal,
        selectedWell:newer.selectedWell||older.selectedWell||null,
        firstVisitedAt:first,
        lastVisitedAt:last,
        visitCount:Math.max(Number(older.visitCount)||0,Number(newer.visitCount)||0,visits.length),
        visits:visits
      })));
    });
    return Array.from(merged.values()).sort(function(a,b){return timeValue(b.lastVisitedAt)-timeValue(a.lastVisitedAt)});
  }

  function currentRecord(){
    if(currentHistoryId!=null){
      const byId=history.find(function(x){return x.id===currentHistoryId});
      if(byId)return byId;
      const byKey=history.find(function(x){return x.key===currentHistoryId});
      if(byKey)return byKey;
    }
    if(!job)return null;
    const key=historyAtsKey(job.ats);
    return history.find(function(x){return x.key===key})||null;
  }

  async function persistRecord(record,quiet){
    const normalized=canonicalRecord(record);
    if(!normalized)return null;
    Object.assign(record,normalized);
    if(deviceStoreAvailable){
      try{
        await R5DeviceStore.putSavedLocation(normalized);
        if(!quiet)setNoteSaveState('Saved on this device','saved');
        return normalized;
      }catch(e){
        deviceStoreAvailable=false;
        console.warn('IndexedDB save failed',e);
        showToast('Device database is unavailable. Browser fallback storage is being used.',5000);
      }
    }
    try{
      R5Storage.setItem(LEGACY_HISTORY_KEY,JSON.stringify(history.slice(0,100)));
    }catch(_){}
    return normalized;
  }

  function updateNoteMeta(record){
    const el=document.getElementById('noteMeta');
    if(!el)return;
    const value=document.getElementById('jobNotes')&&document.getElementById('jobNotes').value||'';
    const updated=record&&record.notesUpdatedAt?' • last saved '+formatVisit(record.notesUpdatedAt):'';
    el.textContent=value.length.toLocaleString()+' character'+(value.length===1?'':'s')+updated;
  }

  function addVisit(item,source){
    const now=new Date().toISOString();
    item.visits=normalizeVisits((item.visits||[]).concat([{at:now,source:source||'lookup'}]));
    item.visitCount=Math.max(0,Number(item.visitCount)||0)+1;
    item.firstVisitedAt=item.firstVisitedAt||item.createdAt||now;
    item.lastVisitedAt=now;
    item.firstSearched=item.firstVisitedAt;
    item.lastSearched=now;
    item.searchCount=item.visitCount;
    return now;
  }

  restoreNoteForJob=function(){
    if(!job)return;
    const item=history.find(function(x){return x.key===historyAtsKey(job.ats)});
    document.getElementById('jobNotes').value=item&&item.notes||'';
    setNoteSaveState('Saved on this device','saved');
    updateNoteMeta(item);
  };

  saveJobHistory=function(updateOnly){
    if(!job)return null;
    const key=historyAtsKey(job.ats);
    let item=currentRecord()||history.find(function(x){return x.key===key})||null;
    const now=new Date().toISOString();
    if(!item){
      item=canonicalRecord({
        key:key,ats:job.ats,lat:job.lat,lng:job.lng,geometry:job.geometry,
        createdAt:now,updatedAt:now,visitCount:0,visits:[],favorite:false,notes:''
      });
      history.unshift(item);
    }
    currentHistoryId=item.id;
    if(!updateOnly)addVisit(item,'lookup');
    item.ats=job.ats;
    item.lat=job.lat;
    item.lng=job.lng;
    item.geometry=compactGeometry(job.geometry)||item.geometry||null;
    item.notes=document.getElementById('jobNotes')&&document.getElementById('jobNotes').value||item.notes||'';
    item.selectedDisposal=selectedDisposal==null?(item.selectedDisposal==null?null:item.selectedDisposal):selectedDisposal;
    item.updatedAt=now;
    if(selectedSurfacePad){
      const b=selectedSurfacePad.bores&&selectedSurfacePad.bores[selectedSurfaceBore]||selectedSurfacePad.bores&&selectedSurfacePad.bores[0]||{};
      item.selectedWell={
        surfaceDls:displaySurfaceDls(selectedSurfacePad.surfaceDls)||job.ats,
        uwi:displayUwi(b),
        licence:b.licence||'',
        licensee:b.licensee||selectedSurfacePad.surfaces&&selectedSurfacePad.surfaces[0]&&selectedSurfacePad.surfaces[0].licensee||'',
        lat:Number.isFinite(+selectedSurfacePad.lat)?+selectedSurfacePad.lat:null,
        lng:Number.isFinite(+selectedSurfacePad.lng)?+selectedSurfacePad.lng:null,
        boreIndex:selectedSurfaceBore,
        status:b.status||'',
        type:b.type||'',
        h2s:b.h2s??null,
        isSour:b.isSour||''
      };
      const sourText=[item.selectedWell.type,item.selectedWell.isSour].filter(Boolean).join(' ');
      if((/H2S|H₂S|SOUR/i.test(sourText)||Number(item.selectedWell.h2s)>0)&&!item.hazards.includes('H2S / sour gas'))item.hazards.push('H2S / sour gas');
      item.surfaceDls=item.selectedWell.surfaceDls;
      item.uwi=item.selectedWell.uwi;
      item.licensee=item.selectedWell.licensee;
    }
    history=[item].concat(history.filter(function(x){return x!==item}));
    updateNoteMeta(item);
    renderHistory();
    void persistRecord(item,!!updateOnly);
    return item;
  };

  persistNoteNow=function(){
    if(!job)return'';
    const value=document.getElementById('jobNotes').value||'';
    let item=currentRecord();
    if(!item)item=saveJobHistory(true);
    if(!item)return value;
    const now=new Date().toISOString();
    item.notes=value;
    item.notesUpdatedAt=now;
    item.updatedAt=now;
    updateNoteMeta(item);
    renderHistory();
    void persistRecord(item,false);
    return value;
  };

  queueNoteSave=function(){
    setNoteSaveState('Saving...','');
    updateNoteMeta(currentRecord());
    clearTimeout(noteSaveTimer);
    noteSaveTimer=setTimeout(function(){persistNoteNow()},240);
  };

  updateHistorySurfaceInfo=function(p){
    p=p||loadedPads[0];
    if(!p||!job)return;
    selectedSurfacePad=selectedSurfacePad||p;
    const b=p.bores&&p.bores[selectedSurfaceBore]||p.bores&&p.bores[0]||{};
    const item=currentRecord();
    if(item){
      item.selectedWell={
        surfaceDls:displaySurfaceDls(p.surfaceDls)||job.ats,
        uwi:displayUwi(b),
        licence:b.licence||'',
        licensee:b.licensee||p.surfaces&&p.surfaces[0]&&p.surfaces[0].licensee||'',
        lat:Number.isFinite(+p.lat)?+p.lat:null,
        lng:Number.isFinite(+p.lng)?+p.lng:null,
        boreIndex:selectedSurfaceBore,
        status:b.status||'',
        type:b.type||'',
        h2s:b.h2s??null,
        isSour:b.isSour||''
      };
      const sourText=[item.selectedWell.type,item.selectedWell.isSour].filter(Boolean).join(' ');
      if((/H2S|H₂S|SOUR/i.test(sourText)||Number(item.selectedWell.h2s)>0)&&!item.hazards.includes('H2S / sour gas'))item.hazards.push('H2S / sour gas');
      item.surfaceDls=item.selectedWell.surfaceDls;
      item.uwi=item.selectedWell.uwi;
      item.licensee=item.selectedWell.licensee;
      item.surfaceCount=loadedPads.length;
      item.updatedAt=new Date().toISOString();
      renderHistory();
      void persistRecord(item,true);
    }
    updateMapJobBar();
  };

  function savedSearchText(h){
    const disposal=facilities.find(function(f){return f.n===Number(h.selectedDisposal)});
    return [
      h.ats,h.surfaceDls,h.licensee,h.uwi,h.notes,
      h.selectedWell&&h.selectedWell.licence,
      h.selectedWell&&h.selectedWell.licensee,
      h.selectedWell&&h.selectedWell.uwi,
      disposal&&disposal.name,disposal&&disposal.place
    ].filter(Boolean).join(' ').toLowerCase();
  }

  function visibleRecords(){
    const search=document.getElementById('savedSearch');
    const q=search?search.value.trim().toLowerCase():'';
    const favButton=document.getElementById('savedFavouritesOnly');
    const favOnly=favButton&&favButton.getAttribute('aria-pressed')==='true';
    const sortEl=document.getElementById('savedSort');
    const sort=sortEl?sortEl.value:'recent';
    const rows=history.filter(function(h){return(!favOnly||h.favorite)&&(!q||savedSearchText(h).includes(q))});
    if(sort==='visits')rows.sort(function(a,b){return(Number(b.visitCount)||0)-(Number(a.visitCount)||0)||timeValue(b.lastVisitedAt)-timeValue(a.lastVisitedAt)});
    else if(sort==='favorite')rows.sort(function(a,b){return Number(!!b.favorite)-Number(!!a.favorite)||timeValue(b.lastVisitedAt)-timeValue(a.lastVisitedAt)});
    else if(sort==='oldest')rows.sort(function(a,b){return timeValue(a.firstVisitedAt)-timeValue(b.firstVisitedAt)});
    else if(sort==='az')rows.sort(function(a,b){return String(a.ats||'').localeCompare(String(b.ats||''),undefined,{numeric:true})});
    else rows.sort(function(a,b){return timeValue(b.lastVisitedAt)-timeValue(a.lastVisitedAt)});
    return rows;
  }

  renderHistory=function(){
    const el=document.getElementById('historyList');
    if(!el)return;
    const countBadge=document.getElementById('historyCountBadge');
    if(countBadge)countBadge.textContent=history.length+' saved';
    const rows=visibleRecords();
    const status=document.getElementById('savedFilterStatus');
    if(status){
      const favOnly=document.getElementById('savedFavouritesOnly')&&document.getElementById('savedFavouritesOnly').getAttribute('aria-pressed')==='true';
      const q=document.getElementById('savedSearch')&&document.getElementById('savedSearch').value.trim();
      status.textContent='Showing '+rows.length+' of '+history.length+' saved LSDs'+(favOnly?' • favourites only':'')+(q?' • search filtered':'')+'. Nearby alerts are '+(nearbyEnabled()?'on':'off')+'.';
    }
    el.innerHTML=rows.map(function(h){
      const main=(h.surfaceDls||h.ats)+(h.licensee?' - '+h.licensee:'');
      const count=Math.max(0,Number(h.visitCount)||0);
      const disposal=facilities.find(function(f){return f.n===Number(h.selectedDisposal)});
      const selection=[];
      if(h.selectedWell&&h.selectedWell.uwi)selection.push('Well '+h.selectedWell.uwi);
      if(disposal)selection.push('Disposal #'+disposal.n+' '+disposal.name);
      return '<article class="history-item '+(h.favorite?'favorite':'')+'" data-saved-key="'+esc(h.key)+'">'+
        '<div class="history-main">'+
          '<div class="history-title-row"><b>'+esc(main)+'</b><button class="history-star" type="button" data-fav-history="'+esc(h.key)+'" aria-label="'+(h.favorite?'Remove favourite':'Add favourite')+'">'+(h.favorite?'★':'☆')+'</button></div>'+
          '<div class="sub">Job: '+esc(h.ats||'')+'</div>'+
          '<div class="history-meta"><span class="history-chip">'+count.toLocaleString()+' visit'+(count===1?'':'s')+'</span><span class="history-chip">First: '+esc(formatVisit(h.firstVisitedAt||h.createdAt))+'</span><span class="history-chip">Latest: '+esc(formatVisit(h.lastVisitedAt||h.createdAt))+'</span>'+(h.favorite?'<span class="history-chip favorite">Favourite</span>':'')+'</div>'+
          (h.notes?'<div class="history-note">'+esc(h.notes.slice(0,360))+'</div>':'')+
          (selection.length?'<div class="history-selection">'+esc(selection.join(' • '))+'</div>':'')+
        '</div>'+
        '<div class="actions"><button data-load-history="'+esc(h.key)+'">Load</button><button data-del-history="'+esc(h.key)+'">Delete</button></div>'+
      '</article>';
    }).join('')||'<div class="empty-saved">No saved LSDs match these filters.</div>';

    document.querySelectorAll('[data-load-history]').forEach(function(button){
      button.onclick=function(){void loadHistoryItem(button.dataset.loadHistory)};
    });
    document.querySelectorAll('[data-fav-history]').forEach(function(button){
      button.onclick=async function(){
        const item=history.find(function(x){return x.key===button.dataset.favHistory});
        if(!item)return;
        item.favorite=!item.favorite;
        item.updatedAt=new Date().toISOString();
        renderHistory();
        await persistRecord(item,true);
      };
    });
    document.querySelectorAll('[data-del-history]').forEach(function(button){
      button.onclick=async function(){
        const key=button.dataset.delHistory;
        const item=history.find(function(x){return x.key===key});
        if(!item||!(await confirmAction('Delete saved LSD '+item.ats+' and its notes?','Delete')))return;
        history=history.filter(function(x){return x.key!==key});
        if(currentHistoryId===item.id||currentHistoryId===key)currentHistoryId=null;
        try{if(deviceStoreAvailable)await R5DeviceStore.deleteSavedLocation(key)}catch(e){console.warn('Could not delete saved LSD',e)}
        renderHistory();
      };
    });
  };

  loadHistoryItem=async function(idOrKey){
    if(pack2Ready)await pack2Ready;
    const h=history.find(function(x){return x.key===String(idOrKey)||String(x.id)===String(idOrKey)});
    if(!h)return;
    currentHistoryId=h.id;
    document.getElementById('jobNotes').value=h.notes||'';
    updateNoteMeta(h);
    try{
      let result;
      if(h.geometry&&Number.isFinite(+h.lat)&&Number.isFinite(+h.lng))result={ats:h.ats,lat:+h.lat,lng:+h.lng,geometry:h.geometry};
      else result=await performJobLookup(parseJobInput(h.ats));
      await setJob(result,{save:true});
      showToast('Loaded saved LSD • '+Math.max(1,Number(currentRecord()&&currentRecord().visitCount)||1).toLocaleString()+' visits',4200);
    }catch(e){
      showToast('Could not reload job: '+(e&&e.message||e),5000);
    }
  };

  function nearbyEnabled(){
    return R5Storage.getItem(NEARBY_ALERTS_KEY)==='yes';
  }

  function nearbyRadius(){
    const value=Number(R5Storage.getItem(NEARBY_RADIUS_KEY)||0.5);
    return [0.5,1,2,5].includes(value)?value:0.5;
  }

  function stopNearby(){
    if(nearbyWatchId!=null&&navigator.geolocation){
      navigator.geolocation.clearWatch(nearbyWatchId);
      nearbyWatchId=null;
    }
  }

  function checkNearby(lat,lng){
    const radius=nearbyRadius();
    let closest=null;
    history.forEach(function(h){
      if(!Number.isFinite(+h.lat)||!Number.isFinite(+h.lng))return;
      const distance=haversineKm(lat,lng,+h.lat,+h.lng);
      if(distance>radius*1.5)nearbySeen.delete(h.key);
      if(distance<=radius&&!nearbySeen.has(h.key)&&(!closest||distance<closest.distance))closest={item:h,distance:distance};
    });
    if(closest){
      nearbySeen.add(closest.item.key);
      showToast('Nearby saved LSD: '+closest.item.ats+' • '+closest.distance.toFixed(2)+' km away',6200);
    }
  }

  function syncNearbyUi(){
    const button=document.getElementById('nearbyAlertsToggle');
    if(button){
      button.textContent='Nearby alerts: '+(nearbyEnabled()?'On':'Off');
      button.setAttribute('aria-pressed',String(nearbyEnabled()));
    }
    const radius=document.getElementById('nearbyRadius');
    if(radius)radius.value=String(nearbyRadius());
  }

  function startNearby(){
    stopNearby();
    if(!nearbyEnabled())return;
    if(!navigator.geolocation){
      R5Storage.setItem(NEARBY_ALERTS_KEY,'no');
      syncNearbyUi();
      showToast('Nearby alerts are unavailable in this browser.',5000);
      return;
    }
    nearbyWatchId=navigator.geolocation.watchPosition(
      function(p){checkNearby(p.coords.latitude,p.coords.longitude)},
      function(e){
        if(e.code===1){
          R5Storage.setItem(NEARBY_ALERTS_KEY,'no');
          stopNearby();
          syncNearbyUi();
          renderHistory();
          showToast('Nearby alerts turned off because location permission is blocked.',5200);
        }
      },
      {enableHighAccuracy:false,maximumAge:60000,timeout:20000}
    );
  }

  async function setNearbyEnabled(enabled){
    R5Storage.setItem(NEARBY_ALERTS_KEY,enabled?'yes':'no');
    nearbySeen.clear();
    if(enabled)startNearby();else stopNearby();
    syncNearbyUi();
    renderHistory();
    document.dispatchEvent(new CustomEvent('r5-nearby-settings-changed'));
    return nearbyEnabled();
  }

  function setNearbyRadius(value){
    const radius=[0.5,1,2,5].includes(Number(value))?Number(value):0.5;
    R5Storage.setItem(NEARBY_RADIUS_KEY,String(radius));
    nearbySeen.clear();
    syncNearbyUi();
    renderHistory();
    document.dispatchEvent(new CustomEvent('r5-nearby-settings-changed'));
    return radius;
  }

  globalThis.R5NearbyAlerts=Object.freeze({
    getStatus:function(){return{enabled:nearbyEnabled(),radiusKm:nearbyRadius(),watching:nearbyWatchId!=null}},
    setEnabled:setNearbyEnabled,
    setRadius:setNearbyRadius
  });

  function bindPack2Ui(){
    const notes=document.getElementById('jobNotes');
    if(notes){
      notes.oninput=queueNoteSave;
      notes.onblur=function(){persistNoteNow()};
    }
    const copyNotes=document.getElementById('copyNotes');
    if(copyNotes)copyNotes.onclick=async function(){
      const text=notes&&notes.value||'';
      await copyText(text,text?'Notes copied':'Notes are empty');
    };
    const clearNotes=document.getElementById('clearNotes');
    if(clearNotes)clearNotes.onclick=async function(){
      if(!job)return;
      if(await confirmAction('Clear the saved notes for this LSD?','Clear notes')){
        notes.value='';
        persistNoteNow();
      }
    };

    const search=document.getElementById('savedSearch');
    if(search)search.oninput=renderHistory;
    const clearSearch=document.getElementById('clearSavedSearch');
    if(clearSearch)clearSearch.onclick=function(){search.value='';renderHistory()};
    const favourites=document.getElementById('savedFavouritesOnly');
    if(favourites)favourites.onclick=function(){
      favourites.setAttribute('aria-pressed',String(favourites.getAttribute('aria-pressed')!=='true'));
      renderHistory();
    };
    const sort=document.getElementById('savedSort');
    if(sort)sort.onchange=renderHistory;
    const radius=document.getElementById('nearbyRadius');
    if(radius)radius.onchange=function(){setNearbyRadius(radius.value)};
    const nearby=document.getElementById('nearbyAlertsToggle');
    if(nearby)nearby.onclick=function(){void setNearbyEnabled(!nearbyEnabled())};

    const clearAll=document.getElementById('clearHistory');
    if(clearAll)clearAll.onclick=async function(){
      if(!(await confirmAction('Clear every saved LSD, visit record, favourite and saved note from this device?','Clear saved data')))return;
      history=[];
      currentHistoryId=null;
      try{if(deviceStoreAvailable)await R5DeviceStore.clearSavedLocations()}catch(e){console.warn('Could not clear saved LSD database',e)}
      R5Storage.removeItem(LEGACY_HISTORY_KEY);
      R5Storage.removeItem(LEGACY_NOTES_KEY);
      renderHistory();
      showToast('Saved LSDs cleared');
    };

    syncNearbyUi();
    updateNoteMeta(currentRecord());
  }

  loadHistory=async function(){
    const legacySnapshot=Array.isArray(history)?history.slice():[];
    let deviceRecords=[];
    try{
      deviceRecords=await R5DeviceStore.getAllSavedLocations();
    }catch(e){
      deviceStoreAvailable=false;
      console.warn('IndexedDB load failed',e);
    }

    if(deviceRecords.length){
      history=mergeRecords(deviceRecords);
    }else{
      history=mergeRecords(legacySnapshot.map(function(raw){
        const key=historyAtsKey(raw&&raw.ats);
        const note=raw&&raw.notes||notesStore&&notesStore[key]||'';
        return Object.assign({},raw,{notes:note});
      }));
      if(deviceStoreAvailable&&history.length){
        try{
          await R5DeviceStore.putSavedLocations(history);
        }catch(e){
          deviceStoreAvailable=false;
          console.warn('Legacy history migration failed',e);
        }
      }
    }

    renderHistory();
    syncNearbyUi();
    if(nearbyEnabled())startNearby();
    return history;
  };

  bindPack2Ui();
  pack2Ready=loadHistory();
  savedDataReady=pack2Ready;
  globalThis.R5Pack2Ready=pack2Ready;
})();