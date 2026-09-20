from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import sqlite3
import tempfile
import zipfile
from datetime import UTC, datetime
from pathlib import Path

EXPECTED_APK_SHA256 = '04d4f80b44c74eeeea778ca94a6fd414ca080845202fcd3433f9adc8a3666815'
EXPECTED_DLS_SHA256 = '506fc5b38c904fca668a6fcca6c90294630e668c03b838ca82c619b8c31787d3'
EXPECTED_REVERSE_SHA256 = 'fe0d9c41ed176a5234b7c34ad8d23f13bda7f923feedb1995e8c84382bd1cf54'
EXPECTED_DB_SHA256 = '6b746af2e2ac3e4c26435de8f3017e1e8e026a365a6d15169f1b8542f9809501'
PACKAGE = 'com.Rocanda.LandTrackerPro'
VERSION = '1.5.7'
API_BASE = 'https://www.uptodown.app/eapi'
APIKEY_SECRET = '$(=a%·!45J&S'
DALVIK_UA = 'Dalvik/2.1.0 (Linux; U; Android 14; SM-G955F Build/AP2A.240805.005)'
ROOT = Path('landtracker-pro-1-5-7-html')
DATA = ROOT / 'data'
SOURCE = DATA / 'source'


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open('rb') as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


def api_headers() -> dict[str, str]:
    now = datetime.now(UTC)
    epoch_ms = int(now.timestamp() * 1000)
    offset_ms = now.minute * 60000 + now.second * 1000 + now.microsecond // 1000
    hour_epoch = (epoch_ms - offset_ms) // 1000
    key = hashlib.sha256((APIKEY_SECRET + str(hour_epoch)).encode('utf-8')).hexdigest()
    return {
        'User-Agent': DALVIK_UA,
        'Identificador': 'Uptodown_Android',
        'Identificador-Version': '707',
        'APIKEY': key,
    }


def download_exact_apk(destination: Path) -> None:
    import requests
    session = requests.Session()
    headers = api_headers()

    def get_json(path: str):
        r = session.get(API_BASE + path, headers=headers, timeout=60)
        r.raise_for_status()
        return r.json()

    resolved = get_json(f'/apps/byPackagename/{PACKAGE}')
    inner = resolved.get('data', resolved)
    app_id = inner.get('appID') or inner.get('id')
    if not app_id:
        raise RuntimeError('Could not resolve LandTracker Pro app ID from Uptodown.')

    versions = get_json(f'/v3/app/{app_id}/device/1/compatible/versions?page[limit]=20&page[offset]=0')
    items = versions.get('data', [])
    target = next((v for v in items if str(v.get('version')) == VERSION), None)
    if not target:
        raise RuntimeError('LandTracker Pro 1.5.7 was not found in Uptodown version data.')

    file_id = target.get('fileID') or target.get('fileid')
    if not file_id:
        raise RuntimeError('LandTracker Pro 1.5.7 has no file ID.')

    advertised = (target.get('sha256') or target.get('SHA256') or '').lower()
    if advertised and advertised != EXPECTED_APK_SHA256:
        raise RuntimeError(f'Uptodown advertises unexpected APK SHA256: {advertised}')

    dl = get_json(f'/apps/{app_id}/file/{file_id}/downloadUrl?update=0')
    url = dl['data']['downloadURL']
    with session.get(url, headers={'User-Agent': DALVIK_UA}, stream=True, timeout=180) as r:
        r.raise_for_status()
        with destination.open('wb') as f:
            for chunk in r.iter_content(1024 * 1024):
                if chunk:
                    f.write(chunk)

    actual = sha256_file(destination)
    if actual != EXPECTED_APK_SHA256:
        raise RuntimeError(f'Downloaded APK hash mismatch: {actual}')


def extract_member(z: zipfile.ZipFile, name: str) -> bytes:
    try:
        return z.read(name)
    except KeyError as e:
        raise RuntimeError(f'APK member missing: {name}') from e


def assert_hash(label: str, data: bytes, expected: str) -> None:
    actual = sha256_bytes(data)
    if actual != expected:
        raise RuntimeError(f'{label} SHA256 mismatch: {actual}')


def build_bcnts_tsv(db_path: Path) -> tuple[bytes, int]:
    con = sqlite3.connect(db_path)
    try:
        rows = con.execute(
            'SELECT F2,F3,F4,F5,F6,F7,Lat,Lon FROM BCNTS ORDER BY F2,F3,F4,F5,F6,F7'
        ).fetchall()
    finally:
        con.close()

    out: list[str] = []
    for quarter, centizone, zone_block, map_unit, map_unit_sub, map_sheet, lat, lon in rows:
        # Exact Lg1/d.a transform recovered from the APK bytecode.
        lat_key = (centizone * 11101 + map_unit * 11102 + map_sheet * 11103) % 801
        lon_key = (centizone * 11103 + map_unit * 11102 + map_sheet * 11101) % 801
        final_lat = float(lat) - (lat_key / 400.0 - 1.0)
        final_lon = float(lon) - (lon_key / 400.0 - 1.0)
        key = f'{quarter}{centizone:03d}{zone_block}{map_unit:03d}{map_unit_sub}{map_sheet:03d}'
        out.append(f'{key}\t{final_lat:.10f}\t{final_lon:.10f}\n')

    raw = ''.join(out).encode('utf-8')
    return gzip.compress(raw, compresslevel=9, mtime=0), len(rows)


def replace_method(text: str, name: str, replacement: str) -> str:
    marker = f'  async {name}('
    start = text.find(marker)
    if start < 0:
        raise RuntimeError(f'Could not find async method {name} in converter-core.js')
    brace = text.find('{', start)
    depth = 0
    end = None
    for i in range(brace, len(text)):
        if text[i] == '{':
            depth += 1
        elif text[i] == '}':
            depth -= 1
            if depth == 0:
                end = i + 1
                break
    if end is None:
        raise RuntimeError(f'Could not locate end of {name} method')
    return text[:start] + replacement.rstrip() + text[end:]


def patch_html_runtime() -> None:
    core_path = ROOT / 'converter-core.js'
    core = core_path.read_text(encoding='utf-8')

    constructor_start = core.find("  constructor(base='data'){")
    fetch_start = core.find('  async _fetch(path){', constructor_start)
    if constructor_start < 0 or fetch_start < 0:
        raise RuntimeError('Could not find LandTrackerEngine constructor')
    constructor = """  constructor(base='data'){
    this.base=base.replace(/\\/$/,'');
    this._dls=null; this._bcnts=null; this._reverseMeta=null;
    this._reverseBytes=null; this._reverseSizes=null; this._reverseOffsets=null; this._reverseCache=new Map();
  }
"""
    core = core[:constructor_start] + constructor + core[fetch_start:]

    core = replace_method(core, 'loadDls', """  async loadDls(){
    if(!this._dls){
      const raw=await this._fetch('source/hf.mp3');
      if(raw.length!==5552064)throw new Error('DLS data file has an unexpected size.');
      this._dls=raw;
    }
    return this._dls;
  }""")

    core = replace_method(core, '_ensureReverseIndex', """  async _ensureReverseIndex(){
    if(this._reverseBytes)return;
    const bytes=await this._fetch('source/VN.mp3');
    if(bytes.length<16400)throw new Error('Reverse lookup data is truncated.');
    const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
    const sizes=new Int32Array(REVERSE_GRID*REVERSE_GRID);
    const offsets=new Uint32Array(REVERSE_GRID*REVERSE_GRID);
    let offset=16400;
    for(let i=0;i<sizes.length;i++){
      const size=view.getInt32(i*4,true);
      sizes[i]=size; offsets[i]=offset;
      offset+=Math.abs(size);
      if(offset>bytes.length)throw new Error('Reverse lookup index is invalid.');
    }
    if(offset!==bytes.length)throw new Error('Reverse lookup data has an unexpected size.');
    const minLat=view.getFloat32(16384,true),minLon=view.getFloat32(16388,true);
    const maxLat=view.getFloat32(16392,true),maxLon=view.getFloat32(16396,true);
    this._reverseBytes=bytes; this._reverseSizes=sizes; this._reverseOffsets=offsets;
    this._reverseMeta={minLat,minLon,maxLat,maxLon,spanLat:maxLat-minLat,spanLon:maxLon-minLon};
  }""")

    core = replace_method(core, '_reverseBin', """  async _reverseBin(index){
    if(index<0||index>=4096)return [];
    if(this._reverseCache.has(index))return this._reverseCache.get(index);
    await this._ensureReverseIndex();
    const size=this._reverseSizes[index],length=Math.abs(size),offset=this._reverseOffsets[index];
    let bytes=this._reverseBytes.subarray(offset,offset+length);
    if(size>0)bytes=await gunzipBytes(bytes);
    if(bytes.length%9!==0)throw new Error('Reverse lookup bin has an invalid record size.');
    const rows=[];
    for(let o=0;o<bytes.length;o+=9){
      rows.push({
        lat:(read24(bytes,o)^KEY_COORD)*1e-5,
        lon:(read24(bytes,o+3)^KEY_COORD)*1e-5,
        idx:(read24(bytes,o+6)^KEY_REVERSE_INDEX)
      });
    }
    if(this._reverseCache.size>=48)this._reverseCache.delete(this._reverseCache.keys().next().value);
    this._reverseCache.set(index,rows); return rows;
  }""")

    core = replace_method(core, 'convertBcnts', """  async convertBcnts(b){
    const map=await this.loadBcnts(); const exact=map.get(bcntsKey(b));
    return exact ? {lat:exact[0],lon:exact[1]} : null;
  }""")

    core_path.write_text(core, encoding='utf-8')

    index_path = ROOT / 'index.html'
    index = index_path.read_text(encoding='utf-8')
    for i in range(1, 8):
        index = index.replace(f'  <script src="asset-icon-{i:02d}.js"></script>\n', '')
    index_path.write_text(index, encoding='utf-8')

    assets_path = ROOT / 'assets-inline.js'
    assets = assets_path.read_text(encoding='utf-8')
    marker = "LandTrackerAssets['icon.png']='icon.png';"
    if marker not in assets:
        assets += f"\n{marker}\n"
    assets_path.write_text(assets, encoding='utf-8')

    for old in ROOT.glob('asset-icon-*.js'):
        old.unlink()


def validate_reverse_blob(data: bytes) -> list[float]:
    import struct
    if len(data) < 16400:
        raise RuntimeError('Reverse data too short')
    sizes = struct.unpack_from('<4096i', data, 0)
    end = 16400 + sum(abs(x) for x in sizes)
    if end != len(data):
        raise RuntimeError(f'Reverse index payload length mismatch: {end} != {len(data)}')
    return list(struct.unpack_from('<4f', data, 16384))


def build(apk_path: Path) -> None:
    if sha256_file(apk_path) != EXPECTED_APK_SHA256:
        raise RuntimeError('APK SHA256 does not match the user-uploaded LandTracker Pro 1.5.7 APK.')

    with zipfile.ZipFile(apk_path) as z:
        dls = extract_member(z, 'res/hf.mp3')
        reverse = extract_member(z, 'res/VN.mp3')
        db = extract_member(z, 'assets/ltdb.db')
        icon = extract_member(z, 'res/o-.png')

    assert_hash('DLS table', dls, EXPECTED_DLS_SHA256)
    assert_hash('reverse table', reverse, EXPECTED_REVERSE_SHA256)
    assert_hash('BCNTS database', db, EXPECTED_DB_SHA256)

    SOURCE.mkdir(parents=True, exist_ok=True)
    (SOURCE / 'hf.mp3').write_bytes(dls)
    (SOURCE / 'VN.mp3').write_bytes(reverse)
    (SOURCE / 'ltdb.db').write_bytes(db)
    (ROOT / 'icon.png').write_bytes(icon)

    bcnts_gz, bcnts_rows = build_bcnts_tsv(SOURCE / 'ltdb.db')
    (DATA / 'bcnts.tsv.gz').write_bytes(bcnts_gz)

    bounds = validate_reverse_blob(reverse)
    manifest = {
        'source': 'LandTracker Pro 1.5.7 APK only',
        'package': PACKAGE,
        'version': VERSION,
        'apkSha256': EXPECTED_APK_SHA256,
        'sourceFiles': {
            'hf.mp3': {'bytes': len(dls), 'sha256': sha256_bytes(dls)},
            'VN.mp3': {'bytes': len(reverse), 'sha256': sha256_bytes(reverse)},
            'ltdb.db': {'bytes': len(db), 'sha256': sha256_bytes(db)},
            'icon.png': {'bytes': len(icon), 'sha256': sha256_bytes(icon)},
        },
        'derivedFiles': {
            'bcnts.tsv.gz': {
                'bytes': len(bcnts_gz),
                'sha256': sha256_bytes(bcnts_gz),
                'rows': bcnts_rows,
                'derivation': 'SQLite BCNTS rows with exact g1/d.a coordinate transform recovered from APK bytecode',
            }
        },
        'dlsRecords': len(dls) // 6,
        'reverseBoundsFloat32': bounds,
        'createdBy': 'deterministic extraction from SHA256-verified APK',
    }
    (DATA / 'source-manifest.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')

    readme = f'''# LandTracker Pro 1.5.7 HTML recreation\n\nThis folder is an isolated HTML recreation built only from the LandTracker Pro 1.5.7 APK supplied for this project. It does not use R5 Atlas, ATSMap, Alberta ATS, or other coordinate datasets.\n\nThe build accepts data only when the APK SHA-256 is exactly `{EXPECTED_APK_SHA256}`. The original DLS table (`hf.mp3`), reverse lookup table (`VN.mp3`), BCNTS SQLite database (`ltdb.db`), and app icon are preserved byte-for-byte under this folder.\n\nBCNTS browser lookup is generated deterministically from the APK SQLite database using the exact coordinate transformation recovered from the APK bytecode.\n'''
    (ROOT / 'README.md').write_text(readme, encoding='utf-8')

    patch_html_runtime()

    if len(dls) != 925344 * 6:
        raise RuntimeError('Unexpected DLS record count')
    if bcnts_rows != 13001:
        raise RuntimeError(f'Unexpected BCNTS row count: {bcnts_rows}')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--apk', type=Path, help='Use an already-downloaded APK instead of Uptodown.')
    args = parser.parse_args()
    if args.apk:
        build(args.apk)
    else:
        with tempfile.TemporaryDirectory() as td:
            apk = Path(td) / 'landtracker-pro-1.5.7.apk'
            download_exact_apk(apk)
            build(apk)
    print('LandTracker Pro 1.5.7 HTML data build complete.')
