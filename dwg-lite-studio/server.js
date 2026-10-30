import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDwgOrDxfBuffer, exportToDxf, getBuiltInSamples } from './lib/cad-codec.js';
import { generatePlotPdf } from './lib/pdf-plotter.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.join(__dirname, 'public');
const SAMPLES_DIR = path.join(__dirname, 'samples');

// Ensure sample DXF files exist on disk for easy file-upload testing
function ensureSampleFilesOnDisk() {
  if (!fs.existsSync(SAMPLES_DIR)) {
    fs.mkdirSync(SAMPLES_DIR, { recursive: true });
  }
  const samples = getBuiltInSamples();
  for (const [id, doc] of Object.entries(samples)) {
    const dxfName = (doc.filename || `${id}.dwg`).replace(/\.dwg$/i, '.dxf');
    const outPath = path.join(SAMPLES_DIR, dxfName);
    if (!fs.existsSync(outPath)) {
      fs.writeFileSync(outPath, exportToDxf(doc), 'utf8');
    }
  }
}

ensureSampleFilesOnDisk();

const REA_ANALYSIS_REPORT = {
  analyzedPath: '/Users/ejeheo/dev_gcli/rea_dwg/Autodesk_AutoCAD_2027.0.1_macOS.dmg',
  format: 'dmg (Apple Disk Image / UDIF)',
  sizeBytes: 2522153780,
  sizeFormatted: '2.52 GB (2,522,153,780 bytes)',
  sha256: '5ec9564805702b9e475f0dd3831a5586cc30bb7ddd47d6099d4709d8175eced9',
  evidenceIds: {
    summary: 'ev_354cd4dbfd9b4323b62617f1c5d4dae055fc4c4473ab60686375aea18228a682',
    parentInspection: 'ev_3579e6a54cefe3d9492c780098cf724e41bc3d12810355796f6af14da01fa1d7',
    inventory: 'ev_831d50c3436228232c4c37044e40ee8d4dc1cec64c3183c8f28dc84eb377ea6f',
    artifactGraphManifest: 'agm_3bf53f8422246eac5b85d2fe817bf6b22fb920d5dc011a07ed41d5a3bd7d92f1',
  },
  graphStats: {
    nodeCount: 256,
    occurrenceCount: 268,
    files: 161,
    directories: 106,
    symlinks: 1,
  },
  components: [
    {
      name: 'Install Autodesk AutoCAD 2027 for Mac.app/Contents/MacOS/Setup',
      role: 'ODIS Bootstrapper & Native UI (wxWidgets 3.3.1 dylibs)',
      size: '532 KB + 14.5 MB libs',
    },
    {
      name: 'autocad2027.pkg',
      role: 'Core AutoCAD 2027 Application & ObjectDBX / AcDb DWG Engine Payload',
      size: '1.38 GB (1,383,167,298 bytes)',
    },
    {
      name: 'AdODIS-installer.app',
      role: 'Autodesk On-Demand Install Service (Darwin)',
      size: '131.6 MB',
    },
    {
      name: 'AdskIdentityManager-Installer.app',
      role: 'Autodesk Identity Manager OAuth/SSO Daemon',
      size: '472.7 MB',
    },
    {
      name: 'AdskLicensing-16.0.3.14414-mac-installer.pkg',
      role: 'Autodesk Licensing Service Daemon',
      size: '188.9 MB',
    },
    {
      name: 'AcActivityInsights-25.1.1.pkg',
      role: 'AutoCAD Activity Insights Telemetry Module',
      size: '5.5 MB',
    },
  ],
  designTakeaway:
    '원본 AutoCAD 2027 macOS 패키지는 ODIS 인스톨러, 라이선싱 데몬, ID 매니저 등 2.52GB 규모의 무거운 엔터프라이즈 구성요소를 포함합니다. DWG Lite Studio는 이 중 도면 데이터 구조(AcDb/DWG R14~R2018+ 헤더·테이블·블록·엔티티 및 Plot Window 파이프라인)만 경량 WebAssembly(LibreDWG) + 네이티브 벡터 PDF 플로터로 대체하여 설치 없이 맥에서 즉시 동작하도록 설계되었습니다.',
};

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.dxf': 'application/dxf',
  '.dwg': 'application/acad',
};

function readBodyBuffer(req, maxBytes = 60 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        reject(new Error('파일 크기가 허용 한도(60MB)를 초과했습니다.'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

export function createAppServer() {
  return http.createServer(async (req, res) => {
    try {
      const urlObj = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      const pathname = urlObj.pathname;

      if (req.method === 'GET' && pathname === '/api/rea-report') {
        return sendJson(res, 200, REA_ANALYSIS_REPORT);
      }

      if (req.method === 'GET' && pathname === '/api/samples') {
        const samples = getBuiltInSamples();
        const list = Object.entries(samples).map(([id, doc]) => ({
          id,
          filename: doc.filename,
          title: doc.title,
          entityCount: doc.entities.length,
          blockCount: Object.keys(doc.blocks || {}).length,
          layerCount: Object.keys(doc.layers || {}).length,
        }));
        return sendJson(res, 200, { samples: list, documents: samples });
      }

      if (req.method === 'GET' && pathname.startsWith('/api/samples/')) {
        const sampleId = decodeURIComponent(pathname.replace('/api/samples/', ''));
        const samples = getBuiltInSamples();
        if (!samples[sampleId]) {
          return sendJson(res, 404, { error: `샘플 도면을 찾을 수 없습니다: ${sampleId}` });
        }
        return sendJson(res, 200, { document: samples[sampleId] });
      }

      if (req.method === 'POST' && pathname === '/api/parse-dwg') {
        const rawBuf = await readBodyBuffer(req);
        let fileBuffer;
        let filename = 'uploaded.dwg';

        const contentType = req.headers['content-type'] || '';
        if (contentType.includes('application/json')) {
          const parsed = JSON.parse(rawBuf.toString('utf8'));
          filename = parsed.filename || 'uploaded.dwg';
          fileBuffer = Buffer.from(parsed.base64 || '', 'base64');
        } else {
          filename = decodeURIComponent(req.headers['x-filename'] || 'uploaded.dwg');
          fileBuffer = rawBuf;
        }

        const doc = await parseDwgOrDxfBuffer(fileBuffer, filename);
        return sendJson(res, 200, { document: doc });
      }

      if (req.method === 'POST' && pathname === '/api/export-dxf') {
        const rawBuf = await readBodyBuffer(req);
        const { document: doc } = JSON.parse(rawBuf.toString('utf8'));
        const dxfString = exportToDxf(doc);
        const outName = (doc?.filename || 'drawing.dwg').replace(/\.(dwg|dxf)$/i, '') + '_edited.dxf';
        res.writeHead(200, {
          'Content-Type': 'application/dxf; charset=utf-8',
          'Content-Disposition': `attachment; filename="${encodeURIComponent(outName)}"`,
        });
        return res.end(dxfString, 'utf8');
      }

      if (req.method === 'POST' && pathname === '/api/export-pdf') {
        const rawBuf = await readBodyBuffer(req);
        const { document: doc, options } = JSON.parse(rawBuf.toString('utf8'));
        const pdfBuffer = generatePlotPdf(doc, options || {});
        const outName = (doc?.filename || 'drawing.dwg').replace(/\.(dwg|dxf)$/i, '') + '_plot.pdf';
        res.writeHead(200, {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename="${encodeURIComponent(outName)}"`,
          'Content-Length': pdfBuffer.length,
        });
        return res.end(pdfBuffer);
      }

      // Serve sample files from /samples/
      if (req.method === 'GET' && pathname.startsWith('/samples/')) {
        const rel = decodeURIComponent(pathname.replace('/samples/', ''));
        const safePath = path.normalize(path.join(SAMPLES_DIR, rel));
        if (safePath.startsWith(SAMPLES_DIR) && fs.existsSync(safePath) && fs.statSync(safePath).isFile()) {
          const ext = path.extname(safePath).toLowerCase();
          res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
          return fs.createReadStream(safePath).pipe(res);
        }
      }

      // Serve static files from /public
      let reqPath = pathname === '/' ? '/index.html' : pathname;
      const filePath = path.normalize(path.join(PUBLIC_DIR, reqPath));
      if (!filePath.startsWith(PUBLIC_DIR) || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
        return sendJson(res, 404, { error: 'Not Found' });
      }
      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, {
        'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
        'Cache-Control': 'no-cache',
      });
      fs.createReadStream(filePath).pipe(res);
    } catch (err) {
      console.error('[DWG Lite Studio Error]:', err);
      sendJson(res, 500, { error: err.message || 'Internal Server Error' });
    }
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  const PORT = Number(process.env.PORT || 4321);
  const server = createAppServer();
  server.listen(PORT, '127.0.0.1', () => {
    console.log(`DWG Lite Studio running at http://127.0.0.1:${PORT}`);
  });
}
