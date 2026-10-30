/**
 * Vector PDF 1.4 Plotter for DWG Lite Studio
 * Supports:
 * - Interactive Plot Window clipping (xMin, yMin, xMax, yMax)
 * - Paper sizes: A4, A3, A2, A1 (Portrait / Landscape)
 * - Scale modes: Fit to Paper ('fit') or custom ratios ('1:50', '1:100', etc.)
 * - Plot styles (CTB simulation): 'monochrome' (흑백), 'grayscale' (그레이스케일), 'color' (원본 색상)
 * - Vector entities: LINE, LWPOLYLINE, CIRCLE, ARC, ELLIPSE, TEXT, MTEXT, INSERT (Blocks), DIMENSION
 * - Full Korean (한글) + ASCII text in PDF using CIDFontType0 (UniKS-UCS2-H / UTF-16BE)
 */

import { getSystemTtfFont, contoursToPdfPathOps } from './ttf-outlines.js';

const PAPER_SIZES_MM = {
  A4: { width: 210, height: 297 },
  A3: { width: 297, height: 420 },
  A2: { width: 420, height: 594 },
  A1: { width: 594, height: 841 },
};

const MM_TO_PT = 72 / 25.4;

function hexToRgb01(hex, plotStyle = 'monochrome') {
  const clean = String(hex || '#111827').replace('#', '');
  let r = parseInt(clean.slice(0, 2), 16) / 255;
  let g = parseInt(clean.slice(2, 4), 16) / 255;
  let b = parseInt(clean.slice(4, 6), 16) / 255;
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) {
    r = 0; g = 0; b = 0;
  }
  // White/light CAD lines on dark background should print dark on white paper
  if (r > 0.9 && g > 0.9 && b > 0.9) {
    r = 0.08; g = 0.08; b = 0.08;
  }
  if (plotStyle === 'monochrome') {
    return [0, 0, 0];
  }
  if (plotStyle === 'grayscale') {
    const lum = Math.min(0.85, 0.299 * r + 0.587 * g + 0.114 * b);
    return [lum, lum, lum];
  }
  return [r, g, b];
}

function toUtf16BeHex(str) {
  const text = String(str || '');
  let hex = '';
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    hex += code.toString(16).padStart(4, '0').toUpperCase();
  }
  return `<${hex}>`;
}

function num(n) {
  return Number(n || 0).toFixed(3);
}

/**
 * Generates a Vector PDF Buffer from a normalized CAD document and plot options
 */
export function generatePlotPdf(doc, options = {}) {
  const paperName = PAPER_SIZES_MM[options.paperSize] ? options.paperSize : 'A3';
  const orientation = options.orientation === 'portrait' ? 'portrait' : 'landscape';
  const plotStyle = options.plotStyle || 'monochrome'; // 'monochrome' | 'grayscale' | 'color'
  const scaleMode = options.scale || 'fit'; // 'fit' | '1:50' | '1:100' | '1:200'
  const showPlotStamp = options.showPlotStamp !== false;
  const lineweightScale = Number(options.lineweightScale || 1.0);

  const baseMm = PAPER_SIZES_MM[paperName];
  const pageWidthMm = orientation === 'landscape' ? Math.max(baseMm.width, baseMm.height) : Math.min(baseMm.width, baseMm.height);
  const pageHeightMm = orientation === 'landscape' ? Math.min(baseMm.width, baseMm.height) : Math.max(baseMm.width, baseMm.height);

  const pageWidthPt = pageWidthMm * MM_TO_PT;
  const pageHeightPt = pageHeightMm * MM_TO_PT;

  const marginMm = Number(options.marginMm ?? 10);
  const marginPt = marginMm * MM_TO_PT;
  const printableWidthPt = pageWidthPt - marginPt * 2;
  const printableHeightPt = pageHeightPt - marginPt * 2 - (showPlotStamp ? 18 : 0);

  // Determine Plot Window in CAD coordinates
  const fallbackExtents = doc.plotWindow || doc.extents || (doc.bounds ? {
    xMin: doc.bounds.minX,
    yMin: doc.bounds.minY,
    xMax: doc.bounds.maxX,
    yMax: doc.bounds.maxY,
  } : { xMin: 0, yMin: 0, xMax: 1000, yMax: 700 });
  const win = options.plotWindow || fallbackExtents;
  const cadXMin = Math.min(Number(win.xMin ?? win.minX ?? 0), Number(win.xMax ?? win.maxX ?? 1000));
  const cadYMin = Math.min(Number(win.yMin ?? win.minY ?? 0), Number(win.yMax ?? win.maxY ?? 700));
  const cadXMax = Math.max(Number(win.xMin ?? win.minX ?? 0), Number(win.xMax ?? win.maxX ?? 1000));
  const cadYMax = Math.max(Number(win.yMin ?? win.minY ?? 0), Number(win.yMax ?? win.maxY ?? 700));

  const cadWidth = Math.max(1e-3, cadXMax - cadXMin);
  const cadHeight = Math.max(1e-3, cadYMax - cadYMin);

  let scalePtPerCadUnit;
  let scaleLabel = 'Fit to Paper';
  if (scaleMode !== 'fit' && scaleMode.includes(':')) {
    const parts = scaleMode.split(':').map(Number);
    if (parts[0] > 0 && parts[1] > 0) {
      // Assuming 1 CAD unit = 1 mm
      const ratio = parts[0] / parts[1];
      scalePtPerCadUnit = ratio * MM_TO_PT;
      scaleLabel = scaleMode;
    }
  }
  if (!scalePtPerCadUnit) {
    scalePtPerCadUnit = Math.min(printableWidthPt / cadWidth, printableHeightPt / cadHeight);
    const effectiveRatio = Math.round(MM_TO_PT / scalePtPerCadUnit);
    scaleLabel = `Fit (~1:${Math.max(1, effectiveRatio)})`;
  }

  const plotBoxWidthPt = Math.min(printableWidthPt, cadWidth * scalePtPerCadUnit);
  const plotBoxHeightPt = Math.min(printableHeightPt, cadHeight * scalePtPerCadUnit);
  const offsetXPt = marginPt + (printableWidthPt - plotBoxWidthPt) / 2;
  const offsetYPt = marginPt + (showPlotStamp ? 18 : 0) + (printableHeightPt - plotBoxHeightPt) / 2;

  const toPdfX = (wx) => offsetXPt + (wx - cadXMin) * scalePtPerCadUnit;
  const toPdfY = (wy) => offsetYPt + (wy - cadYMin) * scalePtPerCadUnit;

  const ops = [];

  // 1. Draw printable border & clip to Plot Window
  ops.push('q');
  ops.push('0.5 w');
  ops.push('0.75 0.78 0.82 RG');
  ops.push(`${num(offsetXPt)} ${num(offsetYPt)} ${num(plotBoxWidthPt)} ${num(plotBoxHeightPt)} re S`);

  // Clip path to plot window
  ops.push(`${num(offsetXPt)} ${num(offsetYPt)} ${num(plotBoxWidthPt)} ${num(plotBoxHeightPt)} re W n`);

  const rawLayers = doc.layers || {};
  const layers = Array.isArray(rawLayers)
    ? Object.fromEntries(rawLayers.map((l) => [l.name, l]))
    : rawLayers;
  const blocks = doc.blocks || {};

  function resolveColor(ent, parentColor) {
    let hex = ent.color || ent.colorHex;
    if (!hex || hex === 'BYLAYER') {
      const layer = layers[ent.layer];
      hex = layer?.color || layer?.colorHex || parentColor || '#111827';
    }
    return hexToRgb01(hex, plotStyle);
  }

  function resolveLineWidthPt(ent) {
    const lwMm = Number(ent.lineweight || 0.25);
    const clampedMm = Math.max(0.12, Math.min(2.0, lwMm <= 0 ? 0.25 : lwMm > 5 ? lwMm / 100 : lwMm));
    return clampedMm * MM_TO_PT * lineweightScale;
  }

  function applyStrokeStyle(ent, parentColor) {
    const [r, g, b] = resolveColor(ent, parentColor);
    const lw = resolveLineWidthPt(ent);
    ops.push(`${num(r)} ${num(g)} ${num(b)} RG`);
    ops.push(`${num(r)} ${num(g)} ${num(b)} rg`);
    ops.push(`${num(lw)} w`);
    const lt = String(ent.linetype || ent.lineType || layers[ent.layer]?.linetype || layers[ent.layer]?.lineType || 'CONTINUOUS').toUpperCase();
    if (lt.includes('DASH') || lt.includes('HIDDEN')) {
      ops.push('[4 2] 0 d');
    } else if (lt.includes('CENTER')) {
      ops.push('[8 2 2 2] 0 d');
    } else {
      ops.push('[] 0 d');
    }
  }

  // Transform helper for nested block coordinates
  function makeTransform(tx = 0, ty = 0, sx = 1, sy = 1, rotDeg = 0, baseX = 0, baseY = 0) {
    const rad = (rotDeg * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    return (x, y) => {
      const dx = (x - baseX) * sx;
      const dy = (y - baseY) * sy;
      return {
        x: tx + dx * cos - dy * sin,
        y: ty + dx * sin + dy * cos,
      };
    };
  }

  function composeTransform(parentTf, childTf) {
    return (x, y) => {
      const p = childTf(x, y);
      return parentTf(p.x, p.y);
    };
  }

  const identityTf = (x, y) => ({ x, y });

  function renderCircleOrArc(cx, cy, r, startDeg, endDeg, tf, isClosedCircle = false) {
    const steps = 48;
    let s = startDeg;
    let e = endDeg;
    if (isClosedCircle) {
      s = 0;
      e = 360;
    } else if (e <= s) {
      e += 360;
    }
    const totalRad = ((e - s) * Math.PI) / 180;
    const startRad = (s * Math.PI) / 180;
    for (let i = 0; i <= steps; i++) {
      const ang = startRad + (totalRad * i) / steps;
      const wx = cx + r * Math.cos(ang);
      const wy = cy + r * Math.sin(ang);
      const pt = tf(wx, wy);
      const px = toPdfX(pt.x);
      const py = toPdfY(pt.y);
      ops.push(`${num(px)} ${num(py)} ${i === 0 ? 'm' : 'l'}`);
    }
    ops.push(isClosedCircle ? 's' : 'S');
  }

  const ttfFont = getSystemTtfFont();

  function renderVectorTextRun(line, startX, startY, fontSizePt, cos, sin, r, g, b) {
    if (!ttfFont) {
      ops.push('BT');
      ops.push(`/F2 ${num(fontSizePt)} Tf`);
      ops.push(`${num(r)} ${num(g)} ${num(b)} rg`);
      ops.push(`${num(cos)} ${num(sin)} ${num(-sin)} ${num(cos)} ${num(startX)} ${num(startY)} Tm`);
      ops.push(`${toUtf16BeHex(line)} Tj`);
      ops.push('ET');
      return;
    }

    const scale = fontSizePt / ttfFont.unitsPerEm;
    ops.push(`${num(r)} ${num(g)} ${num(b)} rg`);
    let cursorEmX = 0;

    for (let i = 0; i < line.length; i++) {
      const cp = line.charCodeAt(i);
      const glyph = ttfFont.getGlyphData(cp);
      if (glyph.contours && glyph.contours.length > 0) {
        const pathOps = contoursToPdfPathOps(glyph.contours, (gx, gy) => {
          const lx = (cursorEmX + gx) * scale;
          const ly = gy * scale;
          return {
            x: startX + lx * cos - ly * sin,
            y: startY + lx * sin + ly * cos,
          };
        });
        if (pathOps) ops.push(pathOps);
      }
      cursorEmX += glyph.advanceWidth;
    }

    // Emit invisible searchable text (3 Tr) for PDF text search / OCR / copy-paste
    ops.push('BT');
    ops.push('3 Tr');
    ops.push(`/F2 ${num(fontSizePt)} Tf`);
    ops.push(`${num(cos)} ${num(sin)} ${num(-sin)} ${num(cos)} ${num(startX)} ${num(startY)} Tm`);
    ops.push(`${toUtf16BeHex(line)} Tj`);
    ops.push('0 Tr');
    ops.push('ET');
  }

  function renderText(textStr, wx, wy, heightCad, rotationDeg, ent, parentColor, tf, scaleFactor = 1) {
    const cleanText = String(textStr || '').replace(/\\P/g, '\n');
    if (!cleanText.trim()) return;
    const lines = cleanText.split(/\r?\n/);
    const pt = tf(wx, wy);
    const px = toPdfX(pt.x);
    const py = toPdfY(pt.y);
    const fontSizePt = Math.max(3.5, Math.min(72, heightCad * scaleFactor * scalePtPerCadUnit));
    const [r, g, b] = resolveColor(ent, parentColor);
    const rad = ((rotationDeg || 0) * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);

    const align = ent?.align || 'left';
    const valign = ent?.valign || (ent?.type === 'MTEXT' ? 'top' : 'bottom');
    const lineStepPt = fontSizePt * 1.28;
    const totalHeightPt = (lines.length - 1) * lineStepPt + fontSizePt * 0.82;

    let baseVerticalShiftPt = 0;
    if (valign === 'top') {
      baseVerticalShiftPt = -fontSizePt * 0.82;
    } else if (valign === 'middle') {
      baseVerticalShiftPt = totalHeightPt / 2 - fontSizePt * 0.82;
    }

    lines.forEach((line, idx) => {
      if (!line) return;
      const lineWidthPt = ttfFont
        ? ttfFont.measureTextEm(line) * fontSizePt
        : line.length * fontSizePt * 0.6;

      let hShiftPt = 0;
      if (align === 'center') hShiftPt = -lineWidthPt / 2;
      else if (align === 'right') hShiftPt = -lineWidthPt;

      const vShiftPt = baseVerticalShiftPt - idx * lineStepPt;
      const lx = px + hShiftPt * cos - vShiftPt * sin;
      const ly = py + hShiftPt * sin + vShiftPt * cos;

      renderVectorTextRun(line, lx, ly, fontSizePt, cos, sin, r, g, b);
    });
  }

  function renderEntity(ent, tf = identityTf, scaleFactor = 1, rotOffset = 0, parentColor = null, depth = 0) {
    if (!ent || ent.visible === false || depth > 6) return;
    const layerInfo = layers[ent.layer];
    if (layerInfo && layerInfo.visible === false) return;

    applyStrokeStyle(ent, parentColor);

    switch (ent.type) {
      case 'LINE': {
        const p1 = tf(ent.x1, ent.y1);
        const p2 = tf(ent.x2, ent.y2);
        ops.push(`${num(toPdfX(p1.x))} ${num(toPdfY(p1.y))} m ${num(toPdfX(p2.x))} ${num(toPdfY(p2.y))} l S`);
        break;
      }
      case 'LWPOLYLINE':
      case 'POLYLINE': {
        const verts = ent.vertices || [];
        if (verts.length < 2) break;
        verts.forEach((v, idx) => {
          const p = tf(v.x, v.y);
          ops.push(`${num(toPdfX(p.x))} ${num(toPdfY(p.y))} ${idx === 0 ? 'm' : 'l'}`);
        });
        ops.push(ent.filled ? 'b' : ent.closed ? 's' : 'S');
        break;
      }
      case 'SOLID': {
        const pts = ent.points || [];
        if (pts.length < 3) break;
        pts.forEach((v, idx) => {
          const p = tf(v.x, v.y);
          ops.push(`${num(toPdfX(p.x))} ${num(toPdfY(p.y))} ${idx === 0 ? 'm' : 'l'}`);
        });
        ops.push('b');
        break;
      }
      case 'CIRCLE': {
        renderCircleOrArc(ent.cx, ent.cy, ent.r ?? ent.radius ?? 50, 0, 360, tf, true);
        break;
      }
      case 'ARC': {
        renderCircleOrArc(ent.cx, ent.cy, ent.r ?? ent.radius ?? 50, ent.startAngle ?? 0, ent.endAngle ?? 180, tf, false);
        break;
      }
      case 'ELLIPSE': {
        const steps = 48;
        const mx = ent.majorX || 10;
        const my = ent.majorY || 0;
        const majorLen = Math.hypot(mx, my);
        const minorLen = majorLen * (ent.axisRatio || 0.5);
        const rot = Math.atan2(my, mx);
        for (let i = 0; i <= steps; i++) {
          const t = (i / steps) * Math.PI * 2;
          const ex = ent.cx + majorLen * Math.cos(t) * Math.cos(rot) - minorLen * Math.sin(t) * Math.sin(rot);
          const ey = ent.cy + majorLen * Math.cos(t) * Math.sin(rot) + minorLen * Math.sin(t) * Math.cos(rot);
          const p = tf(ex, ey);
          ops.push(`${num(toPdfX(p.x))} ${num(toPdfY(p.y))} ${i === 0 ? 'm' : 'l'}`);
        }
        ops.push('S');
        break;
      }
      case 'TEXT':
      case 'MTEXT': {
        renderText(
          ent.text,
          ent.x,
          ent.y,
          ent.height || 100,
          (ent.rotation || 0) + rotOffset,
          ent,
          parentColor,
          tf,
          scaleFactor
        );
        break;
      }
      case 'DIMENSION': {
        const p1 = tf(ent.x1, ent.y1);
        const p2 = tf(ent.x2, ent.y2);
        ops.push(`${num(toPdfX(p1.x))} ${num(toPdfY(p1.y))} m ${num(toPdfX(p2.x))} ${num(toPdfY(p2.y))} l S`);
        const mx = (ent.x1 + ent.x2) / 2;
        const my = (ent.y1 + ent.y2) / 2;
        const dist = Math.round(Math.hypot(ent.x2 - ent.x1, ent.y2 - ent.y1));
        const label = ent.text && ent.text !== '<>' ? ent.text : String(dist);
        renderText(label, ent.textX ?? mx, ent.textY ?? my + 80, ent.height || 110, rotOffset, ent, parentColor, tf, scaleFactor);
        break;
      }
      case 'INSERT': {
        const blk = blocks[ent.blockName];
        if (blk && Array.isArray(blk.entities)) {
          const sx = Number(ent.scaleX ?? 1);
          const sy = Number(ent.scaleY ?? 1);
          const rot = Number(ent.rotation ?? 0);
          const childTf = makeTransform(ent.x, ent.y, sx, sy, rot, blk.basePoint?.x || 0, blk.basePoint?.y || 0);
          const combinedTf = composeTransform(tf, childTf);
          const nextScale = scaleFactor * ((Math.abs(sx) + Math.abs(sy)) / 2);
          for (const child of blk.entities) {
            renderEntity(child, combinedTf, nextScale, rotOffset + rot, ent.colorHex, depth + 1);
          }
        }
        // Render block attributes if present
        if (Array.isArray(ent.attributes)) {
          for (const attr of ent.attributes) {
            if (attr.value) {
              renderText(
                attr.value,
                ent.x + (attr.offsetX || 0),
                ent.y + (attr.offsetY || 0),
                attr.height || 90,
                (ent.rotation || 0) + rotOffset,
                ent,
                parentColor,
                tf,
                scaleFactor
              );
            }
          }
        }
        break;
      }
      default:
        break;
    }
  }

  for (const ent of doc.entities || []) {
    renderEntity(ent);
  }

  ops.push('Q');

  // 2. Plot Stamp / Footer outside the clip area
  if (showPlotStamp) {
    const stampY = marginPt + 4;
    const stampText = `DWG Lite Studio | File: ${doc.filename || 'Drawing.dwg'} | Paper: ${paperName} (${orientation}) | Scale: ${scaleLabel} | Style: ${plotStyle.toUpperCase()} | Window: [${Math.round(cadXMin)}, ${Math.round(cadYMin)}] - [${Math.round(cadXMax)}, ${Math.round(cadYMax)}]`;
    renderVectorTextRun(stampText, marginPt, stampY, 7.5, 1, 0, 0.35, 0.38, 0.42);
  }

  const streamContent = ops.join('\n');
  const streamBytes = Buffer.from(streamContent, 'ascii');

  // Assemble PDF 1.4 objects with Korean CIDFontType0 (HYSMyeongJo-Medium / UniKS-UCS2-H)
  const objects = [
    // 1: Catalog
    `1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n`,
    // 2: Pages
    `2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n`,
    // 3: Page
    `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(pageWidthPt)} ${num(pageHeightPt)}] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 7 0 R >>\nendobj\n`,
    // 4: Standard Helvetica
    `4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n`,
    // 5: Type0 Korean/Unicode CIDFont (renders Korean & English cleanly in macOS Preview / Acrobat)
    `5 0 obj\n<< /Type /Font /Subtype /Type0 /BaseFont /AppleGothic /Encoding /UniKS-UCS2-H /DescendantFonts [6 0 R] >>\nendobj\n`,
    // 6: CIDFontDescriptor
    `6 0 obj\n<< /Type /Font /Subtype /CIDFontType0 /BaseFont /HYSMyeongJo-Medium /CIDSystemInfo << /Registry (Adobe) /Ordering (Korea1) /Supplement 2 >> /DW 1000 >>\nendobj\n`,
    // 7: Content Stream
    `7 0 obj\n<< /Length ${streamBytes.length} >>\nstream\n${streamContent}\nendstream\nendobj\n`,
  ];

  const header = '%PDF-1.4\n%\xFF\xFF\xFF\xFF\n';
  const chunks = [Buffer.from(header, 'binary')];
  const offsets = [0];
  let currentOffset = chunks[0].length;

  for (const objStr of objects) {
    offsets.push(currentOffset);
    const buf = Buffer.from(objStr, 'binary');
    chunks.push(buf);
    currentOffset += buf.length;
  }

  const xrefStart = currentOffset;
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i++) {
    xref += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  xref += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
  chunks.push(Buffer.from(xref, 'binary'));

  return Buffer.concat(chunks);
}
