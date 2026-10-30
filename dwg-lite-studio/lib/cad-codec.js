import path from "node:path";
import { fileURLToPath } from "node:url";
import { LibreDwg, Dwg_File_Type } from "@mlightcad/libredwg-web";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WASM_DIR = path.resolve(
  __dirname,
  "../node_modules/@mlightcad/libredwg-web/wasm/"
) + "/";

// Standard AutoCAD Color Index (ACI) palette (1-9 + common indices)
export const ACI_PALETTE = {
  0: "#ffffff", // ByBlock
  1: "#ff3b30", // Red
  2: "#ffcc00", // Yellow
  3: "#34c759", // Green
  4: "#00c7be", // Cyan
  5: "#007aff", // Blue
  6: "#af52de", // Magenta
  7: "#e5e5ea", // White/Black (auto-contrasted on canvas/PDF)
  8: "#8e8e93", // Dark Gray
  9: "#aeaeb2", // Light Gray
  10: "#ff2d55",
  11: "#ff9f0a",
  30: "#ff9500",
  40: "#ffd60a",
  50: "#d4ff00",
  90: "#30d158",
  130: "#64d2ff",
  140: "#5ac8fa",
  170: "#5856d6",
  210: "#bf5af2",
  250: "#48484a",
  251: "#636366",
  252: "#8e8e93",
  253: "#aeaeb2",
  254: "#d1d1d6",
  255: "#f2f2f7",
  256: "#e5e5ea", // ByLayer
};

export function aciToHex(colorIndex, layerColorHex = "#e5e5ea", trueColor = null) {
  if (typeof trueColor === "number" && trueColor > 0) {
    return "#" + (trueColor & 0xffffff).toString(16).padStart(6, "0");
  }
  if (colorIndex == null || colorIndex === 256) {
    return layerColorHex || "#e5e5ea";
  }
  if (ACI_PALETTE[colorIndex]) {
    return ACI_PALETTE[colorIndex];
  }
  // Fallback deterministic hue for other ACI indices (10..249)
  const idx = Math.max(1, Math.min(255, Number(colorIndex) || 7));
  const hue = ((idx * 37) % 360);
  return `hsl(${hue}, 75%, 55%)`;
}

export function cleanMText(rawText) {
  if (!rawText) return "";
  return String(rawText)
    .replace(/\\U\+([0-9A-Fa-f]{4})/g, (_, hex) =>
      String.fromCharCode(parseInt(hex, 16))
    )
    .replace(/\\P/g, "\n")
    .replace(/\\[LOlo]/g, "")
    .replace(/\\[Ff][^;\\]*?(?:\|[^;\\]*)*;/g, "")
    .replace(/\\[KkCcHhWwTtAaQq][^;\\]*;?/g, "")
    .replace(/\\S([^;^\\]+)\^([^;\\]*);/g, "$1/$2")
    .replace(/%%[dD]/g, "°")
    .replace(/%%[pP]/g, "±")
    .replace(/%%[cC]/g, "Ø")
    .replace(/%%%/g, "%")
    .replace(/\\\\/g, "\\")
    .replace(/\\~/g, " ")
    .replace(/[{}]/g, "")
    .trim();
}

let libreDwgSingleton = null;
async function getLibreDwg() {
  if (!libreDwgSingleton) {
    libreDwgSingleton = await LibreDwg.create(WASM_DIR);
  }
  return libreDwgSingleton;
}

/**
 * Parse a binary .dwg, ASCII .dxf, or JSON CAD file buffer into a unified editable CAD Document.
 */
export async function parseDwgOrDxfBuffer(buffer, filename = "drawing.dwg") {
  const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  const headAscii = bytes.subarray(0, Math.min(64, bytes.length)).toString("utf8").trimStart();

  // 1. Check if JSON CAD format
  if (headAscii.startsWith("{") && headAscii.includes('"entities"')) {
    const parsed = JSON.parse(bytes.toString("utf8"));
    return ensureDocumentDefaults(parsed, filename, "JSON-CAD");
  }

  // 2. Check if binary DWG magic header ("AC10..." or "AC1..." or "AC2...")
  const magic6 = bytes.subarray(0, 6).toString("ascii");
  if (/^AC[0-9.]{3,4}/.test(magic6)) {
    const libredwg = await getLibreDwg();
    const arrayBuf = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength
    );
    const dataPtr = libredwg.dwg_read_data(arrayBuf, Dwg_File_Type.DWG);
    if (!dataPtr) {
      throw new Error(`DWG 바이너리 파싱에 실패했습니다 (헤더: ${magic6}).`);
    }
    try {
      const versionInfo = libredwg.dwg_get_version_type(dataPtr);
      const { database, stats } = libredwg.convertEx(dataPtr);
      return normalizeLibreDwgDatabase(database, filename, magic6, versionInfo, stats);
    } finally {
      libredwg.dwg_free(dataPtr);
    }
  }

  // 3. Otherwise parse as AutoCAD DXF (supports both .dxf and ASCII DWG/DXF)
  const text = bytes.toString("utf8");
  if (text.includes("SECTION") && text.includes("ENTITIES")) {
    return parseDxfText(text, filename);
  }

  // 4. Fallback: Attempt binary DWG via LibreDWG anyway
  const libredwg = await getLibreDwg();
  const arrayBuf = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength
  );
  const dataPtr = libredwg.dwg_read_data(arrayBuf, Dwg_File_Type.DWG);
  if (!dataPtr) {
    throw new Error("지원되지 않거나 손상된 DWG/DXF 파일입니다.");
  }
  try {
    const versionInfo = libredwg.dwg_get_version_type(dataPtr);
    const { database, stats } = libredwg.convertEx(dataPtr);
    return normalizeLibreDwgDatabase(database, filename, magic6 || "DWG", versionInfo, stats);
  } finally {
    libredwg.dwg_free(dataPtr);
  }
}

let nextIdCounter = 1000;
function makeId(prefix = "ent") {
  nextIdCounter += 1;
  return `${prefix}_${nextIdCounter}`;
}

export function normalizeLibreDwgDatabase(db, filename, magicHeader, versionInfo, stats) {
  const layersMap = new Map();
  const rawLayers = db?.tables?.LAYER?.entries || [];
  for (const l of rawLayers) {
    const name = l.name || "0";
    const colorIndex = l.colorIndex ?? 7;
    layersMap.set(name, {
      name,
      colorIndex,
      color: aciToHex(colorIndex, "#e5e5ea", l.color),
      visible: !l.off && !l.frozen,
      locked: Boolean(l.locked),
      lineweight: l.lineweight && l.lineweight > 0 ? l.lineweight / 100 : 0.25,
      linetype: l.linetypeName || "CONTINUOUS",
    });
  }
  if (!layersMap.has("0")) {
    layersMap.set("0", {
      name: "0",
      colorIndex: 7,
      color: "#e5e5ea",
      visible: true,
      locked: false,
      lineweight: 0.25,
      linetype: "CONTINUOUS",
    });
  }

  const blocks = {};
  let modelSpaceEntities = Array.isArray(db?.entities) ? db.entities : [];

  const blockEntries = db?.tables?.BLOCK_RECORD?.entries || [];
  for (const blk of blockEntries) {
    if (!blk || !blk.name) continue;
    const upper = blk.name.toUpperCase();
    if (upper === "*MODEL_SPACE" || upper === "$MODEL_SPACE") {
      if (Array.isArray(blk.entities) && blk.entities.length > modelSpaceEntities.length) {
        modelSpaceEntities = blk.entities;
      }
      continue;
    }
    if (upper.startsWith("*PAPER_SPACE")) {
      continue;
    }
    const converted = (blk.entities || [])
      .map((e) => convertLibreEntity(e, layersMap))
      .filter(Boolean);
    blocks[blk.name] = {
      name: blk.name,
      basePoint: {
        x: blk.basePoint?.x || 0,
        y: blk.basePoint?.y || 0,
      },
      entities: converted,
    };
  }

  const entities = modelSpaceEntities
    .map((e) => convertLibreEntity(e, layersMap))
    .filter(Boolean);

  return ensureDocumentDefaults(
    {
      filename,
      format: `DWG (${versionInfo?.hdr || magicHeader || "AC1032"} - ${versionInfo?.description || "AutoCAD DWG"})`,
      layers: Array.from(layersMap.values()),
      blocks,
      entities,
      stats: stats || {},
    },
    filename,
    versionInfo?.hdr || magicHeader || "DWG"
  );
}

function convertLibreEntity(e, layersMap) {
  if (!e || !e.type) return null;
  const layerName = e.layer || "0";
  if (!layersMap.has(layerName)) {
    layersMap.set(layerName, {
      name: layerName,
      colorIndex: 7,
      color: "#e5e5ea",
      visible: true,
      locked: false,
      lineweight: 0.25,
      linetype: "CONTINUOUS",
    });
  }
  const layerObj = layersMap.get(layerName);
  const colorIndex = e.colorIndex ?? 256;
  const color = aciToHex(colorIndex, layerObj.color, e.color);
  const id = e.handle ? `h_${e.handle}` : makeId("ent");
  const base = {
    id,
    handle: String(e.handle || id),
    type: e.type,
    layer: layerName,
    colorIndex,
    color,
    linetype: e.lineType || layerObj.linetype || "CONTINUOUS",
    lineweight: e.lineweight && e.lineweight > 0 ? e.lineweight / 100 : layerObj.lineweight || 0.25,
  };

  switch (e.type) {
    case "LINE":
      return {
        ...base,
        type: "LINE",
        x1: Number(e.startPoint?.x ?? 0),
        y1: Number(e.startPoint?.y ?? 0),
        x2: Number(e.endPoint?.x ?? 0),
        y2: Number(e.endPoint?.y ?? 0),
      };

    case "LWPOLYLINE":
    case "POLYLINE":
    case "POLYLINE_2D": {
      const rawVerts = e.vertices || e.points || [];
      const vertices = rawVerts.map((v) => ({
        x: Number(v.x ?? v.point?.x ?? 0),
        y: Number(v.y ?? v.point?.y ?? 0),
        bulge: Number(v.bulge ?? 0),
      }));
      if (vertices.length < 2) return null;
      const closed = Boolean((e.flag & 1) || (e.flag & 512) || e.closed);
      return {
        ...base,
        type: "LWPOLYLINE",
        closed,
        vertices,
      };
    }

    case "CIRCLE":
      return {
        ...base,
        type: "CIRCLE",
        cx: Number(e.center?.x ?? 0),
        cy: Number(e.center?.y ?? 0),
        r: Math.max(0.001, Number(e.radius ?? 1)),
      };

    case "ARC":
      return {
        ...base,
        type: "ARC",
        cx: Number(e.center?.x ?? 0),
        cy: Number(e.center?.y ?? 0),
        r: Math.max(0.001, Number(e.radius ?? 1)),
        // LibreDWG stores ARC angles in radians
        startAngle: Number(e.startAngle ?? 0) * (180 / Math.PI),
        endAngle: Number(e.endAngle ?? Math.PI) * (180 / Math.PI),
      };

    case "ELLIPSE": {
      const cx = Number(e.center?.x ?? 0);
      const cy = Number(e.center?.y ?? 0);
      const mx = Number(e.majorAxisEndPoint?.x ?? 10);
      const my = Number(e.majorAxisEndPoint?.y ?? 0);
      const rx = Math.hypot(mx, my);
      const ry = rx * Number(e.axisRatio ?? 0.5);
      const rotation = Math.atan2(my, mx) * (180 / Math.PI);
      return {
        ...base,
        type: "ELLIPSE",
        cx,
        cy,
        rx: Math.max(0.001, rx),
        ry: Math.max(0.001, ry),
        rotation,
      };
    }

    case "SPLINE": {
      const pts = e.controlPoints || e.fitPoints || [];
      if (pts.length < 2) return null;
      return {
        ...base,
        type: "LWPOLYLINE",
        closed: false,
        vertices: pts.map((p) => ({ x: Number(p.x ?? 0), y: Number(p.y ?? 0), bulge: 0 })),
      };
    }

    case "SOLID": {
      const pts = [e.corner1, e.corner2, e.corner4, e.corner3].filter(Boolean);
      if (pts.length < 3) return null;
      return {
        ...base,
        type: "LWPOLYLINE",
        closed: true,
        filled: true,
        vertices: pts.map((p) => ({ x: Number(p.x ?? 0), y: Number(p.y ?? 0), bulge: 0 })),
      };
    }

    case "TEXT":
    case "ATTRIB":
    case "ATTDEF": {
      const useEndPt =
        (e.halign || e.valign) &&
        e.endPoint &&
        (e.endPoint.x !== 0 || e.endPoint.y !== 0);
      const x = Number(
        (useEndPt ? e.endPoint?.x : null) ??
          e.startPoint?.x ??
          e.insertionPoint?.x ??
          0
      );
      const y = Number(
        (useEndPt ? e.endPoint?.y : null) ??
          e.startPoint?.y ??
          e.insertionPoint?.y ??
          0
      );
      const rotRad = Number(e.rotation ?? 0);
      const rotation = Math.abs(rotRad) <= Math.PI * 2.01 ? rotRad * (180 / Math.PI) : rotRad;
      return {
        ...base,
        type: "TEXT",
        text: cleanMText(e.text ?? e.value ?? ""),
        x,
        y,
        height: Math.max(0.5, Number(e.textHeight ?? e.height ?? 10)),
        rotation,
        align: e.halign === 1 || e.halign === 4 ? "center" : e.halign === 2 ? "right" : "left",
        valign: e.valign === 3 ? "top" : e.valign === 2 ? "middle" : "bottom",
      };
    }

    case "MTEXT": {
      const x = Number(e.insertionPoint?.x ?? 0);
      const y = Number(e.insertionPoint?.y ?? 0);
      const rotRad = Number(e.rotation ?? 0);
      let rotation = Math.abs(rotRad) <= Math.PI * 2.01 ? rotRad * (180 / Math.PI) : rotRad;
      if (
        Math.abs(rotation) < 1e-4 &&
        e.xAxisDir &&
        (Number(e.xAxisDir.x || 0) !== 0 || Number(e.xAxisDir.y || 0) !== 0)
      ) {
        rotation =
          Math.atan2(Number(e.xAxisDir.y || 0), Number(e.xAxisDir.x || 1)) *
          (180 / Math.PI);
      }
      const ap = Number(e.attachmentPoint || 1);
      return {
        ...base,
        type: "MTEXT",
        text: cleanMText(e.text ?? ""),
        x,
        y,
        height: Math.max(0.5, Number(e.textHeight ?? e.height ?? 10)),
        width: Number(e.rectWidth ?? e.referenceWidth ?? 0),
        rotation,
        attachmentPoint: ap,
        align: [2, 5, 8].includes(ap)
          ? "center"
          : [3, 6, 9].includes(ap)
          ? "right"
          : "left",
        valign: [1, 2, 3].includes(ap)
          ? "top"
          : [4, 5, 6].includes(ap)
          ? "middle"
          : "bottom",
      };
    }

    case "INSERT": {
      const rotRad = Number(e.rotation ?? 0);
      const rotation = Math.abs(rotRad) <= Math.PI * 2.01 ? rotRad * (180 / Math.PI) : rotRad;
      const attribs = Array.isArray(e.attribs)
        ? e.attribs.map((a) => ({
            tag: a.tag || "ATTR",
            text: cleanMText(a.text || a.value || ""),
            x: Number(a.startPoint?.x ?? a.insertionPoint?.x ?? e.insertionPoint?.x ?? 0),
            y: Number(a.startPoint?.y ?? a.insertionPoint?.y ?? e.insertionPoint?.y ?? 0),
            height: Number(a.textHeight ?? 10),
          }))
        : [];
      return {
        ...base,
        type: "INSERT",
        blockName: e.name || "UNKNOWN_BLOCK",
        x: Number(e.insertionPoint?.x ?? 0),
        y: Number(e.insertionPoint?.y ?? 0),
        scaleX: Number(e.xScale ?? 1),
        scaleY: Number(e.yScale ?? 1),
        rotation,
        attribs,
      };
    }

    case "DIMENSION": {
      if (e.name) {
        return {
          ...base,
          type: "INSERT",
          blockName: e.name,
          x: Number(e.insertionPoint?.x ?? 0),
          y: Number(e.insertionPoint?.y ?? 0),
          scaleX: 1,
          scaleY: 1,
          rotation: 0,
          isDimensionBlock: true,
        };
      }
      return null;
    }

    default:
      return null;
  }
}

/**
 * Full-featured AutoCAD DXF parser supporting LAYER, BLOCKS, and ENTITIES
 */
export function parseDxfText(dxfText, filename = "drawing.dxf") {
  const lines = dxfText.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const pairs = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = parseInt(lines[i].trim(), 10);
    const val = lines[i + 1].trim();
    if (!Number.isNaN(code)) {
      pairs.push([code, val]);
    }
  }

  const layersMap = new Map([
    [
      "0",
      {
        name: "0",
        colorIndex: 7,
        color: "#e5e5ea",
        visible: true,
        locked: false,
        lineweight: 0.25,
        linetype: "CONTINUOUS",
      },
    ],
  ]);
  const blocks = {};
  const entities = [];

  let section = null;
  let i = 0;

  while (i < pairs.length) {
    const [code, val] = pairs[i];
    if (code === 0 && val === "SECTION") {
      const next = pairs[i + 1];
      if (next && next[0] === 2) {
        section = next[1].toUpperCase();
        i += 2;
        continue;
      }
    }
    if (code === 0 && val === "ENDSEC") {
      section = null;
      i += 1;
      continue;
    }

    if (section === "TABLES") {
      if (code === 0 && val === "LAYER") {
        i += 1;
        let name = "0";
        let colorIndex = 7;
        let flags = 0;
        let linetype = "CONTINUOUS";
        let lineweight = 0.25;
        while (i < pairs.length && pairs[i][0] !== 0) {
          const [c, v] = pairs[i];
          if (c === 2) name = v;
          else if (c === 62) colorIndex = parseInt(v, 10);
          else if (c === 70) flags = parseInt(v, 10);
          else if (c === 6) linetype = v;
          else if (c === 370) {
            const lw = parseInt(v, 10);
            if (lw > 0) lineweight = lw / 100;
          }
          i += 1;
        }
        const visible = colorIndex >= 0 && !(flags & 1);
        const absColor = Math.abs(colorIndex) || 7;
        layersMap.set(name, {
          name,
          colorIndex: absColor,
          color: aciToHex(absColor),
          visible,
          locked: Boolean(flags & 4),
          lineweight,
          linetype,
        });
        continue;
      }
    } else if (section === "BLOCKS") {
      if (code === 0 && val === "BLOCK") {
        i += 1;
        let blockName = "";
        let bx = 0;
        let by = 0;
        while (i < pairs.length && pairs[i][0] !== 0) {
          const [c, v] = pairs[i];
          if (c === 2 || c === 3) blockName = blockName || v;
          else if (c === 10) bx = parseFloat(v) || 0;
          else if (c === 20) by = parseFloat(v) || 0;
          i += 1;
        }
        const blockEntities = [];
        while (i < pairs.length && !(pairs[i][0] === 0 && pairs[i][1] === "ENDBLK")) {
          if (pairs[i][0] === 0) {
            const parsedEnt = readDxfEntity(pairs, i, layersMap);
            if (parsedEnt.entity) blockEntities.push(parsedEnt.entity);
            i = parsedEnt.nextIndex;
          } else {
            i += 1;
          }
        }
        if (
          blockName &&
          !blockName.toUpperCase().startsWith("*MODEL_SPACE") &&
          !blockName.toUpperCase().startsWith("*PAPER_SPACE")
        ) {
          blocks[blockName] = {
            name: blockName,
            basePoint: { x: bx, y: by },
            entities: blockEntities,
          };
        }
        continue;
      }
    } else if (section === "ENTITIES") {
      if (code === 0) {
        const parsedEnt = readDxfEntity(pairs, i, layersMap);
        if (parsedEnt.entity) entities.push(parsedEnt.entity);
        i = parsedEnt.nextIndex;
        continue;
      }
    }
    i += 1;
  }

  return ensureDocumentDefaults(
    {
      filename,
      format: "DXF (AutoCAD Drawing Exchange)",
      layers: Array.from(layersMap.values()),
      blocks,
      entities,
    },
    filename,
    "DXF"
  );
}

function readDxfEntity(pairs, startIndex, layersMap) {
  const entType = pairs[startIndex][1];
  let i = startIndex + 1;

  // Handle old-style POLYLINE + VERTEX + SEQEND
  if (entType === "POLYLINE") {
    let layer = "0";
    let colorIndex = 256;
    let flags = 0;
    let handle = null;
    while (i < pairs.length && pairs[i][0] !== 0) {
      const [c, v] = pairs[i];
      if (c === 8) layer = v;
      else if (c === 62) colorIndex = parseInt(v, 10);
      else if (c === 70) flags = parseInt(v, 10);
      else if (c === 5) handle = v;
      i += 1;
    }
    const vertices = [];
    while (i < pairs.length) {
      if (pairs[i][0] === 0 && pairs[i][1] === "VERTEX") {
        i += 1;
        let vx = 0;
        let vy = 0;
        let bulge = 0;
        while (i < pairs.length && pairs[i][0] !== 0) {
          const [c, v] = pairs[i];
          if (c === 10) vx = parseFloat(v) || 0;
          else if (c === 20) vy = parseFloat(v) || 0;
          else if (c === 42) bulge = parseFloat(v) || 0;
          i += 1;
        }
        vertices.push({ x: vx, y: vy, bulge });
      } else if (pairs[i][0] === 0 && pairs[i][1] === "SEQEND") {
        i += 1;
        while (i < pairs.length && pairs[i][0] !== 0) i += 1;
        break;
      } else if (pairs[i][0] === 0) {
        break;
      } else {
        i += 1;
      }
    }
    const layerObj = ensureLayer(layersMap, layer);
    return {
      nextIndex: i,
      entity:
        vertices.length >= 2
          ? {
              id: handle ? `h_${handle}` : makeId("ent"),
              handle: handle || makeId("h"),
              type: "LWPOLYLINE",
              layer,
              colorIndex,
              color: aciToHex(colorIndex, layerObj.color),
              linetype: layerObj.linetype,
              lineweight: layerObj.lineweight,
              closed: Boolean(flags & 1),
              vertices,
            }
          : null,
    };
  }

  // Standard single record entity
  const props = [];
  while (i < pairs.length && pairs[i][0] !== 0) {
    props.push(pairs[i]);
    i += 1;
  }

  let layer = "0";
  let colorIndex = 256;
  let trueColor = null;
  let linetype = null;
  let lineweight = null;
  let handle = null;

  for (const [c, v] of props) {
    if (c === 8) layer = v;
    else if (c === 62) colorIndex = parseInt(v, 10);
    else if (c === 420) trueColor = parseInt(v, 10);
    else if (c === 6) linetype = v;
    else if (c === 370) {
      const lw = parseInt(v, 10);
      if (lw > 0) lineweight = lw / 100;
    } else if (c === 5) handle = v;
  }

  const layerObj = ensureLayer(layersMap, layer);
  const base = {
    id: handle ? `h_${handle}` : makeId("ent"),
    handle: handle || makeId("h"),
    type: entType,
    layer,
    colorIndex,
    color: aciToHex(colorIndex, layerObj.color, trueColor),
    linetype: linetype || layerObj.linetype || "CONTINUOUS",
    lineweight: lineweight || layerObj.lineweight || 0.25,
  };

  if (entType === "LINE") {
    let x1 = 0, y1 = 0, x2 = 0, y2 = 0;
    for (const [c, v] of props) {
      if (c === 10) x1 = parseFloat(v) || 0;
      else if (c === 20) y1 = parseFloat(v) || 0;
      else if (c === 11) x2 = parseFloat(v) || 0;
      else if (c === 21) y2 = parseFloat(v) || 0;
    }
    return { nextIndex: i, entity: { ...base, type: "LINE", x1, y1, x2, y2 } };
  }

  if (entType === "LWPOLYLINE") {
    const vertices = [];
    let currentVert = null;
    let flags = 0;
    for (const [c, v] of props) {
      if (c === 70) flags = parseInt(v, 10);
      else if (c === 10) {
        if (currentVert) vertices.push(currentVert);
        currentVert = { x: parseFloat(v) || 0, y: 0, bulge: 0 };
      } else if (c === 20 && currentVert) {
        currentVert.y = parseFloat(v) || 0;
      } else if (c === 42 && currentVert) {
        currentVert.bulge = parseFloat(v) || 0;
      }
    }
    if (currentVert) vertices.push(currentVert);
    return {
      nextIndex: i,
      entity:
        vertices.length >= 2
          ? {
              ...base,
              type: "LWPOLYLINE",
              closed: Boolean((flags & 1) || (flags & 512)),
              vertices,
            }
          : null,
    };
  }

  if (entType === "CIRCLE") {
    let cx = 0, cy = 0, r = 1;
    for (const [c, v] of props) {
      if (c === 10) cx = parseFloat(v) || 0;
      else if (c === 20) cy = parseFloat(v) || 0;
      else if (c === 40) r = Math.max(0.001, parseFloat(v) || 1);
    }
    return { nextIndex: i, entity: { ...base, type: "CIRCLE", cx, cy, r } };
  }

  if (entType === "ARC") {
    let cx = 0, cy = 0, r = 1, startAngle = 0, endAngle = 180;
    for (const [c, v] of props) {
      if (c === 10) cx = parseFloat(v) || 0;
      else if (c === 20) cy = parseFloat(v) || 0;
      else if (c === 40) r = Math.max(0.001, parseFloat(v) || 1);
      else if (c === 50) startAngle = parseFloat(v) || 0;
      else if (c === 51) endAngle = parseFloat(v) || 0;
    }
    return {
      nextIndex: i,
      entity: { ...base, type: "ARC", cx, cy, r, startAngle, endAngle },
    };
  }

  if (entType === "TEXT" || entType === "MTEXT" || entType === "ATTRIB") {
    let x = 0, y = 0, height = 10, rotation = 0, textParts = [], halign = 0, attach = 1, width = 0;
    for (const [c, v] of props) {
      if (c === 10) x = parseFloat(v) || 0;
      else if (c === 20) y = parseFloat(v) || 0;
      else if (c === 40) height = Math.max(1, parseFloat(v) || 10);
      else if (c === 41) width = parseFloat(v) || 0;
      else if (c === 50) rotation = parseFloat(v) || 0;
      else if (c === 1 || c === 3) textParts.push(v);
      else if (c === 72) halign = parseInt(v, 10);
      else if (c === 71) attach = parseInt(v, 10);
    }
    const text = cleanMText(textParts.join(""));
    const align =
      entType === "MTEXT"
        ? [2, 5, 8].includes(attach)
          ? "center"
          : [3, 6, 9].includes(attach)
          ? "right"
          : "left"
        : halign === 1 || halign === 4
        ? "center"
        : halign === 2
        ? "right"
        : "left";

    return {
      nextIndex: i,
      entity: {
        ...base,
        type: entType === "MTEXT" ? "MTEXT" : "TEXT",
        text,
        x,
        y,
        height,
        width,
        rotation,
        align,
      },
    };
  }

  if (entType === "INSERT") {
    let blockName = "", x = 0, y = 0, scaleX = 1, scaleY = 1, rotation = 0, hasAttribs = 0;
    for (const [c, v] of props) {
      if (c === 2) blockName = v;
      else if (c === 10) x = parseFloat(v) || 0;
      else if (c === 20) y = parseFloat(v) || 0;
      else if (c === 41) scaleX = parseFloat(v) || 1;
      else if (c === 42) scaleY = parseFloat(v) || 1;
      else if (c === 50) rotation = parseFloat(v) || 0;
      else if (c === 66) hasAttribs = parseInt(v, 10);
    }
    const attribs = [];
    if (hasAttribs) {
      while (i < pairs.length) {
        if (pairs[i][0] === 0 && pairs[i][1] === "ATTRIB") {
          i += 1;
          let tag = "ATTR", val = "", ax = x, ay = y, ah = 10;
          while (i < pairs.length && pairs[i][0] !== 0) {
            const [c, v] = pairs[i];
            if (c === 2) tag = v;
            else if (c === 1) val = cleanMText(v);
            else if (c === 10) ax = parseFloat(v) || x;
            else if (c === 20) ay = parseFloat(v) || y;
            else if (c === 40) ah = parseFloat(v) || 10;
            i += 1;
          }
          attribs.push({ tag, text: val, x: ax, y: ay, height: ah });
        } else if (pairs[i][0] === 0 && pairs[i][1] === "SEQEND") {
          i += 1;
          while (i < pairs.length && pairs[i][0] !== 0) i += 1;
          break;
        } else {
          break;
        }
      }
    }
    return {
      nextIndex: i,
      entity: {
        ...base,
        type: "INSERT",
        blockName,
        x,
        y,
        scaleX,
        scaleY,
        rotation,
        attribs,
      },
    };
  }

  if (entType === "DIMENSION") {
    let blockName = "", x1 = 0, y1 = 0, x2 = 0, y2 = 0, dimX = 0, dimY = 0, text = "";
    for (const [c, v] of props) {
      if (c === 2) blockName = v;
      else if (c === 10) dimX = parseFloat(v) || 0;
      else if (c === 20) dimY = parseFloat(v) || 0;
      else if (c === 13) x1 = parseFloat(v) || 0;
      else if (c === 23) y1 = parseFloat(v) || 0;
      else if (c === 14) x2 = parseFloat(v) || 0;
      else if (c === 24) y2 = parseFloat(v) || 0;
      else if (c === 1) text = v;
    }
    if (blockName) {
      return {
        nextIndex: i,
        entity: {
          ...base,
          type: "INSERT",
          blockName,
          x: 0,
          y: 0,
          scaleX: 1,
          scaleY: 1,
          rotation: 0,
          isDimensionBlock: true,
        },
      };
    }
    return {
      nextIndex: i,
      entity: {
        ...base,
        type: "DIMENSION",
        x1,
        y1,
        x2,
        y2,
        dimX,
        dimY,
        text,
      },
    };
  }

  return { nextIndex: i, entity: null };
}

function ensureLayer(layersMap, name) {
  if (!layersMap.has(name)) {
    layersMap.set(name, {
      name,
      colorIndex: 7,
      color: "#e5e5ea",
      visible: true,
      locked: false,
      lineweight: 0.25,
      linetype: "CONTINUOUS",
    });
  }
  return layersMap.get(name);
}

export function computeBounds(entities, blocks = {}, layersMap = null) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const expand = (x, y) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  };

  const visitEntity = (e, tx = 0, ty = 0, sx = 1, sy = 1, rotDeg = 0, depth = 0) => {
    if (!e || depth > 6) return;
    if (layersMap && e.layer && layersMap.has(e.layer) && !layersMap.get(e.layer).visible) {
      return;
    }
    const rad = (rotDeg * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const tf = (px, py) => {
      const rx = px * sx;
      const ry = py * sy;
      return {
        x: tx + rx * cos - ry * sin,
        y: ty + rx * sin + ry * cos,
      };
    };

    if (e.type === "LINE" || e.type === "DIMENSION") {
      const p1 = tf(e.x1, e.y1);
      const p2 = tf(e.x2, e.y2);
      expand(p1.x, p1.y);
      expand(p2.x, p2.y);
      if (e.type === "DIMENSION" && e.dimX != null) {
        const pd = tf(e.dimX, e.dimY);
        expand(pd.x, pd.y);
      }
    } else if (e.type === "LWPOLYLINE" && Array.isArray(e.vertices)) {
      for (const v of e.vertices) {
        const p = tf(v.x, v.y);
        expand(p.x, p.y);
      }
    } else if (e.type === "CIRCLE" || e.type === "ARC") {
      const c = tf(e.cx, e.cy);
      const r = e.r * Math.max(Math.abs(sx), Math.abs(sy));
      expand(c.x - r, c.y - r);
      expand(c.x + r, c.y + r);
    } else if (e.type === "ELLIPSE") {
      const c = tf(e.cx, e.cy);
      const r = Math.max(e.rx || 10, e.ry || 5) * Math.max(Math.abs(sx), Math.abs(sy));
      expand(c.x - r, c.y - r);
      expand(c.x + r, c.y + r);
    } else if (e.type === "TEXT" || e.type === "MTEXT") {
      if (!String(e.text || "").trim()) return;
      const p = tf(e.x, e.y);
      const h = (e.height || 10) * Math.abs(sy);
      const lines = String(e.text || "").split("\n");
      const maxLen = Math.max(1, ...lines.map((l) => l.length));
      const w = maxLen * h * 0.65;
      expand(p.x, p.y);
      expand(p.x + w, p.y + h * lines.length);
    } else if (e.type === "INSERT") {
      const blk = blocks[e.blockName];
      if (blk && Array.isArray(blk.entities)) {
        const bx = blk.basePoint?.x || 0;
        const by = blk.basePoint?.y || 0;
        for (const child of blk.entities) {
          // Transform relative to block basePoint
          const cRad = ((e.rotation || 0) * Math.PI) / 180;
          const cCos = Math.cos(cRad);
          const cSin = Math.sin(cRad);
          const ox = -bx * (e.scaleX ?? 1);
          const oy = -by * (e.scaleY ?? 1);
          const insP = tf(
            e.x + ox * cCos - oy * cSin,
            e.y + ox * cSin + oy * cCos
          );
          visitEntity(
            child,
            insP.x,
            insP.y,
            sx * (e.scaleX ?? 1),
            sy * (e.scaleY ?? 1),
            rotDeg + (e.rotation || 0),
            depth + 1
          );
        }
      } else {
        const p = tf(e.x, e.y);
        expand(p.x - 50, p.y - 50);
        expand(p.x + 50, p.y + 50);
      }
      if (Array.isArray(e.attribs)) {
        for (const a of e.attribs) {
          expand(a.x, a.y);
        }
      }
    }
  };

  for (const e of entities) {
    visitEntity(e);
  }

  if (!Number.isFinite(minX)) {
    return { minX: 0, minY: 0, maxX: 1000, maxY: 700, width: 1000, height: 700 };
  }
  return {
    minX,
    minY,
    maxX,
    maxY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
  };
}

function ensureDocumentDefaults(doc, filename, formatCode) {
  const layers = Array.isArray(doc.layers) && doc.layers.length > 0
    ? doc.layers
    : [
        {
          name: "0",
          colorIndex: 7,
          color: "#e5e5ea",
          visible: true,
          locked: false,
          lineweight: 0.25,
          linetype: "CONTINUOUS",
        },
      ];
  const blocks = doc.blocks || {};
  const entities = Array.isArray(doc.entities) ? doc.entities : [];
  const bounds = computeBounds(entities, blocks);

  return {
    filename: doc.filename || filename,
    format: doc.format || formatCode,
    layers,
    blocks,
    entities,
    bounds,
    plotWindow: doc.plotWindow || {
      xMin: bounds.minX - bounds.width * 0.03,
      yMin: bounds.minY - bounds.height * 0.03,
      xMax: bounds.maxX + bounds.width * 0.03,
      yMax: bounds.maxY + bounds.height * 0.03,
    },
    stats: doc.stats || {},
  };
}

/**
 * Export the CAD document back to standard AutoCAD DXF text format.
 */
export function exportToDxf(doc) {
  const out = [];
  const push = (code, val) => {
    out.push(String(code), String(val ?? ""));
  };

  // HEADER
  push(0, "SECTION");
  push(2, "HEADER");
  push(9, "$ACADVER");
  push(1, "AC1015");
  push(9, "$DWGCODEPAGE");
  push(3, "UTF-8");
  push(0, "ENDSEC");

  // TABLES (LAYERS)
  const layerList = Array.isArray(doc.layers)
    ? doc.layers
    : Object.values(doc.layers || {});
  push(0, "SECTION");
  push(2, "TABLES");
  push(0, "TABLE");
  push(2, "LAYER");
  push(70, layerList.length);
  for (const layer of layerList) {
    push(0, "LAYER");
    push(2, layer.name || "0");
    push(70, layer.locked ? 4 : 0);
    const aci = layer.colorIndex && layer.colorIndex !== 256 ? layer.colorIndex : 7;
    push(62, layer.visible === false ? -Math.abs(aci) : Math.abs(aci));
    push(6, layer.linetype || layer.lineType || "CONTINUOUS");
  }
  push(0, "ENDTAB");
  push(0, "ENDSEC");

  // BLOCKS
  push(0, "SECTION");
  push(2, "BLOCKS");
  for (const [blkName, blk] of Object.entries(doc.blocks || {})) {
    push(0, "BLOCK");
    push(8, "0");
    push(2, blkName);
    push(70, 0);
    push(10, blk.basePoint?.x || 0);
    push(20, blk.basePoint?.y || 0);
    push(30, 0);
    push(3, blkName);
    for (const ent of blk.entities || []) {
      writeDxfEntity(push, ent);
    }
    push(0, "ENDBLK");
    push(8, "0");
  }
  push(0, "ENDSEC");

  // ENTITIES
  push(0, "SECTION");
  push(2, "ENTITIES");
  for (const ent of doc.entities || []) {
    writeDxfEntity(push, ent);
  }
  push(0, "ENDSEC");
  push(0, "EOF");

  return out.join("\n") + "\n";
}

function writeDxfEntity(push, e) {
  if (!e || !e.type) return;
  const layer = e.layer || "0";
  const colorIndex = e.colorIndex ?? 256;

  if (e.type === "LINE") {
    push(0, "LINE");
    push(8, layer);
    if (colorIndex !== 256) push(62, colorIndex);
    push(10, Number(e.x1 || 0));
    push(20, Number(e.y1 || 0));
    push(30, 0);
    push(11, Number(e.x2 || 0));
    push(21, Number(e.y2 || 0));
    push(31, 0);
  } else if (e.type === "LWPOLYLINE" && Array.isArray(e.vertices)) {
    push(0, "LWPOLYLINE");
    push(8, layer);
    if (colorIndex !== 256) push(62, colorIndex);
    push(90, e.vertices.length);
    push(70, e.closed ? 1 : 0);
    for (const v of e.vertices) {
      push(10, Number(v.x || 0));
      push(20, Number(v.y || 0));
      if (v.bulge) push(42, Number(v.bulge));
    }
  } else if (e.type === "CIRCLE") {
    push(0, "CIRCLE");
    push(8, layer);
    if (colorIndex !== 256) push(62, colorIndex);
    push(10, Number(e.cx || 0));
    push(20, Number(e.cy || 0));
    push(30, 0);
    push(40, Number(e.r ?? e.radius ?? 1));
  } else if (e.type === "ARC") {
    push(0, "ARC");
    push(8, layer);
    if (colorIndex !== 256) push(62, colorIndex);
    push(10, Number(e.cx || 0));
    push(20, Number(e.cy || 0));
    push(30, 0);
    push(40, Number(e.r ?? e.radius ?? 1));
    push(50, Number(e.startAngle || 0));
    push(51, Number(e.endAngle || 180));
  } else if (e.type === "TEXT" || e.type === "MTEXT") {
    if (e.type === "MTEXT" || String(e.text || "").includes("\n")) {
      push(0, "MTEXT");
      push(8, layer);
      if (colorIndex !== 256) push(62, colorIndex);
      push(10, Number(e.x || 0));
      push(20, Number(e.y || 0));
      push(30, 0);
      push(40, Number(e.height || 10));
      push(41, Number(e.width || 0));
      push(71, e.align === "center" ? 2 : e.align === "right" ? 3 : 1);
      push(50, Number(e.rotation || 0));
      push(1, String(e.text || "").replace(/\n/g, "\\P"));
    } else {
      push(0, "TEXT");
      push(8, layer);
      if (colorIndex !== 256) push(62, colorIndex);
      push(10, Number(e.x || 0));
      push(20, Number(e.y || 0));
      push(30, 0);
      push(40, Number(e.height || 10));
      push(50, Number(e.rotation || 0));
      if (e.align === "center" || e.align === "right") {
        push(72, e.align === "center" ? 1 : 2);
        push(11, Number(e.x || 0));
        push(21, Number(e.y || 0));
        push(31, 0);
      }
      push(1, String(e.text || ""));
    }
  } else if (e.type === "INSERT") {
    push(0, "INSERT");
    push(8, layer);
    if (colorIndex !== 256) push(62, colorIndex);
    push(2, e.blockName || "BLOCK");
    push(10, Number(e.x || 0));
    push(20, Number(e.y || 0));
    push(30, 0);
    push(41, Number(e.scaleX ?? 1));
    push(42, Number(e.scaleY ?? 1));
    push(43, 1);
    push(50, Number(e.rotation || 0));
  }
}

/**
 * Built-in rich Architectural & Mechanical CAD sample drawings for immediate testing
 */
export function getBuiltInSamples() {
  // Sample 1: Korean Architectural Office & Lab Floorplan (건축 평면도 + 표제란 + 블록)
  const archLayers = [
    { name: "A-WALL", colorIndex: 7, color: "#f2f2f7", visible: true, locked: false, lineweight: 0.50, linetype: "CONTINUOUS" },
    { name: "A-DOOR-WIN", colorIndex: 3, color: "#34c759", visible: true, locked: false, lineweight: 0.25, linetype: "CONTINUOUS" },
    { name: "A-FURN", colorIndex: 4, color: "#00c7be", visible: true, locked: false, lineweight: 0.20, linetype: "CONTINUOUS" },
    { name: "A-GRID", colorIndex: 1, color: "#ff3b30", visible: true, locked: false, lineweight: 0.15, linetype: "CENTER" },
    { name: "A-DIM", colorIndex: 2, color: "#ffcc00", visible: true, locked: false, lineweight: 0.18, linetype: "CONTINUOUS" },
    { name: "A-TEXT", colorIndex: 4, color: "#64d2ff", visible: true, locked: false, lineweight: 0.25, linetype: "CONTINUOUS" },
    { name: "A-TITLE", colorIndex: 7, color: "#e5e5ea", visible: true, locked: false, lineweight: 0.35, linetype: "CONTINUOUS" },
  ];

  const archBlocks = {
    "BLK_DOOR_900": {
      name: "BLK_DOOR_900",
      basePoint: { x: 0, y: 0 },
      entities: [
        // Door leaf (900mm)
        { id: "bd_1", type: "LWPOLYLINE", layer: "A-DOOR-WIN", colorIndex: 3, color: "#34c759", closed: true, vertices: [{ x: 0, y: 0 }, { x: 45, y: 0 }, { x: 45, y: 900 }, { x: 0, y: 900 }] },
        // Door swing arc
        { id: "bd_2", type: "ARC", layer: "A-DOOR-WIN", colorIndex: 3, color: "#34c759", cx: 0, cy: 0, r: 900, startAngle: 0, endAngle: 90 },
      ],
    },
    "BLK_WINDOW_1800": {
      name: "BLK_WINDOW_1800",
      basePoint: { x: 0, y: 0 },
      entities: [
        { id: "bw_1", type: "LWPOLYLINE", layer: "A-DOOR-WIN", colorIndex: 3, color: "#34c759", closed: true, vertices: [{ x: 0, y: -100 }, { x: 1800, y: -100 }, { x: 1800, y: 100 }, { x: 0, y: 100 }] },
        { id: "bw_2", type: "LINE", layer: "A-DOOR-WIN", colorIndex: 3, color: "#34c759", x1: 0, y1: -25, x2: 1800, y2: -25 },
        { id: "bw_3", type: "LINE", layer: "A-DOOR-WIN", colorIndex: 3, color: "#34c759", x1: 0, y1: 25, x2: 1800, y2: 25 },
      ],
    },
    "BLK_WORKSTATION": {
      name: "BLK_WORKSTATION",
      basePoint: { x: 0, y: 0 },
      entities: [
        // Desk 1600 x 800
        { id: "bws_1", type: "LWPOLYLINE", layer: "A-FURN", colorIndex: 4, color: "#00c7be", closed: true, vertices: [{ x: 0, y: 0 }, { x: 1600, y: 0 }, { x: 1600, y: 800 }, { x: 0, y: 800 }] },
        // Monitor
        { id: "bws_2", type: "LWPOLYLINE", layer: "A-FURN", colorIndex: 4, color: "#00c7be", closed: true, vertices: [{ x: 550, y: 620 }, { x: 1050, y: 620 }, { x: 1050, y: 700 }, { x: 550, y: 700 }] },
        // Chair
        { id: "bws_3", type: "CIRCLE", layer: "A-FURN", colorIndex: 4, color: "#00c7be", cx: 800, cy: -220, r: 220 },
        { id: "bws_4", type: "TEXT", layer: "A-FURN", colorIndex: 4, color: "#00c7be", text: "DESK-1600", x: 520, y: 340, height: 110, rotation: 0, align: "left" },
      ],
    },
    "BLK_COLUMN_400": {
      name: "BLK_COLUMN_400",
      basePoint: { x: 0, y: 0 },
      entities: [
        { id: "bc_1", type: "LWPOLYLINE", layer: "A-WALL", colorIndex: 7, color: "#f2f2f7", closed: true, vertices: [{ x: -200, y: -200 }, { x: 200, y: -200 }, { x: 200, y: 200 }, { x: -200, y: 200 }] },
        { id: "bc_2", type: "LINE", layer: "A-WALL", colorIndex: 7, color: "#f2f2f7", x1: -200, y1: -200, x2: 200, y2: 200 },
        { id: "bc_3", type: "LINE", layer: "A-WALL", colorIndex: 7, color: "#f2f2f7", x1: -200, y1: 200, x2: 200, y2: -200 },
      ],
    },
    "BLK_NORTH_MARK": {
      name: "BLK_NORTH_MARK",
      basePoint: { x: 0, y: 0 },
      entities: [
        { id: "bn_1", type: "CIRCLE", layer: "A-TITLE", colorIndex: 7, color: "#e5e5ea", cx: 0, cy: 0, r: 280 },
        { id: "bn_2", type: "LWPOLYLINE", layer: "A-TITLE", colorIndex: 7, color: "#e5e5ea", closed: true, vertices: [{ x: 0, y: 380 }, { x: -120, y: -160 }, { x: 0, y: -60 }, { x: 120, y: -160 }] },
        { id: "bn_3", type: "TEXT", layer: "A-TITLE", colorIndex: 2, color: "#ffcc00", text: "N", x: -70, y: 440, height: 200, rotation: 0, align: "left" },
      ],
    },
  };

  const archEntities = [
    // Outer Drawing Sheet Border (A3 Scale 1:100 -> 14000 x 9800)
    { id: "e_border_out", type: "LWPOLYLINE", layer: "A-TITLE", colorIndex: 7, color: "#e5e5ea", lineweight: 0.5, closed: true, vertices: [{ x: -1200, y: -1600 }, { x: 12800, y: -1600 }, { x: 12800, y: 8200 }, { x: -1200, y: 8200 }] },
    { id: "e_border_in", type: "LWPOLYLINE", layer: "A-TITLE", colorIndex: 7, color: "#e5e5ea", lineweight: 0.3, closed: true, vertices: [{ x: -1000, y: -1400 }, { x: 12600, y: -1400 }, { x: 12600, y: 8000 }, { x: -1000, y: 8000 }] },

    // Title Block (Bottom Right)
    { id: "e_tb_box", type: "LWPOLYLINE", layer: "A-TITLE", colorIndex: 7, color: "#e5e5ea", closed: true, vertices: [{ x: 7600, y: -1400 }, { x: 12600, y: -1400 }, { x: 12600, y: -200 }, { x: 7600, y: -200 }] },
    { id: "e_tb_h1", type: "LINE", layer: "A-TITLE", colorIndex: 7, color: "#e5e5ea", x1: 7600, y1: -600, x2: 12600, y2: -600 },
    { id: "e_tb_h2", type: "LINE", layer: "A-TITLE", colorIndex: 7, color: "#e5e5ea", x1: 7600, y1: -1000, x2: 12600, y2: -1000 },
    { id: "e_tb_v1", type: "LINE", layer: "A-TITLE", colorIndex: 7, color: "#e5e5ea", x1: 9300, y1: -1400, x2: 9300, y2: -200 },
    { id: "e_tb_t1", type: "TEXT", layer: "A-TITLE", colorIndex: 2, color: "#ffcc00", text: "프로젝트명", x: 7800, y: -480, height: 150, rotation: 0, align: "left" },
    { id: "e_tb_v_proj", type: "TEXT", layer: "A-TEXT", colorIndex: 4, color: "#64d2ff", text: "판교 R&D 센터 3층 스마트 오피스 평면도", x: 9500, y: -480, height: 165, rotation: 0, align: "left" },
    { id: "e_tb_t2", type: "TEXT", layer: "A-TITLE", colorIndex: 2, color: "#ffcc00", text: "도면번호 / 축척", x: 7800, y: -880, height: 150, rotation: 0, align: "left" },
    { id: "e_tb_v_no", type: "TEXT", layer: "A-TEXT", colorIndex: 7, color: "#e5e5ea", text: "A-301 (SCALE 1:100 / UNIT: mm)", x: 9500, y: -880, height: 150, rotation: 0, align: "left" },
    { id: "e_tb_t3", type: "TEXT", layer: "A-TITLE", colorIndex: 2, color: "#ffcc00", text: "설계 / 승인일자", x: 7800, y: -1280, height: 150, rotation: 0, align: "left" },
    { id: "e_tb_v_date", type: "TEXT", layer: "A-TEXT", colorIndex: 7, color: "#e5e5ea", text: "2026.10.20 (REV.02 - 승인완료)", x: 9500, y: -1280, height: 150, rotation: 0, align: "left" },

    // Structural Center Grid Lines (X1, X2, X3 / Y1, Y2)
    { id: "e_gx1", type: "LINE", layer: "A-GRID", colorIndex: 1, color: "#ff3b30", linetype: "CENTER", x1: 0, y1: -600, x2: 0, y2: 7200 },
    { id: "e_gx2", type: "LINE", layer: "A-GRID", colorIndex: 1, color: "#ff3b30", linetype: "CENTER", x1: 5000, y1: -600, x2: 5000, y2: 7200 },
    { id: "e_gx3", type: "LINE", layer: "A-GRID", colorIndex: 1, color: "#ff3b30", linetype: "CENTER", x1: 10000, y1: -600, x2: 10000, y2: 7200 },
    { id: "e_gy1", type: "LINE", layer: "A-GRID", colorIndex: 1, color: "#ff3b30", linetype: "CENTER", x1: -600, y1: 0, x2: 10800, y2: 0 },
    { id: "e_gy2", type: "LINE", layer: "A-GRID", colorIndex: 1, color: "#ff3b30", linetype: "CENTER", x1: -600, y1: 6000, x2: 10800, y2: 6000 },

    // Grid Bubbles
    { id: "e_gb_x1", type: "CIRCLE", layer: "A-GRID", colorIndex: 1, color: "#ff3b30", cx: 0, cy: 7450, r: 250 },
    { id: "e_gt_x1", type: "TEXT", layer: "A-GRID", colorIndex: 1, color: "#ff3b30", text: "X1", x: -110, y: 7360, height: 180, rotation: 0, align: "left" },
    { id: "e_gb_x2", type: "CIRCLE", layer: "A-GRID", colorIndex: 1, color: "#ff3b30", cx: 5000, cy: 7450, r: 250 },
    { id: "e_gt_x2", type: "TEXT", layer: "A-GRID", colorIndex: 1, color: "#ff3b30", text: "X2", x: 4880, y: 7360, height: 180, rotation: 0, align: "left" },
    { id: "e_gb_x3", type: "CIRCLE", layer: "A-GRID", colorIndex: 1, color: "#ff3b30", cx: 10000, cy: 7450, r: 250 },
    { id: "e_gt_x3", type: "TEXT", layer: "A-GRID", colorIndex: 1, color: "#ff3b30", text: "X3", x: 9880, y: 7360, height: 180, rotation: 0, align: "left" },

    // Exterior & Interior Walls (10000 x 6000 mm building bay)
    { id: "e_wall_ext", type: "LWPOLYLINE", layer: "A-WALL", colorIndex: 7, color: "#f2f2f7", lineweight: 0.5, closed: true, vertices: [{ x: 0, y: 0 }, { x: 10000, y: 0 }, { x: 10000, y: 6000 }, { x: 0, y: 6000 }] },
    { id: "e_wall_ext_in", type: "LWPOLYLINE", layer: "A-WALL", colorIndex: 7, color: "#f2f2f7", lineweight: 0.35, closed: true, vertices: [{ x: 200, y: 200 }, { x: 9800, y: 200 }, { x: 9800, y: 5800 }, { x: 200, y: 5800 }] },
    // Partition Wall between Main Office (left) and Conference/Server Room (right)
    { id: "e_wall_part1", type: "LINE", layer: "A-WALL", colorIndex: 7, color: "#f2f2f7", lineweight: 0.4, x1: 5000, y1: 200, x2: 5000, y2: 4600 },
    { id: "e_wall_part2", type: "LINE", layer: "A-WALL", colorIndex: 7, color: "#f2f2f7", lineweight: 0.4, x1: 5000, y1: 5500, x2: 5000, y2: 5800 },
    // Horizontal Partition on Right Side (Conference vs Server Lab)
    { id: "e_wall_part3", type: "LINE", layer: "A-WALL", colorIndex: 7, color: "#f2f2f7", lineweight: 0.4, x1: 5000, y1: 3200, x2: 8500, y2: 3200 },
    { id: "e_wall_part4", type: "LINE", layer: "A-WALL", colorIndex: 7, color: "#f2f2f7", lineweight: 0.4, x1: 9400, y1: 3200, x2: 9800, y2: 3200 },

    // Structural Columns (Block Inserts)
    { id: "e_col_1", type: "INSERT", layer: "A-WALL", colorIndex: 7, color: "#f2f2f7", blockName: "BLK_COLUMN_400", x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
    { id: "e_col_2", type: "INSERT", layer: "A-WALL", colorIndex: 7, color: "#f2f2f7", blockName: "BLK_COLUMN_400", x: 5000, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
    { id: "e_col_3", type: "INSERT", layer: "A-WALL", colorIndex: 7, color: "#f2f2f7", blockName: "BLK_COLUMN_400", x: 10000, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
    { id: "e_col_4", type: "INSERT", layer: "A-WALL", colorIndex: 7, color: "#f2f2f7", blockName: "BLK_COLUMN_400", x: 0, y: 6000, scaleX: 1, scaleY: 1, rotation: 0 },
    { id: "e_col_5", type: "INSERT", layer: "A-WALL", colorIndex: 7, color: "#f2f2f7", blockName: "BLK_COLUMN_400", x: 5000, y: 6000, scaleX: 1, scaleY: 1, rotation: 0 },
    { id: "e_col_6", type: "INSERT", layer: "A-WALL", colorIndex: 7, color: "#f2f2f7", blockName: "BLK_COLUMN_400", x: 10000, y: 6000, scaleX: 1, scaleY: 1, rotation: 0 },

    // Doors & Windows (Block Inserts)
    { id: "e_door_main", type: "INSERT", layer: "A-DOOR-WIN", colorIndex: 3, color: "#34c759", blockName: "BLK_DOOR_900", x: 2000, y: 200, scaleX: 1, scaleY: 1, rotation: 0 },
    { id: "e_door_conf", type: "INSERT", layer: "A-DOOR-WIN", colorIndex: 3, color: "#34c759", blockName: "BLK_DOOR_900", x: 5000, y: 4600, scaleX: 1, scaleY: 1, rotation: 0 },
    { id: "e_door_lab", type: "INSERT", layer: "A-DOOR-WIN", colorIndex: 3, color: "#34c759", blockName: "BLK_DOOR_900", x: 8500, y: 3200, scaleX: 1, scaleY: 1, rotation: 0 },
    { id: "e_win_1", type: "INSERT", layer: "A-DOOR-WIN", colorIndex: 3, color: "#34c759", blockName: "BLK_WINDOW_1800", x: 1600, y: 6000, scaleX: 1, scaleY: 1, rotation: 0 },
    { id: "e_win_2", type: "INSERT", layer: "A-DOOR-WIN", colorIndex: 3, color: "#34c759", blockName: "BLK_WINDOW_1800", x: 6600, y: 6000, scaleX: 1, scaleY: 1, rotation: 0 },

    // Workstations & Conference Table (Block Inserts & Shapes)
    { id: "e_ws_1", type: "INSERT", layer: "A-FURN", colorIndex: 4, color: "#00c7be", blockName: "BLK_WORKSTATION", x: 700, y: 3800, scaleX: 1, scaleY: 1, rotation: 0 },
    { id: "e_ws_2", type: "INSERT", layer: "A-FURN", colorIndex: 4, color: "#00c7be", blockName: "BLK_WORKSTATION", x: 2600, y: 3800, scaleX: 1, scaleY: 1, rotation: 0 },
    { id: "e_ws_3", type: "INSERT", layer: "A-FURN", colorIndex: 4, color: "#00c7be", blockName: "BLK_WORKSTATION", x: 700, y: 1800, scaleX: 1, scaleY: 1, rotation: 0 },
    { id: "e_ws_4", type: "INSERT", layer: "A-FURN", colorIndex: 4, color: "#00c7be", blockName: "BLK_WORKSTATION", x: 2600, y: 1800, scaleX: 1, scaleY: 1, rotation: 0 },
    // Conference Table
    { id: "e_conf_tbl", type: "LWPOLYLINE", layer: "A-FURN", colorIndex: 4, color: "#00c7be", closed: true, vertices: [{ x: 6000, y: 4100 }, { x: 8800, y: 4100 }, { x: 8800, y: 5100 }, { x: 6000, y: 5100 }] },
    // North Mark
    { id: "e_north", type: "INSERT", layer: "A-TITLE", colorIndex: 7, color: "#e5e5ea", blockName: "BLK_NORTH_MARK", x: 11600, y: 6900, scaleX: 1, scaleY: 1, rotation: 0 },

    // Room Labels (Editable Texts)
    { id: "e_txt_room1", type: "TEXT", layer: "A-TEXT", colorIndex: 4, color: "#64d2ff", text: "101 메인 개발실 (MAIN DEV OFFICE)", x: 950, y: 5150, height: 220, rotation: 0, align: "left" },
    { id: "e_txt_room1_sub", type: "TEXT", layer: "A-TEXT", colorIndex: 7, color: "#e5e5ea", text: "면적: 30.0 m² | 마감: OA 플로어 + 흡음 텍스", x: 950, y: 4820, height: 135, rotation: 0, align: "left" },
    { id: "e_txt_room2", type: "TEXT", layer: "A-TEXT", colorIndex: 4, color: "#64d2ff", text: "102 대회의실 (CONFERENCE ROOM)", x: 5600, y: 5350, height: 200, rotation: 0, align: "left" },
    { id: "e_txt_room3", type: "TEXT", layer: "A-TEXT", colorIndex: 4, color: "#64d2ff", text: "103 서버 및 장비실 (SERVER LAB)", x: 5600, y: 2450, height: 200, rotation: 0, align: "left" },
    { id: "e_txt_room3_sub", type: "TEXT", layer: "A-TEXT", colorIndex: 2, color: "#ffcc00", text: "※ 항온항습기 24시간 가동 구역 (출입통제)", x: 5600, y: 2100, height: 140, rotation: 0, align: "left" },

    // Dimension Lines (Top & Left)
    { id: "e_dim_top1", type: "LINE", layer: "A-DIM", colorIndex: 2, color: "#ffcc00", x1: 0, y1: 6600, x2: 5000, y2: 6600 },
    { id: "e_dim_top1_t", type: "TEXT", layer: "A-DIM", colorIndex: 2, color: "#ffcc00", text: "5,000", x: 2500, y: 6720, height: 170, rotation: 0, align: "center" },
    { id: "e_dim_top2", type: "LINE", layer: "A-DIM", colorIndex: 2, color: "#ffcc00", x1: 5000, y1: 6600, x2: 10000, y2: 6600 },
    { id: "e_dim_top2_t", type: "TEXT", layer: "A-DIM", colorIndex: 2, color: "#ffcc00", text: "5,000", x: 7500, y: 6720, height: 170, rotation: 0, align: "center" },
    { id: "e_dim_left", type: "LINE", layer: "A-DIM", colorIndex: 2, color: "#ffcc00", x1: -500, y1: 0, x2: -500, y2: 6000 },
    { id: "e_dim_left_t", type: "TEXT", layer: "A-DIM", colorIndex: 2, color: "#ffcc00", text: "6,000", x: -650, y: 3000, height: 170, rotation: 90, align: "center" },
  ];

  const archDoc = ensureDocumentDefaults(
    {
      filename: "건축평면도_판교R&D센터_A301.dwg",
      format: "DWG (AC1032 - AutoCAD 2027 호환 도면)",
      layers: archLayers,
      blocks: archBlocks,
      entities: archEntities,
      plotWindow: {
        xMin: -1200,
        yMin: -1600,
        xMax: 12800,
        yMax: 8200,
      },
    },
    "건축평면도_판교R&D센터_A301.dwg",
    "DWG"
  );

  // Sample 2: Mechanical Precision Bracket Drawing (기계 부품 상세도)
  const mechLayers = [
    { name: "M-OUTLINE", colorIndex: 7, color: "#f2f2f7", visible: true, locked: false, lineweight: 0.50, linetype: "CONTINUOUS" },
    { name: "M-CENTER", colorIndex: 1, color: "#ff3b30", visible: true, locked: false, lineweight: 0.18, linetype: "CENTER" },
    { name: "M-HIDDEN", colorIndex: 3, color: "#34c759", visible: true, locked: false, lineweight: 0.20, linetype: "DASHED" },
    { name: "M-DIM", colorIndex: 2, color: "#ffcc00", visible: true, locked: false, lineweight: 0.20, linetype: "CONTINUOUS" },
    { name: "M-TEXT", colorIndex: 4, color: "#64d2ff", visible: true, locked: false, lineweight: 0.25, linetype: "CONTINUOUS" },
  ];

  const mechBlocks = {
    "BLK_BOLT_M12": {
      name: "BLK_BOLT_M12",
      basePoint: { x: 0, y: 0 },
      entities: [
        { id: "bm_1", type: "CIRCLE", layer: "M-OUTLINE", colorIndex: 7, color: "#f2f2f7", cx: 0, cy: 0, r: 12 },
        { id: "bm_2", type: "CIRCLE", layer: "M-HIDDEN", colorIndex: 3, color: "#34c759", linetype: "DASHED", cx: 0, cy: 0, r: 20 },
        { id: "bm_3", type: "LINE", layer: "M-CENTER", colorIndex: 1, color: "#ff3b30", linetype: "CENTER", x1: -26, y1: 0, x2: 26, y2: 0 },
        { id: "bm_4", type: "LINE", layer: "M-CENTER", colorIndex: 1, color: "#ff3b30", linetype: "CENTER", x1: 0, y1: -26, x2: 0, y2: 26 },
      ],
    },
  };

  const mechEntities = [
    { id: "m_base", type: "LWPOLYLINE", layer: "M-OUTLINE", colorIndex: 7, color: "#f2f2f7", closed: true, vertices: [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 260 }, { x: 0, y: 260 }] },
    { id: "m_bore", type: "CIRCLE", layer: "M-OUTLINE", colorIndex: 7, color: "#f2f2f7", cx: 200, cy: 130, r: 65 },
    { id: "m_cx", type: "LINE", layer: "M-CENTER", colorIndex: 1, color: "#ff3b30", linetype: "CENTER", x1: -20, y1: 130, x2: 420, y2: 130 },
    { id: "m_cy", type: "LINE", layer: "M-CENTER", colorIndex: 1, color: "#ff3b30", linetype: "CENTER", x1: 200, y1: -20, x2: 200, y2: 280 },
    { id: "m_b1", type: "INSERT", layer: "M-OUTLINE", colorIndex: 7, color: "#f2f2f7", blockName: "BLK_BOLT_M12", x: 50, y: 50, scaleX: 1, scaleY: 1, rotation: 0 },
    { id: "m_b2", type: "INSERT", layer: "M-OUTLINE", colorIndex: 7, color: "#f2f2f7", blockName: "BLK_BOLT_M12", x: 350, y: 50, scaleX: 1, scaleY: 1, rotation: 0 },
    { id: "m_b3", type: "INSERT", layer: "M-OUTLINE", colorIndex: 7, color: "#f2f2f7", blockName: "BLK_BOLT_M12", x: 50, y: 210, scaleX: 1, scaleY: 1, rotation: 0 },
    { id: "m_b4", type: "INSERT", layer: "M-OUTLINE", colorIndex: 7, color: "#f2f2f7", blockName: "BLK_BOLT_M12", x: 350, y: 210, scaleX: 1, scaleY: 1, rotation: 0 },
    { id: "m_t1", type: "TEXT", layer: "M-TEXT", colorIndex: 4, color: "#64d2ff", text: "AL6061-T6 하우징 브래킷 (HOUSING BRACKET)", x: 0, y: 300, height: 16, rotation: 0, align: "left" },
    { id: "m_t2", type: "TEXT", layer: "M-DIM", colorIndex: 2, color: "#ffcc00", text: "4-Ø24 THRU / Ø40 C'BORE (BLK_BOLT_M12)", x: 0, y: -35, height: 12, rotation: 0, align: "left" },
  ];

  const mechDoc = ensureDocumentDefaults(
    {
      filename: "기계부품도_하우징브래킷_M102.dwg",
      format: "DWG (AC1032 - AutoCAD 2027 호환 도면)",
      layers: mechLayers,
      blocks: mechBlocks,
      entities: mechEntities,
      plotWindow: {
        xMin: -40,
        yMin: -60,
        xMax: 440,
        yMax: 340,
      },
    },
    "기계부품도_하우징브래킷_M102.dwg",
    "DWG"
  );

  return {
    "arch-floorplan": archDoc,
    "mech-bracket": mechDoc,
  };
}
