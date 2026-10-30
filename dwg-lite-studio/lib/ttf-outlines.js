/**
 * Pure Node.js TrueType (.ttf) Glyph Metrics & Vector Outline Extractor
 * Uses macOS system font (/System/Library/Fonts/Supplemental/AppleGothic.ttf)
 * so Korean (한글), English, and CAD symbols (Ø, ±, °, ∅) render as 100% crisp
 * vector outlines with exact proportional spacing in every PDF viewer.
 */

import fs from 'node:fs';

const TTF_CANDIDATES = [
  '/System/Library/Fonts/Supplemental/AppleGothic.ttf',
  '/System/Library/Fonts/Supplemental/Arial Unicode.ttf',
];

let cachedFont = null;

export function getSystemTtfFont() {
  if (cachedFont !== null) return cachedFont;
  for (const p of TTF_CANDIDATES) {
    try {
      if (fs.existsSync(p)) {
        const buf = fs.readFileSync(p);
        cachedFont = parseTtfBuffer(buf);
        return cachedFont;
      }
    } catch {
      // ignore and try next
    }
  }
  cachedFont = false;
  return null;
}

function parseTtfBuffer(buf) {
  const numTables = buf.readUInt16BE(4);
  const tables = {};
  for (let i = 0; i < numTables; i++) {
    const pos = 12 + i * 16;
    const tag = buf.toString('ascii', pos, pos + 4);
    const offset = buf.readUInt32BE(pos + 8);
    const length = buf.readUInt32BE(pos + 12);
    tables[tag] = { offset, length };
  }

  const head = tables.head.offset;
  const unitsPerEm = buf.readUInt16BE(head + 18);
  const indexToLocFormat = buf.readInt16BE(head + 50);

  const hhea = tables.hhea.offset;
  const numOfLongHorMetrics = buf.readUInt16BE(hhea + 34);

  const maxp = tables.maxp.offset;
  const numGlyphs = buf.readUInt16BE(maxp + 4);

  // Parse cmap Format 4 (BMP Unicode -> Glyph ID)
  const cmapOffset = tables.cmap.offset;
  const numSubtables = buf.readUInt16BE(cmapOffset + 2);
  let format4Offset = null;
  for (let i = 0; i < numSubtables; i++) {
    const subPos = cmapOffset + 4 + i * 8;
    const platformId = buf.readUInt16BE(subPos);
    const encodingId = buf.readUInt16BE(subPos + 2);
    const relOffset = buf.readUInt32BE(subPos + 4);
    const absOffset = cmapOffset + relOffset;
    const format = buf.readUInt16BE(absOffset);
    if (format === 4 && (platformId === 0 || (platformId === 3 && (encodingId === 1 || encodingId === 10)))) {
      format4Offset = absOffset;
      break;
    }
  }

  const segCountX2 = buf.readUInt16BE(format4Offset + 6);
  const segCount = segCountX2 / 2;
  const endCodesPos = format4Offset + 14;
  const startCodesPos = endCodesPos + segCountX2 + 2;
  const idDeltasPos = startCodesPos + segCountX2;
  const idRangeOffsetsPos = idDeltasPos + segCountX2;

  const endCodes = new Uint16Array(segCount);
  const startCodes = new Uint16Array(segCount);
  const idDeltas = new Int16Array(segCount);
  const idRangeOffsets = new Uint16Array(segCount);

  for (let i = 0; i < segCount; i++) {
    endCodes[i] = buf.readUInt16BE(endCodesPos + i * 2);
    startCodes[i] = buf.readUInt16BE(startCodesPos + i * 2);
    idDeltas[i] = buf.readInt16BE(idDeltasPos + i * 2);
    idRangeOffsets[i] = buf.readUInt16BE(idRangeOffsetsPos + i * 2);
  }

  function charToGlyphId(codePoint) {
    // Fallback for diameter symbol ∅ (U+2205) -> Ø (U+00D8) if missing
    let cp = codePoint === 0x2205 ? 0x00d8 : codePoint;
    let low = 0;
    let high = segCount - 1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      if (endCodes[mid] < cp) {
        low = mid + 1;
      } else if (startCodes[mid] > cp) {
        high = mid - 1;
      } else {
        const rangeOffset = idRangeOffsets[mid];
        if (rangeOffset === 0) {
          return (cp + idDeltas[mid]) & 0xffff;
        }
        const glyphIndexAddress =
          idRangeOffsetsPos + mid * 2 + rangeOffset + (cp - startCodes[mid]) * 2;
        const gid = buf.readUInt16BE(glyphIndexAddress);
        if (gid === 0) return 0;
        return (gid + idDeltas[mid]) & 0xffff;
      }
    }
    return 0;
  }

  const hmtxOffset = tables.hmtx.offset;
  function getAdvanceWidth(gid) {
    const idx = Math.min(gid, numOfLongHorMetrics - 1);
    return buf.readUInt16BE(hmtxOffset + idx * 4);
  }

  const locaOffset = tables.loca.offset;
  const glyfOffset = tables.glyf.offset;
  function getGlyphOffset(gid) {
    if (gid < 0 || gid >= numGlyphs) return null;
    if (indexToLocFormat === 0) {
      const o1 = buf.readUInt16BE(locaOffset + gid * 2) * 2;
      const o2 = buf.readUInt16BE(locaOffset + (gid + 1) * 2) * 2;
      return o1 === o2 ? null : { offset: glyfOffset + o1, length: o2 - o1 };
    }
    const o1 = buf.readUInt32BE(locaOffset + gid * 4);
    const o2 = buf.readUInt32BE(locaOffset + (gid + 1) * 4);
    return o1 === o2 ? null : { offset: glyfOffset + o1, length: o2 - o1 };
  }

  const glyphCache = new Map();

  function getGlyphContours(gid, depth = 0) {
    if (depth > 4) return [];
    if (glyphCache.has(gid)) return glyphCache.get(gid);

    const loc = getGlyphOffset(gid);
    if (!loc) {
      glyphCache.set(gid, []);
      return [];
    }

    const pos = loc.offset;
    const numberOfContours = buf.readInt16BE(pos);
    if (numberOfContours === 0) {
      glyphCache.set(gid, []);
      return [];
    }

    // Simple glyph
    if (numberOfContours > 0) {
      let p = pos + 10;
      const endPtsOfContours = [];
      for (let i = 0; i < numberOfContours; i++) {
        endPtsOfContours.push(buf.readUInt16BE(p));
        p += 2;
      }
      const instructionLength = buf.readUInt16BE(p);
      p += 2 + instructionLength;

      const numPoints = endPtsOfContours[numberOfContours - 1] + 1;
      const flags = new Uint8Array(numPoints);
      for (let i = 0; i < numPoints; i++) {
        const flag = buf.readUInt8(p++);
        flags[i] = flag;
        if (flag & 8) {
          const repeatCount = buf.readUInt8(p++);
          for (let r = 0; r < repeatCount; r++) {
            flags[++i] = flag;
          }
        }
      }

      const xCoords = new Int16Array(numPoints);
      let x = 0;
      for (let i = 0; i < numPoints; i++) {
        const flag = flags[i];
        if (flag & 2) {
          const dx = buf.readUInt8(p++);
          x += flag & 16 ? dx : -dx;
        } else if (!(flag & 16)) {
          x += buf.readInt16BE(p);
          p += 2;
        }
        xCoords[i] = x;
      }

      const yCoords = new Int16Array(numPoints);
      let y = 0;
      for (let i = 0; i < numPoints; i++) {
        const flag = flags[i];
        if (flag & 4) {
          const dy = buf.readUInt8(p++);
          y += flag & 32 ? dy : -dy;
        } else if (!(flag & 32)) {
          y += buf.readInt16BE(p);
          p += 2;
        }
        yCoords[i] = y;
      }

      const contours = [];
      let startIdx = 0;
      for (let c = 0; c < numberOfContours; c++) {
        const endIdx = endPtsOfContours[c];
        const pts = [];
        for (let i = startIdx; i <= endIdx; i++) {
          pts.push({
            x: xCoords[i],
            y: yCoords[i],
            onCurve: Boolean(flags[i] & 1),
          });
        }
        contours.push(pts);
        startIdx = endIdx + 1;
      }
      glyphCache.set(gid, contours);
      return contours;
    }

    // Compound glyph (numberOfContours < 0)
    let p = pos + 10;
    const contours = [];
    const ARG_1_AND_2_ARE_WORDS = 0x0001;
    const ARGS_ARE_XY_VALUES = 0x0002;
    const WE_HAVE_A_SCALE = 0x0008;
    const MORE_COMPONENTS = 0x0020;
    const WE_HAVE_AN_X_AND_Y_SCALE = 0x0040;
    const WE_HAVE_A_TWO_BY_TWO = 0x0080;

    let flags = MORE_COMPONENTS;
    while (flags & MORE_COMPONENTS) {
      flags = buf.readUInt16BE(p);
      const subGid = buf.readUInt16BE(p + 2);
      p += 4;

      let dx = 0;
      let dy = 0;
      if (flags & ARG_1_AND_2_ARE_WORDS) {
        if (flags & ARGS_ARE_XY_VALUES) {
          dx = buf.readInt16BE(p);
          dy = buf.readInt16BE(p + 2);
        }
        p += 4;
      } else {
        if (flags & ARGS_ARE_XY_VALUES) {
          dx = buf.readInt8(p);
          dy = buf.readInt8(p + 1);
        }
        p += 2;
      }

      let a = 1, b = 0, c = 0, d = 1;
      if (flags & WE_HAVE_A_SCALE) {
        a = d = buf.readInt16BE(p) / 16384;
        p += 2;
      } else if (flags & WE_HAVE_AN_X_AND_Y_SCALE) {
        a = buf.readInt16BE(p) / 16384;
        d = buf.readInt16BE(p + 2) / 16384;
        p += 4;
      } else if (flags & WE_HAVE_A_TWO_BY_TWO) {
        a = buf.readInt16BE(p) / 16384;
        b = buf.readInt16BE(p + 2) / 16384;
        c = buf.readInt16BE(p + 4) / 16384;
        d = buf.readInt16BE(p + 6) / 16384;
        p += 8;
      }

      const subContours = getGlyphContours(subGid, depth + 1);
      for (const contour of subContours) {
        contours.push(
          contour.map((pt) => ({
            x: pt.x * a + pt.y * c + dx,
            y: pt.x * b + pt.y * d + dy,
            onCurve: pt.onCurve,
          }))
        );
      }
    }

    glyphCache.set(gid, contours);
    return contours;
  }

  function getGlyphData(codePoint) {
    const gid = charToGlyphId(codePoint);
    return {
      gid,
      advanceWidth: getAdvanceWidth(gid),
      contours: getGlyphContours(gid),
    };
  }

  function measureTextEm(str) {
    let total = 0;
    for (let i = 0; i < str.length; i++) {
      const cp = str.charCodeAt(i);
      const gid = charToGlyphId(cp);
      total += getAdvanceWidth(gid);
    }
    return total / unitsPerEm;
  }

  return {
    unitsPerEm,
    getGlyphData,
    measureTextEm,
  };
}

/**
 * Converts TrueType contours (quadratic splines) into PDF path operators
 */
export function contoursToPdfPathOps(contours, mapPointFn) {
  const ops = [];
  const f = (n) => Number(n).toFixed(2);

  for (const rawPts of contours) {
    if (!rawPts || rawPts.length === 0) continue;

    // Expand implied on-curve midpoints between consecutive off-curve points
    const pts = [];
    const len = rawPts.length;
    for (let i = 0; i < len; i++) {
      const curr = rawPts[i];
      const next = rawPts[(i + 1) % len];
      pts.push(curr);
      if (!curr.onCurve && !next.onCurve) {
        pts.push({
          x: (curr.x + next.x) / 2,
          y: (curr.y + next.y) / 2,
          onCurve: true,
        });
      }
    }

    // Ensure contour starts with an on-curve point
    let firstOnIdx = pts.findIndex((p) => p.onCurve);
    let ordered;
    if (firstOnIdx === -1) {
      const mid = {
        x: (pts[0].x + pts[1].x) / 2,
        y: (pts[0].y + pts[1].y) / 2,
        onCurve: true,
      };
      ordered = [mid, ...pts];
    } else if (firstOnIdx > 0) {
      ordered = [...pts.slice(firstOnIdx), ...pts.slice(0, firstOnIdx)];
    } else {
      ordered = pts;
    }

    const startP = mapPointFn(ordered[0].x, ordered[0].y);
    ops.push(`${f(startP.x)} ${f(startP.y)} m`);
    let currOn = ordered[0];

    let i = 1;
    while (i < ordered.length) {
      const pt = ordered[i];
      if (pt.onCurve) {
        const p = mapPointFn(pt.x, pt.y);
        ops.push(`${f(p.x)} ${f(p.y)} l`);
        currOn = pt;
        i++;
      } else {
        // Quadratic Bezier: currOn -> ctrl(pt) -> nextOn
        const nextOn = ordered[(i + 1) % ordered.length];
        // Convert Quadratic (P0, Q1, P2) to Cubic (P0, C1, C2, P2) for PDF 'c' operator
        const c1x = currOn.x + (2 / 3) * (pt.x - currOn.x);
        const c1y = currOn.y + (2 / 3) * (pt.y - currOn.y);
        const c2x = nextOn.x + (2 / 3) * (pt.x - nextOn.x);
        const c2y = nextOn.y + (2 / 3) * (pt.y - nextOn.y);
        const p1 = mapPointFn(c1x, c1y);
        const p2 = mapPointFn(c2x, c2y);
        const p3 = mapPointFn(nextOn.x, nextOn.y);
        ops.push(`${f(p1.x)} ${f(p1.y)} ${f(p2.x)} ${f(p2.y)} ${f(p3.x)} ${f(p3.y)} c`);
        currOn = nextOn;
        i += 2;
      }
    }
    ops.push('h');
  }

  if (ops.length > 0) {
    ops.push('f');
  }
  return ops.join(' ');
}
