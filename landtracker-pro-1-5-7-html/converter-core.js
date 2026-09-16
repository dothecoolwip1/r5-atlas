(function(root){
'use strict';

const KEY_COORD = 9171110;
const KEY_REVERSE_INDEX = 10251028;
const LAT_DEG_PER_MILE = 0.014458089;
const REVERSE_GRID = 64;
const DLS_RECORDS = 925344;
const REVERSE_BOUNDS = [48.92753982543945,97.25264739990234,60.086029052734375,124.10211181640625];
const REVERSE_BOUNDARY_INDEX = 501331;
const REVERSE_BOUNDARY_BIN = 2144;
const BCNTS_MAP_UNITS = [82,83,84,85,92,93,94,95,102,103,104];

const QUARTER_OFFSETS = {
  C:  [-0.5, 0.5],
  SW: [-0.75, 0.75],
  SE: [-0.75, 0.25],
  NE: [-0.25, 0.25],
  NW: [-0.25, 0.75]
};
const LSD_OFFSETS = [
  [-0.875,0.125],[-0.875,0.375],[-0.875,0.625],[-0.875,0.875],
  [-0.625,0.875],[-0.625,0.625],[-0.625,0.375],[-0.625,0.125],
  [-0.375,0.125],[-0.375,0.375],[-0.375,0.625],[-0.375,0.875],
  [-0.125,0.875],[-0.125,0.625],[-0.125,0.375],[-0.125,0.125]
];
const REVERSE_LSD = [
  [16,15,14,13],
  [9,10,11,12],
  [8,7,6,5],
  [1,2,3,4]
];

class DotNetRandom {
  constructor(seed){
    const INTMAX = 2147483647;
    const a = new Array(56).fill(0);
    const subtraction = seed === -2147483648 ? INTMAX : Math.abs(seed);
    let mj = 161803398 - subtraction;
    a[55] = mj;
    let mk = 1;
    for(let i=1;i<55;i++){
      const ii = (21*i)%55;
      a[ii] = mk;
      mk = mj - mk;
      if(mk < 0) mk += INTMAX;
      mj = a[ii];
    }
    for(let k=1;k<5;k++){
      for(let i=1;i<56;i++){
        a[i] -= a[1 + ((i+30)%55)];
        if(a[i] < 0) a[i] += INTMAX;
      }
    }
    this.a=a; this.b=0; this.c=21;
  }
  sample(){
    this.b++; if(this.b>=56)this.b=1;
    this.c++; if(this.c>=56)this.c=1;
    let ret=this.a[this.b]-this.a[this.c];
    if(ret===2147483647)ret--;
    if(ret<0)ret+=2147483647;
    this.a[this.b]=ret;
    return ret*4.656612875245797e-10;
  }
  next(lo,hi){ return Math.trunc(this.sample()*(hi-lo))+lo; }
}

function read24(bytes,offset){ return bytes[offset] | (bytes[offset+1]<<8) | (bytes[offset+2]<<16); }
function milesPerDegreeLon(lat){
  const r=lat*Math.PI/180;
  return (Math.cos(r)*111412.84 + Math.cos(2*r)*(-93.5) + Math.cos(3*r)*0.118)/1609.344;
}
function dlsIndex(m,r,t,s){ return ((((m-1)*34+(r-1))*126+(t-1))*36+(s-1)); }
function validateDls(d){
  return d && Number.isInteger(d.meridian)&&d.meridian>=1&&d.meridian<=6 &&
    Number.isInteger(d.range)&&d.range>=1&&d.range<=34 &&
    Number.isInteger(d.township)&&d.township>=1&&d.township<=126 &&
    Number.isInteger(d.section)&&d.section>=1&&d.section<=36 &&
    Number.isInteger(d.lsd)&&d.lsd>=0&&d.lsd<=16 &&
    (!d.quarter || Object.prototype.hasOwnProperty.call(QUARTER_OFFSETS,d.quarter));
}
function dlsBase(bytes,d){
  if(!validateDls(d)) return null;
  const off=dlsIndex(d.meridian,d.range,d.township,d.section)*6;
  if(off<0 || off+6>bytes.length)return null;
  let a=read24(bytes,off)^KEY_COORD;
  let b=read24(bytes,off+3)^KEY_COORD;
  const rng=new DotNetRandom(d.section*d.township);
  a=a*10+rng.next(0,9);
  b=b*10+rng.next(0,9);
  return {lat:a*1e-6,lon:b*1e-6};
}
function dlsToLatLon(bytes,d){
  const base=dlsBase(bytes,d); if(!base)return null;
  let offset=null;
  if(d.quarter) offset=QUARTER_OFFSETS[d.quarter]||null;
  else if(d.lsd>0) offset=LSD_OFFSETS[d.lsd-1];
  if(!offset)return base;
  const dLat=offset[0]*LAT_DEG_PER_MILE;
  const dLon=offset[1]/milesPerDegreeLon(base.lat+dLat);
  return {lat:base.lat+dLat,lon:base.lon+dLon};
}
function formatDls(d){
  const base=`${d.lsd}-${d.section}-${d.township}-${d.range}W${d.meridian}`;
  return d.quarter ? `${d.quarter} ${base}` : base;
}
function formatLatLon(p){ return `N${Math.abs(p.lat).toFixed(6)}, W${Math.abs(p.lon).toFixed(6)}`; }
function formatBcnts(b){
  return `${b.quarter}-${String(b.centizone).padStart(3,'0')}-${b.zoneBlock}-${String(b.mapUnit).padStart(3,'0')}-${b.mapUnitSub}-${String(b.mapSheet).padStart(3,'0')}`;
}
function bcntsKey(b){
  return `${b.quarter}${String(b.centizone).padStart(3,'0')}${b.zoneBlock}${String(b.mapUnit).padStart(3,'0')}${b.mapUnitSub}${String(b.mapSheet).padStart(3,'0')}`;
}
function idToDls(idx){
  const section=idx%36+1; idx=Math.floor(idx/36);
  const township=idx%126+1; idx=Math.floor(idx/126);
  const range=idx%34+1; idx=Math.floor(idx/34);
  const meridian=idx%6+1;
  return {meridian,range,township,section,lsd:0,quarter:''};
}

async function gunzipBytes(bytes){
  if(typeof DecompressionStream==='undefined')throw new Error('This browser does not support the gzip decoder required by LandTracker Pro.');
  const stream=new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
async function gunzipText(bytes){ return new TextDecoder().decode(await gunzipBytes(bytes)); }

class LandTrackerEngine {
  constructor(base='data'){
    this.base=base.replace(/\/$/,'');
    this._dls=null; this._bcnts=null; this._reverseMeta=null;
    this._reverseHeads=null; this._reverseNext=null; this._reverseCache=new Map();
  }
  async _fetch(path){
    const r=await fetch(`${this.base}/${path}`);
    if(!r.ok)throw new Error(`Unable to load ${path}`);
    return new Uint8Array(await r.arrayBuffer());
  }
  async loadDls(){
    if(!this._dls){
      const gz=await this._fetch('dls.delta.gz');
      const delta=await gunzipBytes(gz);
      const raw=new Uint8Array(DLS_RECORDS*6);
      let cursor=0,prevLat=0,prevLon=0;
      const readVar=()=>{
        let u=0,shift=0;
        for(let i=0;i<5;i++){
          if(cursor>=delta.length)throw new Error('DLS compact data is truncated.');
          const b=delta[cursor++]; u|=(b&127)<<shift;
          if(!(b&128))return (u>>>1)^-(u&1);
          shift+=7;
        }
        throw new Error('DLS compact data contains an invalid delta.');
      };
      for(let idx=0;idx<DLS_RECORDS;idx++){
        prevLat+=readVar(); prevLon+=readVar();
        const a=(prevLat^KEY_COORD)>>>0,b=(prevLon^KEY_COORD)>>>0,o=idx*6;
        raw[o]=a&255; raw[o+1]=(a>>>8)&255; raw[o+2]=(a>>>16)&255;
        raw[o+3]=b&255; raw[o+4]=(b>>>8)&255; raw[o+5]=(b>>>16)&255;
      }
      if(cursor!==delta.length||raw.length!==5552064)throw new Error('DLS data file has an unexpected size.');
      this._dls=raw;
    }
    return this._dls;
  }
  async _ensureReverseIndex(){
    if(this._reverseHeads)return;
    const bytes=await this.loadDls();
    const [minLat,minLon,maxLat,maxLon]=REVERSE_BOUNDS;
    const spanLat=maxLat-minLat,spanLon=maxLon-minLon;
    const heads=new Int32Array(REVERSE_GRID*REVERSE_GRID); heads.fill(-1);
    const next=new Int32Array(DLS_RECORDS); next.fill(-1);
    for(let idx=DLS_RECORDS-1;idx>=0;idx--){
      const o=idx*6;
      const lat=(read24(bytes,o)^KEY_COORD)*1e-5;
      const lon=(read24(bytes,o+3)^KEY_COORD)*1e-5;
      let x=Math.max(0,Math.min(63,Math.floor(((lat-minLat)/spanLat)*63)));
      let y=Math.max(0,Math.min(63,Math.floor(((lon-minLon)/spanLon)*63)));
      let bin=y*64+x;
      if(idx===REVERSE_BOUNDARY_INDEX)bin=REVERSE_BOUNDARY_BIN;
      next[idx]=heads[bin]; heads[bin]=idx;
    }
    this._reverseHeads=heads; this._reverseNext=next;
    this._reverseMeta={minLat,minLon,maxLat,maxLon,spanLat,spanLon};
  }
  async loadBcnts(){
    if(!this._bcnts){
      const gz=await this._fetch('bcnts.tsv.gz');
      const text=await gunzipText(gz); const map=new Map();
      for(const line of text.split('\n')){
        if(!line)continue; const [k,lat,lon]=line.split('\t'); map.set(k,[+lat,+lon]);
      }
      this._bcnts=map;
    }
    return this._bcnts;
  }
  async convertDls(d){ const bytes=await this.loadDls(); return dlsToLatLon(bytes,d); }
  async convertBcnts(b){
    const map=await this.loadBcnts(); const exact=map.get(bcntsKey(b));
    if(exact)return {lat:exact[0],lon:exact[1]};
    return bcntsFallback(b);
  }
  async _reverseBin(index){
    if(index<0||index>=4096)return [];
    if(this._reverseCache.has(index))return this._reverseCache.get(index);
    await this._ensureReverseIndex();
    const rows=[];
    for(let idx=this._reverseHeads[index];idx>=0;idx=this._reverseNext[idx]){
      const o=idx*6;
      rows.push({
        lat:(read24(this._dls,o)^KEY_COORD)*1e-5,
        lon:(read24(this._dls,o+3)^KEY_COORD)*1e-5,
        idx
      });
    }
    if(this._reverseCache.size>=48)this._reverseCache.delete(this._reverseCache.keys().next().value);
    this._reverseCache.set(index,rows); return rows;
  }
  async reverse(lat,lon){
    lat=Math.abs(+lat); lon=Math.abs(+lon);
    if(!Number.isFinite(lat)||!Number.isFinite(lon))return null;
    await this._ensureReverseIndex();
    const m=this._reverseMeta;
    if(lat<m.minLat||lat>m.maxLat||lon<m.minLon||lon>m.maxLon)return null;
    const x=Math.max(0,Math.min(63,Math.floor(((lat-m.minLat)/m.spanLat)*64)));
    const y=Math.max(0,Math.min(63,Math.floor(((lon-m.minLon)/m.spanLon)*64)));
    const jobs=[];
    for(let yy=y-1;yy<=y+1;yy++)for(let xx=x-1;xx<=x+1;xx++)if(xx>=0&&xx<64&&yy>=0&&yy<64)jobs.push(this._reverseBin(yy*64+xx));
    const rows=(await Promise.all(jobs)).flat();
    let meridian;
    if(lon>=118)meridian=6; else if(lon>=114)meridian=5; else if(lon>=110)meridian=4; else if(lon>=106)meridian=3; else if(lon>=102)meridian=2; else if(lon>=97.457892)meridian=1; else return null;
    let best=null,bestDist=Infinity;
    for(const row of rows){
      if(row.lat<lat||row.lon>lon)continue;
      const d=idToDls(row.idx); if(d.meridian<meridian)continue;
      const dist=(row.lat-lat)**2+(row.lon-lon)**2;
      if(dist<bestDist){bestDist=dist;best={row,d};}
    }
    if(!best)return null;
    const d=best.d;
    const base=dlsToLatLon(this._dls,d); if(!base)return null;
    let north=(base.lat-lat)*69.172;
    let east=(lon-base.lon)*milesPerDegreeLon(lat);
    if(north>=1)north=.999; if(east>=1)east=.999;
    const ri=Math.floor(north/.25),ci=Math.floor(east/.25);
    if(ri>=0&&ri<=3&&ci>=0&&ci<=3)d.lsd=REVERSE_LSD[ri][ci];
    return d;
  }
}

const BCNTS_TABLES = {"b":[[0.0,0.0],[0.0,0.00625],[0.004166667,0.00625],[0.004166667,0.0]],"c":[[0.0,0.0],[0.0,0.0125],[0.0,0.025],[0.0,0.0375],[0.0,0.05],[0.0,0.0625],[0.0,0.075],[0.0,0.0875],[0.0,0.1],[0.0,0.1125],[0.008333333,0.0],[0.008333333,0.0125],[0.008333333,0.025],[0.008333333,0.0375],[0.008333333,0.05],[0.008333333,0.0625],[0.008333333,0.075],[0.008333333,0.0875],[0.008333333,0.1],[0.008333333,0.1125],[0.016666667,0.0],[0.016666667,0.0125],[0.016666667,0.025],[0.016666667,0.0375],[0.016666667,0.05],[0.016666667,0.0625],[0.016666667,0.075],[0.016666667,0.0875],[0.016666667,0.1],[0.016666667,0.1125],[0.025,0.0],[0.025,0.0125],[0.025,0.025],[0.025,0.0375],[0.025,0.05],[0.025,0.0625],[0.025,0.075],[0.025,0.0875],[0.025,0.1],[0.025,0.1125],[0.033333333,0.0],[0.033333333,0.0125],[0.033333333,0.025],[0.033333333,0.0375],[0.033333333,0.05],[0.033333333,0.0625],[0.033333333,0.075],[0.033333333,0.0875],[0.033333333,0.1],[0.033333333,0.1125],[0.041666667,0.0],[0.041666667,0.0125],[0.041666667,0.025],[0.041666667,0.0375],[0.041666667,0.05],[0.041666667,0.0625],[0.041666667,0.075],[0.041666667,0.0875],[0.041666667,0.1],[0.041666667,0.1125],[0.05,0.0],[0.05,0.0125],[0.05,0.025],[0.05,0.0375],[0.05,0.05],[0.05,0.0625],[0.05,0.075],[0.05,0.0875],[0.05,0.1],[0.05,0.1125],[0.058333333,0.0],[0.058333333,0.0125],[0.058333333,0.025],[0.058333333,0.0375],[0.058333333,0.05],[0.058333333,0.0625],[0.058333333,0.075],[0.058333333,0.0875],[0.058333333,0.1],[0.058333333,0.1125],[0.066666667,0.0],[0.066666667,0.0125],[0.066666667,0.025],[0.066666667,0.0375],[0.066666667,0.05],[0.066666667,0.0625],[0.066666667,0.075],[0.066666667,0.0875],[0.066666667,0.1],[0.066666667,0.1125],[0.075,0.0],[0.075,0.0125],[0.075,0.025],[0.075,0.0375],[0.075,0.05],[0.075,0.0625],[0.075,0.075],[0.075,0.0875],[0.075,0.1],[0.075,0.1125]],"d":[[0.0,0.0],[0.0,0.125],[0.0,0.25],[0.0,0.375],[0.083333333,0.375],[0.083333333,0.25],[0.083333333,0.125],[0.083333333,0.0],[0.166666667,0.0],[0.166666667,0.125],[0.166666667,0.25],[0.166666667,0.375]],"e":[[0.0,0.0],[4.0,0.0],[8.0,0.0],[12.0,0.0],[0.0,8.0],[4.0,8.0],[8.0,8.0],[12.0,8.0],[0.0,16.0],[4.0,16.0],[8.0,16.0]],"f":[[0.0,0.0],[0.0,2.0],[0.0,4.0],[0.0,6.0],[1.0,6.0],[1.0,4.0],[1.0,2.0],[1.0,0.0],[2.0,0.0],[2.0,2.0],[2.0,4.0],[2.0,6.0],[3.0,6.0],[3.0,4.0],[3.0,2.0],[3.0,0.0]],"g":[[0.0,0.0],[0.0,0.5],[0.0,1.0],[0.0,1.5],[0.25,1.5],[0.25,1.0],[0.25,0.5],[0.25,0.0],[0.5,0.0],[0.5,0.5],[0.5,1.0],[0.5,1.5],[0.75,1.5],[0.75,1.0],[0.75,0.5],[0.75,0.0]]};
function letterIndex(s){return String(s||'A').toUpperCase().charCodeAt(0)-65;}
function bcntsFallback(b){
  const q=letterIndex(b.quarter), cz=b.centizone-1, zb=letterIndex(b.zoneBlock), mu=Math.max(0,BCNTS_MAP_UNITS.indexOf(+b.mapUnit)), sub=letterIndex(b.mapUnitSub), sheet=b.mapSheet-1;
  if(q<0||q>=4||cz<0||cz>=100||zb<0||zb>=12||sub<0||sub>=16||sheet<0||sheet>=16)return null;
  const rows=[BCNTS_TABLES.b[q],BCNTS_TABLES.c[cz],BCNTS_TABLES.d[zb],BCNTS_TABLES.e[mu],BCNTS_TABLES.f[sub],BCNTS_TABLES.g[sheet]];
  let lat=48.0020833,lon=112.003125;
  for(const r of rows){lat+=r[0];lon+=r[1];}
  return {lat,lon};
}

root.LandTrackerCore={LandTrackerEngine,DotNetRandom,dlsIndex,dlsBase,dlsToLatLon,formatDls,formatLatLon,formatBcnts,bcntsFallback,bcntsKey,idToDls,milesPerDegreeLon,constants:{BCNTS_MAP_UNITS,QUARTER_OFFSETS,LSD_OFFSETS}};
if(typeof module!=='undefined'&&module.exports)module.exports=root.LandTrackerCore;
})(typeof globalThis!=='undefined'?globalThis:this);
