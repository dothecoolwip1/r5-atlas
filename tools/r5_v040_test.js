const fs = require('fs');
const vm = require('vm');

function load(path) {
  const source = fs.readFileSync(path, 'utf8');
  vm.runInThisContext(source, { filename: path });
}

(async () => {
  load('testing/lsd-converter.js');
  if (!globalThis.LSDConverter) throw new Error('Base LSDConverter did not load into global scope');
  load('testing/lsd-converter-v2.js');
  if (!globalThis.LSDConverterV2) throw new Error('LSDConverterV2 did not load into global scope');

  const gz = fs.readFileSync('testing/data/alberta-ats-v41-lsd.bin.gz');
  const buffer = gz.buffer.slice(gz.byteOffset, gz.byteOffset + gz.byteLength);
  const converter = await globalThis.LSDConverterV2.createConverterFromGzip(buffer);
  const report = converter.selfTest();
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) throw new Error(`Converter v2 self-test failed: ${report.failed} test(s)`);

  const accepted = [
    '10-36-39-28w4',
    '10 36 39 28 W4',
    '10/36/39/28/W4',
    'LSD 10 SEC 36 TWP 39 RGE 28 W4',
    'NE-36-39-28-W4',
    'C 36 39 28 W4'
  ];
  for (const value of accepted) {
    const parsed = globalThis.LSDConverterV2.parse(value);
    if (parsed.status !== 'ok') throw new Error(`Parser rejected ${value}: ${parsed.message}`);
  }

  const bad = [
    '0-36-39-28-W4',
    '17-36-39-28-W4',
    '10-0-39-28-W4',
    '10-37-39-28-W4',
    '10-36-0-28-W4',
    '10-36-127-28-W4',
    '10-36-39-35-W4',
    'XX-36-39-28-W4'
  ];
  for (const value of bad) {
    const parsed = globalThis.LSDConverterV2.parse(value);
    if (parsed.status === 'ok') throw new Error(`Parser incorrectly accepted ${value}`);
  }

  const r29 = converter.resolve('10-36-39-29-W4');
  const r2 = converter.resolve('10-36-39-2-W4');
  if (r29.status === 'ok') throw new Error('R29 W4 unexpectedly resolved; range isolation regression');
  if (r2.status !== 'ok') throw new Error('R2 W4 did not resolve');
  if (!(r2.longitude > -110.4 && r2.longitude < -110.0)) throw new Error(`R2 W4 longitude sanity failed: ${r2.longitude}`);

  console.log('Converter v2 validation passed.');
})().catch(error => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
