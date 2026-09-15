from pathlib import Path
root = Path('index.html').read_text(encoding='utf-8')
p = Path('testing/index.html')
text = p.read_text(encoding='utf-8')
if text != root:
    raise SystemExit('testing/index.html is not an exact copy of production before patching')
marker = "const ATS_SERVICE='https://geospatial.alberta.ca/titan/rest/services/base/alberta_township_system/MapServer';"
marker_pos = text.index(marker)
script_pos = text.rfind('<script', 0, marker_pos)
if script_pos < 0:
    raise SystemExit('Original tracker script block not found')
text = text[:script_pos] + '<script src="lsd-converter.js"></script>\n' + text[script_pos:]
start = text.index('async function lookupATS(p){')
end = text.index('async function lookupQuarter(p){', start)
replacement = """let offlineLsdConverterPromise;
async function getOfflineLsdConverter(){
  if(!offlineLsdConverterPromise){
    offlineLsdConverterPromise=(async()=>{
      const response=await fetch('data/alberta-ats-v41-lsd.bin.gz');
      if(!response.ok)throw Error('LSD coordinate data could not be loaded.');
      return LSDConverter.createConverterFromGzip(await response.arrayBuffer());
    })();
  }
  return offlineLsdConverterPromise;
}
async function lookupATS(p){
  const converter=await getOfflineLsdConverter();
  const description=`${String(p.lsd).padStart(2,'0')}-${String(p.sec).padStart(2,'0')}-${String(p.twp).padStart(3,'0')}-${String(p.rge).padStart(2,'0')}-W${p.mer}`;
  const result=converter.convert(description);
  if(result.status!=='ok')throw Error(result.message||'LSD not found.');
  let geometry=null;
  if(typeof navigator==='undefined'||navigator.onLine!==false){
    try{
      const where=`LSD=${p.lsd} AND SEC=${p.sec} AND TWP=${p.twp} AND RGE=${p.rge} AND M=${p.mer}`;
      const d=await fetchJson(atsUrl('/5/query',{f:'json',where,returnGeometry:'true',outSR:'4326',outFields:'*'}));
      geometry=d.features?.[0]?.geometry||null;
    }catch{}
  }
  return{lat:result.latitude,lng:result.longitude,ats:canonical(p),geometry,quarter:''}
}
"""
text = text[:start] + replacement + text[end:]
p.write_text(text, encoding='utf-8')
