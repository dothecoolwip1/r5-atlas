const MAGIC = [82,53,76,83,68,48,49,0];
const ANCHORS = [3,0,12,15];
const XY = [[3,0],[2,0],[1,0],[0,0],[0,1],[1,1],[2,1],[3,1],[3,2],[2,2],[1,2],[0,2],[0,3],[1,3],[2,3],[3,3]];

function pad(value, width) { return String(value).padStart(width, '0'); }

export function parseLSD(value) {
  const fail = (status, message) => ({status, input:value, message});
  if (typeof value !== 'string' || value.length > 160 || !value.trim()) {
    return fail('invalid_input','Enter an LSD such as 06-32-048-07-W5.');
  }
  const text = value.trim().toUpperCase();
  if (/^(NE|NW|SE|SW)\b/.test(text)) {
    return fail('unsupported_format','A quarter section is not an LSD. Enter an LSD number from 1 to 16.');
  }
  const labelled = /^LSD\s*(\d{1,2})\s+SEC(?:TION)?\s*(\d{1,2})\s+TWP\s*(\d{1,3})\s+RGE\s*(\d{1,2})\s+W\s*(\d)(?:M)?$/;
  const standard = /^(\d{1,2})(?:\s*-\s*|\s+)(\d{1,2})(?:\s*-\s*|\s+)(\d{1,3})(?:\s*-\s*|\s+)(\d{1,2})(?:\s*-?\s*W\s*|\s*-\s*)(\d)(?:M)?$/;
  const match = text.match(standard) || text.match(labelled);
  if (!match) return fail('unsupported_format','Use LSD-Section-Township-Range-WMeridian, for example 06-32-048-07-W5.');
  const [lsd,section,township,range,meridian] = match.slice(1).map(Number);
  for (const [name,num,min,max] of [['LSD',lsd,1,16],['Section',section,1,36],['Township',township,1,126],['Range',range,1,30]]) {
    if (num < min || num > max) return fail('invalid_input',`${name} must be between ${min} and ${max}.`);
  }
  if (![4,5,6].includes(meridian)) return fail('invalid_input','This Alberta converter supports W4, W5, and W6.');
  return {
    status:'ok', input:value, lsd, section, township, range, meridian,
    normalized:`${pad(lsd,2)}-${pad(section,2)}-${pad(township,3)}-${pad(range,2)}-W${meridian}`,
    pid:`${meridian}${pad(range,2)}${pad(township,3)}${pad(section,2)}${pad(lsd,2)}`
  };
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i=0;i<bytes.length;i++) {
    crc ^= bytes[i];
    for (let j=0;j<8;j++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export async function ungzip(arrayBuffer) {
  if (!('DecompressionStream' in globalThis)) throw new Error('This browser does not support gzip decompression. Use a current Chrome, Edge, Safari, or Firefox.');
  const stream = new Blob([arrayBuffer]).stream().pipeThrough(new DecompressionStream('gzip'));
  return await new Response(stream).arrayBuffer();
}

export class AlbertaLSDDataPack {
  constructor(arrayBuffer) {
    this.buffer = arrayBuffer;
    this.bytes = new Uint8Array(arrayBuffer);
    this.view = new DataView(arrayBuffer);
    if (this.bytes.length < 40 || this.bytes.length > 64*1024*1024) throw new Error('Invalid data pack size.');
    for (let i=0;i<8;i++) if (this.bytes[i] !== MAGIC[i]) throw new Error('This is not an R5 LSD data pack.');
    const version = this.view.getUint16(8,true);
    const headerSize = this.view.getUint16(10,true);
    if (version !== 1 || headerSize !== 40) throw new Error('Unsupported data pack version.');
    this.sections = this.view.getUint32(12,true);
    this.records = this.view.getUint32(16,true);
    const metaLength = this.view.getUint32(20,true);
    this.indexOffset = this.view.getUint32(24,true);
    this.dataOffset = this.view.getUint32(28,true);
    const totalLength = this.view.getUint32(32,true);
    const expectedCrc = this.view.getUint32(36,true);
    if (totalLength !== this.bytes.length) throw new Error('Truncated data pack.');
    if (this.sections > 408240 || this.records > this.sections*16) throw new Error('Invalid data counts.');
    const expectedIndex = Math.ceil((40 + metaLength)/4)*4;
    if (this.indexOffset !== expectedIndex) throw new Error('Invalid metadata length.');
    if (this.dataOffset !== this.indexOffset + this.sections*8 || this.dataOffset > this.bytes.length) throw new Error('Invalid index layout.');
    const actualCrc = crc32(this.bytes.subarray(40));
    if (actualCrc !== expectedCrc) throw new Error('Data pack checksum failed.');
    const metaBytes = this.bytes.subarray(40,40+metaLength);
    this.metadata = JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(metaBytes));
    if (this.metadata.crs !== 'EPSG:4326' || this.metadata.coordinateScale !== 1000000) throw new Error('Unsupported coordinate reference system or scale.');
    this.cache = new Map();
  }

  findIndex(key) {
    let low=0, high=this.sections-1;
    while (low<=high) {
      const mid=(low+high)>>1;
      const candidate=this.view.getUint32(this.indexOffset+mid*8,true);
      if (candidate===key) return mid;
      if (candidate<key) low=mid+1; else high=mid-1;
    }
    return -1;
  }

  decode(index) {
    if (this.cache.has(index)) return this.cache.get(index);
    let cursor=this.dataOffset+this.view.getUint32(this.indexOffset+index*8+4,true);
    const end=index+1<this.sections
      ? this.dataOffset+this.view.getUint32(this.indexOffset+(index+1)*8+4,true)
      : this.bytes.length;
    const need=n=>{ if(cursor+n>end) throw new Error('Truncated section record.'); };
    const u8=()=>{need(1); return this.bytes[cursor++];};
    const u16=()=>{need(2); const v=this.view.getUint16(cursor,true); cursor+=2; return v;};
    const i16=()=>{need(2); const v=this.view.getInt16(cursor,true); cursor+=2; return v;};
    const i32=()=>{need(4); const v=this.view.getInt32(cursor,true); cursor+=4; return v;};
    const variable=()=>{
      let unsigned=0, factor=1;
      for(let i=0;i<5;i++){
        const byte=u8(); unsigned+=(byte&127)*factor;
        if(!(byte&128)) return (unsigned&1) ? -((unsigned+1)>>1) : (unsigned>>1);
        factor*=128;
      }
      throw new Error('Invalid coordinate residual.');
    };
    const present=u16(), ambiguous=u16(), interior=u16(), mode=u8();
    if ((present&ambiguous) || (interior&~present) || !(present||ambiguous)) throw new Error('Invalid section masks.');
    if (![0,1].includes(mode)) throw new Error('Unsupported section encoding.');
    const points=Array(16).fill(null);
    if (present) {
      const origin=[i32(),i32()];
      if (mode===1) {
        if (!ANCHORS.every(a=>present&(1<<a))) throw new Error('Missing compression anchor.');
        const anchors=[origin];
        for(let i=0;i<3;i++) anchors.push([origin[0]+i16(),origin[1]+i16()]);
        ANCHORS.forEach((a,i)=>points[a]=anchors[i]);
        for(let pointIndex=0;pointIndex<16;pointIndex++){
          if(!(present&(1<<pointIndex)) || points[pointIndex]) continue;
          const [x,y]=XY[pointIndex];
          const weights=[(3-x)*(3-y),x*(3-y),(3-x)*y,x*y];
          const point=[];
          for(let axis=0;axis<2;axis++){
            let weighted=0;
            for(let j=0;j<4;j++) weighted+=anchors[j][axis]*weights[j];
            const predicted=Math.floor((2*weighted+9)/18);
            point.push(predicted+variable());
          }
          points[pointIndex]=point;
        }
      } else {
        let first=true, previous=origin;
        for(let pointIndex=0;pointIndex<16;pointIndex++){
          if(present&(1<<pointIndex)){
            if(first){points[pointIndex]=origin; first=false;}
            else { previous=[previous[0]+variable(),previous[1]+variable()]; points[pointIndex]=previous; }
            previous=points[pointIndex];
          }
        }
      }
    } else if (mode!==0) throw new Error('Invalid empty section encoding.');
    if (cursor!==end) throw new Error('Unexpected bytes in section record.');
    const result={points,present,ambiguous,interior};
    if (this.cache.size>96) this.cache.delete(this.cache.keys().next().value);
    this.cache.set(index,result);
    return result;
  }

  convert(value) {
    const parsed=parseLSD(value);
    if(parsed.status!=='ok') return parsed;
    const key=(((parsed.meridian-4)*30+parsed.range-1)*126+parsed.township-1)*36+parsed.section-1;
    const index=this.findIndex(key);
    const missing=()=>({...parsed,status:'missing_record',message:'This LSD has no location in the bundled Alberta grid. No coordinate was estimated.'});
    if(index<0) return missing();
    const record=this.decode(index), bit=1<<(parsed.lsd-1);
    if(record.ambiguous&bit) return {...parsed,status:'ambiguous_record',message:'The source contains conflicting records for this LSD. No coordinate was selected.'};
    const point=record.points[parsed.lsd-1];
    if(!point) return missing();
    return {
      ...parsed,
      latitude:point[0]/1000000,
      longitude:point[1]/1000000,
      crs:'EPSG:4326',
      pointType:(record.interior&bit)?'lsd_polygon_interior':'lsd_polygon_centroid',
      source:this.metadata.sourceName,
      datasetVersion:this.metadata.datasetVersion,
      retrievedDate:this.metadata.retrievedDate
    };
  }
}
