from pathlib import Path
import json

INDEX = Path('testing/index.html')
SW = Path('testing/sw.js')
VERSION = Path('testing/version.json')

text = INDEX.read_text(encoding='utf-8')
start_marker = 'async function lookupATS(p){'
end_marker = 'function geometryLatLng(g){'
if start_marker not in text or end_marker not in text:
    raise SystemExit('Could not locate legal-land lookup block in testing/index.html')

start = text.index(start_marker)
end = text.index(end_marker, start)

hybrid = r'''const R5_HYBRID_CACHE_KEY='r5-atlas-hybrid-coordinate-cache-v1';
const R5_ATS_LIVE='https://geospatial.alberta.ca/titan/rest/services/ags_apps/ags_apps_alberta_township_system/MapServer';
function r5HybridKey(kind,p){return `${kind}:${kind==='lsd'?String(p.lsd).padStart(2,'0')+'-':''}${kind==='quarter'?p.quarter+'-':''}${String(p.sec).padStart(2,'0')}-${String(p.twp).padStart(3,'0')}-${String(p.rge).padStart(2,'0')}-W${p.mer}`}
function r5HybridReadCache(key){try{const all=JSON.parse(localStorage.getItem(R5_HYBRID_CACHE_KEY)||'{}');const v=all[key];return v&&Number.isFinite(v.lat)&&Number.isFinite(v.lng)?v:null}catch{return null}}
function r5HybridWriteCache(key,value){try{const all=JSON.parse(localStorage.getItem(R5_HYBRID_CACHE_KEY)||'{}');all[key]={lat:value.lat,lng:value.lng,source:value.source||'Government of Alberta ATS live polygon',verifiedAt:new Date().toISOString()};const keys=Object.keys(all).sort((a,b)=>String(all[a]?.verifiedAt||'').localeCompare(String(all[b]?.verifiedAt||'')));while(keys.length>500)delete all[keys.shift()];localStorage.setItem(R5_HYBRID_CACHE_KEY,JSON.stringify(all))}catch{}}
function r5PolygonCenter(geometry){const rings=geometry?.rings||[];let area2=0,cx=0,cy=0;for(const ring of rings){for(let i=0,j=ring.length-1;i<ring.length;j=i++){const x0=ring[j][0],y0=ring[j][1],x1=ring[i][0],y1=ring[i][1],cross=x0*y1-x1*y0;area2+=cross;cx+=(x0+x1)*cross;cy+=(y0+y1)*cross}}if(Math.abs(area2)>1e-14){return{lat:cy/(3*area2),lng:cx/(3*area2)}}const pts=rings.flat();if(!pts.length)return null;let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;for(const [x,y] of pts){minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y)}return{lat:(minY+maxY)/2,lng:(minX+maxX)/2}}
async function r5AtsQuery(layer,where,{geometry=null}={}){const q=new URLSearchParams({f:'json',where,outFields:'*',returnGeometry:'true',outSR:'4326'});if(geometry){q.set('geometry',geometry);q.set('geometryType','esriGeometryPoint');q.set('inSR','4326');q.set('spatialRel','esriSpatialRelIntersects')}const response=await fetch(`${R5_ATS_LIVE}/${layer}/query?${q.toString()}`,{cache:'no-store'});if(!response.ok)throw Error(`Alberta ATS service returned ${response.status}.`);const data=await response.json();if(data.error)throw Error(data.error.message||'Alberta ATS query failed.');return data}
function r5PickLandFeature(features){return(features||[]).find(f=>!String(f?.attributes?.RA??'').trim())||(features||[])[0]||null}
async function lookupATS(p){
  const description=p.normalized||`${String(p.lsd).padStart(2,'0')}-${String(p.sec).padStart(2,'0')}-${String(p.twp).padStart(3,'0')}-${String(p.rge).padStart(2,'0')}-W${p.mer}`;
  let offline=null;
  try{offline=(await getOfflineLsdConverter()).resolve(description)}catch(e){console.warn('Offline LSD lookup unavailable',e)}
  const cacheKey=r5HybridKey('lsd',p),cached=r5HybridReadCache(cacheKey);
  let liveFeature=null,liveCenter=null;
  if(typeof navigator==='undefined'||navigator.onLine!==false){
    try{const where=`LS=${p.lsd} AND SEC=${p.sec} AND TWP=${p.twp} AND RGE=${p.rge} AND M=${p.mer}`;const d=await r5AtsQuery(3,where);liveFeature=r5PickLandFeature(d.features);if(liveFeature?.geometry){liveCenter=r5PolygonCenter(liveFeature.geometry);if(Number.isFinite(liveCenter?.lat)&&Number.isFinite(liveCenter?.lng))r5HybridWriteCache(cacheKey,{...liveCenter,source:'Government of Alberta ATS live LSD polygon'})}}catch(e){console.warn('Live Alberta LSD lookup failed',e)}
  }
  if(offline?.status==='ok')return{lat:offline.latitude,lng:offline.longitude,ats:canonical(p),geometry:liveFeature?.geometry||null,quarter:'',coordinateSource:offline.coordinateSource||'Alberta ATS v4.1 offline pack',coordinateMethod:offline.coordinateMethod||'authoritative_lsd_polygon_point',hybridSource:'offline'};
  if(Number.isFinite(liveCenter?.lat)&&Number.isFinite(liveCenter?.lng))return{...liveCenter,ats:canonical(p),geometry:liveFeature.geometry,quarter:'',coordinateSource:'Government of Alberta ATS live LSD polygon',coordinateMethod:'polygon_centroid',hybridSource:'live'};
  if(cached)return{lat:cached.lat,lng:cached.lng,ats:canonical(p),geometry:null,quarter:'',coordinateSource:'Previously verified Government of Alberta ATS result',coordinateMethod:'cached_live_polygon_centroid',hybridSource:'cache'};
  throw Error(offline?.message||'No matching Alberta ATS LSD was found online or in the offline coordinate pack.');
}
async function lookupQuarter(p){
  const description=p.normalized||`${p.quarter}-${String(p.sec).padStart(2,'0')}-${String(p.twp).padStart(3,'0')}-${String(p.rge).padStart(2,'0')}-W${p.mer}`;
  let offline=null;
  try{offline=(await getOfflineLsdConverter()).resolve(description)}catch(e){console.warn('Offline quarter lookup unavailable',e)}
  const cacheKey=r5HybridKey('quarter',p),cached=r5HybridReadCache(cacheKey);
  let feature=null,center=null;
  if(typeof navigator==='undefined'||navigator.onLine!==false){
    try{let layer=2,where=`QS='${p.quarter}' AND SEC=${p.sec} AND TWP=${p.twp} AND RGE=${p.rge} AND M=${p.mer}`;if(p.quarter==='C'){layer=1;where=`SEC=${p.sec} AND TWP=${p.twp} AND RGE=${p.rge} AND M=${p.mer}`}const d=await r5AtsQuery(layer,where);feature=r5PickLandFeature(d.features);if(feature?.geometry){center=r5PolygonCenter(feature.geometry);if(Number.isFinite(center?.lat)&&Number.isFinite(center?.lng))r5HybridWriteCache(cacheKey,{...center,source:'Government of Alberta ATS live polygon'})}}catch(e){console.warn('Live Alberta quarter lookup failed',e)}
  }
  if(Number.isFinite(center?.lat)&&Number.isFinite(center?.lng))return{...center,ats:canonicalQ(p),geometry:feature.geometry,quarter:p.quarter,coordinateSource:'Government of Alberta ATS live polygon',coordinateMethod:'polygon_centroid',hybridSource:'live'};
  if(offline?.status==='ok')return{lat:offline.latitude,lng:offline.longitude,ats:canonicalQ(p),geometry:null,quarter:p.quarter,coordinateSource:offline.coordinateSource||'Alberta ATS v4.1 offline pack',coordinateMethod:offline.coordinateMethod||'derived_from_authoritative_lsd_points',hybridSource:'offline'};
  if(cached)return{lat:cached.lat,lng:cached.lng,ats:canonicalQ(p),geometry:null,quarter:p.quarter,coordinateSource:'Previously verified Government of Alberta ATS result',coordinateMethod:'cached_live_polygon_centroid',hybridSource:'cache'};
  throw Error(offline?.message||'Quarter or section centre was not found online or in the offline coordinate pack.');
}
async function identifyPoint(lat,lng){
  const d=await r5AtsQuery(3,'1=1',{geometry:`${lng},${lat}`});const f=r5PickLandFeature(d.features);if(!f)throw Error('No Alberta LSD found at this point.');const a=f.attributes||{};const p={lsd:+(a.LS??a['Legal SubDivision']??a['Legal Subdivision']),sec:+(a.SEC??a.Section),twp:+(a.TWP??a.Township),rge:+(a.RGE??a.Range),mer:+(a.M??a.Meridian)};if(!p.lsd||!p.sec||!p.twp||!p.rge||!p.mer)throw Error('Incomplete ATS result.');const center=r5PolygonCenter(f.geometry)||{lat,lng};r5HybridWriteCache(r5HybridKey('lsd',p),{...center,source:'Government of Alberta ATS live point identification'});return{lat,lng,ats:canonical(p),geometry:f.geometry,quarter:'',coordinateSource:'Government of Alberta ATS live point identification',coordinateMethod:'point_in_polygon',hybridSource:'live'}
}
'''

text = text[:start] + hybrid + text[end:]
text = text.replace('content="0.4.0"', 'content="0.5.0"', 1)
text = text.replace('App v0.4.0', 'App v0.5.0', 1)
INDEX.write_text(text, encoding='utf-8')

sw = SW.read_text(encoding='utf-8')
if "const CACHE_NAME = `r5-atlas-${APP_VERSION}`;" in sw:
    sw = sw.replace("const CACHE_NAME = `r5-atlas-${APP_VERSION}`;", "const CACHE_NAME = `r5-atlas-${APP_VERSION}-hybrid`;", 1)
SW.write_text(sw, encoding='utf-8')

release = {
    'version': '0.5.0',
    'releasedAt': '2026-09-17',
    'title': 'Hybrid Alberta LSD lookup',
    'notes': [
        'Hybrid lookup now uses the bundled offline Alberta ATS coordinate pack first and the live Government of Alberta ATS service as a fallback when the local pack has no record.',
        'Corrected live Legal SubDivision queries to the current Government of Alberta ATS layer 3 and LS field.',
        'Corrected quarter-section live queries to layer 2 and section-centre live queries to layer 1.',
        'Previously verified live coordinates are cached on the device and can be reused when offline.',
        'GPS reverse lookup now queries the current Legal SubDivision layer instead of the obsolete layer mapping.',
        'No coordinate is guessed: a result must come from the bundled ATS pack, the live Alberta ATS polygons, or a previously verified live result.'
    ]
}
VERSION.write_text(json.dumps(release, indent=2) + '\n', encoding='utf-8')

patched = INDEX.read_text(encoding='utf-8')
checks = {
    'version meta': 'content="0.5.0"' in patched,
    'hybrid lookup': "async function lookupATS(p){" in patched and "r5AtsQuery(3,where)" in patched,
    'current LSD field': 'LS=${p.lsd}' in patched,
    'quarter layer': 'let layer=2' in patched,
    'section layer': 'layer=1' in patched,
    'GPS layer': "r5AtsQuery(3,'1=1'" in patched,
    'verified cache': 'r5-atlas-hybrid-coordinate-cache-v1' in patched,
}
failed = [name for name, ok in checks.items() if not ok]
if failed:
    raise SystemExit('Patch verification failed: ' + ', '.join(failed))
print('Hybrid testing patch applied:', ', '.join(checks))
