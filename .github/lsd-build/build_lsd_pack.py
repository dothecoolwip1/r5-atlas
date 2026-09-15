import concurrent.futures, datetime as dt, gzip, hashlib, json, math, os, struct, sys, time, urllib.parse, urllib.request, zlib
from collections import defaultdict
from pathlib import Path
SOURCE='https://geospatial.alberta.ca/titan/rest/services/ags_apps/ags_apps_alberta_township_system/MapServer/3'
PAGE=1000; WHERE="RA = ' '"; MAGIC=b'R5LSD01\0'; ANCHORS=[3,0,12,15]; XY=[(3,0),(2,0),(1,0),(0,0),(0,1),(1,1),(2,1),(3,1),(3,2),(2,2),(1,2),(0,2),(0,3),(1,3),(2,3),(3,3)]
def query(p):
 u=SOURCE+'/query?'+urllib.parse.urlencode(dict(f='json',**p))
 for a in range(6):
  try:
   with urllib.request.urlopen(urllib.request.Request(u,headers={'Accept':'application/json'}),timeout=120) as r:d=json.load(r)
   if 'error' in d:raise RuntimeError(d['error'])
   return d
  except Exception:
   if a==5:raise
   time.sleep(min(2**a,20))
def inside(pt,rings):
 x,y=pt; hit=False
 for ring in rings:
  for a,b in zip(ring,ring[1:]):
   if (a[1]>y)!=(b[1]>y) and a[0]+(y-a[1])*(b[0]-a[0])/(b[1]-a[1])>x:hit=not hit
 return hit
def centroid(rings):
 if not rings or not rings[0]:raise ValueError('Empty polygon')
 ox,oy=rings[0][0]; area2=cx=cy=0.0
 for ring in rings:
  if len(ring)<4 or ring[0]!=ring[-1]:raise ValueError('Unclosed or degenerate ring')
  for a,b in zip(ring,ring[1:]):
   x0,y0,x1,y1=a[0]-ox,a[1]-oy,b[0]-ox,b[1]-oy; c=x0*y1-x1*y0; area2+=c; cx+=(x0+x1)*c; cy+=(y0+y1)*c
 if not math.isfinite(area2) or abs(area2)<1e-18:raise ValueError('Zero area polygon')
 return [ox+cx/(3*area2),oy+cy/(3*area2)]
def rep(rings):
 c=centroid(rings)
 if inside(c,rings):return c,False
 levels=sorted(set(p[1] for ring in rings for p in ring)); best=None
 for y in [c[1]]+[(a+b)/2 for a,b in zip(levels,levels[1:])]:
  xs=[]
  for ring in rings:
   for a,b in zip(ring,ring[1:]):
    if (a[1]>y)!=(b[1]>y):xs.append(a[0]+(y-a[1])*(b[0]-a[0])/(b[1]-a[1]))
  xs.sort()
  for a,b in zip(xs[0::2],xs[1::2]):
   if b>a and (best is None or b-a>best[0]):best=(b-a,[(a+b)/2,y])
 if best is None or not inside(best[1],rings):raise ValueError('Could not find an interior point')
 return best[1],True
def skey(m,r,t,s):return (((m-4)*30+r-1)*126+t-1)*36+s-1
def svar(v):
 u=v*2 if v>=0 else -v*2-1;o=bytearray()
 while u>=128:o.append((u&127)|128);u>>=7
 o.append(u);return o
def pred(aa,i,axis):
 x,y=XY[i];w=[(3-x)*(3-y),x*(3-y),(3-x)*y,x*y];n=sum(a[axis]*q for a,q in zip(aa,w));return (2*n+9)//18
def enc(points,amb=0,inter=0):
 present=sum(1<<i for i,p in enumerate(points) if p is not None);o=bytearray(struct.pack('<HHH',present,amb,inter))
 if not present:return o+b'\0'
 aa=[points[i] for i in ANCHORS]; model=all(a is not None for a in aa)
 if model:
  origin=aa[0];ds=[a[j]-origin[j] for a in aa[1:] for j in (0,1)];model=all(-32768<=d<=32767 for d in ds)
 o.append(1 if model else 0)
 if model:
  o+=struct.pack('<ii6h',*origin,*ds)
  for i,p in enumerate(points):
   if p is not None and i not in ANCHORS:
    for axis in (0,1):o+=svar(p[axis]-pred(aa,i,axis))
 else:
  prev=next(p for p in points if p is not None);o+=struct.pack('<ii',*prev);first=True
  for p in points:
   if p is None:continue
   if first:first=False;continue
   for axis in (0,1):o+=svar(p[axis]-prev[axis])
   prev=p
 return o
def main():
 out=Path(sys.argv[1]); count=query(dict(where=WHERE,returnCountOnly='true'))['count']; print('source',count,flush=True)
 sections={}; ambiguous=defaultdict(int); interior=defaultdict(int); dups=0; repairs=[]; last=-1
 def page(off):
  return query(dict(where=WHERE,outFields='OBJECTID,M,RGE,TWP,SEC,LS,RA',returnGeometry='true',outSR=4326,geometryPrecision=7,orderByFields='OBJECTID',resultOffset=off,resultRecordCount=PAGE))['features']
 def full(oid):return query(dict(where=f'OBJECTID={oid}',outFields='OBJECTID,M,RGE,TWP,SEC,LS,RA',returnGeometry='true',outSR=4326))['features'][0]
 start=time.time();done=0
 with concurrent.futures.ThreadPoolExecutor(max_workers=int(os.environ.get('LSD_FETCH_WORKERS','24'))) as ex:
  for off,features in zip(range(0,count,PAGE),ex.map(page,range(0,count,PAGE))):
   for f in features:
    a=f['attributes'];oid=a['OBJECTID']
    if oid<=last:raise RuntimeError('OBJECTID order');last=oid
    rings=(f.get('geometry') or {}).get('rings')
    try:(lon,lat),ins=rep(rings)
    except Exception as e:
     f=full(oid);rings=(f.get('geometry') or {}).get('rings');(lon,lat),ins=rep(rings);repairs.append({'objectId':oid,'page':f'{off:07d}.json.gz','reason':str(e),'requestedGeometryPrecision':None,'retrievedDate':dt.date.today().isoformat()})
    m,r,t,s,ls=(int(a[n]) for n in ('M','RGE','TWP','SEC','LS'));k=skey(m,r,t,s);arr=sections.setdefault(k,[None]*16);p=(round(lat*1e6),round(lon*1e6))
    if arr[ls-1] is None:arr[ls-1]=p
    elif arr[ls-1]!=p:ambiguous[k]|=1<<(ls-1);arr[ls-1]=None
    else:dups+=1
    if ins:interior[k]|=1<<(ls-1)
    done+=1
   if done%50000<1000:print(done,'/',count,'elapsed',round(time.time()-start),flush=True)
 if done!=count or query(dict(where=WHERE,returnCountOnly='true'))['count']!=count:raise RuntimeError('source count changed')
 records=sum(sum(p is not None for p in arr) for arr in sections.values());ambn=sum(v.bit_count() for v in ambiguous.values());intern=sum(v.bit_count() for v in interior.values())
 h=hashlib.sha256()
 for k in sorted(sections):
  for i,p in enumerate(sections[k]):
   if p is not None:h.update(struct.pack('<IBiiB',k,i+1,*p,bool(interior[k]&(1<<i))))
 meta={'format':'r5-lsd-pack','formatVersion':1,'sourceCoordinateSha256':h.hexdigest(),'sourceName':'Government of Alberta ATS v4.1 LSD polygons','sourceUrl':SOURCE,'datasetVersion':'ATS v4.1','retrievedDate':dt.date.today().isoformat(),'sourceLicense':'Open Government Licence Alberta','crs':'EPSG:4326','coordinateOrder':'latitude,longitude','coordinateScale':1000000,'pointDefinition':'centroid of each LSD polygon, moved inside when a centroid falls outside','roadAllowanceHandling':'records with RA values are excluded','sourceFeatureCount':count,'sourceGeometryPrecision':7,'fullPrecisionRepairs':repairs,'coverage':'province','buildStats':{'features':done,'roadAllowanceFeatures':0,'geometryErrors':0,'sections':len(sections),'records':records,'ambiguousRecords':ambn,'duplicateSourceRows':dups,'interiorPoints':intern}}
 keys=sorted(sections);mb=json.dumps(meta,sort_keys=True,separators=(',',':')).encode();io=(40+len(mb)+3)//4*4;do=io+8*len(keys);idx=bytearray();payload=bytearray()
 for k in keys:idx+=struct.pack('<II',k,len(payload));payload+=enc(sections[k],ambiguous[k],interior[k])
 body=mb+bytes(io-40-len(mb))+idx+payload;packed=struct.pack('<8sHH7I',MAGIC,1,40,len(keys),records,len(mb),io,do,40+len(body),zlib.crc32(body))+body
 out.parent.mkdir(parents=True,exist_ok=True);out.write_bytes(packed);gz=gzip.compress(packed,compresslevel=9,mtime=0);Path(str(out)+'.gz').write_bytes(gz)
 report=meta|{'dataBytes':len(packed),'gzipBytes':len(gz),'packSha256':hashlib.sha256(packed).hexdigest()};out.with_suffix('.manifest.json').write_text(json.dumps(report,indent=2)+'\n')
 print(json.dumps(report['buildStats']|{'bytes':len(packed),'gzipBytes':len(gz),'sha256':report['packSha256'],'coordinateSha256':h.hexdigest(),'repairs':repairs},indent=2),flush=True)
if __name__=='__main__':main()
