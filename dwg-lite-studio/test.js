import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { getBuiltInSamples, exportToDxf, parseDwgOrDxfBuffer } from './lib/cad-codec.js';
import { generatePlotPdf } from './lib/pdf-plotter.js';
import { inspectDocument, applyEditOperations } from './lib/cad-cli-ops.js';
import './server.js'; // Ensures sample DXF files are generated in ./samples

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI_PATH = path.join(__dirname, 'cli.js');

async function runTests() {
  console.log('1. Testing Built-in CAD Samples & Entity Structure...');
  const samples = getBuiltInSamples();
  const floorplan = samples['arch-floorplan'];
  assert.ok(floorplan, 'arch-floorplan sample exists');
  assert.ok(floorplan.entities.length >= 25, 'floorplan has rich entities');
  assert.ok(floorplan.blocks['BLK_DOOR_900'], 'door block exists');
  assert.ok(floorplan.blocks['BLK_WORKSTATION'], 'workstation block exists');

  console.log('2. Testing Text / Line / Block Edits & DXF Roundtrip...');
  const cloned = JSON.parse(JSON.stringify(floorplan));
  const txtEnt = cloned.entities.find((e) => e.type === 'TEXT');
  assert.ok(txtEnt, 'found TEXT entity');
  txtEnt.text = '수정된 대회의실 (30인)';
  const dxfContent = exportToDxf(cloned);
  assert.ok(dxfContent.includes('수정된 대회의실 (30인)'), 'DXF contains edited Korean text');

  const reparsed = await parseDwgOrDxfBuffer(Buffer.from(dxfContent, 'utf8'), 'roundtrip.dxf');
  assert.ok(reparsed.entities.some((e) => e.type === 'TEXT' && e.text.includes('수정된 대회의실')), 'Roundtrip parsed edited text');
  assert.ok(reparsed.blocks['BLK_DOOR_900'], 'Roundtrip preserved block definition');

  console.log('3. Testing Plot Window Vector PDF Generator...');
  const pdfBuf = generatePlotPdf(floorplan, {
    paperSize: 'A3',
    orientation: 'landscape',
    scale: 'fit',
    plotStyle: 'monochrome',
    plotWindow: { xMin: -700, yMin: -1000, xMax: 12700, yMax: 8900 },
  });
  const pdfHeader = pdfBuf.subarray(0, 8).toString('ascii');
  assert.equal(pdfHeader, '%PDF-1.4', 'Valid PDF 1.4 header');
  assert.ok(pdfBuf.length > 1500, `PDF has non-trivial vector content (${pdfBuf.length} bytes)`);

  const samplePdfPath = path.join(__dirname, 'samples', '건축평면도_판교R&D센터_A301_plot.pdf');
  fs.writeFileSync(samplePdfPath, pdfBuf);

  console.log('4. Testing CLI Operations (inspect, edit, plot, convert)...');
  // 4a. Test CLI inspect --json
  const inspectOut = execFileSync(process.execPath, [CLI_PATH, 'inspect', 'sample:arch-floorplan', '--json'], {
    encoding: 'utf8',
  });
  const inspectData = JSON.parse(inspectOut);
  assert.equal(inspectData.filename, '건축평면도_판교R&D센터_A301.dwg');
  assert.ok(inspectData.texts.length >= 6, 'CLI inspect returned text entities');
  assert.ok(inspectData.blockDefs.length >= 5, 'CLI inspect returned block definitions');

  // 4b. Test CLI edit (modify text, add text, add line, add block, and save as DXF)
  const cliEditedDxfPath = path.join(__dirname, 'samples', 'cli_edited_floorplan.dxf');
  const editOut = execFileSync(
    process.execPath,
    [
      CLI_PATH,
      'edit',
      'sample:arch-floorplan',
      '--replace-text',
      '102 대회의실 (CONFERENCE ROOM)=102 AI 전략회의실 (30인)',
      '--add-text',
      'CLI 추가 주석,4500,6800,180,A-TEXT',
      '--add-line',
      '0,0,12000,0,A-WALL,#ffffff',
      '--add-block',
      'BLK_WORKSTATION,9200,2800,1,1,0',
      '-o',
      cliEditedDxfPath,
    ],
    { encoding: 'utf8' }
  );
  assert.ok(editOut.includes('글자 치환'), 'CLI edit logged text replacement');
  assert.ok(fs.existsSync(cliEditedDxfPath), 'CLI edited DXF file was created');
  const editedDxfText = fs.readFileSync(cliEditedDxfPath, 'utf8');
  assert.ok(editedDxfText.includes('102 AI 전략회의실 (30인)'), 'Edited DXF contains replaced text');
  assert.ok(editedDxfText.includes('CLI 추가 주석'), 'Edited DXF contains added text');

  // 4c. Test CLI plot with custom Plot Window (-w) to PDF
  const cliWindowPdfPath = path.join(__dirname, 'samples', 'cli_window_plot.pdf');
  const plotOut = execFileSync(
    process.execPath,
    [
      CLI_PATH,
      'plot',
      cliEditedDxfPath,
      '--window',
      '0,0,7500,8000',
      '--paper',
      'A4',
      '--orientation',
      'landscape',
      '--style',
      'monochrome',
      '-o',
      cliWindowPdfPath,
    ],
    { encoding: 'utf8' }
  );
  assert.ok(plotOut.includes('벡터 PDF 출력 완료'), 'CLI plot succeeded');
  const cliPdfBytes = fs.readFileSync(cliWindowPdfPath);
  assert.equal(cliPdfBytes.subarray(0, 8).toString('ascii'), '%PDF-1.4', 'CLI generated valid PDF 1.4');

  console.log('✅ All verification & CLI tests passed!');
}

runTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
