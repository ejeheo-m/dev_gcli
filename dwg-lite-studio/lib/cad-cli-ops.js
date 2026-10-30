import { computeBounds } from './cad-codec.js';

/**
 * Helper to normalize layer lookup whether doc.layers is an Array or Object
 */
export function getLayerList(doc) {
  if (Array.isArray(doc.layers)) return doc.layers;
  return Object.values(doc.layers || {});
}

export function findLayer(doc, name) {
  if (Array.isArray(doc.layers)) {
    return doc.layers.find((l) => l.name === name);
  }
  return doc.layers?.[name];
}

/**
 * Inspects a normalized CAD document and returns a structured summary
 */
export function inspectDocument(doc, options = {}) {
  const entities = doc.entities || [];
  const typeCounts = {};
  for (const e of entities) {
    typeCounts[e.type] = (typeCounts[e.type] || 0) + 1;
  }

  const search = options.search ? String(options.search).toLowerCase() : null;

  const texts = entities
    .filter((e) => (e.type === 'TEXT' || e.type === 'MTEXT') && (!search || String(e.text || '').toLowerCase().includes(search)))
    .map((e) => ({
      id: e.id,
      type: e.type,
      layer: e.layer,
      text: e.text,
      x: Math.round(e.x || 0),
      y: Math.round(e.y || 0),
      height: e.height,
      rotation: e.rotation || 0,
    }));

  const blockDefs = Object.entries(doc.blocks || {}).map(([name, blk]) => ({
    name,
    description: blk.description || '',
    entityCount: (blk.entities || []).length,
    instanceCount: entities.filter((e) => e.type === 'INSERT' && e.blockName === name).length,
  }));

  const blockInserts = entities
    .filter((e) => e.type === 'INSERT' && (!search || String(e.blockName || '').toLowerCase().includes(search)))
    .map((e) => ({
      id: e.id,
      blockName: e.blockName,
      layer: e.layer,
      x: Math.round(e.x || 0),
      y: Math.round(e.y || 0),
      scaleX: e.scaleX ?? 1,
      scaleY: e.scaleY ?? 1,
      rotation: e.rotation ?? 0,
    }));

  const linesAndShapes = entities
    .filter((e) => ['LINE', 'LWPOLYLINE', 'POLYLINE', 'CIRCLE', 'ARC'].includes(e.type))
    .map((e) => {
      if (e.type === 'LINE') {
        return {
          id: e.id,
          type: e.type,
          layer: e.layer,
          x1: Math.round(e.x1),
          y1: Math.round(e.y1),
          x2: Math.round(e.x2),
          y2: Math.round(e.y2),
          length: Math.round(Math.hypot(e.x2 - e.x1, e.y2 - e.y1)),
        };
      }
      if (e.type === 'CIRCLE' || e.type === 'ARC') {
        const radVal = e.r ?? e.radius ?? 0;
        return {
          id: e.id,
          type: e.type,
          layer: e.layer,
          cx: Math.round(e.cx),
          cy: Math.round(e.cy),
          radius: Math.round(radVal),
        };
      }
      return {
        id: e.id,
        type: e.type,
        layer: e.layer,
        vertexCount: (e.vertices || []).length,
        closed: Boolean(e.closed),
      };
    });

  const layers = getLayerList(doc).map((l) => ({
    name: l.name,
    colorHex: l.color || l.colorHex || '#e5e5ea',
    visible: l.visible !== false,
    lineType: l.linetype || l.lineType || 'CONTINUOUS',
    entityCount: entities.filter((e) => e.layer === l.name).length,
  }));

  const b = doc.bounds || computeBounds(entities, doc.blocks || {});
  const extents = doc.extents || {
    xMin: Math.round(b.minX ?? 0),
    yMin: Math.round(b.minY ?? 0),
    xMax: Math.round(b.maxX ?? 1000),
    yMax: Math.round(b.maxY ?? 700),
  };

  return {
    filename: doc.filename,
    formatVersion: doc.format || doc.formatVersion || 'AutoCAD DWG/DXF',
    extents,
    totalEntities: entities.length,
    typeCounts,
    layers,
    blockDefs,
    blockInserts,
    texts,
    linesAndShapes,
  };
}

/**
 * Helper to translate an entity in-place by (dx, dy)
 */
export function translateEntity(ent, dx, dy) {
  switch (ent.type) {
    case 'LINE':
    case 'DIMENSION':
      ent.x1 = Number(ent.x1 || 0) + dx;
      ent.y1 = Number(ent.y1 || 0) + dy;
      ent.x2 = Number(ent.x2 || 0) + dx;
      ent.y2 = Number(ent.y2 || 0) + dy;
      break;
    case 'LWPOLYLINE':
    case 'POLYLINE':
      ent.vertices = (ent.vertices || []).map((v) => ({
        ...v,
        x: Number(v.x || 0) + dx,
        y: Number(v.y || 0) + dy,
      }));
      break;
    case 'CIRCLE':
    case 'ARC':
    case 'ELLIPSE':
      ent.cx = Number(ent.cx || 0) + dx;
      ent.cy = Number(ent.cy || 0) + dy;
      break;
    case 'TEXT':
    case 'MTEXT':
    case 'INSERT':
      ent.x = Number(ent.x || 0) + dx;
      ent.y = Number(ent.y || 0) + dy;
      break;
    default:
      break;
  }
}

/**
 * Explodes an INSERT entity into transformed primitive entities
 */
export function explodeInsertEntity(ent, blocks = {}) {
  const blk = blocks[ent.blockName];
  if (!blk || !Array.isArray(blk.entities)) return [];

  const sx = Number(ent.scaleX ?? 1);
  const sy = Number(ent.scaleY ?? 1);
  const rad = ((ent.rotation || 0) * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const bx = blk.basePoint?.x || 0;
  const by = blk.basePoint?.y || 0;

  const tf = (x, y) => {
    const dx = (x - bx) * sx;
    const dy = (y - by) * sy;
    return {
      x: Math.round((ent.x + dx * cos - dy * sin) * 100) / 100,
      y: Math.round((ent.y + dx * sin + dy * cos) * 100) / 100,
    };
  };

  const exploded = [];
  blk.entities.forEach((child, idx) => {
    const clone = JSON.parse(JSON.stringify(child));
    clone.id = `${ent.id}_exp_${idx}`;
    if (clone.layer === '0' && ent.layer) {
      clone.layer = ent.layer;
    }
    if (clone.type === 'LINE') {
      const p1 = tf(clone.x1, clone.y1);
      const p2 = tf(clone.x2, clone.y2);
      clone.x1 = p1.x;
      clone.y1 = p1.y;
      clone.x2 = p2.x;
      clone.y2 = p2.y;
    } else if (clone.type === 'LWPOLYLINE' || clone.type === 'POLYLINE') {
      clone.vertices = (clone.vertices || []).map((v) => ({ ...v, ...tf(v.x, v.y) }));
    } else if (clone.type === 'CIRCLE' || clone.type === 'ARC') {
      const c = tf(clone.cx, clone.cy);
      clone.cx = c.x;
      clone.cy = c.y;
      const r0 = clone.r ?? clone.radius ?? 50;
      const rNew = Math.round(r0 * Math.abs(sx) * 100) / 100;
      clone.r = rNew;
      clone.radius = rNew;
      if (clone.type === 'ARC' && ent.rotation) {
        clone.startAngle = ((clone.startAngle || 0) + ent.rotation) % 360;
        clone.endAngle = ((clone.endAngle || 0) + ent.rotation) % 360;
      }
    } else if (clone.type === 'TEXT' || clone.type === 'MTEXT') {
      const p = tf(clone.x, clone.y);
      clone.x = p.x;
      clone.y = p.y;
      clone.height = Math.round((clone.height || 100) * Math.abs(sy) * 100) / 100;
      clone.rotation = (clone.rotation || 0) + (ent.rotation || 0);
    }
    exploded.push(clone);
  });

  return exploded;
}

/**
 * Applies a batch of CLI edit operations to a CAD document and returns a change log
 */
export function applyEditOperations(doc, ops = {}) {
  const logs = [];
  const entities = doc.entities || [];
  const blocks = doc.blocks || {};

  // 1. Replace text (substring/global replacement in TEXT & MTEXT, optionally inside blocks)
  for (const rule of ops.replaceText || []) {
    const eqIdx = rule.indexOf('=');
    if (eqIdx === -1) continue;
    const fromStr = rule.slice(0, eqIdx);
    const toStr = rule.slice(eqIdx + 1);
    let count = 0;

    const processList = (list) => {
      for (const e of list) {
        if ((e.type === 'TEXT' || e.type === 'MTEXT') && String(e.text || '').includes(fromStr)) {
          e.text = String(e.text).split(fromStr).join(toStr);
          count++;
        }
      }
    };

    processList(entities);
    if (ops.includeBlocks) {
      for (const blk of Object.values(blocks)) {
        processList(blk.entities || []);
      }
    }
    logs.push(`글자 치환 ("${fromStr}" -> "${toStr}"): ${count}건 변경됨`);
  }

  // 2. Set text by ID: "<id>=<newText>"
  for (const rule of ops.setText || []) {
    const eqIdx = rule.indexOf('=');
    if (eqIdx === -1) continue;
    const id = rule.slice(0, eqIdx).trim();
    const newText = rule.slice(eqIdx + 1);
    const target = entities.find((e) => e.id === id);
    if (target && (target.type === 'TEXT' || target.type === 'MTEXT')) {
      const old = target.text;
      target.text = newText;
      logs.push(`글자 수정 [#${id}]: "${old}" -> "${newText}"`);
    } else {
      logs.push(`경고: 글자 객체 [#${id}]를 찾을 수 없습니다.`);
    }
  }

  // 3. Scale all text heights
  if (ops.textScale && Number(ops.textScale) > 0) {
    const factor = Number(ops.textScale);
    let count = 0;
    for (const e of entities) {
      if (e.type === 'TEXT' || e.type === 'MTEXT') {
        e.height = Math.round((e.height || 120) * factor * 100) / 100;
        count++;
      }
    }
    logs.push(`전체 글자 크기 배율(${factor}x) 적용: ${count}건`);
  }

  // 4. Add new TEXT entities: "text,x,y[,height,layer,rotation]"
  for (const spec of ops.addText || []) {
    const parts = spec.split(',');
    if (parts.length < 3) continue;
    const [text, xStr, yStr, hStr, layerName, rotStr] = parts;
    const newEnt = {
      id: `txt_cli_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      type: 'TEXT',
      layer: layerName || '0',
      color: '#fef08a',
      colorHex: '#fef08a',
      lineweight: 0.25,
      text,
      x: Number(xStr),
      y: Number(yStr),
      height: Number(hStr || 180),
      rotation: Number(rotStr || 0),
    };
    entities.push(newEnt);
    logs.push(`새 글자 추가 [#${newEnt.id}]: "${text}" at (${newEnt.x}, ${newEnt.y})`);
  }

  // 5. Modify specific LINE coordinates: "<id>=x1,y1,x2,y2"
  for (const rule of ops.setLine || []) {
    const eqIdx = rule.indexOf('=');
    if (eqIdx === -1) continue;
    const id = rule.slice(0, eqIdx).trim();
    const coords = rule.slice(eqIdx + 1).split(',').map(Number);
    const target = entities.find((e) => e.id === id && e.type === 'LINE');
    if (target && coords.length >= 4) {
      [target.x1, target.y1, target.x2, target.y2] = coords;
      logs.push(`선 좌표 수정 [#${id}]: (${coords[0]}, ${coords[1]}) -> (${coords[2]}, ${coords[3]})`);
    }
  }

  // 6. Add new LINE: "x1,y1,x2,y2[,layer,colorHex,lineType]"
  for (const spec of ops.addLine || []) {
    const parts = spec.split(',');
    if (parts.length < 4) continue;
    const [x1, y1, x2, y2, layer, colorHex, lineType] = parts;
    const newLine = {
      id: `line_cli_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      type: 'LINE',
      layer: layer || '0',
      color: colorHex || '#38bdf8',
      colorHex: colorHex || '#38bdf8',
      lineweight: 0.25,
      linetype: lineType || 'CONTINUOUS',
      lineType: lineType || 'CONTINUOUS',
      x1: Number(x1),
      y1: Number(y1),
      x2: Number(x2),
      y2: Number(y2),
    };
    entities.push(newLine);
    logs.push(`새 선(LINE) 추가 [#${newLine.id}]: (${newLine.x1},${newLine.y1}) -> (${newLine.x2},${newLine.y2})`);
  }

  // 7. Add new Rect (LWPOLYLINE): "x1,y1,x2,y2[,layer,colorHex]"
  for (const spec of ops.addRect || []) {
    const parts = spec.split(',');
    if (parts.length < 4) continue;
    const [x1, y1, x2, y2, layer, colorHex] = parts;
    const nx1 = Number(x1), ny1 = Number(y1), nx2 = Number(x2), ny2 = Number(y2);
    const newRect = {
      id: `rect_cli_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      type: 'LWPOLYLINE',
      layer: layer || '0',
      color: colorHex || '#38bdf8',
      colorHex: colorHex || '#38bdf8',
      lineweight: 0.25,
      closed: true,
      vertices: [
        { x: nx1, y: ny1 },
        { x: nx2, y: ny1 },
        { x: nx2, y: ny2 },
        { x: nx1, y: ny2 },
      ],
    };
    entities.push(newRect);
    logs.push(`새 사각형(LWPOLYLINE) 추가 [#${newRect.id}]: (${nx1},${ny1}) ~ (${nx2},${ny2})`);
  }

  // 8. Add new Circle: "cx,cy,radius[,layer,colorHex]"
  for (const spec of ops.addCircle || []) {
    const parts = spec.split(',');
    if (parts.length < 3) continue;
    const [cx, cy, r, layer, colorHex] = parts;
    const radNum = Number(r);
    const newCircle = {
      id: `circle_cli_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      type: 'CIRCLE',
      layer: layer || '0',
      color: colorHex || '#38bdf8',
      colorHex: colorHex || '#38bdf8',
      lineweight: 0.25,
      cx: Number(cx),
      cy: Number(cy),
      r: radNum,
      radius: radNum,
    };
    entities.push(newCircle);
    logs.push(`새 원(CIRCLE) 추가 [#${newCircle.id}]: 중심(${newCircle.cx},${newCircle.cy}), R=${radNum}`);
  }

  // 9. Modify Block INSERT instance: "<id>=x,y[,scaleX,scaleY,rotation]"
  for (const rule of ops.setBlock || []) {
    const eqIdx = rule.indexOf('=');
    if (eqIdx === -1) continue;
    const id = rule.slice(0, eqIdx).trim();
    const vals = rule.slice(eqIdx + 1).split(',').map(Number);
    const target = entities.find((e) => e.id === id && e.type === 'INSERT');
    if (target && vals.length >= 2) {
      target.x = vals[0];
      target.y = vals[1];
      if (!Number.isNaN(vals[2])) target.scaleX = vals[2];
      if (!Number.isNaN(vals[3])) target.scaleY = vals[3];
      if (!Number.isNaN(vals[4])) target.rotation = vals[4];
      logs.push(`블록 인스턴스 수정 [#${id} (${target.blockName})]: pos=(${target.x},${target.y}), scale=(${target.scaleX},${target.scaleY}), rot=${target.rotation}°`);
    }
  }

  // 10. Replace Block name across INSERTs: "OldBlockName=NewBlockName"
  for (const rule of ops.replaceBlock || []) {
    const eqIdx = rule.indexOf('=');
    if (eqIdx === -1) continue;
    const oldName = rule.slice(0, eqIdx).trim();
    const newName = rule.slice(eqIdx + 1).trim();
    let count = 0;
    for (const e of entities) {
      if (e.type === 'INSERT' && e.blockName === oldName) {
        e.blockName = newName;
        count++;
      }
    }
    logs.push(`블록 참조 교체 ("${oldName}" -> "${newName}"): ${count}건`);
  }

  // 11. Add Block INSERT instance: "BlockName,x,y[,scaleX,scaleY,rotation,layer]"
  for (const spec of ops.addBlock || []) {
    const parts = spec.split(',');
    if (parts.length < 3) continue;
    const [blockName, x, y, sx, sy, rot, layer] = parts;
    const newIns = {
      id: `ins_cli_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      type: 'INSERT',
      layer: layer || '0',
      blockName: blockName.trim(),
      x: Number(x),
      y: Number(y),
      scaleX: Number(sx || 1),
      scaleY: Number(sy || sx || 1),
      rotation: Number(rot || 0),
      attribs: [],
      attributes: [],
    };
    entities.push(newIns);
    logs.push(`새 블록 배치 [#${newIns.id}]: ${newIns.blockName} at (${newIns.x}, ${newIns.y})`);
  }

  // 12. Scale internal Block Definition geometry (BEDIT from CLI): "BlockName=factor"
  for (const rule of ops.scaleBlockDef || []) {
    const eqIdx = rule.indexOf('=');
    if (eqIdx === -1) continue;
    const bName = rule.slice(0, eqIdx).trim();
    const factor = Number(rule.slice(eqIdx + 1));
    const blk = blocks[bName];
    if (blk && factor > 0) {
      for (const child of blk.entities || []) {
        if (child.type === 'LINE') {
          child.x1 *= factor; child.y1 *= factor;
          child.x2 *= factor; child.y2 *= factor;
        } else if (child.type === 'LWPOLYLINE' || child.type === 'POLYLINE') {
          child.vertices = (child.vertices || []).map((v) => ({ ...v, x: v.x * factor, y: v.y * factor }));
        } else if (child.type === 'CIRCLE' || child.type === 'ARC') {
          child.cx *= factor; child.cy *= factor;
          const rVal = (child.r ?? child.radius ?? 50) * factor;
          child.r = rVal;
          child.radius = rVal;
        } else if (child.type === 'TEXT' || child.type === 'MTEXT') {
          child.x *= factor; child.y *= factor;
          child.height = (child.height || 100) * factor;
        }
      }
      logs.push(`블록 내부 정의 스케일 조정 [${bName}]: ${factor}배 (모든 참조에 일괄 적용됨)`);
    }
  }

  // 13. Explode Blocks: ID, BlockName, or "ALL"
  for (const targetSpec of ops.explodeBlock || []) {
    const key = targetSpec.trim();
    let explodedCount = 0;
    for (let i = entities.length - 1; i >= 0; i--) {
      const e = entities[i];
      if (e.type === 'INSERT' && (key === 'ALL' || e.id === key || e.blockName === key)) {
        const primitives = explodeInsertEntity(e, blocks);
        entities.splice(i, 1, ...primitives);
        explodedCount++;
      }
    }
    logs.push(`블록 분해(EXPLODE: ${key}): ${explodedCount}개 블록 분해 완료`);
  }

  // 14. Move entity by ID or Layer: "<id_or_layer>=dx,dy"
  for (const rule of ops.move || []) {
    const eqIdx = rule.indexOf('=');
    if (eqIdx === -1) continue;
    const targetKey = rule.slice(0, eqIdx).trim();
    const [dx, dy] = rule.slice(eqIdx + 1).split(',').map(Number);
    if (Number.isNaN(dx) || Number.isNaN(dy)) continue;

    let moved = 0;
    for (const e of entities) {
      if (e.id === targetKey || e.layer === targetKey || targetKey === 'ALL') {
        translateEntity(e, dx, dy);
        moved++;
      }
    }
    logs.push(`객체 이동 [${targetKey}] by (${dx}, ${dy}): ${moved}개 객체 이동됨`);
  }

  // 15. Layer visibility & color
  for (const lName of ops.hideLayer || []) {
    for (const part of lName.split(',')) {
      const layerObj = findLayer(doc, part.trim());
      if (layerObj) {
        layerObj.visible = false;
        logs.push(`레이어 숨김: ${part.trim()}`);
      }
    }
  }
  for (const lName of ops.showLayer || []) {
    for (const part of lName.split(',')) {
      const layerObj = findLayer(doc, part.trim());
      if (layerObj) {
        layerObj.visible = true;
        logs.push(`레이어 표시: ${part.trim()}`);
      }
    }
  }
  for (const rule of ops.layerColor || []) {
    const eqIdx = rule.indexOf('=');
    if (eqIdx === -1) continue;
    const lName = rule.slice(0, eqIdx).trim();
    const colorHex = rule.slice(eqIdx + 1).trim();
    const layerObj = findLayer(doc, lName);
    if (layerObj) {
      layerObj.color = colorHex;
      layerObj.colorHex = colorHex;
      logs.push(`레이어 색상 변경 [${lName}]: ${colorHex}`);
    }
  }

  // 16. Delete entities by ID list
  for (const idGroup of ops.deleteIds || []) {
    const ids = idGroup.split(',').map((s) => s.trim()).filter(Boolean);
    let delCount = 0;
    for (const id of ids) {
      const idx = entities.findIndex((e) => e.id === id);
      if (idx !== -1) {
        entities.splice(idx, 1);
        delCount++;
      }
    }
    logs.push(`객체 삭제 (${ids.join(', ')}): ${delCount}건 삭제됨`);
  }

  return logs;
}
