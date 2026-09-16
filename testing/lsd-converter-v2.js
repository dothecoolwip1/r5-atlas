/* R5 Atlas Alberta Legal Land Converter v2.
 * Offline-first wrapper around the authoritative Alberta ATS v4.1 LSD pack.
 * Coordinates are never guessed. Quarter/section centres are derived only when
 * all required authoritative LSD centroid records are present.
 */
(function (root, factory) {
  const api = factory(root.LSDConverter || null);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.LSDConverterV2 = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (BaseConverter) {
  'use strict';

  const VERSION = '2.0.0';
  const QUARTER_LSDS = Object.freeze({
    SW: Object.freeze([3, 4, 5, 6]),
    SE: Object.freeze([1, 2, 7, 8]),
    NW: Object.freeze([11, 12, 13, 14]),
    NE: Object.freeze([9, 10, 15, 16]),
    C: Object.freeze([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16])
  });

  const pad = (n, width) => String(n).padStart(width, '0');
  const fail = (input, status, message, extra) => ({ status, input, message, ...(extra || {}) });

  function validateFields(input, values, kind) {
    const limits = [
      ['Section', values.section, 1, 36],
      ['Township', values.township, 1, 126],
      ['Range', values.range, 1, 34],
      ['Meridian', values.meridian, 1, 6]
    ];
    if (kind === 'lsd') limits.unshift(['LSD', values.lsd, 1, 16]);
    for (const [name, value, min, max] of limits) {
      if (!Number.isInteger(value) || value < min || value > max) {
        return fail(input, 'invalid_input', `${name} must be between ${min} and ${max}.`);
      }
    }
    return null;
  }

  function makeLsd(input, lsd, section, township, range, meridian) {
    const values = { lsd, section, township, range, meridian };
    const invalid = validateFields(input, values, 'lsd');
    if (invalid) return invalid;
    return {
      status: 'ok', kind: 'lsd', input, ...values,
      normalized: `${pad(lsd, 2)}-${pad(section, 2)}-${pad(township, 3)}-${pad(range, 2)}-W${meridian}`,
      pid: `${meridian}${pad(range, 2)}${pad(township, 3)}${pad(section, 2)}${pad(lsd, 2)}`
    };
  }

  function makeQuarter(input, quarter, section, township, range, meridian) {
    const q = String(quarter || '').toUpperCase();
    if (!Object.prototype.hasOwnProperty.call(QUARTER_LSDS, q)) {
      return fail(input, 'invalid_input', 'Quarter must be C, NE, NW, SE, or SW.');
    }
    const values = { section, township, range, meridian };
    const invalid = validateFields(input, values, 'quarter');
    if (invalid) return invalid;
    return {
      status: 'ok', kind: 'quarter', input, quarter: q, ...values,
      normalized: `${q}-${pad(section, 2)}-${pad(township, 3)}-${pad(range, 2)}-W${meridian}`
    };
  }

  function parsePid(input) {
    const text = String(input || '').trim();
    if (!/^[1-6]\d{9}$/.test(text)) {
      return fail(input, 'unsupported_format', 'PID must contain ten digits in M-RR-TTT-SS-LL order.');
    }
    return makeLsd(
      input,
      Number(text.slice(8, 10)),
      Number(text.slice(6, 8)),
      Number(text.slice(3, 6)),
      Number(text.slice(1, 3)),
      Number(text[0])
    );
  }

  function parseLegal(input) {
    if (typeof input !== 'string' || !input.trim() || input.length > 180) {
      return fail(input, 'invalid_input', 'Enter an Alberta LSD or quarter section.');
    }
    const raw = input.trim();
    const text = raw.toUpperCase().replace(/\u2013|\u2014/g, '-').replace(/\s+/g, ' ').trim();

    if (/^\d{10}$/.test(text)) return parsePid(text);

    let m = text.match(/^LSD\s*(\d{1,2})\s*(?:[-/, ]+)?SEC(?:TION)?\s*(\d{1,2})\s*(?:[-/, ]+)?TWP(?:NSHIP)?\s*(\d{1,3})\s*(?:[-/, ]+)?R(?:GE|ANGE)\s*(\d{1,2})\s*(?:[-/, ]+)?W(?:EST)?\s*([1-6])(?:\s*M(?:ERIDIAN)?)?$/);
    if (m) return makeLsd(raw, ...m.slice(1).map(Number));

    m = text.match(/^(\d{1,2})(?:\s*[-/]\s*|\s+)(\d{1,2})(?:\s*[-/]\s*|\s+)(\d{1,3})(?:\s*[-/]\s*|\s+)(\d{1,2})(?:\s*[-/]?\s*)W?\s*([1-6])(?:\s*M)?$/);
    if (m) return makeLsd(raw, ...m.slice(1).map(Number));

    m = text.match(/^(C|NE|NW|SE|SW)(?:\s*[-/]\s*|\s+)(\d{1,2})(?:\s*[-/]\s*|\s+)(\d{1,3})(?:\s*[-/]\s*|\s+)(\d{1,2})(?:\s*[-/]?\s*)W?\s*([1-6])(?:\s*M)?$/);
    if (m) return makeQuarter(raw, m[1], ...m.slice(2).map(Number));

    m = text.match(/^(?:QTR|QUARTER)\s*(C|NE|NW|SE|SW)\s*(?:[-/, ]+)?SEC(?:TION)?\s*(\d{1,2})\s*(?:[-/, ]+)?TWP(?:NSHIP)?\s*(\d{1,3})\s*(?:[-/, ]+)?R(?:GE|ANGE)\s*(\d{1,2})\s*(?:[-/, ]+)?W(?:EST)?\s*([1-6])(?:\s*M(?:ERIDIAN)?)?$/);
    if (m) return makeQuarter(raw, m[1], ...m.slice(2).map(Number));

    return fail(raw, 'unsupported_format', 'Use LSD-Section-Township-Range-WMeridian, a ten-digit PID, or C/NE/NW/SE/SW-Section-Township-Range-WMeridian.');
  }

  function coverageReason(parsed) {
    if (parsed.meridian < 4 || parsed.meridian > 6) {
      return 'The description is formatted correctly, but the bundled Alberta ATS source contains W4, W5, and W6 records only.';
    }
    if (parsed.range > 30) {
      return 'The description is formatted correctly, but the bundled Alberta ATS source contains no coordinate record for this range/meridian combination.';
    }
    return 'The description is formatted correctly, but no matching surveyed Alberta ATS record exists in the bundled source. No coordinate was estimated.';
  }

  function mean(points) {
    return {
      latitude: points.reduce((sum, point) => sum + point.latitude, 0) / points.length,
      longitude: points.reduce((sum, point) => sum + point.longitude, 0) / points.length
    };
  }

  function createConverter(base) {
    if (!base || typeof base.convert !== 'function') {
      throw new Error('LSD Converter v2 requires a loaded R5 LSD base converter.');
    }

    function resolveLsd(parsed) {
      const result = base.convert(parsed.normalized);
      if (result && result.status === 'ok') {
        return {
          ...parsed,
          ...result,
          status: 'ok',
          kind: 'lsd',
          normalized: parsed.normalized,
          pid: parsed.pid,
          coordinateMethod: 'authoritative_lsd_polygon_point',
          coordinateSource: 'Alberta ATS v4.1 offline pack',
          estimated: false
        };
      }
      if (result && result.status === 'ambiguous_record') {
        return { ...parsed, ...result, status: 'ambiguous_record', estimated: false };
      }
      return { ...parsed, status: 'missing_record', message: coverageReason(parsed), estimated: false };
    }

    function resolveQuarter(parsed) {
      const lsds = QUARTER_LSDS[parsed.quarter];
      const points = [];
      const missing = [];
      const ambiguous = [];
      for (const lsd of lsds) {
        const child = resolveLsd(makeLsd(parsed.input, lsd, parsed.section, parsed.township, parsed.range, parsed.meridian));
        if (child.status === 'ok') points.push(child);
        else if (child.status === 'ambiguous_record') ambiguous.push(lsd);
        else missing.push(lsd);
      }
      if (ambiguous.length) {
        return {
          ...parsed,
          status: 'ambiguous_record',
          estimated: false,
          message: `The source contains conflicting records for LSD ${ambiguous.join(', ')}. No quarter/section coordinate was selected.`
        };
      }
      if (missing.length || points.length !== lsds.length) {
        return {
          ...parsed,
          status: 'missing_record',
          estimated: false,
          missingLsds: missing,
          message: `${coverageReason(parsed)} ${parsed.quarter === 'C' ? 'A section centre' : 'A quarter-section centre'} was not derived because all required LSD records were not present.`
        };
      }
      const centre = mean(points);
      return {
        ...parsed,
        status: 'ok',
        latitude: centre.latitude,
        longitude: centre.longitude,
        coordinateMethod: parsed.quarter === 'C' ? 'mean_of_16_authoritative_lsd_points' : 'mean_of_4_authoritative_lsd_points',
        coordinateSource: 'Alberta ATS v4.1 offline pack',
        derivedFromLsds: lsds.slice(),
        estimated: false,
        derived: true
      };
    }

    function resolve(input) {
      const parsed = typeof input === 'string' ? parseLegal(input) : input;
      if (!parsed || parsed.status !== 'ok') return parsed || fail(input, 'invalid_input', 'Invalid legal land description.');
      return parsed.kind === 'quarter' ? resolveQuarter(parsed) : resolveLsd(parsed);
    }

    function inspectSection(section, township, range, meridian) {
      const records = [];
      for (let lsd = 1; lsd <= 16; lsd++) records.push(resolveLsd(makeLsd('', lsd, section, township, range, meridian)));
      return {
        section, township, range, meridian,
        present: records.filter(r => r.status === 'ok').map(r => r.lsd),
        missing: records.filter(r => r.status === 'missing_record').map(r => r.lsd),
        ambiguous: records.filter(r => r.status === 'ambiguous_record').map(r => r.lsd),
        complete: records.every(r => r.status === 'ok')
      };
    }

    function selfTest() {
      const tests = [];
      const push = (name, pass, detail) => tests.push({ name, pass: !!pass, detail: detail || '' });

      const known = resolve('06-32-048-07-W5');
      push('known W5 record resolves', known.status === 'ok', known.status);
      if (known.status === 'ok') {
        push('known latitude', Math.abs(known.latitude - 53.18331) < 0.00002, String(known.latitude));
        push('known longitude', Math.abs(known.longitude - (-114.991884)) < 0.00002, String(known.longitude));
      }

      const variants = ['6 32 48 7 W5', '6/32/48/7/W5', 'LSD 6 SEC 32 TWP 48 RGE 7 W5'];
      for (const value of variants) {
        const r = resolve(value);
        push(`parser variant: ${value}`, r.status === 'ok' && r.normalized === '06-32-048-07-W5', r.status);
      }

      const r28 = resolve('10-36-039-28-W4');
      push('T39 R28 W4 resolves', r28.status === 'ok', r28.status);
      if (r28.status === 'ok') push('T39 R28 W4 longitude sanity', r28.longitude < -113.7 && r28.longitude > -114.1, String(r28.longitude));

      const r29 = resolve('10-36-039-29-W4');
      push('T39 R29 W4 never aliases another range', r29.status !== 'ok', r29.status);

      const r2 = resolve('10-36-039-02-W4');
      push('T39 R2 W4 resolves independently', r2.status === 'ok', r2.status);
      if (r2.status === 'ok') push('T39 R2 W4 longitude sanity', r2.longitude < -110.0 && r2.longitude > -110.4, String(r2.longitude));

      const quarter = resolve('NE-32-048-07-W5');
      push('offline quarter section resolves', quarter.status === 'ok' && quarter.derivedFromLsds?.length === 4, quarter.status);
      const centre = resolve('C-32-048-07-W5');
      push('offline section centre resolves', centre.status === 'ok' && centre.derivedFromLsds?.length === 16, centre.status);

      const invalid = parseLegal('17-36-39-28-W4');
      push('reject LSD > 16', invalid.status === 'invalid_input', invalid.status);

      return {
        version: VERSION,
        passed: tests.filter(t => t.pass).length,
        failed: tests.filter(t => !t.pass).length,
        ok: tests.every(t => t.pass),
        tests
      };
    }

    return Object.freeze({
      version: VERSION,
      parse: parseLegal,
      parsePid,
      resolve,
      inspectSection,
      selfTest,
      base
    });
  }

  async function createConverterFromGzip(input) {
    if (!BaseConverter || typeof BaseConverter.createConverterFromGzip !== 'function') {
      throw new Error('Load lsd-converter.js before lsd-converter-v2.js.');
    }
    const base = await BaseConverter.createConverterFromGzip(input);
    return createConverter(base);
  }

  function createConverterFromBase(base) {
    return createConverter(base);
  }

  return Object.freeze({
    version: VERSION,
    QUARTER_LSDS,
    parse: parseLegal,
    parsePid,
    createConverterFromGzip,
    createConverterFromBase
  });
});
