const facilities = globalThis.R5_DATA?.facilities || [];

const categoryLabels={red:'Oil & Gas / Oilfield Waste',blue:'Septic / Municipal',yellow:'Commercial Liquid Waste'};
const ATS_SERVICE='https://geospatial.alberta.ca/titan/rest/services/base/alberta_township_system/MapServer';
const ROUTING_SERVICE='https://router.project-osrm.org/table/v1/driving';
const AER_LICENCE_DASH='https://www2.aer.ca/t/Production/views/COM-WellLicenceMainDashboard/LicenceDetailDashboard?iframeSizedToWindow=true&%3Aembed=y&%3AshowAppBanner=false&%3Adisplay_count=no&%3AshowVizHome=no';
const AER_LICENCE_CSV='https://www2.aer.ca/t/Production/views/COM-WellLicenceAllList/WellLicenceAllAB.csv';
const AER_SUMMARY_BASE='https://www2.aer.ca/t/Production/views/PRD_0100_Well_Summary_Report/WellSummaryReport';
const HISTORY_KEY='albertaOilfieldFieldMapHistoryV15';

let activeCats={red:true,blue:false,yellow:false};let job=null,jobMarker=null,jobPolygon=null,selectedDisposal=null;let routes=new Map(),routeRequest=0;let history=[];let currentHistoryId=null;let savedDataReady=null;
let wellMode={type:'radius',km:0.5};let wellsVisible=true,loadedPads=[];let wellMarkers=[];let st37Ready=false,st37Promise=null;let surfaceGrid=new Map(),boresByLicence=new Map();let companyCache=new Map(),companyState=null,companyRenderLimit=100;let companyMapInstance=null,companyMapLayer=null,companyMapProfile=null,companyMapTypeFilters={active:true,issued:true,abandoned:true,suspended:true,cancelled:true,other:true};let noteSaveTimer=null;

const map=L.map('map',{zoomControl:false,preferCanvas:true}).setView([53.65,-114.4],5);L.control.zoom({position:'bottomright'}).addTo(map);
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; OpenStreetMap contributors'}).addTo(map);L.control.scale({imperial:false}).addTo(map);
const facilityMarkers=new Map();
const markerClusterAvailable=typeof L.markerClusterGroup==='function';
function makeClusterIcon(kind,count){
  const label=kind==='well'?'W':'D';
  return L.divIcon({className:'r5-cluster-host',html:`<div class="r5-cluster r5-cluster-${kind}" aria-hidden="true"><span>${count}</span><small>${label}</small></div>`,iconSize:[48,48],iconAnchor:[24,24]});
}
function createMarkerGroup(kind){
  if(markerClusterAvailable)return L.markerClusterGroup({
    maxClusterRadius:zoom=>kind==='well'?(zoom<11?64:48):(zoom<8?84:zoom<11?68:54),
    disableClusteringAtZoom:kind==='well'?15:14,
    showCoverageOnHover:false,
    spiderfyOnMaxZoom:true,
    removeOutsideVisibleBounds:true,
    chunkedLoading:true,
    iconCreateFunction:cluster=>makeClusterIcon(kind,cluster.getChildCount())
  });
  return L.layerGroup();
}
const facilityClusterLayer=createMarkerGroup('disposal').addTo(map);
const wellClusterLayer=createMarkerGroup('well').addTo(map);
const esc=s=>String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');
const n2=n=>String(n).padStart(2,'0'),n3=n=>String(n).padStart(3,'0');
function haversineKm(a,b,c,d){const R=6371.0088,toRad=x=>x*Math.PI/180;const x=toRad(c-a),y=toRad(d-b);const z=Math.sin(x/2)**2+Math.cos(toRad(a))*Math.cos(toRad(c))*Math.sin(y/2)**2;return 2*R*Math.atan2(Math.sqrt(z),Math.sqrt(1-z));}
function facilityGlyph(category){return category==='red'?'O':category==='blue'?'S':'C'}
function makeFacilityIcon(f){return L.divIcon({className:'r5-marker-host',html:`<div class="r5-map-marker r5-marker-disposal r5-category-${f.c}" aria-hidden="true"><span class="r5-marker-glyph">${facilityGlyph(f.c)}</span><span class="r5-marker-number">${f.n}</span></div>`,iconSize:[44,50],iconAnchor:[22,48],popupAnchor:[0,-44]});}
function makeJobIcon(){return L.divIcon({className:'r5-marker-host',html:'<div class="r5-map-marker r5-marker-lsd" aria-hidden="true"><span class="r5-marker-glyph">L</span><span class="r5-marker-tag">LSD</span></div>',iconSize:[50,50],iconAnchor:[25,25]});}
function makeWellIcon(count){return L.divIcon({className:'r5-marker-host',html:`<div class="r5-map-marker r5-marker-well" aria-hidden="true"><span class="r5-marker-glyph">W</span><span class="r5-marker-count">${count||1}</span></div>`,iconSize:[42,42],iconAnchor:[21,21]});}
function addClusterMarker(group,marker){if(!group.hasLayer(marker))group.addLayer(marker)}
function removeClusterMarker(group,marker){if(group.hasLayer(marker))group.removeLayer(marker)}
function focusFacilityMarker(fOrNumber,zoom=12){
  const f=typeof fOrNumber==='object'?fOrNumber:facilities.find(x=>x.n===Number(fOrNumber));
  if(!f)return;
  const marker=facilityMarkers.get(f.n);
  if(!marker)return;
  addClusterMarker(facilityClusterLayer,marker);
  const open=()=>marker.openPopup();
  map.flyTo([f.lat,f.lng],Math.max(map.getZoom(),zoom));
  if(typeof facilityClusterLayer.zoomToShowLayer==='function'){
    setTimeout(()=>facilityClusterLayer.zoomToShowLayer(marker,open),320);
  }else setTimeout(open,320);
}
facilities.forEach(f=>{
  const markerLabel=`Disposal #${f.n}: ${f.name}, ${f.place}, ${categoryLabels[f.c]||f.type}`;
  const m=L.marker([f.lat,f.lng],{icon:makeFacilityIcon(f),keyboard:true,title:markerLabel,alt:markerLabel,riseOnHover:true})
    .bindPopup(`<div class="r5-map-popup"><strong>#${f.n} ${esc(f.name)}</strong><span>${esc(f.place)}</span><span>${esc(f.type)}</span><span>${esc(f.hours)}</span></div>`);
  facilityMarkers.set(f.n,m);
  addClusterMarker(facilityClusterLayer,m);
});
globalThis.R5MapUI=Object.freeze({
  markerClusterAvailable,
  focusFacility:focusFacilityMarker,
  status:()=>({markerClusterAvailable,facilityCount:facilityClusterLayer.getLayers().length,wellCount:wellClusterLayer.getLayers().length})
});
function mapsSearch(lat,lng){return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`}
function directions(originLat,originLng,destLat,destLng){return `https://www.google.com/maps/dir/?api=1&origin=${originLat},${originLng}&destination=${destLat},${destLng}`}
function renderFacilities(){const q=(document.getElementById('directorySearch')?.value||'').toLowerCase().trim();const visible=facilities.filter(f=>activeCats[f.c]&&(!q||[f.n,f.name,f.phone,f.place,f.lsd,f.coords,f.type,f.hours].join(' ').toLowerCase().includes(q)));const set=new Set(visible.map(f=>f.n));facilities.forEach(f=>{const m=facilityMarkers.get(f.n);if(set.has(f.n))addClusterMarker(facilityClusterLayer,m);else removeClusterMarker(facilityClusterLayer,m)});document.getElementById('directoryStatus').textContent=`Showing ${visible.length} of ${facilities.length} facilities`;document.getElementById('facilityGrid').innerHTML=visible.map(f=>facilityCard(f)).join('')||'<div class="status">No facilities match the current disposal types.</div>';bindFacilityActions();syncChips();}
function facilityCard(f){const r=routes.get(f.n);const drive=job?(r?`${(r.distance/1000).toFixed(1)} km • ${formatDuration(r.duration)}`:'Road route unavailable'):'';const label=`Disposal #${f.n}, ${f.name}, ${f.place}, ${f.type}`;return `<article class="facility ${selectedDisposal===f.n?'sel':''}" aria-label="${esc(label)}"><div class="facility-top"><div class="num ${f.c}">${f.n}</div><div class="facility-title"><b>${esc(f.name)}</b><span>${esc(f.place)}</span></div></div><div class="facility-body"><div><b>Phone:</b> ${esc(f.phone)}</div><div><b>LSD:</b> ${esc(f.lsd)}</div><div><b>Type:</b> ${esc(f.type)}</div><div><b>Hours:</b> ${esc(f.hours)}</div>${job?`<div><b>From job:</b> ${drive}</div>`:''}<div class="actions">${f.phone!=='N/A'?`<a href="tel:${f.phone.split('/')[0].replace(/[^0-9+]/g,'')}">Call</a>`:''}<a target="_blank" rel="noopener" href="${mapsSearch(f.lat,f.lng)}">Map</a><button data-zoom-fac="${f.n}">Zoom</button>${job?`<button data-select-fac="${f.n}">${selectedDisposal===f.n?'Selected':'Select disposal'}</button><a target="_blank" rel="noopener" href="${directions(job.lat,job.lng,f.lat,f.lng)}">Directions</a>`:''}</div></div></article>`}
function bindFacilityActions(){document.querySelectorAll('[data-zoom-fac]').forEach(b=>b.onclick=()=>focusFacilityMarker(Number(b.dataset.zoomFac),11));document.querySelectorAll('[data-select-fac]').forEach(b=>b.onclick=()=>selectDisposal(Number(b.dataset.selectFac)));}
function syncChips(){document.querySelectorAll('#facilityCategoryFilters .filter-chip').forEach(b=>{const on=!!activeCats[b.dataset.cat];b.classList.toggle('off',!on);b.setAttribute('aria-pressed',String(on));b.dataset.stateLabel=on?'On':'Off';b.setAttribute('aria-label',`${categoryLabels[b.dataset.cat]||b.dataset.cat}: ${on?'shown':'hidden'}`);});}
function formatDuration(sec){if(!Number.isFinite(sec))return 'n/a';const m=Math.round(sec/60);return m<60?`${m} min`:`${Math.floor(m/60)} h ${m%60} min`;}
function parseJobInput(raw){
  raw=String(raw||'').trim();
  let m=raw.match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
  if(m)return{type:'gps',lat:+m[1],lng:+m[2]};
  if(/^[1-6]\d{9}$/.test(raw)){
    const pidParsed=globalThis.LSDConverterV2?.parsePid(raw);
    if(pidParsed?.status==='ok')return{type:'ats',sourceType:'pid',lsd:pidParsed.lsd,sec:pidParsed.section,twp:pidParsed.township,rge:pidParsed.range,mer:pidParsed.meridian,normalized:pidParsed.normalized,pid:raw};
  }
  const parsed=globalThis.LSDConverterV2?.parse(raw);
  if(parsed?.status==='ok'&&parsed.kind==='lsd'){
    return{type:'ats',lsd:parsed.lsd,sec:parsed.section,twp:parsed.township,rge:parsed.range,mer:parsed.meridian,normalized:parsed.normalized,pid:parsed.pid};
  }
  if(parsed?.status==='ok'&&parsed.kind==='quarter'){
    return{type:'quarter',quarter:parsed.quarter,sec:parsed.section,twp:parsed.township,rge:parsed.range,mer:parsed.meridian,normalized:parsed.normalized};
  }
  return{type:'invalid',message:parsed?.message||'Enter an LSD, quarter section, or GPS coordinate.'};
}
function canonical(p){return `${n2(p.lsd)}-${n2(p.sec)}-${n3(p.twp)}-${n2(p.rge)} W${p.mer}M`}
function canonicalQ(p){return `${p.quarter}-${n2(p.sec)}-${n3(p.twp)}-${n2(p.rge)} W${p.mer}M`}
function atsUrl(path,params){return `${ATS_SERVICE}${path}?${new URLSearchParams(params)}`}
const fetchJson=(url,timeout=18000)=>R5Providers.fetchJson(url,timeout);
function polygonCenter(g){const ring=g?.rings?.[0];if(!ring?.length)throw Error('ATS geometry missing.');let lat=0,lng=0;ring.forEach(p=>{lng+=p[0];lat+=p[1]});return{lat:lat/ring.length,lng:lng/ring.length}}
function firstReal(results){return (results||[]).find(x=>String(x.attributes?.['Road Allowance']??x.attributes?.RA??'').trim()==='')||results?.[0]||null}
function attr(a,...keys){for(const k of keys)if(a?.[k]!=null&&String(a[k]).trim()!=='')return a[k];return null}
let offlineLsdConverterPromise;
async function getOfflineLsdConverter(){
  if(!offlineLsdConverterPromise){
    offlineLsdConverterPromise=(async()=>{
      if(!globalThis.LSDConverterV2)throw Error('LSD Converter v2 did not load.');
      const response=await fetch('data/alberta-ats-v41-lsd.bin.gz');
      if(!response.ok)throw Error('LSD coordinate data could not be loaded.');
      const converter=await LSDConverterV2.createConverterFromGzip(await response.arrayBuffer());
      const report=converter.selfTest();
      if(!report.ok){
        console.error('LSD Converter v2 self-test failed',report);
        throw Error('LSD coordinate data failed its startup validation.');
      }
      return converter;
    })();
  }
  return offlineLsdConverterPromise;
}
async function lookupATS(p){
  const converter=await getOfflineLsdConverter();
  const description=p.normalized||`${String(p.lsd).padStart(2,'0')}-${String(p.sec).padStart(2,'0')}-${String(p.twp).padStart(3,'0')}-${String(p.rge).padStart(2,'0')}-W${p.mer}`;
  const result=converter.resolve(description);
  let geometry=null;

  if(typeof navigator==='undefined'||navigator.onLine!==false){
    try{
      const where=`LSD=${p.lsd} AND SEC=${p.sec} AND TWP=${p.twp} AND RGE=${p.rge} AND M=${p.mer}`;
      const d=await fetchJson(atsUrl('/5/query',{
        f:'json',where,
        returnGeometry:'true',
        outSR:'4326',
        outFields:'*'
      }));
      geometry=d.features?.[0]?.geometry||null;
    }catch{}
  }

  if(result.status!=='ok')throw Error(result.message||'LSD not found in the Alberta ATS source.');
  return{
    lat:result.latitude,
    lng:result.longitude,
    ats:canonical(p),
    geometry,
    quarter:'',
    coordinateSource:result.coordinateSource,
    coordinateMethod:result.coordinateMethod
  };
}
async function lookupQuarter(p){
  const converter=await getOfflineLsdConverter();
  const description=p.normalized||`${p.quarter}-${String(p.sec).padStart(2,'0')}-${String(p.twp).padStart(3,'0')}-${String(p.rge).padStart(2,'0')}-W${p.mer}`;
  const offline=converter.resolve(description);
  let geometry=null;

  if(typeof navigator==='undefined'||navigator.onLine!==false){
    try{
      let path='/3/query';
      let where=`QS='${p.quarter}' AND SEC=${p.sec} AND TWP=${p.twp} AND RGE=${p.rge} AND M=${p.mer}`;
      if(p.quarter==='C'){
        path='/1/query';
        where=`SEC=${p.sec} AND TWP=${p.twp} AND RGE=${p.rge} AND M=${p.mer} AND RA=' '`;
      }
      const d=await fetchJson(atsUrl(path,{
        f:'json',where,
        returnGeometry:'true',
        outSR:'4326',
        outFields:'*'
      }));
      const f=d.features?.[0];
      if(f?.geometry){
        geometry=f.geometry;
        const exact=polygonCenter(geometry);
        if(Number.isFinite(exact?.lat)&&Number.isFinite(exact?.lng)){
          return{...exact,ats:canonicalQ(p),geometry,quarter:p.quarter,coordinateSource:'Government of Alberta ATS live polygon',coordinateMethod:'polygon_center'};
        }
      }
    }catch{}
  }

  if(offline.status!=='ok')throw Error(offline.message||'Quarter or section centre not found.');
  return{
    lat:offline.latitude,
    lng:offline.longitude,
    ats:canonicalQ(p),
    geometry,
    quarter:p.quarter,
    coordinateSource:offline.coordinateSource,
    coordinateMethod:offline.coordinateMethod
  };
}
async function identifyPoint(lat,lng){const extent=`${lng-.04},${lat-.04},${lng+.04},${lat+.04}`;const d=await fetchJson(atsUrl('/identify',{geometry:`${lng},${lat}`,geometryType:'esriGeometryPoint',sr:'4326',layers:'all:5',tolerance:'2',mapExtent:extent,imageDisplay:'1000,1000,96',returnGeometry:'true',f:'json'}));const r=firstReal(d.results);if(!r)throw Error('No Alberta LSD found at this point.');const a=r.attributes||{};const p={lsd:+attr(a,'Legal SubDivision','Legal Subdivision','LS'),sec:+attr(a,'Section','SEC'),twp:+attr(a,'Township','TWP'),rge:+attr(a,'Range','RGE'),mer:+attr(a,'Meridian','M')};if(!p.lsd||!p.sec||!p.twp||!p.rge||!p.mer)throw Error('Incomplete ATS result.');return{lat,lng,ats:canonical(p),geometry:r.geometry,quarter:''}}
function geometryLatLng(g){return(g?.rings||[]).map(r=>r.map(([lng,lat])=>[lat,lng]))}
function pointInRing(lat,lng,ring){let inside=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const xi=ring[i][0],yi=ring[i][1],xj=ring[j][0],yj=ring[j][1];const hit=((yi>lat)!=(yj>lat))&&(lng<(xj-xi)*(lat-yi)/(yj-yi+1e-15)+xi);if(hit)inside=!inside}return inside}
function pointInJobPolygon(lat,lng){const ring=job?.geometry?.rings?.[0];return ring?pointInRing(lat,lng,ring):false}
async function performJobLookup(parsed){if(parsed.type==='ats')return lookupATS(parsed);if(parsed.type==='quarter')return lookupQuarter(parsed);if(parsed.type==='gps')return identifyPoint(parsed.lat,parsed.lng);throw Error('Use LSD, quarter section, or GPS coordinates.');}

function st37Lines(text,fn){let s=0;while(s<text.length){let e=text.indexOf('\n',s);if(e<0)e=text.length;if(e>s)fn(text.slice(s,e));s=e+1}}
let st37MetaPromise;
async function fetchSt37Meta(){
  if(st37MetaPromise)return st37MetaPromise;
  st37MetaPromise=fetch(`data/st37-meta.json?t=${Date.now()}`,{cache:'no-store'}).then(r=>r.ok?r.json():null).catch(()=>null);
  return st37MetaPromise;
}
async function gunzipResponse(response){
  if(!response?.ok)throw Error(`ST37 data file returned ${response?.status||'an error'}.`);
  if(!response.body)throw Error('ST37 data response had no body.');
  const stream=response.body.pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).text();
}
async function gunzipBlock(id){
  if(!('DecompressionStream' in window))throw Error('Current Chrome, Edge, or Android Chrome is required to unpack the offline well backup.');
  const local=id==='st37SurfaceEmbedded'?'data/st37-surface.txt.gz':id==='st37BoreEmbedded'?'data/st37-bore.txt.gz':null;
  if(!local)throw Error('Unknown offline well data block.');
  try{
    const response=await fetch(local);
    return await gunzipResponse(response);
  }catch(e){
    console.warn('Local well snapshot unavailable',e);
    throw Error('The offline well backup is not available on this device yet. Open R5 Atlas online, load Wells once, then retry offline.');
  }
}
async function ensureSt37(){
  if(st37Ready)return;
  if(st37Promise)return st37Promise;
  st37Promise=(async()=>{
    const status=document.getElementById('st37Status');
    const meta=await fetchSt37Meta();
    const surfaceExpected=Number(meta?.surfaceRecords)||539475;
    const boreExpected=Number(meta?.bottomHoleRecords)||537514;
    status.textContent=`Unpacking ${surfaceExpected.toLocaleString()} surface holes...`;
    let txt=await gunzipBlock('st37SurfaceEmbedded');
    let surfaceLoaded=0;
    st37Lines(txt,line=>{
      if(!line||line[0]==='#')return;
      const p=line.split('\x1f');
      if(p.length<8)return;
      const r=[+p[1],+p[2],p[3],p[4],p[5],p[6],p[7],p[8]||''];
      if(!Number.isFinite(r[0])||!Number.isFinite(r[1]))return;
      let b=surfaceGrid.get(p[0]);
      if(!b)surfaceGrid.set(p[0],b=[]);
      b.push(r);
      surfaceLoaded++;
    });
    txt=null;
    await new Promise(r=>requestAnimationFrame(r));
    status.textContent=`Surface holes ready. Unpacking ${boreExpected.toLocaleString()} bottom-hole records...`;
    txt=await gunzipBlock('st37BoreEmbedded');
    let boreLoaded=0;
    st37Lines(txt,line=>{
      if(!line||line[0]==='#')return;
      const p=line.split('\x1f');
      if(p.length<12||!p[0])return;
      const r=[p[1],p[2],p[3],p[4]?+p[4]:null,p[5]?+p[5]:null,p[6]?+p[6]:null,p[7]?+p[7]:null,p[8],p[9],p[10],p[11]];
      let b=boresByLicence.get(p[0]);
      if(!b)boresByLicence.set(p[0],b=[]);
      b.push(r);
      boreLoaded++;
    });
    txt=null;
    st37Ready=true;
    const generated=meta?.generatedAt?formatHistoryDate(meta.generatedAt):'legacy August 2026';
    status.textContent=`Offline well snapshot ready • ${surfaceLoaded.toLocaleString()} surface holes • ${boreLoaded.toLocaleString()} bottom holes • refreshed ${generated}`;
  })();
  return st37Promise;
}
function candidateSurfaces(){if(!job)return[];let minLat,maxLat,minLng,maxLng;if(wellMode.type==='lsd'&&job.geometry?.rings?.[0]){const ring=job.geometry.rings[0];minLat=Math.min(...ring.map(x=>x[1]));maxLat=Math.max(...ring.map(x=>x[1]));minLng=Math.min(...ring.map(x=>x[0]));maxLng=Math.max(...ring.map(x=>x[0]));}else{const km=wellMode.km||2,dlat=km/111.2,dlng=km/(111.2*Math.cos(job.lat*Math.PI/180));minLat=job.lat-dlat;maxLat=job.lat+dlat;minLng=job.lng-dlng;maxLng=job.lng+dlng}const out=[];for(let a=Math.floor(minLat*10);a<=Math.floor(maxLat*10);a++)for(let c=Math.floor(minLng*10);c<=Math.floor(maxLng*10);c++){const rows=surfaceGrid.get(`${a}:${c}`)||[];rows.forEach(r=>{if(r[0]<minLat||r[0]>maxLat||r[1]<minLng||r[1]>maxLng)return;if(wellMode.type==='lsd'){if(!pointInJobPolygon(r[0],r[1]))return}else if(haversineKm(job.lat,job.lng,r[0],r[1])>wellMode.km)return;out.push({lat:r[0],lng:r[1],licence:r[2],licensee:r[3],status:r[4],statusDate:r[5],category:r[6],surfaceDls:r[7]||''})})}return out}
function groupPads(surfaces){const m=new Map();surfaces.forEach(s=>{const key=`${s.lat.toFixed(6)}|${s.lng.toFixed(6)}`;let p=m.get(key);if(!p)m.set(key,p={key,lat:s.lat,lng:s.lng,surfaces:[],bores:[],distance:haversineKm(job.lat,job.lng,s.lat,s.lng),surfaceDls:s.surfaceDls||((wellMode.type==='lsd'&&pointInJobPolygon(s.lat,s.lng))?job.ats:'')});p.surfaces.push(s);const bs=boresByLicence.get(s.licence)||[];if(bs.length)bs.forEach(b=>p.bores.push({licence:s.licence,licensee:s.licensee,status:s.status,statusDate:s.statusDate,uwi:b[0]||'',rawUwi:b[1]||'',name:b[2]||'',tmd:Number.isFinite(b[3])&&b[3]>0?b[3]:null,tvd:Number.isFinite(b[4])&&b[4]>0?b[4]:null,bhLat:Number.isFinite(b[5])?b[5]:null,bhLng:Number.isFinite(b[6])?b[6]:null,type:b[10]||s.category||''}));else p.bores.push({licence:s.licence,licensee:s.licensee,status:s.status,statusDate:s.statusDate,uwi:'',rawUwi:'',name:`AER Licence ${s.licence}`,tmd:null,tvd:null,bhLat:null,bhLng:null,type:s.category||''})});return[...m.values()].sort((a,b)=>a.distance-b.distance)}
function clearWellMarkers(){wellClusterLayer.clearLayers();wellMarkers=[];loadedPads=[]}
function clearWellMarkersOnly(){wellClusterLayer.clearLayers();wellMarkers=[]}
function displayUwi(b){return b.uwi||b.rawUwi||'Not reported'}
function displaySurfaceDls(v){return String(v||'').trim().replace(/\s+/g,'').replace(/W([456])M$/i,'W$1')}
function depthText(v){return Number.isFinite(v)&&v>0?`${v.toLocaleString(undefined,{maximumFractionDigits:1})} m`:'Not reported'}
function aerSummaryUrl(raw){if(!raw)return AER_SUMMARY_BASE+'?%3Aembed=y&%3AshowShareOptions=true&%3Adisplay_count=no&%3AshowVizHome=no&%3Arefresh=y';const params=new URLSearchParams();params.set('Enter Well Identifier (UWI)',raw);params.set(':embed','y');params.set(':showShareOptions','true');params.set(':display_count','no');params.set(':showVizHome','no');params.set(':refresh','y');return `${AER_SUMMARY_BASE}?${params.toString()}#3`}


function normalizeCompanyName(v){return String(v||'').trim().replace(/\s+/g,' ').toLowerCase()}
function parseStatusDate(v){const t=Date.parse(v||'');return Number.isFinite(t)?t:0}
function countMap(items,keyFn){const m=new Map();items.forEach(x=>{const k=keyFn(x)||'Not reported';m.set(k,(m.get(k)||0)+1)});return [...m.entries()].sort((a,b)=>b[1]-a[1])}
async function getCompanyProfile(name){const norm=normalizeCompanyName(name);if(companyCache.has(norm))return companyCache.get(norm);await ensureSt37();const surfaces=[];let bucket=0;for(const rows of surfaceGrid.values()){for(const r of rows){if(normalizeCompanyName(r[3])===norm)surfaces.push({lat:r[0],lng:r[1],licence:r[2],licensee:r[3],status:r[4],statusDate:r[5],category:r[6]})}if(++bucket%250===0)await new Promise(res=>setTimeout(res,0))}const dedup=new Map();surfaces.forEach(x=>dedup.set(`${x.licence}|${x.lat.toFixed(6)}|${x.lng.toFixed(6)}`,x));const records=[...dedup.values()].map(surf=>{const bores=(boresByLicence.get(surf.licence)||[]).map(b=>({uwi:b[0]||'',rawUwi:b[1]||'',name:b[2]||'',tmd:Number.isFinite(b[3])&&b[3]>0?b[3]:null,tvd:Number.isFinite(b[4])&&b[4]>0?b[4]:null,bhLat:Number.isFinite(b[5])?b[5]:null,bhLng:Number.isFinite(b[6])?b[6]:null,licensee:b[7]||surf.licensee,status:b[8]||surf.status,statusDate:b[9]||surf.statusDate,category:b[10]||surf.category}));return{...surf,bores}});let maxTmd=null,maxTvd=null,wellbores=0;records.forEach(r=>r.bores.forEach(b=>{wellbores++;if(b.tmd&&(maxTmd===null||b.tmd>maxTmd))maxTmd=b.tmd;if(b.tvd&&(maxTvd===null||b.tvd>maxTvd))maxTvd=b.tvd}));const latest=Math.max(0,...records.map(r=>parseStatusDate(r.statusDate)));const profile={name:records[0]?.licensee||name,records,licences:new Set(records.map(r=>r.licence)).size,wellbores,maxTmd,maxTvd,latest,statuses:countMap(records,r=>r.status),categories:countMap(records,r=>r.category)};companyCache.set(norm,profile);return profile}
function companyRecordText(r){return [r.licence,r.status,r.statusDate,r.category,r.lat,r.lng,...r.bores.flatMap(b=>[b.uwi,b.rawUwi,b.name,b.status,b.category])].join(' ').toLowerCase()}
function renderCompanyWellList(){if(!companyState)return;const q=(document.getElementById('companySearch')?.value||'').trim().toLowerCase();const filtered=companyState.profile.records.filter(r=>!q||companyRecordText(r).includes(q));const shown=filtered.slice(0,companyRenderLimit);document.getElementById('companyListCount').textContent=`${filtered.length.toLocaleString()} surface locations match`;document.getElementById('companyWellList').innerHTML=shown.map(r=>`<article class="company-well"><h4>Licence ${esc(r.licence)}</h4><div class="company-well-lines"><b>Status:</b> ${esc(r.status||'Not reported')} ${r.statusDate?`• ${esc(r.statusDate)}`:''}<br><b>Surface GPS:</b> <span class="mono">${r.lat.toFixed(6)}, ${r.lng.toFixed(6)}</span><br><b>Category:</b> ${esc(r.category||'Not reported')}</div>${r.bores.length?`<div style="margin-top:7px">${r.bores.map(b=>`<div class="bore" style="padding-top:7px"><b>${esc(b.name||displayUwi(b))}</b><div class="company-well-lines">UWI: <span class="mono">${esc(displayUwi(b))}</span><br>TVD: ${depthText(b.tvd)} • TMD: ${depthText(b.tmd)}</div></div>`).join('')}</div>`:'<div class="smallnote" style="margin-top:6px">No Bottom Hole record attached in this ST37 snapshot.</div>'}<div class="actions"><a target="_blank" rel="noopener" href="${mapsSearch(r.lat,r.lng)}">Map</a>${job?`<a target="_blank" rel="noopener" href="${directions(job.lat,job.lng,r.lat,r.lng)}">Directions</a>`:''}<button data-company-dls="${r.lat},${r.lng}">Resolve Surface DLS</button></div></article>`).join('')||'<div class="status">No wells match this company search.</div>';const more=document.getElementById('companyLoadMore');more.classList.toggle('hidden',shown.length>=filtered.length);more.textContent=`Load more (${Math.min(100,filtered.length-shown.length).toLocaleString()})`;document.querySelectorAll('[data-company-dls]').forEach(b=>b.onclick=async()=>{const [lat,lng]=b.dataset.companyDls.split(',').map(Number);const original=b.textContent;b.textContent='Resolving...';try{const x=await identifyPoint(lat,lng);b.textContent=x.ats}catch{b.textContent='Could not resolve';setTimeout(()=>b.textContent=original,1800)}})}

function companyH2sSummary(categories){
  const tiers={zero:{single:0,multi:0},low:{single:0,multi:0},medium:{single:0,multi:0},high:{single:0,multi:0},veryHigh:{single:0,multi:0},historic:0,other:0};
  for(const [raw,count] of categories||[]){
    const c=String(raw||'').replace(/\s+/g,' ').trim();
    const lc=c.toLowerCase();
    const isMulti=lc.includes('multiwell');
    const type=isMulti?'multi':'single';
    if(lc.includes('bwl historic')){tiers.historic+=count;continue}
    if(lc.includes('0.00 mol/kmol')&&!lc.includes('>0.00')&&!lc.includes('> 0.00')){tiers.zero[type]+=count;continue}
    if((lc.includes('>0.00')||lc.includes('> 0.00'))&&lc.includes('< 0.01')){tiers.low[type]+=count;continue}
    if((lc.includes('>= 0.01')||lc.includes('>=0.01'))&&lc.includes('< 0.3')){tiers.medium[type]+=count;continue}
    if((lc.includes('>= 0.3')||lc.includes('>=0.3'))&&lc.includes('< 2.0')){tiers.high[type]+=count;continue}
    if(lc.includes('>= 2.0')||lc.includes('>=2.0')){tiers.veryHigh[type]+=count;continue}
    tiers.other+=count;
  }
  const card=(cls,title,desc,t)=>`<div class="h2s-tier ${cls}"><div class="h2s-tier-title">${title}</div><div class="h2s-tier-desc">${desc}</div><div class="h2s-tier-counts"><div class="h2s-tier-count">Single wells<b>${t.single.toLocaleString()}</b></div><div class="h2s-tier-count">Multiwell pads<b>${t.multi.toLocaleString()}</b></div></div></div>`;
  let html='<div class="h2s-summary">';
  if(tiers.zero.single||tiers.zero.multi)html+=card('h2s-zero','🟢 No H₂S reported','AER category reports 0.00 mol/kmol H₂S.',tiers.zero);
  if(tiers.low.single||tiers.low.multi)html+=card('h2s-low','🟡 H₂S present • lower release rate','H₂S is reported, with an AER release-rate category below 0.01 m³/s.',tiers.low);
  if(tiers.medium.single||tiers.medium.multi)html+=card('h2s-medium','🟠 H₂S present • moderate release rate','AER release-rate category is 0.01 to less than 0.3 m³/s.',tiers.medium);
  if(tiers.high.single||tiers.high.multi)html+=card('h2s-high','🔴 H₂S present • higher release rate','AER release-rate category is 0.3 to less than 2.0 m³/s.',tiers.high);
  if(tiers.veryHigh.single||tiers.veryHigh.multi)html+=card('h2s-very-high','🟣 H₂S present • very high release rate','AER release-rate category is 2.0 m³/s or greater.',tiers.veryHigh);
  if(tiers.historic)html+=`<div class="h2s-tier h2s-historic"><div class="h2s-tier-title">⚪ Historic wells</div><div class="h2s-tier-desc">BWL historic records are kept separate because this category does not provide a comparable H₂S release tier here.</div><div class="h2s-tier-counts"><div class="h2s-tier-count">Historic well records<b>${tiers.historic.toLocaleString()}</b></div></div></div>`;
  if(tiers.other)html+=`<div class="h2s-tier"><div class="h2s-tier-title">Other / ungrouped categories</div><div class="h2s-tier-desc">Records that do not match the common AER H₂S categories above.</div><div class="h2s-tier-counts"><div class="h2s-tier-count">Records<b>${tiers.other.toLocaleString()}</b></div></div></div>`;
  html+='</div><div class="h2s-footnote">Plain-language grouping of the AER ST37 well categories. Release rate is not the same thing as ppm concentration. Always use the site hazard assessment, signage, monitors and required PPE.</div>';
  return html;
}
const COMPANY_WELL_TYPES={
  active:{label:'Active / Producing',color:'#16a34a'},
  issued:{label:'Issued / Amended',color:'#2563eb'},
  abandoned:{label:'Abandoned',color:'#dc2626'},
  suspended:{label:'Suspended / Inactive',color:'#d97706'},
  cancelled:{label:'Cancelled / Expired',color:'#64748b'},
  other:{label:'Other Status',color:'#7c3aed'}
};
function companyWellType(r){
  const s=String(r?.status||'').trim().toLowerCase();
  if(/abandon/.test(s))return'abandoned';
  if(/suspend|inactive|shut.?in|dormant/.test(s))return'suspended';
  if(/cancel|expire|rescinded|withdrawn|void/.test(s))return'cancelled';
  if(/active|flowing|producing|production|on prod|completed|drilled/.test(s))return'active';
  if(/issued|amended|approved|licen[cs]ed/.test(s))return'issued';
  return'other';
}
function companyMapPopupHtml(r){
  const bores=r.bores||[];
  const typeKey=companyWellType(r),type=COMPANY_WELL_TYPES[typeKey];
  const boreText=bores.length?bores.slice(0,6).map(b=>`<div style="margin-top:6px"><b>${esc(b.name||displayUwi(b))}</b><br>UWI: <span class="mono">${esc(displayUwi(b))}</span><br>TVD: ${depthText(b.tvd)} • TMD: ${depthText(b.tmd)}</div>`).join(''):'<div style="margin-top:6px">No attached Bottom Hole record in this ST37 snapshot.</div>';
  const extra=bores.length>6?`<div style="margin-top:5px">+ ${(bores.length-6).toLocaleString()} more wellbore(s)</div>`:'';
  return `<div class="company-only-popup"><b>${esc(r.licensee||companyState?.profile?.name||'Licensee')}</b><br><span style="display:inline-flex;align-items:center;gap:5px;margin:4px 0"><span style="width:9px;height:9px;border-radius:50%;background:${type.color};display:inline-block"></span><b>${esc(type.label)}</b></span><br>ST37 status: ${esc(r.status||'Not reported')}<br>Licence: ${esc(r.licence||'Not reported')}<br>Surface GPS: <span class="mono">${r.lat.toFixed(6)}, ${r.lng.toFixed(6)}</span>${boreText}${extra}</div>`;
}
function renderCompanyMapFilters(profile){
  const host=document.getElementById('companyMapFilters');
  if(!host)return;
  const counts={active:0,issued:0,abandoned:0,suspended:0,cancelled:0,other:0};
  profile.records.forEach(r=>counts[companyWellType(r)]++);
  host.innerHTML=Object.entries(COMPANY_WELL_TYPES).filter(([k])=>counts[k]>0).map(([k,t])=>`<button type="button" class="company-type-filter ${companyMapTypeFilters[k]?'':'off'}" data-company-map-type="${k}" aria-pressed="${companyMapTypeFilters[k]}"><span class="company-type-swatch" style="background:${t.color}"></span><span>${esc(t.label)}</span><span class="company-type-count">${counts[k].toLocaleString()}</span></button>`).join('');
  host.querySelectorAll('[data-company-map-type]').forEach(btn=>btn.addEventListener('click',()=>{
    const key=btn.dataset.companyMapType;
    companyMapTypeFilters[key]=!companyMapTypeFilters[key];
    renderCompanyMapFilters(profile);
    renderCompanyWellsMap(profile,true);
  }));
}
function renderCompanyWellsMap(profile,fitVisible=true){
  if(!companyMapInstance||!profile)return;
  if(companyMapLayer)companyMapLayer.remove();
  companyMapLayer=L.layerGroup().addTo(companyMapInstance);
  const bounds=[];
  const renderer=L.canvas({padding:.5});
  let visible=0;
  for(const r of profile.records){
    if(!Number.isFinite(r.lat)||!Number.isFinite(r.lng))continue;
    const typeKey=companyWellType(r);
    if(!companyMapTypeFilters[typeKey])continue;
    const type=COMPANY_WELL_TYPES[typeKey];
    const marker=L.circleMarker([r.lat,r.lng],{renderer,radius:5.5,weight:1.4,color:'#fff',fillColor:type.color,fillOpacity:.92});
    marker.bindPopup(companyMapPopupHtml(r),{maxWidth:320});
    marker.addTo(companyMapLayer);
    bounds.push([r.lat,r.lng]);
    visible++;
  }
  document.getElementById('companyMapSubtitle').textContent=`${visible.toLocaleString()} of ${profile.records.length.toLocaleString()} surface locations shown • Offline AER well snapshot • August 2026`;
  if(fitVisible&&bounds.length)companyMapInstance.fitBounds(L.latLngBounds(bounds).pad(.04),{maxZoom:12});
}
function openCompanyWellsMap(profile){
  if(!profile?.records?.length)return;
  companyMapProfile=profile;
  companyMapTypeFilters={active:true,issued:true,abandoned:true,suspended:true,cancelled:true,other:true};
  const back=document.getElementById('companyMapBackdrop');
  back.classList.remove('hidden');
  document.getElementById('companyMapTitle').textContent=profile.name;
  document.getElementById('companyMapSubtitle').textContent=`${profile.records.length.toLocaleString()} surface locations • Offline AER well snapshot • August 2026`;
  document.body.style.overflow='hidden';
  renderCompanyMapFilters(profile);
  requestAnimationFrame(()=>{
    if(!companyMapInstance){
      companyMapInstance=L.map('companyOnlyMap',{zoomControl:true,preferCanvas:true}).setView([53.65,-114.4],5);
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; OpenStreetMap contributors'}).addTo(companyMapInstance);
      L.control.scale({imperial:false}).addTo(companyMapInstance);
    }
    companyMapInstance.invalidateSize();
    renderCompanyWellsMap(profile,true);
  });
}
function closeCompanyWellsMap(){
  document.getElementById('companyMapBackdrop').classList.add('hidden');
  companyMapProfile=null;
  document.body.style.overflow=document.getElementById('companyBackdrop').classList.contains('hidden')?'':'hidden';
}
async function openCompanyProfile(name){const back=document.getElementById('companyBackdrop'),body=document.getElementById('companyBody');back.classList.remove('hidden');document.body.style.overflow='hidden';document.getElementById('companyTitle').textContent=name;document.getElementById('companySubtitle').textContent='Building company profile from local AER well snapshot...';body.innerHTML='<div class="company-loading"><div class="company-spinner"></div>Finding every surface location and wellbore for this licensee...</div>';try{const p=await getCompanyProfile(name);companyState={profile:p};companyRenderLimit=100;document.getElementById('companyTitle').textContent=p.name;document.getElementById('companySubtitle').textContent='Offline AER well snapshot • August 2026';const statusPills=p.statuses.slice(0,12).map(([k,v])=>`<span class="stat-pill">${esc(k)}: ${v.toLocaleString()}</span>`).join('');const h2sSummary=companyH2sSummary(p.categories);body.innerHTML=`<div class="company-summary"><div class="metric"><b>${p.records.length.toLocaleString()}</b><span>Surface locations</span></div><div class="metric"><b>${p.licences.toLocaleString()}</b><span>Unique licences</span></div><div class="metric"><b>${p.wellbores.toLocaleString()}</b><span>Wellbores</span></div><div class="metric"><b>${depthText(p.maxTvd)}</b><span>Deepest reported TVD</span></div><div class="metric"><b>${depthText(p.maxTmd)}</b><span>Deepest reported TMD</span></div><div class="metric"><b>${p.latest?new Date(p.latest).toLocaleDateString():'Not reported'}</b><span>Latest status date</span></div></div><div class="company-detail-card"><h3>Licence Status Breakdown</h3><div class="stat-pills">${statusPills||'<span class="smallnote">No status information.</span>'}</div></div><div class="company-detail-card"><h3>H₂S / Well Safety Categories</h3>${h2sSummary}</div><div class="company-detail-card"><h3>Company Actions</h3><div class="actions"><button id="companyMapAll">Fit company wells on map</button><button id="companyCopySummary">Copy company summary</button><a target="_blank" rel="noopener" href="${AER_LICENCE_CSV}">Latest AER Licence CSV</a></div><div class="smallnote">ST37 identifies the licensee. It does not provide a separate corporate contact profile or guarantee licensee and operator are the same entity.</div></div><div class="company-wells-head"><div class="card-title-row"><h3 style="margin:0">All Wells</h3><span id="companyListCount" class="smallnote"></span></div><input id="companySearch" class="company-search" style="width:100%;margin-top:7px" placeholder="Search this company by well name, UWI, licence or status"></div><div id="companyWellList" class="company-well-list"></div><button id="companyLoadMore" class="mini-btn company-load-more">Load more</button>`;document.getElementById('companySearch').oninput=()=>{companyRenderLimit=100;renderCompanyWellList()};document.getElementById('companyLoadMore').onclick=()=>{companyRenderLimit+=100;renderCompanyWellList()};document.getElementById('companyMapAll').onclick=()=>openCompanyWellsMap(p);document.getElementById('companyCopySummary').onclick=async()=>{const txt=`${p.name}\nSurface locations: ${p.records.length}\nUnique licences: ${p.licences}\nWellbores: ${p.wellbores}\nDeepest reported TVD: ${depthText(p.maxTvd)}\nDeepest reported TMD: ${depthText(p.maxTmd)}\nData: Offline AER well snapshot • August 2026`;await copyText(txt,'Company summary copied')};renderCompanyWellList()}catch(e){body.innerHTML=`<div class="status error">${esc(e.message||'Could not build company profile.')}</div>`}}
function closeCompanyProfile(){document.getElementById('companyBackdrop').classList.add('hidden');document.body.style.overflow=''}
function setNoteSaveState(text,cls='saved'){const el=document.getElementById('noteSaveState');if(!el)return;el.textContent=text;el.className=`save-state ${cls}`}


// Persistence and field UX
const NOTES_KEY='albertaOilfieldFieldMapNotesV17';
let notesStore={};let selectedSurfacePad=null;let selectedSurfaceBore=0;let atsOverlay=null;let atsOverlayOn=true;let atsOverlayTimer=null;let toastTimer=null;
function showToast(msg,ms=3200){const el=document.getElementById('appToast');el.textContent=msg;el.classList.remove('hidden');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.add('hidden'),ms)}
async function copyText(text,successMessage='Copied'){
  try{
    await navigator.clipboard.writeText(text);
    showToast(successMessage);
    return true;
  }catch(e){
    console.warn('Clipboard write failed',e);
    showToast('Copy failed. Allow clipboard access and try again.',4200);
    return false;
  }
}
function confirmAction(message,confirmLabel='Continue'){
  return new Promise(resolve=>{
    const overlay=document.createElement('div');
    overlay.className='r5-confirm-backdrop';
    const dialog=document.createElement('div');
    dialog.className='r5-confirm-dialog';
    dialog.setAttribute('role','dialog');
    dialog.setAttribute('aria-modal','true');
    const text=document.createElement('p');
    text.textContent=message;
    const actions=document.createElement('div');
    actions.className='r5-confirm-actions';
    const cancel=document.createElement('button');
    cancel.type='button';
    cancel.textContent='Cancel';
    const ok=document.createElement('button');
    ok.type='button';
    ok.className='primary-btn';
    ok.textContent=confirmLabel;
    const finish=value=>{overlay.remove();resolve(value)};
    cancel.onclick=()=>finish(false);
    ok.onclick=()=>finish(true);
    overlay.onclick=e=>{if(e.target===overlay)finish(false)};
    actions.append(cancel,ok);
    dialog.append(text,actions);
    overlay.append(dialog);
    document.body.append(overlay);
    cancel.focus();
  });
}
function loadNotesStore(){try{notesStore=JSON.parse(R5Storage.getItem(NOTES_KEY)||'{}')||{}}catch{notesStore={}}}
function jobNoteKey(){return job?String(job.ats||`${job.lat.toFixed(5)},${job.lng.toFixed(5)}`).replace(/\s+/g,'').toUpperCase():''}
function persistNoteNow(){if(!job)return;const key=jobNoteKey(),val=document.getElementById('jobNotes').value||'';notesStore[key]=val;try{R5Storage.setItem(NOTES_KEY,JSON.stringify(notesStore));setNoteSaveState('Saved to this browser','saved')}catch(e){setNoteSaveState('Could not save notes','error')}return val}
function restoreNoteForJob(){if(!job)return;const saved=notesStore[jobNoteKey()];if(saved!=null)document.getElementById('jobNotes').value=saved;setNoteSaveState('Saved to this browser','saved')}
function queueNoteSave(){setNoteSaveState('Saving...','');clearTimeout(noteSaveTimer);noteSaveTimer=setTimeout(()=>{persistNoteNow();saveJobHistory(true)},220)}
function compactGeometry(g){if(!g?.rings?.[0])return null;return{rings:[g.rings[0].map(([x,y])=>[+x.toFixed(6),+y.toFixed(6)])]}}
function saveHistoryStorage(){try{R5Storage.setItem(HISTORY_KEY,JSON.stringify(history.slice(0,40)));return true}catch(e){showToast('History storage is full. Notes are still saved separately.');return false}}
function historyAtsKey(v){return String(v||'').replace(/\\s+/g,'').toUpperCase()}
function historyTime(v){const t=Date.parse(v||'');return Number.isFinite(t)?t:0}
function formatHistoryDate(v){const t=historyTime(v);if(!t)return'Unknown';try{return new Date(t).toLocaleString(undefined,{year:'numeric',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})}catch{return String(v||'Unknown')}}
function mergeHistoryByLsd(records){
  const merged=new Map();
  for(const raw of records||[]){
    if(!raw)continue;
    const h={...raw,geometry:compactGeometry(raw.geometry)};
    const key=historyAtsKey(h.ats)||`ID:${h.id||Math.random()}`;
    const first=h.firstSearched||h.created||h.lastSearched||new Date().toISOString();
    const last=h.lastSearched||h.created||first;
    h.firstSearched=first;h.lastSearched=last;h.created=h.created||first;h.searchCount=Math.max(1,Number(h.searchCount)||1);
    const x=merged.get(key);
    if(!x){merged.set(key,h);continue}
    if(historyTime(h.firstSearched)<historyTime(x.firstSearched))x.firstSearched=h.firstSearched;
    if(historyTime(h.lastSearched)>historyTime(x.lastSearched)){
      const keepFirst=x.firstSearched,keepCount=x.searchCount;
      Object.assign(x,h);
      x.firstSearched=keepFirst;
      x.searchCount=keepCount;
    }
    x.searchCount=(Number(x.searchCount)||0)+(Number(h.searchCount)||1);
    for(const field of ['notes','selectedDisposal','surfaceDls','licensee','uwi','surfaceCount','geometry','lat','lng'])if((x[field]==null||x[field]==='')&&h[field]!=null&&h[field]!=='')x[field]=h[field];
  }
  return[...merged.values()].sort((a,b)=>historyTime(b.lastSearched)-historyTime(a.lastSearched));
}
function loadHistory(){
  try{history=JSON.parse(R5Storage.getItem(HISTORY_KEY)||'[]')||[]}catch{history=[]}
  history=mergeHistoryByLsd(history);
  for(const h of history){
    if(h.notes&&h.ats){
      const k=historyAtsKey(h.ats);
      if(notesStore[k]==null)notesStore[k]=h.notes;
    }
  }
  try{R5Storage.setItem(NOTES_KEY,JSON.stringify(notesStore))}catch{}
  saveHistoryStorage();
  renderHistory();
}
function saveJobHistory(updateOnly=false){
  if(!job)return;
  const notes=persistNoteNow()??'';
  const key=historyAtsKey(job.ats);
  let item=currentHistoryId?history.find(x=>x.id===currentHistoryId):null;
  if(!item&&key)item=history.find(x=>historyAtsKey(x.ats)===key)||null;
  const now=new Date().toISOString();
  if(!item){
    item={id:Date.now(),created:now,firstSearched:now,lastSearched:now,searchCount:updateOnly?0:1};
    history.unshift(item);
  }else if(!updateOnly){
    item.firstSearched=item.firstSearched||item.created||now;
    item.lastSearched=now;
    item.searchCount=Math.max(0,Number(item.searchCount)||0)+1;
    history=[item,...history.filter(x=>x!==item)];
  }
  currentHistoryId=item.id;
  const rememberedDisposal=selectedDisposal??item.selectedDisposal??null;
  Object.assign(item,{ats:job.ats,lat:job.lat,lng:job.lng,geometry:compactGeometry(job.geometry)||item.geometry||null,notes,selectedDisposal:rememberedDisposal});
  if(!item.firstSearched)item.firstSearched=item.created||now;
  if(!item.lastSearched)item.lastSearched=item.created||now;
  if(!Number.isFinite(+item.searchCount)||+item.searchCount<1)item.searchCount=1;
  if(selectedSurfacePad){
    const b=selectedSurfacePad.bores?.[selectedSurfaceBore]||selectedSurfacePad.bores?.[0];
    item.surfaceDls=displaySurfaceDls(selectedSurfacePad.surfaceDls)||job.ats;
    item.licensee=b?.licensee||selectedSurfacePad.surfaces?.[0]?.licensee||item.licensee||'';
    item.uwi=b?displayUwi(b):(item.uwi||'');
  }
  saveHistoryStorage();
  renderHistory();
  return item;
}
function updateHistorySurfaceInfo(p=loadedPads[0]){
  if(!p||!job)return;
  selectedSurfacePad=selectedSurfacePad||p;
  const b=p.bores?.[selectedSurfaceBore]||p.bores?.[0];
  const item=currentHistoryId?history.find(x=>x.id===currentHistoryId):history.find(x=>historyAtsKey(x.ats)===historyAtsKey(job.ats));
  if(item){
    item.surfaceDls=displaySurfaceDls(p.surfaceDls)||job.ats;
    item.licensee=b?.licensee||p.surfaces?.[0]?.licensee||item.licensee||'';
    item.uwi=b?displayUwi(b):(item.uwi||'');
    item.surfaceCount=loadedPads.length;
    saveHistoryStorage();
    renderHistory();
  }
  updateMapJobBar();
}
function renderHistory(){
  const el=document.getElementById('historyList');
  const countBadge=document.getElementById('historyCountBadge');
  if(countBadge)countBadge.textContent=`${history.length} saved`;
  el.innerHTML=history.map(h=>{
    const main=`${h.surfaceDls||h.ats}${h.licensee?` - ${h.licensee}`:''}`;
    const count=Math.max(1,Number(h.searchCount)||1);
    const first=formatHistoryDate(h.firstSearched||h.created);
    const last=formatHistoryDate(h.lastSearched||h.created);
    const searched=count>1?`First searched: ${first} • Last searched: ${last} • ${count} searches`:`Searched: ${last}`;
    return `<div class="history-item"><div><b>${esc(main)}</b><div class="sub">Job: ${esc(h.ats||'')}</div><div class="sub">${esc(searched)}</div>${h.uwi?`<div class="sub mono">${esc(h.uwi)}</div>`:''}${h.notes?`<div class="sub">${esc(h.notes.slice(0,160))}</div>`:''}</div><div class="actions"><button data-load-history="${h.id}">Load</button><button data-del-history="${h.id}">Delete</button></div></div>`;
  }).join('')||'<div class="status">No saved jobs yet.</div>';
  document.querySelectorAll('[data-load-history]').forEach(b=>b.onclick=()=>loadHistoryItem(+b.dataset.loadHistory));
  document.querySelectorAll('[data-del-history]').forEach(b=>b.onclick=()=>{
    history=history.filter(x=>x.id!=b.dataset.delHistory);
    saveHistoryStorage();
    renderHistory();
  });
}
async function loadHistoryItem(id){
  const h=history.find(x=>x.id===id);
  if(!h)return;
  currentHistoryId=id;
  document.getElementById('jobNotes').value=h.notes||notesStore[historyAtsKey(h.ats)]||'';
  try{
    let r;
    if(h.geometry)r={ats:h.ats,lat:+h.lat,lng:+h.lng,geometry:h.geometry};
    else r=await performJobLookup(parseJobInput(h.ats));
    await setJob(r,{save:false});
    selectedDisposal=h.selectedDisposal??null;
    if(selectedDisposal)selectDisposal(+selectedDisposal);
    showToast(`Loaded saved LSD • last searched ${formatHistoryDate(h.lastSearched||h.created)}`,4200);
  }catch(e){showToast(`Could not reload job: ${e.message}`)}
}
function h2sPlainText(category){const c=String(category||'').trim();if(/H2S|H₂S|SOUR/i.test(c))return{warn:true,title:'H₂S / sour-gas caution',text:'This record is flagged for H₂S or sour gas. H₂S is a poisonous gas that can be deadly. Follow the site’s H₂S procedures, signage, monitoring and PPE requirements.'};return{warn:false,title:'H₂S information',text:'No H₂S warning is shown in this ST37 record. That does not prove the location is H₂S-free. Always follow the site-specific hazard assessment, signage and monitoring requirements.'}}
function updateMapJobBar(){const bar=document.getElementById('mapJobBar');if(!job){bar.classList.add('hidden');return}if(!document.getElementById('wellSelectionBar').classList.contains('hidden')){bar.classList.add('hidden');return}bar.classList.remove('hidden');document.getElementById('mapJobTitle').textContent=job.ats;const p=selectedSurfacePad||loadedPads[0],b=p?.bores?.[0];const parts=[];if(loadedPads.length)parts.push(`${loadedPads.length} surface well${loadedPads.length===1?'':'s'} in area`);if(p)parts.push(displaySurfaceDls(p.surfaceDls)||job.ats);if(b?.licensee)parts.push(b.licensee);document.getElementById('mapJobSub').textContent=parts.join(' • ')||'Tap Job, Wells or Disposals below.'}
function hideWellSelection(){document.getElementById('wellSelectionBar').classList.add('hidden');if(job)updateMapJobBar()}
function selectSurfacePad(p,boreIndex=0){selectedSurfacePad=p;selectedSurfaceBore=Math.min(boreIndex,Math.max(0,(p.bores?.length||1)-1));const b=p.bores?.[selectedSurfaceBore]||p.bores?.[0];const bar=document.getElementById('wellSelectionBar');document.getElementById('mapJobBar').classList.add('hidden');bar.classList.remove('hidden');document.getElementById('wellSelectionTitle').textContent=displaySurfaceDls(p.surfaceDls)||'Surface Location';document.getElementById('wellSelectionSub').textContent=[b?.name||displayUwi(b||{}),b?.licensee].filter(Boolean).join(' • ');updateHistorySurfaceInfo(p);map.panTo([p.lat,p.lng],{animate:true})}
function openWellDetail(p=selectedSurfacePad,boreIndex=selectedSurfaceBore){if(!p)return;selectedSurfacePad=p;selectedSurfaceBore=boreIndex;const b=p.bores?.[boreIndex]||p.bores?.[0]||{};const safety=h2sPlainText(b.type);document.getElementById('wellDetailTitle').textContent=displaySurfaceDls(p.surfaceDls)||'Surface Well';document.getElementById('wellDetailBody').innerHTML=`<div class="detail-group surface-priority"><h3>Surface Location</h3><div class="detail-grid"><div class="label">Surface DLS</div><div class="value mono">${esc(displaySurfaceDls(p.surfaceDls)||job?.ats||'Not resolved')}</div><div class="label">Surface GPS</div><div class="value mono">${p.lat.toFixed(6)}, ${p.lng.toFixed(6)}</div><div class="label">From job</div><div class="value">${p.distance.toFixed(2)} km straight-line</div></div><div class="actions"><a target="_blank" rel="noopener" href="${directions(job.lat,job.lng,p.lat,p.lng)}">Directions to Surface</a><a target="_blank" rel="noopener" href="${mapsSearch(p.lat,p.lng)}">Open Map</a></div></div><div class="detail-group"><h3>Well</h3>${p.bores.length>1?`<div class="toolbar-row" style="margin-bottom:10px">${p.bores.map((x,i)=>`<button class="chip detail-bore ${i===boreIndex?'active':''}" data-detail-bore="${i}">${i+1}</button>`).join('')}</div>`:''}<div class="detail-grid"><div class="label">Well name</div><div class="value">${esc(b.name||displayUwi(b))}</div><div class="label">UWI</div><div class="value mono">${esc(displayUwi(b))}</div><div class="label">Licence</div><div class="value">${esc(b.licence||'Not reported')}</div><div class="label">Licensee</div><div class="value">${b.licensee?`<button type="button" class="licensee-link" data-detail-licensee="${esc(b.licensee)}">${esc(b.licensee)}</button>`:'Not reported'}</div><div class="label">Status</div><div class="value">${esc(b.status||'Not reported')}</div><div class="label">TVD</div><div class="value">${depthText(b.tvd)}</div><div class="label">TMD</div><div class="value">${depthText(b.tmd)}</div>${b.bhLat&&b.bhLng?`<div class="label">Bottom-hole GPS</div><div class="value mono">${b.bhLat.toFixed(6)}, ${b.bhLng.toFixed(6)}</div>`:''}</div><div class="actions"><a target="_blank" rel="noopener" href="${aerSummaryUrl(b.rawUwi||b.uwi)}">Open AER Well Summary</a></div></div><div class="safety-callout"><strong>${esc(safety.title)}</strong>${esc(safety.text)}</div>`;document.getElementById('wellDetailBackdrop').classList.remove('hidden');document.body.style.overflow='hidden';document.querySelectorAll('[data-detail-bore]').forEach(x=>x.onclick=()=>openWellDetail(p,+x.dataset.detailBore));document.querySelectorAll('[data-detail-licensee]').forEach(x=>x.onclick=()=>{closeWellDetail();openCompanyProfile(x.dataset.detailLicensee)})}
function closeWellDetail(){document.getElementById('wellDetailBackdrop').classList.add('hidden');document.body.style.overflow=''}
function wellCard(p,i){const surf=displaySurfaceDls(p.surfaceDls)||job?.ats||'Surface location';const b=p.bores?.[0]||{};const label=[surf,b.name||displayUwi(b),b.licensee,p.bores.length>1?`${p.bores.length} wellbores`:''].filter(Boolean).join(', ');return `<article class="well-card" aria-label="${esc(label)}"><div class="well-body"><div class="well-section-label">Surface Location</div><div class="well-surface-value">${esc(surf)}</div><div class="well-meta mono">${p.lat.toFixed(6)}, ${p.lng.toFixed(6)} • ${p.distance.toFixed(2)} km from job</div><div style="margin-top:9px"><div class="well-section-label">Well${p.bores.length>1?'s':''}</div><div class="well-name">${esc(b.name||displayUwi(b))}</div><div class="well-lines"><div><b>UWI:</b> <span class="mono">${esc(displayUwi(b))}</span></div><div><b>Licensee:</b> ${b.licensee?`<button class="licensee-link" data-licensee="${esc(b.licensee)}">${esc(b.licensee)}</button>`:'Not reported'}</div><div><b>Status:</b> ${esc(b.status||'Not reported')}</div>${p.bores.length>1?`<div><b>${p.bores.length} wellbores at this surface</b></div>`:''}</div></div><div class="actions"><button data-well-detail="${i}">Details</button><button data-well-focus="${i}">Show on Map</button><a target="_blank" rel="noopener" href="${directions(job.lat,job.lng,p.lat,p.lng)}">Directions</a></div></div></article>`}
function renderWells(){
  clearWellMarkersOnly();
  const q=document.getElementById('wellSearch').value.toLowerCase().trim();
  const pads=loadedPads.filter(p=>!q||[...p.surfaces.map(s=>`${s.licence} ${s.licensee} ${s.status}`),...p.bores.map(b=>`${b.uwi} ${b.rawUwi} ${b.name} ${b.licence} ${b.licensee} ${b.status}`)].join(' ').toLowerCase().includes(q));
  document.getElementById('wellStatus').textContent=wellMode.type==='lsd'?`${loadedPads.length} surface location${loadedPads.length===1?'':'s'} start inside this LSD. ${pads.length} shown.`:`${loadedPads.length} surface locations loaded. ${pads.length} shown within ${wellMode.km} km.`;
  document.getElementById('wellStatus').className='status ok';
  if(wellsVisible)pads.forEach(p=>{const first=p.bores?.[0]||{};const label=[displaySurfaceDls(p.surfaceDls)||'Surface well',first.licensee,displayUwi(first)].filter(Boolean).join(' • ');const m=L.marker([p.lat,p.lng],{icon:makeWellIcon(p.bores.length),keyboard:true,title:label,alt:label,riseOnHover:true});m.on('click',()=>selectSurfacePad(p));addClusterMarker(wellClusterLayer,m);wellMarkers.push(m)});
  document.getElementById('wellGrid').innerHTML=pads.slice(0,100).map((p,i)=>wellCard(p,i)).join('')+(pads.length>100?'<div class="status">Showing the nearest 100 surface locations. Use the search or a smaller radius.</div>':'');
  bindWellActions(pads);
  if(loadedPads.length&&!selectedSurfacePad){
    const item=currentHistoryId?history.find(x=>x.id===currentHistoryId):null;
    const stored=item?.selectedWell||null;
    const targetUwi=String(stored?.uwi||item?.uwi||'').trim();
    const targetLicence=String(stored?.licence||'').trim();
    let match=null,boreIndex=0;
    if(targetUwi||targetLicence){
      for(const p of loadedPads){
        const i=(p.bores||[]).findIndex(b=>
          (targetUwi&&displayUwi(b)===targetUwi)||
          (targetLicence&&String(b.licence||'').trim()===targetLicence)
        );
        if(i>=0){match=p;boreIndex=i;break}
      }
    }else if(item?.surfaceDls){
      match=loadedPads.find(p=>displaySurfaceDls(p.surfaceDls)===displaySurfaceDls(item.surfaceDls))||null;
    }
    if(match){
      selectedSurfacePad=match;
      selectedSurfaceBore=boreIndex;
    }
  }
  if(selectedSurfacePad)updateHistorySurfaceInfo(selectedSurfacePad);
  updateMapJobBar();
}
function bindWellActions(pads){document.querySelectorAll('[data-well-detail]').forEach(b=>b.onclick=()=>openWellDetail(pads[+b.dataset.wellDetail],0));document.querySelectorAll('[data-well-focus]').forEach(b=>b.onclick=()=>{const p=pads[+b.dataset.wellFocus];selectSurfacePad(p);map.setView([p.lat,p.lng],15);closeMobileSheets()});document.querySelectorAll('[data-licensee]').forEach(b=>b.onclick=()=>openCompanyProfile(b.dataset.licensee))}
const AER_WELL_LAYER='https://gisservices.aer.ca/arcgis/rest/services/OneStop/MS_Asset/MapServer/0/query';
function wellSearchBounds(){
  if(wellMode.type==='lsd'&&job?.geometry?.rings?.[0]){
    const ring=job.geometry.rings[0];
    return{minLat:Math.min(...ring.map(x=>x[1])),maxLat:Math.max(...ring.map(x=>x[1])),minLng:Math.min(...ring.map(x=>x[0])),maxLng:Math.max(...ring.map(x=>x[0]))};
  }
  const km=wellMode.km||2,dlat=km/111.2,dlng=km/(111.2*Math.cos(job.lat*Math.PI/180));
  return{minLat:job.lat-dlat,maxLat:job.lat+dlat,minLng:job.lng-dlng,maxLng:job.lng+dlng};
}
async function loadLiveAerWells(){
  const b=wellSearchBounds();
  const q=new URLSearchParams({
    where:'1=1',
    geometry:`${b.minLng},${b.minLat},${b.maxLng},${b.maxLat}`,
    geometryType:'esriGeometryEnvelope',
    inSR:'4326',
    spatialRel:'esriSpatialRelIntersects',
    outFields:'Well_Licence_Number,Well_Name,Well_Type,Well_Purpose,UWI,Licence_Status,Licence_Status_Date,Company_BA_Long_Name,Status_Fluid,Surface_Location,Calculated_Latitude,Calculated_Longitude,Maximum_Estimated_H2S,Is_Well_Sour',
    returnGeometry:'false',
    resultRecordCount:'2000',
    f:'json'
  });
  const d=await fetchJson(`${AER_WELL_LAYER}?${q.toString()}`,15000);
  const rows=(d.features||[]).map(f=>f.attributes||{}).map(a=>({
    lat:+a.Calculated_Latitude,
    lng:+a.Calculated_Longitude,
    licence:String(a.Well_Licence_Number||''),
    licensee:String(a.Company_BA_Long_Name||''),
    status:String(a.Licence_Status||''),
    statusDate:a.Licence_Status_Date?new Date(a.Licence_Status_Date).toISOString().slice(0,10):'',
    category:String(a.Well_Type||a.Well_Purpose||a.Status_Fluid||''),
    surfaceDls:String(a.Surface_Location||''),
    uwi:String(a.UWI||''),
    name:String(a.Well_Name||''),
    h2s:Number.isFinite(+a.Maximum_Estimated_H2S)?+a.Maximum_Estimated_H2S:null,
    isSour:String(a.Is_Well_Sour||'')
  })).filter(r=>Number.isFinite(r.lat)&&Number.isFinite(r.lng));
  const exact=rows.filter(r=>{
    if(wellMode.type==='lsd'&&job.geometry?.rings?.[0])return pointInJobPolygon(r.lat,r.lng);
    return haversineKm(job.lat,job.lng,r.lat,r.lng)<=wellMode.km;
  });
  const pads=new Map();
  for(const r of exact){
    const key=`${r.lat.toFixed(6)}|${r.lng.toFixed(6)}`;
    let p=pads.get(key);
    if(!p){p={key,lat:r.lat,lng:r.lng,surfaces:[],bores:[],distance:haversineKm(job.lat,job.lng,r.lat,r.lng),surfaceDls:r.surfaceDls||''};pads.set(key,p)}
    p.surfaces.push(r);
    p.bores.push({licence:r.licence,licensee:r.licensee,status:r.status,statusDate:r.statusDate,uwi:r.uwi,rawUwi:r.uwi,name:r.name||(`AER Licence ${r.licence}`),tmd:null,tvd:null,bhLat:null,bhLng:null,type:r.category,h2s:r.h2s,isSour:r.isSour});
    if(!p.surfaceDls&&r.surfaceDls)p.surfaceDls=r.surfaceDls;
  }
  return[...pads.values()].sort((a,b)=>a.distance-b.distance);
}
async function loadWells(){
  if(!job)return;
  const status=document.getElementById('wellStatus');
  status.className='status';
  status.textContent=wellMode.type==='lsd'?'Loading live AER surface wells in this LSD...':`Loading live AER surface wells within ${wellMode.km} km...`;
  try{
    loadedPads=await loadLiveAerWells();
    selectedSurfacePad=null;
    selectedSurfaceBore=0;
    renderWells();
    const checked=new Date().toLocaleString(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
    status.textContent+=(status.textContent?' ':'')+'Source: live AER OneStop.';
    document.getElementById('st37Status').textContent=`Live AER OneStop • checked ${checked}`;
    return;
  }catch(liveError){
    console.warn('Live AER well lookup failed, using ST37 fallback',liveError);
  }
  status.textContent='Live AER lookup unavailable. Loading the offline ST37 well snapshot...';
  try{
    await Promise.race([
      ensureSt37(),
      new Promise((_,reject)=>setTimeout(()=>reject(Error('Well data timed out. Check your connection and try again.')),30000))
    ]);
    const surfaces=candidateSurfaces();
    loadedPads=groupPads(surfaces);
    selectedSurfacePad=null;
    selectedSurfaceBore=0;
    renderWells();
    document.getElementById('st37Status').textContent='Offline fallback • Offline AER well snapshot • August 2026 snapshot';
  }catch(e){
    status.textContent=e?.message||'Well data could not be loaded.';
    status.className='status error';
  }
}
function nearestHtml(){const list=facilities.filter(f=>activeCats[f.c]).map(f=>({f,r:routes.get(f.n)})).filter(x=>x.r).sort((a,b)=>a.r.distance-b.r.distance).slice(0,3);return list.map(({f,r})=>`<div class="recommend ${selectedDisposal===f.n?'selected':''}"><div><b>#${f.n} ${esc(f.name)}</b><div class="meta">${esc(f.type)} • ${esc(f.place)}</div><div class="actions"><button data-pick-disposal="${f.n}">${selectedDisposal===f.n?'Selected':'Select'}</button><a target="_blank" rel="noopener" href="${directions(job.lat,job.lng,f.lat,f.lng)}">Directions</a></div></div><div class="drive">${(r.distance/1000).toFixed(1)} km<div class="sub">${formatDuration(r.duration)}</div></div></div>`).join('')||'<div class="status">No routed facilities in the selected disposal types.</div>'}
function bindNearestButtons(){document.querySelectorAll('[data-pick-disposal]').forEach(b=>b.onclick=()=>selectDisposal(Number(b.dataset.pickDisposal)))}
function renderNearest(){if(!job)return;const html=nearestHtml();document.getElementById('nearestDisposals').innerHTML=html;document.getElementById('mobileNearestDisposals').innerHTML=html;bindNearestButtons()}
function selectDisposal(n){selectedDisposal=n;const f=facilities.find(x=>x.n===n),r=routes.get(n);const html=`<h4>Selected Disposal: #${f.n} ${esc(f.name)}</h4><div class="sub">${esc(f.place)}${r?` • ${(r.distance/1000).toFixed(1)} km • ${formatDuration(r.duration)}`:''}</div><div class="actions"><a target="_blank" rel="noopener" href="${directions(job.lat,job.lng,f.lat,f.lng)}">Directions Job → Disposal</a>${f.phone!=='N/A'?`<a href="tel:${f.phone.split('/')[0].replace(/[^0-9+]/g,'')}">Call</a>`:''}</div>`;['selectedDisposal','mobileSelectedDisposal'].forEach(id=>{const box=document.getElementById(id);box.classList.remove('hidden');box.innerHTML=html});saveJobHistory(true);renderNearest();renderFacilities();updateMapJobBar()}
async function calculateRoutes(){if(!job)return;const id=++routeRequest;const coords=[[job.lng,job.lat],...facilities.map(f=>[f.lng,f.lat])].map(x=>x.join(',')).join(';');const msg='Calculating road routes...';document.getElementById('routeStatus').textContent=msg;document.getElementById('mobileRouteStatus').textContent=msg;try{const d=await fetchJson(`${ROUTING_SERVICE}/${coords}?sources=0&annotations=distance,duration`,22000);if(id!==routeRequest)return;routes.clear();facilities.forEach((f,i)=>{const dist=d.distances?.[0]?.[i+1],dur=d.durations?.[0]?.[i+1];if(Number.isFinite(dist)&&Number.isFinite(dur))routes.set(f.n,{distance:dist,duration:dur})});const ok=`Showing the 3 closest disposal options by driving distance.`;['routeStatus','mobileRouteStatus'].forEach(x=>{const el=document.getElementById(x);el.textContent=ok;el.className='status ok'})}catch(e){const er='Road distance is unavailable right now. Directions buttons still open Google Maps.';['routeStatus','mobileRouteStatus'].forEach(x=>{const el=document.getElementById(x);el.textContent=er;el.className='status error'})}renderNearest();renderFacilities()}
async function setJob(result,{save=true}={}){
  if(savedDataReady)await savedDataReady;
  job=result;
  const existing=history.find(x=>historyAtsKey(x.ats)===historyAtsKey(job.ats))||null;
  const priorLast=existing?.lastSearched||existing?.created||null;
  if(existing)currentHistoryId=existing.id;
  else if(save)currentHistoryId=null;
  selectedDisposal=existing?.selectedDisposal??null;
  selectedSurfacePad=null;
  selectedSurfaceBore=0;
  routes.clear();
  clearWellMarkers();
  hideWellSelection();
  document.getElementById('jobArea').classList.remove('hidden');
  document.getElementById('wellsPanel').classList.remove('hidden');
  if(jobMarker)map.removeLayer(jobMarker);
  if(jobPolygon)map.removeLayer(jobPolygon);
  jobMarker=L.marker([job.lat,job.lng],{icon:makeJobIcon()}).addTo(map);
  if(job.geometry?.rings)jobPolygon=L.polygon(geometryLatLng(job.geometry),{color:'#176a91',weight:3,fillColor:'#65a9c8',fillOpacity:.08}).addTo(map);
  if(jobPolygon)map.fitBounds(jobPolygon.getBounds().pad(.18),{maxZoom:15});else map.setView([job.lat,job.lng],14);
  document.getElementById('jobDetails').innerHTML=`<b>ATS</b><span>${esc(job.ats)}</span><b>GPS</b><span class="mono">${job.lat.toFixed(6)}, ${job.lng.toFixed(6)}</span>`;
  document.getElementById('jobMaps').href=mapsSearch(job.lat,job.lng);
  restoreNoteForJob();
  const saved=save?saveJobHistory(false):existing;
  if(existing&&priorLast){
    document.getElementById('jobStatus').textContent=`Job loaded: ${job.ats} • previously searched ${formatHistoryDate(priorLast)}`;
    showToast(`Previously searched ${formatHistoryDate(priorLast)} • saved notes restored`,4500);
  }else{
    document.getElementById('jobStatus').textContent=`Job loaded: ${job.ats}`;
  }
  document.getElementById('jobStatus').className='map-status ok';
  updateMapJobBar();
  await Promise.allSettled([calculateRoutes(),loadWells()]);
  if(selectedDisposal)selectDisposal(+selectedDisposal);
  renderFacilities();
  refreshAtsOverlay();
}
function clearJob(){job=null;selectedDisposal=null;selectedSurfacePad=null;routes.clear();routeRequest++;if(jobMarker)map.removeLayer(jobMarker);if(jobPolygon)map.removeLayer(jobPolygon);jobMarker=jobPolygon=null;clearWellMarkers();hideWellSelection();document.getElementById('jobArea').classList.add('hidden');document.getElementById('wellsPanel').classList.add('hidden');document.getElementById('jobStatus').textContent='Enter a job location or tap the map.';document.getElementById('jobStatus').className='map-status';['selectedDisposal','mobileSelectedDisposal'].forEach(id=>document.getElementById(id).classList.add('hidden'));document.getElementById('mapJobBar').classList.add('hidden');closeMobileSheets();renderFacilities()}
function openMobileSheet(id){if(window.innerWidth>720){document.getElementById(id)?.scrollIntoView({behavior:'smooth',block:'start'});return}document.querySelectorAll('.content>.section').forEach(x=>x.classList.remove('mobile-open'));document.querySelectorAll('.mobile-nav button').forEach(x=>x.classList.remove('active'));const el=document.getElementById(id);if(!el||el.classList.contains('hidden')){showToast(id==='wellsPanel'?'Choose a job first to see surface wells.':'Choose a job first.');return}el.classList.add('mobile-open');document.getElementById('sheetBackdrop').classList.add('show');document.querySelectorAll(`.mobile-nav button[data-scroll="${id}"]`).forEach(x=>x.classList.add('active'))}
function closeMobileSheets(){document.querySelectorAll('.content>.section').forEach(x=>x.classList.remove('mobile-open'));document.querySelectorAll('.mobile-nav button').forEach(x=>x.classList.remove('active'));document.getElementById('sheetBackdrop').classList.remove('show')}
function fitRelevantPins(){const pts=[];if(job)pts.push([job.lat,job.lng]);if(job&&loadedPads.length)loadedPads.slice(0,40).forEach(p=>pts.push([p.lat,p.lng]));if(job){facilities.filter(f=>activeCats[f.c]&&routes.get(f.n)).sort((a,b)=>routes.get(a.n).distance-routes.get(b.n).distance).slice(0,3).forEach(f=>pts.push([f.lat,f.lng]))}else facilities.filter(f=>activeCats[f.c]).forEach(f=>pts.push([f.lat,f.lng]));if(pts.length)map.fitBounds(L.latLngBounds(pts).pad(.12),{maxZoom:14})}
async function useCurrentLocation(){const btn=document.getElementById('myLocation'),status=document.getElementById('jobStatus');if(!navigator.geolocation){status.textContent='This browser does not provide device location.';status.className='map-status error';showToast('Device location is unavailable in this browser.');return}btn.disabled=true;btn.textContent='…';status.textContent='Getting your device location...';navigator.geolocation.getCurrentPosition(async p=>{try{currentHistoryId=null;document.getElementById('jobNotes').value='';const r=await identifyPoint(p.coords.latitude,p.coords.longitude);await setJob(r);map.setView([p.coords.latitude,p.coords.longitude],15)}catch(e){status.textContent=e.message;status.className='map-status error'}finally{btn.disabled=false;btn.textContent='◎'}},e=>{btn.disabled=false;btn.textContent='◎';let msg=e.code===1?'Location permission is blocked. Allow Location for this site in your browser settings.':e.code===2?'Your device could not determine a location. Make sure Location/GPS is turned on.':'Location timed out. Move where the phone has a clearer GPS signal and try again.';if(!window.isSecureContext)msg+=' Device location normally requires an HTTPS page, so test it from GitHub Pages rather than the local file preview.';status.textContent=msg;status.className='map-status error';showToast(msg,5200)},{enableHighAccuracy:true,timeout:18000,maximumAge:30000})}
function atsExportUrl(){const b=map.getBounds(),z=map.getZoom(),sz=map.getSize();let layers=z>=14?'1,3,5,15,19,20':z>=11?'1,3,15,19':'0,1,7,15';return `${ATS_SERVICE}/export?bbox=${b.getWest()},${b.getSouth()},${b.getEast()},${b.getNorth()}&bboxSR=4326&imageSR=4326&size=${Math.max(300,Math.round(sz.x))},${Math.max(300,Math.round(sz.y))}&format=png32&transparent=true&layers=show:${layers}&dpi=96&f=image`}
function refreshAtsOverlay(){if(!atsOverlayOn)return;if(atsOverlay)map.removeLayer(atsOverlay);const bounds=map.getBounds();atsOverlay=L.imageOverlay(atsExportUrl(),bounds,{opacity:.58,interactive:false,pane:'overlayPane'}).addTo(map)}
function scheduleAtsOverlay(){clearTimeout(atsOverlayTimer);atsOverlayTimer=setTimeout(refreshAtsOverlay,280)}
function toggleAtsOverlay(){atsOverlayOn=!atsOverlayOn;const b=document.getElementById('atsGridToggle');b.style.opacity=atsOverlayOn?'1':'.55';if(!atsOverlayOn&&atsOverlay){map.removeLayer(atsOverlay);atsOverlay=null}else refreshAtsOverlay();showToast(`ATS grid ${atsOverlayOn?'on':'off'}`)}

document.getElementById('directorySearch').oninput=renderFacilities;document.getElementById('clearDirectorySearch').onclick=()=>{document.getElementById('directorySearch').value='';renderFacilities()};document.getElementById('fitFacilities').onclick=()=>{const ms=facilities.filter(f=>activeCats[f.c]).map(f=>facilityMarkers.get(f.n)).filter(m=>facilityClusterLayer.hasLayer(m));if(ms.length)map.fitBounds(L.featureGroup(ms).getBounds().pad(.1))};document.querySelectorAll('#facilityCategoryFilters .filter-chip').forEach(b=>b.onclick=()=>{activeCats[b.dataset.cat]=!activeCats[b.dataset.cat];renderFacilities();if(job)renderNearest()});
document.getElementById('findJob').onclick=async()=>{const p=parseJobInput(document.getElementById('jobInput').value);document.getElementById('jobStatus').textContent='Looking up Alberta ATS...';try{currentHistoryId=null;document.getElementById('jobNotes').value='';setNoteSaveState('Saved','saved');await setJob(await performJobLookup(p))}catch(e){document.getElementById('jobStatus').textContent=e.message;document.getElementById('jobStatus').className='map-status error'}};document.getElementById('jobInput').onkeydown=e=>{if(e.key==='Enter')document.getElementById('findJob').click()};document.getElementById('myLocation').onclick=useCurrentLocation;document.getElementById('clearJob').onclick=clearJob;document.getElementById('jobNotes').oninput=queueNoteSave;document.getElementById('jobNotes').onblur=()=>saveJobHistory(true);document.getElementById('copyJob').onclick=async()=>{if(!job)return;const f=selectedDisposal?facilities.find(x=>x.n===selectedDisposal):null;const txt=`Job: ${job.ats}\nGPS: ${job.lat.toFixed(6)}, ${job.lng.toFixed(6)}${f?`\nDisposal: ${f.name}`:''}\nNotes: ${document.getElementById('jobNotes').value||''}`;await copyText(txt,'Job info copied')};document.getElementById('clearHistory').onclick=async()=>{if(await confirmAction('Clear all saved LSD history and saved notes?','Clear saved data')){history=[];notesStore={};R5Storage.removeItem(HISTORY_KEY);R5Storage.removeItem(NOTES_KEY);renderHistory()}};
document.querySelectorAll('.well-radius').forEach(b=>b.onclick=()=>{document.querySelectorAll('.well-radius').forEach(x=>x.classList.remove('active'));b.classList.add('active');wellMode=b.dataset.mode==='lsd'?{type:'lsd'}:{type:'radius',km:+b.dataset.km};loadWells()});document.getElementById('hideWells').onclick=()=>{wellsVisible=!wellsVisible;document.getElementById('hideWells').textContent=wellsVisible?'Hide pins':'Show pins';renderWells()};document.getElementById('wellSearch').oninput=renderWells;document.getElementById('clearWellSearch').onclick=()=>{document.getElementById('wellSearch').value='';renderWells()};
document.getElementById('companyClose').onclick=closeCompanyProfile;document.getElementById('companyMapClose').onclick=closeCompanyWellsMap;document.getElementById('companyMapBackdrop').onclick=e=>{if(e.target.id==='companyMapBackdrop')closeCompanyWellsMap()};document.getElementById('companyBackdrop').onclick=e=>{if(e.target.id==='companyBackdrop')closeCompanyProfile()};document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!document.getElementById('companyBackdrop').classList.contains('hidden'))closeCompanyProfile()});document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!document.getElementById('companyMapBackdrop').classList.contains('hidden'))closeCompanyWellsMap()});document.querySelectorAll('[data-scroll]').forEach(b=>b.onclick=()=>b.dataset.scroll==='mapSection'?closeMobileSheets():openMobileSheet(b.dataset.scroll));window.addEventListener('beforeunload',()=>{if(job)saveJobHistory(true)});
map.on('click',async e=>{if(!(await confirmAction(`Use ${e.latlng.lat.toFixed(5)}, ${e.latlng.lng.toFixed(5)} as the job location?`,'Use location')))return;document.getElementById('jobStatus').textContent='Identifying clicked location...';try{currentHistoryId=null;document.getElementById('jobNotes').value='';setNoteSaveState('Saved','saved');await setJob(await identifyPoint(e.latlng.lat,e.latlng.lng))}catch(err){document.getElementById('jobStatus').textContent=err.message;document.getElementById('jobStatus').className='map-status error'}});

document.getElementById('atsGridToggle').onclick=toggleAtsOverlay;
document.getElementById('sheetBackdrop').onclick=closeMobileSheets;
document.querySelectorAll('[data-sheet-close]').forEach(b=>b.onclick=closeMobileSheets);
document.querySelectorAll('[data-open-sheet]').forEach(b=>b.onclick=()=>openMobileSheet(b.dataset.openSheet));
document.getElementById('wellSelectionDetails').onclick=()=>openWellDetail();
document.getElementById('wellSelectionClose').onclick=hideWellSelection;
document.getElementById('fitFacilities').onclick=fitRelevantPins;
document.getElementById('wellDetailClose').onclick=closeWellDetail;
document.getElementById('wellDetailBackdrop').onclick=e=>{if(e.target.id==='wellDetailBackdrop')closeWellDetail()};
document.getElementById('toggleDirectory').onclick=()=>{const w=document.getElementById('directoryMobileWrap');w.classList.toggle('open');document.getElementById('toggleDirectory').textContent=w.classList.contains('open')?'Hide full facility directory':'Browse all disposal facilities'};
map.on('moveend zoomend resize',scheduleAtsOverlay);
loadNotesStore();refreshAtsOverlay();

renderFacilities();loadHistory();
