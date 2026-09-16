import json
from pathlib import Path

INDEX = Path('testing/index.html')
SW = Path('testing/sw.js')
VERSION = Path('testing/version.json')


def replace_function(text: str, name: str, replacement: str) -> str:
    candidates = [f'async function {name}(', f'function {name}(']
    positions = [(text.find(marker), marker) for marker in candidates if text.find(marker) >= 0]
    if not positions:
        raise SystemExit(f'Function {name} not found')
    start, marker = min(positions, key=lambda item: item[0])
    brace = text.find('{', start + len(marker))
    if brace < 0:
        raise SystemExit(f'Opening brace for {name} not found')
    depth = 0
    end = None
    for i in range(brace, len(text)):
        ch = text[i]
        if ch == '{':
            depth += 1
        elif ch == '}':
            depth -= 1
            if depth == 0:
                end = i + 1
                break
    if end is None:
        raise SystemExit(f'Closing brace for {name} not found')
    return text[:start] + replacement.rstrip() + text[end:]


html = INDEX.read_text(encoding='utf-8')

if 'App v0.3.0' not in html or 'name="r5-app-version" content="0.3.0"' not in html:
    raise SystemExit('Expected v0.3.0 markers were not found in testing/index.html')

old_script = '<script src="lsd-converter.js"></script>'
new_scripts = '<script src="lsd-converter.js"></script>\n<script src="lsd-converter-v2.js"></script>'
if 'lsd-converter-v2.js' not in html:
    if old_script not in html:
        raise SystemExit('Base LSD converter script tag not found')
    html = html.replace(old_script, new_scripts, 1)

parse_job_input = r'''function parseJobInput(raw){
  raw=String(raw||'').trim();
  let m=raw.match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
  if(m)return{type:'gps',lat:+m[1],lng:+m[2]};
  const parsed=globalThis.LSDConverterV2?.parse(raw);
  if(parsed?.status==='ok'&&parsed.kind==='lsd'){
    return{type:'ats',lsd:parsed.lsd,sec:parsed.section,twp:parsed.township,rge:parsed.range,mer:parsed.meridian,normalized:parsed.normalized,pid:parsed.pid};
  }
  if(parsed?.status==='ok'&&parsed.kind==='quarter'){
    return{type:'quarter',quarter:parsed.quarter,sec:parsed.section,twp:parsed.township,rge:parsed.range,mer:parsed.meridian,normalized:parsed.normalized};
  }
  return{type:'invalid',message:parsed?.message||'Enter an LSD, quarter section, or GPS coordinate.'};
}'''
html = replace_function(html, 'parseJobInput', parse_job_input)

get_converter = r'''async function getOfflineLsdConverter(){
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
}'''
html = replace_function(html, 'getOfflineLsdConverter', get_converter)

lookup_ats = r'''async function lookupATS(p){
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
}'''
html = replace_function(html, 'lookupATS', lookup_ats)

lookup_quarter = r'''async function lookupQuarter(p){
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
}'''
html = replace_function(html, 'lookupQuarter', lookup_quarter)

html = html.replace('App v0.3.0', 'App v0.4.0', 1)
html = html.replace('name="r5-app-version" content="0.3.0"', 'name="r5-app-version" content="0.4.0"', 1)
INDEX.write_text(html, encoding='utf-8')

sw = SW.read_text(encoding='utf-8')
if "'./lsd-converter-v2.js'" not in sw:
    anchor = "  './lsd-converter.js',\n"
    if anchor not in sw:
        raise SystemExit('Service worker LSD converter precache anchor not found')
    sw = sw.replace(anchor, anchor + "  './lsd-converter-v2.js',\n", 1)
SW.write_text(sw, encoding='utf-8')

release = json.loads(VERSION.read_text(encoding='utf-8'))
if release.get('version') != '0.3.0':
    raise SystemExit(f"Expected testing version 0.3.0, found {release.get('version')}")
release.update({
    'version': '0.4.0',
    'releasedAt': '2026-09-15',
    'title': 'Alberta legal land converter v2',
    'notes': [
        'Rebuilt the testing legal-land lookup around Converter v2 while keeping the authoritative Alberta ATS v4.1 offline pack.',
        'Added flexible LSD input parsing including dashes, spaces, slashes, labelled descriptions, and ten-digit PID input.',
        'Added offline NE, NW, SE, SW and section-centre lookups derived only from complete authoritative LSD records; coordinates are never guessed.',
        'Quarter and section lookups use the live Alberta polygon centre when online and fall back to the offline data when disconnected.',
        'Added startup self-tests that block the converter if known records, parser variants, range isolation, or quarter/section lookups fail.',
        'Improved missing-record errors so a valid-looking description cannot silently alias to a different range or meridian.'
    ]
})
VERSION.write_text(json.dumps(release, indent=2) + '\n', encoding='utf-8')
