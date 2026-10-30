#!/usr/bin/env node
/**
 * DWG Lite Studio CLI (dwg-cli)
 * Command-line tool for inspecting, editing (Text, Lines, Blocks, Layers),
 * converting (.dwg / .dxf / .json), and plotting to Vector PDF with Plot Window.
 */

import fs from 'node:fs';
import path from 'node:path';
import { parseDwgOrDxfBuffer, exportToDxf, getBuiltInSamples } from './lib/cad-codec.js';
import { generatePlotPdf } from './lib/pdf-plotter.js';
import { inspectDocument, applyEditOperations } from './lib/cad-cli-ops.js';

function printHelp() {
  console.log(`
================================================================================
 🛠️  DWG Lite Studio CLI (dwg-cli) — 도면 조회 · 글자/선/블록 수정 · PDF/DXF 변환
================================================================================

사용법:
  node cli.js <명령어> <입력파일 또는 sample:이름> [옵션]

지원 명령어:
  1) inspect <input>                 도면 요약, 글자/블록/선/레이어 목록 조회
  2) edit <input> -o <output>        글자·선·블록·레이어 수정 후 DXF/PDF/JSON 저장
  3) plot <input> -o <output.pdf>    인쇄 범위(Plot Window) 지정 및 벡터 PDF 출력
  4) convert <input> -o <output>     DWG / DXF / JSON / PDF 포맷 상호 변환

입력 파일(<input>):
  • 로컬 도면 경로: 예) ./samples/건축평면도_판교R&D센터_A301.dxf, ~/drawing.dwg
  • 내장 샘플 별칭: sample:arch-floorplan 또는 sample:mech-bracket

--------------------------------------------------------------------------------
[1] 도면 조회 (inspect) 옵션:
  --texts                  도면 내 모든 글자(TEXT/MTEXT) 목록 출력
  --blocks                 블록 정의(BLOCK_RECORD) 및 배치된 블록(INSERT) 출력
  --lines                  선/폴리선/원/호(LINE/LWPOLYLINE/CIRCLE/ARC) 목록 출력
  --layers                 레이어 목록 출력
  --search <키워드>        글자 또는 블록 이름 필터링
  --json                   전체 조회 결과를 JSON 포맷으로 출력

--------------------------------------------------------------------------------
[2] 도면 수정 (edit) 옵션:
  -o, --output <경로>      저장할 파일 경로 (.dxf, .pdf, .json 자동 인식)

  [글자(TEXT/MTEXT) 수정]
  --replace-text "기존=새문구"          도면 내 일치하는 모든 문구 일괄 치환 (복수 지정 가능)
  --include-blocks                      글자 치환 시 블록 정의 내부의 글자까지 함께 치환
  --set-text "<객체ID>=<새문구>"        특정 ID의 글자 내용을 변경
  --text-scale <배율>                   모든 글자 크기를 지정 배율(예: 1.2)로 조절
  --add-text "문구,X,Y[,높이,레이어,각도]"  도면의 (X,Y) 좌표에 새 글자 추가

  [선/도형(LINE/POLYLINE/CIRCLE) 수정]
  --set-line "<객체ID>=X1,Y1,X2,Y2"     특정 선(LINE)의 시작/끝 좌표 변경
  --add-line "X1,Y1,X2,Y2[,레이어,색상,선종류]"  새 선(LINE) 추가
  --add-rect "X1,Y1,X2,Y2[,레이어,색상]"        새 사각형(LWPOLYLINE) 추가
  --add-circle "CX,CY,반지름[,레이어,색상]"     새 원(CIRCLE) 추가
  --move "<객체ID|레이어명|ALL>=dX,dY"   특정 객체 또는 특정 레이어 전체를 (dX, dY)만큼 이동

  [블록(INSERT/BLOCK) 수정]
  --set-block "<객체ID>=X,Y[,배율X,배율Y,회전각]"  배치된 블록의 위치·배율·회전 변경
  --replace-block "기존블록명=새블록명"            도면 내 블록 참조를 다른 블록으로 일괄 교체
  --add-block "블록명,X,Y[,배율X,배율Y,회전각,레이어]"  새 블록 참조(INSERT) 배치
  --scale-block-def "블록명=배율"                  블록 내부 도형 크기를 일괄 배율 조정 (BEDIT 효과)
  --explode-block "<객체ID|블록명|ALL>"            블록을 개별 선/원/글자 객체로 분해(EXPLODE)

  [레이어 및 공통 삭제]
  --hide-layer "레이어1,레이어2"        지정한 레이어 숨기기 (PDF 출력 시 제외됨)
  --show-layer "레이어1,레이어2"        지정한 레이어 표시
  --layer-color "레이어명=#RRGGBB"      레이어 색상 변경
  --delete "객체ID1,객체ID2"            지정한 ID의 객체 삭제

--------------------------------------------------------------------------------
[3] 인쇄 범위 지정 PDF 출력 (plot / edit -o *.pdf) 옵션:
  -w, --window "xMin,yMin,xMax,yMax"    인쇄할 도면 좌표 범위 (생략 시 도면 전체 Extents)
  --paper <A4|A3|A2|A1>                 용지 크기 (기본값: A3)
  --orientation <landscape|portrait>    용지 방향: 가로(landscape) / 세로(portrait)
  --scale <fit|1:50|1:100|1:200>        출력 축척 (기본값: fit)
  --style <monochrome|grayscale|color>  플롯 스타일: 흑백(monochrome) / 그레이스케일 / 컬러
  --no-stamp                            하단 도면 출력 스탬프 숨기기

--------------------------------------------------------------------------------
예시:
  # 1. 도면 내 모든 글자(TEXT)와 블록(INSERT) 조회
  node cli.js inspect sample:arch-floorplan --texts --blocks

  # 2. 도면의 글자 치환 + 새 주석 추가 + 블록 추가 후 수정본 DXF로 저장
  node cli.js edit ./samples/건축평면도_판교R&D센터_A301.dxf \\
    --replace-text "대회의실 (24인)=임원 대회의실 (30인)" \\
    --add-text "보안구역 출입통제,4500,6800,200,A-TEXT" \\
    --add-block "BLK_WORKSTATION,9200,2800,1,1,0" \\
    -o ./samples/edited_floorplan.dxf

  # 3. 글자 수정과 동시에 원하는 인쇄 범위(Window)만 지정하여 흑백 A3 벡터 PDF로 바로 출력
  node cli.js edit sample:arch-floorplan \\
    --replace-text "오픈 연구실 (R&D Zone)=AI 에이전트 연구소" \\
    --window "0,0,7500,8000" --paper A3 --style monochrome \\
    -o ./samples/left_wing_plot.pdf
`);
}

function parseCliArgs(argv) {
  const args = argv.slice(2);
  const result = {
    command: args[0] || 'help',
    input: null,
    output: null,
    // inspect flags
    texts: false,
    blocks: false,
    lines: false,
    layers: false,
    search: null,
    json: false,
    // edit multi-value flags
    replaceText: [],
    includeBlocks: false,
    setText: [],
    textScale: null,
    addText: [],
    setLine: [],
    addLine: [],
    addRect: [],
    addCircle: [],
    setBlock: [],
    replaceBlock: [],
    addBlock: [],
    scaleBlockDef: [],
    explodeBlock: [],
    move: [],
    hideLayer: [],
    showLayer: [],
    layerColor: [],
    deleteIds: [],
    // plot flags
    window: null,
    paper: 'A3',
    orientation: 'landscape',
    scale: 'fit',
    style: 'monochrome',
    showStamp: true,
  };

  let i = 1;
  while (i < args.length) {
    const arg = args[i];
    if (!arg.startsWith('-') && !result.input) {
      result.input = arg;
      i++;
      continue;
    }

    switch (arg) {
      case '-h':
      case '--help':
        result.command = 'help';
        break;
      case '-o':
      case '--output':
        result.output = args[++i];
        break;
      case '--texts':
        result.texts = true;
        break;
      case '--blocks':
        result.blocks = true;
        break;
      case '--lines':
        result.lines = true;
        break;
      case '--layers':
        result.layers = true;
        break;
      case '--search':
        result.search = args[++i];
        break;
      case '--json':
        result.json = true;
        break;
      case '--replace-text':
        result.replaceText.push(args[++i]);
        break;
      case '--include-blocks':
        result.includeBlocks = true;
        break;
      case '--set-text':
        result.setText.push(args[++i]);
        break;
      case '--text-scale':
        result.textScale = Number(args[++i]);
        break;
      case '--add-text':
        result.addText.push(args[++i]);
        break;
      case '--set-line':
        result.setLine.push(args[++i]);
        break;
      case '--add-line':
        result.addLine.push(args[++i]);
        break;
      case '--add-rect':
        result.addRect.push(args[++i]);
        break;
      case '--add-circle':
        result.addCircle.push(args[++i]);
        break;
      case '--set-block':
        result.setBlock.push(args[++i]);
        break;
      case '--replace-block':
        result.replaceBlock.push(args[++i]);
        break;
      case '--add-block':
        result.addBlock.push(args[++i]);
        break;
      case '--scale-block-def':
        result.scaleBlockDef.push(args[++i]);
        break;
      case '--explode-block':
        result.explodeBlock.push(args[++i]);
        break;
      case '--move':
        result.move.push(args[++i]);
        break;
      case '--hide-layer':
        result.hideLayer.push(args[++i]);
        break;
      case '--show-layer':
        result.showLayer.push(args[++i]);
        break;
      case '--layer-color':
        result.layerColor.push(args[++i]);
        break;
      case '--delete':
        result.deleteIds.push(args[++i]);
        break;
      case '-w':
      case '--window':
        result.window = args[++i];
        break;
      case '--paper':
        result.paper = (args[++i] || 'A3').toUpperCase();
        break;
      case '--orientation':
        result.orientation = (args[++i] || 'landscape').toLowerCase();
        break;
      case '--scale':
        result.scale = args[++i] || 'fit';
        break;
      case '--style':
        result.style = (args[++i] || 'monochrome').toLowerCase();
        break;
      case '--no-stamp':
        result.showStamp = false;
        break;
      default:
        console.warn(`⚠️ 알 수 없는 옵션 무시됨: ${arg}`);
        break;
    }
    i++;
  }

  return result;
}

async function loadInputDocument(inputSpec) {
  if (!inputSpec) {
    throw new Error('입력 도면 파일 경로 또는 내장 샘플 이름(예: sample:arch-floorplan)을 지정해 주세요.');
  }
  if (inputSpec.startsWith('sample:')) {
    const sampleId = inputSpec.replace('sample:', '');
    const samples = getBuiltInSamples();
    if (!samples[sampleId]) {
      throw new Error(`내장 샘플을 찾을 수 없습니다: ${sampleId} (사용 가능: ${Object.keys(samples).join(', ')})`);
    }
    return JSON.parse(JSON.stringify(samples[sampleId]));
  }

  const resolvedPath = path.resolve(inputSpec);
  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`입력 파일을 찾을 수 없습니다: ${resolvedPath}`);
  }
  const ext = path.extname(resolvedPath).toLowerCase();
  const buf = fs.readFileSync(resolvedPath);
  if (ext === '.json') {
    return JSON.parse(buf.toString('utf8'));
  }
  return await parseDwgOrDxfBuffer(buf, path.basename(resolvedPath));
}

function buildPlotOptions(cliOpts, doc) {
  let plotWindow =
    doc.plotWindow ||
    doc.extents ||
    (doc.bounds
      ? {
          xMin: Math.round(doc.bounds.minX),
          yMin: Math.round(doc.bounds.minY),
          xMax: Math.round(doc.bounds.maxX),
          yMax: Math.round(doc.bounds.maxY),
        }
      : { xMin: 0, yMin: 0, xMax: 12000, yMax: 8000 });
  if (cliOpts.window) {
    const parts = cliOpts.window.split(',').map(Number);
    if (parts.length === 4 && parts.every((n) => !Number.isNaN(n))) {
      plotWindow = {
        xMin: Math.min(parts[0], parts[2]),
        yMin: Math.min(parts[1], parts[3]),
        xMax: Math.max(parts[0], parts[2]),
        yMax: Math.max(parts[1], parts[3]),
      };
    } else {
      throw new Error(`--window 옵션 형식이 올바르지 않습니다 ("xMin,yMin,xMax,yMax"): ${cliOpts.window}`);
    }
  }
  return {
    paperSize: cliOpts.paper,
    orientation: cliOpts.orientation,
    scale: cliOpts.scale,
    plotStyle: cliOpts.style,
    showPlotStamp: cliOpts.showStamp,
    plotWindow,
  };
}

function saveOutputDocument(doc, outputSpec, cliOpts) {
  if (!outputSpec) {
    throw new Error('-o <출력파일경로> 옵션을 지정해 주세요 (.dxf, .pdf, .json 지원).');
  }
  const outPath = path.resolve(outputSpec);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const ext = path.extname(outPath).toLowerCase();

  if (ext === '.pdf') {
    const plotOpts = buildPlotOptions(cliOpts, doc);
    const pdfBuf = generatePlotPdf(doc, plotOpts);
    fs.writeFileSync(outPath, pdfBuf);
    console.log(`✅ 벡터 PDF 출력 완료: ${outPath} (${pdfBuf.length.toLocaleString()} bytes)`);
    console.log(
      `   • 용지: ${plotOpts.paperSize} (${plotOpts.orientation}) | 축척: ${plotOpts.scale} | 스타일: ${plotOpts.plotStyle}`
    );
    console.log(
      `   • 인쇄 범위(Window): [${plotOpts.plotWindow.xMin}, ${plotOpts.plotWindow.yMin}] ~ [${plotOpts.plotWindow.xMax}, ${plotOpts.plotWindow.yMax}]`
    );
  } else if (ext === '.json') {
    fs.writeFileSync(outPath, JSON.stringify(doc, null, 2), 'utf8');
    console.log(`✅ 정규화 CAD JSON 저장 완료: ${outPath}`);
  } else {
    // Default to AutoCAD DXF (.dxf)
    const dxfStr = exportToDxf(doc);
    fs.writeFileSync(outPath, dxfStr, 'utf8');
    console.log(`✅ AutoCAD DXF 도면 저장 완료: ${outPath} (${Buffer.byteLength(dxfStr).toLocaleString()} bytes)`);
  }
}

function printInspectionReport(info, cliOpts) {
  if (cliOpts.json) {
    console.log(JSON.stringify(info, null, 2));
    return;
  }

  console.log(`\n📐 도면 요약: ${info.filename} (${info.formatVersion || 'AutoCAD DWG/DXF'})`);
  console.log(
    `   • 전체 범위(Extents): X [${info.extents?.xMin ?? 0} ~ ${info.extents?.xMax ?? 0}], Y [${info.extents?.yMin ?? 0} ~ ${info.extents?.yMax ?? 0}]`
  );
  console.log(`   • 총 객체 수: ${info.totalEntities}개`, info.typeCounts);
  console.log(`   • 레이어 수: ${info.layers.length}개 | 블록 정의 수: ${info.blockDefs.length}개`);

  const showAll = !cliOpts.texts && !cliOpts.blocks && !cliOpts.lines && !cliOpts.layers;

  if (cliOpts.layers || showAll) {
    console.log(`\n🗂️  [레이어 목록] (${info.layers.length}개)`);
    for (const l of info.layers) {
      console.log(`   - ${l.name.padEnd(12)} | 색상: ${l.colorHex} | 선종류: ${l.lineType.padEnd(10)} | 객체: ${l.entityCount}개 | 표시: ${l.visible ? 'ON' : 'OFF'}`);
    }
  }

  if (cliOpts.texts || showAll) {
    console.log(`\n🔤 [글자(TEXT/MTEXT) 목록] (${info.texts.length}개)`);
    for (const t of info.texts) {
      const clean = String(t.text || '').replace(/\n/g, ' \\P ');
      console.log(`   - [#${t.id.padEnd(8)}] (${String(t.x).padStart(5)}, ${String(t.y).padStart(5)}) H=${String(t.height).padEnd(4)} [${t.layer}] : "${clean}"`);
    }
  }

  if (cliOpts.blocks || showAll) {
    console.log(`\n🧩 [블록 정의 (BLOCK_RECORD)] (${info.blockDefs.length}개)`);
    for (const b of info.blockDefs) {
      console.log(`   - ${b.name.padEnd(18)} | 내부객체: ${b.entityCount}개 | 도면 내 사용: ${b.instanceCount}회 | ${b.description}`);
    }
    console.log(`\n📍 [배치된 블록 참조 (INSERT)] (${info.blockInserts.length}개)`);
    for (const ins of info.blockInserts) {
      console.log(
        `   - [#${ins.id.padEnd(8)}] ${ins.blockName.padEnd(18)} | 위치: (${ins.x}, ${ins.y}) | 배율: (${ins.scaleX}, ${ins.scaleY}) | 회전: ${ins.rotation}°`
      );
    }
  }

  if (cliOpts.lines) {
    console.log(`\n📏 [선/도형 (LINE/POLYLINE/CIRCLE/ARC) 목록] (${info.linesAndShapes.length}개)`);
    for (const s of info.linesAndShapes) {
      if (s.type === 'LINE') {
        console.log(`   - [#${s.id.padEnd(8)}] LINE       [${s.layer}] (${s.x1},${s.y1}) -> (${s.x2},${s.y2}) 길이=${s.length}`);
      } else if (s.type === 'CIRCLE' || s.type === 'ARC') {
        console.log(`   - [#${s.id.padEnd(8)}] ${s.type.padEnd(10)} [${s.layer}] 중심=(${s.cx},${s.cy}) R=${s.radius}`);
      } else {
        console.log(`   - [#${s.id.padEnd(8)}] ${s.type.padEnd(10)} [${s.layer}] 정점=${s.vertexCount}개 닫힘=${s.closed}`);
      }
    }
  }
  console.log('');
}

async function main() {
  const cliOpts = parseCliArgs(process.argv);
  const cmd = cliOpts.command.toLowerCase();

  if (cmd === 'help' || !cliOpts.input) {
    printHelp();
    process.exit(0);
  }

  const doc = await loadInputDocument(cliOpts.input);

  if (cmd === 'inspect' || cmd === 'info') {
    const info = inspectDocument(doc, { search: cliOpts.search });
    printInspectionReport(info, cliOpts);
    return;
  }

  if (cmd === 'edit') {
    const logs = applyEditOperations(doc, cliOpts);
    if (logs.length > 0) {
      console.log(`🛠️  CLI 도면 수정 내역 (${logs.length}건):`);
      for (const l of logs) {
        console.log(`   • ${l}`);
      }
    } else {
      console.log('ℹ️ 지정된 수정 옵션이 없어 원본 상태로 저장합니다.');
    }
    saveOutputDocument(doc, cliOpts.output, cliOpts);
    return;
  }

  if (cmd === 'plot' || cmd === 'pdf') {
    const outPath = cliOpts.output || (doc.filename || 'drawing').replace(/\.(dwg|dxf|json)$/i, '') + '_plot.pdf';
    saveOutputDocument(doc, outPath.endsWith('.pdf') ? outPath : `${outPath}.pdf`, cliOpts);
    return;
  }

  if (cmd === 'convert') {
    saveOutputDocument(doc, cliOpts.output, cliOpts);
    return;
  }

  throw new Error(`알 수 없는 명령어입니다: ${cmd} (inspect, edit, plot, convert 중 하나를 사용하세요)`);
}

main().catch((err) => {
  console.error(`❌ [dwg-cli 오류]: ${err.message}`);
  process.exit(1);
});
