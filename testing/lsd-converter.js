/* Offline LSD Converter. MIT code; see NOTICE.md for data attribution. */
(function(root) {
"use strict";
/** Alberta LSD input parsing. No coordinate estimates or prefix matching. */
const pad = (n, width) => String(n).padStart(width, '0');

function parseLsd(input) {
  const fail = (status, message) => ({ status, input, message });
  if (typeof input !== 'string' || input.length > 160 || !input.trim()) {
    return fail('invalid_input', 'Enter an LSD such as 06-32-048-07-W5.');
  }
  const text = input.trim().toUpperCase();
  if (/^(NE|NW|SE|SW)\b/.test(text)) {
    return fail('unsupported_format', 'A quarter section is not an LSD. Enter an LSD number from 1 to 16.');
  }
  const labelled = /^LSD\s*(\d{1,2})\s+SEC(?:TION)?\s*(\d{1,2})\s+TWP\s*(\d{1,3})\s+RGE\s*(\d{1,2})\s+W\s*(\d)(?:M)?$/;
  const standard = /^(\d{1,2})(?:\s*-\s*|\s+)(\d{1,2})(?:\s*-\s*|\s+)(\d{1,3})(?:\s*-\s*|\s+)(\d{1,2})(?:\s*-?\s*W\s*|\s*-\s*)(\d)(?:M)?$/;
  const match = text.match(standard) || text.match(labelled);
  if (!match) return fail('unsupported_format', 'Use LSD-Section-Township-Range-WMeridian, for example 06-32-048-07-W5.');
  const [lsd, section, township, range, meridian] = match.slice(1).map(Number);
  for (const [name, value, min, max] of [
    ['LSD', lsd, 1, 16], ['Section', section, 1, 36],
    ['Township', township, 1, 126], ['Range', range, 1, 30],
  ]) {
    if (value < min || value > max) return fail('invalid_input', `${name} must be between ${min} and ${max}.`);
  }
  if (![4, 5, 6].includes(meridian)) return fail('invalid_input', 'This Alberta converter supports W4, W5, and W6.');
  return {
    status: 'ok', input, lsd, section, township, range, meridian,
    normalized: `${pad(lsd, 2)}-${pad(section, 2)}-${pad(township, 3)}-${pad(range, 2)}-W${meridian}`,
    pid: `${meridian}${pad(range, 2)}${pad(township, 3)}${pad(section, 2)}${pad(lsd, 2)}`,
  };
}

function parsePid(input) {
  if (typeof input !== 'string' || !/^[456]\d{9}$/.test(input.trim())) {
    return { status: 'unsupported_format', input, message: 'PID must contain exactly ten digits in M-RR-TTT-SS-LL order.' };
  }
  const p = input.trim();
  return { ...parseLsd(`${p.slice(8, 10)}-${p.slice(6, 8)}-${p.slice(3, 6)}-${p.slice(1, 3)}-W${p[0]}`), input };
}

const MAGIC = [82, 53, 76, 83, 68, 48, 49, 0];
const ANCHORS = [3, 0, 12, 15];
const XY = [[3,0],[2,0],[1,0],[0,0],[0,1],[1,1],[2,1],[3,1],[3,2],[2,2],[1,2],[0,2],[0,3],[1,3],[2,3],[3,3]];
const MAX_BYTES = 64 * 1024 * 1024;
const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, n) => {
  for (let i = 0; i < 8; i++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});

class DataPackError extends Error {
  constructor(message) { super(message); this.name = 'DataPackError'; }
}
function check(condition, message) { if (!condition) throw new DataPackError(message); }
function bytesOf(input) {
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  throw new DataPackError('Supply the data pack as an ArrayBuffer or typed array.');
}
function crc32(bytes, start = 0) {
  let crc = 0xffffffff;
  for (let i = start; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function deepFreeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(deepFreeze); Object.freeze(value); }
  return value;
}
function metadataText(bytes) {
  if (typeof TextDecoder === 'function') return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  let result = '';
  for (let i = 0; i < bytes.length;) {
    const first = bytes[i++];
    if (first < 128) { result += String.fromCharCode(first); continue; }
    const count = first >= 0xc2 && first <= 0xdf ? 1 : first >= 0xe0 && first <= 0xef ? 2 : first >= 0xf0 && first <= 0xf4 ? 3 : -1;
    check(count >= 0 && i + count <= bytes.length, 'Invalid UTF-8 metadata.');
    let cp = first & (127 >> count + 1);
    for (let j = 0; j < count; j++) {
      const next = bytes[i++]; check((next & 0xc0) === 0x80, 'Invalid UTF-8 continuation.'); cp = cp * 64 + (next & 63);
    }
    check(cp >= [0, 128, 2048, 65536][count] && cp <= 0x10ffff && !(cp >= 0xd800 && cp <= 0xdfff), 'Invalid UTF-8 codepoint.');
    result += String.fromCodePoint(cp);
  }
  return result;
}
function createConverterFromBase64(base64) {
  check(typeof base64 === 'string' && base64.length <= Math.ceil(MAX_BYTES / 3) * 4, 'Invalid base64 data pack size.');
  const equal = base64.indexOf('=');
  check(base64.length % 4 === 0 && !/[^A-Za-z0-9+/=]/.test(base64) && (equal < 0 || equal === base64.length - 1 || (equal === base64.length - 2 && base64.endsWith('=='))), 'Invalid base64 data pack.');
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const lookup = new Int16Array(128).fill(-1);
  for (let i = 0; i < alphabet.length; i++) lookup[alphabet.charCodeAt(i)] = i;
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  const bytes = new Uint8Array(base64.length / 4 * 3 - padding);
  let cursor = 0;
  for (let i = 0; i < base64.length; i += 4) {
    const a = lookup[base64.charCodeAt(i)], b = lookup[base64.charCodeAt(i + 1)];
    const c = base64[i + 2] === '=' ? 0 : lookup[base64.charCodeAt(i + 2)];
    const d = base64[i + 3] === '=' ? 0 : lookup[base64.charCodeAt(i + 3)];
    bytes[cursor++] = (a << 2) | (b >> 4);
    if (cursor < bytes.length) bytes[cursor++] = (b << 4) | (c >> 2);
    if (cursor < bytes.length) bytes[cursor++] = (c << 6) | d;
  }
  return createConverter(bytes);
}
function createConverter(input) {
  const supplied = bytesOf(input);
  check(supplied.length >= 40 && supplied.length <= MAX_BYTES, 'Invalid data pack size.');
  const bytes = supplied.slice();
  const view = new DataView(bytes.buffer);
  check(MAGIC.every((v, i) => bytes[i] === v), 'This is not an R5 LSD data pack.');
  check(view.getUint16(8, true) === 1 && view.getUint16(10, true) === 40, 'Unsupported data pack version.');
  const sections = view.getUint32(12, true);
  const records = view.getUint32(16, true);
  const metaLength = view.getUint32(20, true);
  const indexOffset = view.getUint32(24, true);
  const dataOffset = view.getUint32(28, true);
  check(view.getUint32(32, true) === bytes.length, 'Truncated data pack.');
  check(sections <= 408240 && records <= sections * 16, 'Invalid data counts.');
  check(metaLength <= 1024 * 1024 && indexOffset === Math.ceil((40 + metaLength) / 4) * 4, 'Invalid metadata length.');
  check(dataOffset === indexOffset + sections * 8 && dataOffset <= bytes.length, 'Invalid index layout.');
  check(crc32(bytes, 40) === view.getUint32(36, true), 'Data pack checksum failed.');
  let metadata;
  try { metadata = JSON.parse(metadataText(bytes.subarray(40, 40 + metaLength))); }
  catch { throw new DataPackError('Invalid data pack metadata.'); }
  check(metadata && typeof metadata.sourceName === 'string' && typeof metadata.datasetVersion === 'string' && typeof metadata.retrievedDate === 'string' && metadata.crs === 'EPSG:4326' && metadata.coordinateScale === 1000000, 'Unsupported coordinate reference system or scale.');
  deepFreeze(metadata);
  let previousKey = -1, previousOffset = -1;
  for (let i = 0; i < sections; i++) {
    const p = indexOffset + i * 8;
    const key = view.getUint32(p, true), offset = view.getUint32(p + 4, true);
    check(key > previousKey && key < 408240, 'Invalid section index order.');
    check(offset > previousOffset && dataOffset + offset + 7 <= bytes.length, 'Invalid section payload offset.');
    check(i !== 0 || offset === 0, 'Invalid first section offset.');
    previousKey = key; previousOffset = offset;
  }
  check(sections > 0 || dataOffset === bytes.length, 'Unexpected payload.');
  const cache = new Map();
  function find(key) {
    let lo = 0, hi = sections - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >>> 1, candidate = view.getUint32(indexOffset + mid * 8, true);
      if (candidate === key) return mid;
      if (candidate < key) lo = mid + 1; else hi = mid - 1;
    }
    return -1;
  }
  function decode(index) {
    if (cache.has(index)) return cache.get(index);
    let cursor = dataOffset + view.getUint32(indexOffset + index * 8 + 4, true);
    const end = index + 1 < sections ? dataOffset + view.getUint32(indexOffset + (index + 1) * 8 + 4, true) : bytes.length;
    const need = n => check(cursor + n <= end, 'Truncated section record.');
    const u16 = () => { need(2); const n = view.getUint16(cursor, true); cursor += 2; return n; };
    const i16 = () => { need(2); const n = view.getInt16(cursor, true); cursor += 2; return n; };
    const i32 = () => { need(4); const n = view.getInt32(cursor, true); cursor += 4; return n; };
    const variable = () => {
      let u = 0, factor = 1;
      for (let i = 0; i < 5; i++) {
        need(1); const byte = bytes[cursor++]; u += (byte & 127) * factor;
        if (!(byte & 128)) { check(u <= 0xffffffff, 'Coordinate residual overflow.'); return u & 1 ? -(u + 1) / 2 : u / 2; }
        factor *= 128;
      }
      throw new DataPackError('Invalid coordinate residual.');
    };
    const present = u16(), ambiguous = u16(), interior = u16();
    check(!(present & ambiguous) && !(interior & ~present) && (present || ambiguous), 'Invalid section masks.');
    need(1); const mode = bytes[cursor++]; check(mode === 0 || mode === 1, 'Unsupported section encoding.');
    const points = Array(16).fill(null);
    if (present) {
      const origin = [i32(), i32()];
      if (mode === 1) {
        check(ANCHORS.every(i => present & (1 << i)), 'Missing compression anchor.');
        const anchors = [origin];
        for (let i = 0; i < 3; i++) anchors.push([origin[0] + i16(), origin[1] + i16()]);
        ANCHORS.forEach((i, a) => { points[i] = anchors[a]; });
        for (let i = 0; i < 16; i++) {
          if (!(present & (1 << i)) || points[i]) continue;
          const [x, y] = XY[i];
          const weights = [(3-x)*(3-y), x*(3-y), (3-x)*y, x*y];
          points[i] = [0, 1].map(axis => {
            const n = anchors.reduce((sum, a, j) => sum + a[axis] * weights[j], 0);
            return Math.floor((2 * n + 9) / 18) + variable();
          });
        }
      } else {
        let first = true, previous = origin;
        for (let i = 0; i < 16; i++) if (present & (1 << i)) {
          points[i] = first ? origin : [previous[0] + variable(), previous[1] + variable()];
          first = false; previous = points[i];
        }
      }
      for (const p of points) if (p) check(Number.isInteger(p[0]) && Number.isInteger(p[1]) && p[0] >= 48900000 && p[0] <= 60100000 && p[1] >= -120100000 && p[1] <= -109900000, 'Coordinate outside Alberta data bounds.');
    } else check(mode === 0, 'Invalid empty section encoding.');
    check(cursor === end, 'Unexpected bytes in section record.');
    const result = { points, present, ambiguous, interior };
    if (cache.size >= 64) cache.delete(cache.keys().next().value);
    cache.set(index, result);
    return result;
  }
  function resolve(parsed) {
    if (parsed.status !== 'ok') return parsed;
    const { meridian: m, range: r, township: t, section: s, lsd } = parsed;
    const key = (((m - 4) * 30 + r - 1) * 126 + t - 1) * 36 + s - 1;
    const index = find(key);
    const missing = () => ({ ...parsed, status: 'missing_record', message: 'No matching Alberta ATS record exists for this LSD. Check the range and meridian.' });
    if (index < 0) return missing();
    const record = decode(index), bit = 1 << (lsd - 1);
    if (record.ambiguous & bit) return { ...parsed, status: 'ambiguous_record', message: 'The source contains conflicting records for this LSD. No coordinate was selected.' };
    const point = record.points[lsd - 1];
    if (!point) return missing();
    return { ...parsed, latitude: point[0] / 1000000, longitude: point[1] / 1000000, crs: 'EPSG:4326', coverage: metadata.coverage || 'unspecified', pointType: record.interior & bit ? 'lsd_polygon_interior' : 'lsd_polygon_centroid', source: metadata.sourceName, datasetVersion: metadata.datasetVersion, retrievedDate: metadata.retrievedDate, coordinateResolutionDegrees: 0.000001, maxQuantizationErrorMeters: 0.08, sourceAccuracyMeters: null };
  }
  return Object.freeze({
    metadata,
    stats: Object.freeze({ sections, records, dataBytes: bytes.length }),
    convert: input => resolve(parseLsd(input)),
    convertPid: input => resolve(parsePid(input)),
    convertBatch(inputs) { if (!Array.isArray(inputs)) throw new TypeError('Supply an array of LSD strings.'); return inputs.map(input => resolve(parseLsd(input))); },
    validateAll() { let count = 0; for (let i = 0; i < sections; i++) count += decode(i).points.filter(Boolean).length; check(count === records, 'Record count does not match payload.'); return { sections, records: count }; },
  });
}
async function createConverterFromGzip(input) {
  const bytes = bytesOf(input);
  check(bytes.length <= MAX_BYTES, 'Compressed data pack is too large.');
  check(typeof DecompressionStream === 'function', 'This runtime has no gzip decoder. Decompress with the host platform and call createConverter(bytes).');
  const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')).getReader();
  const chunks = []; let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > MAX_BYTES) { await reader.cancel(); throw new DataPackError('Expanded data pack is too large.'); }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof DataPackError) throw error;
    throw new DataPackError('Invalid or truncated gzip data.');
  } finally { reader.releaseLock(); }
  const result = new Uint8Array(length); let cursor = 0;
  for (const chunk of chunks) { result.set(chunk, cursor); cursor += chunk.length; }
  return createConverter(result);
}
const api = Object.freeze({parseLsd, parsePid, createConverter, createConverterFromGzip, createConverterFromBase64, DataPackError});
if (typeof module === "object" && module.exports) module.exports = api;
else root.LSDConverter = api;
})(globalThis);
