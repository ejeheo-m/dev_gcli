/**
 * DWG Lite Studio — Interactive macOS CAD Editor & Plot Window PDF Frontend
 */

const state = {
  doc: null,
  activeTool: 'select', // 'select' | 'pan' | 'line' | 'rect' | 'circle' | 'text' | 'insert' | 'plotwindow'
  selectedId: null,
  hoveredId: null,
  editingBlockName: null, // If non-null, user is inside In-Place Block Editor (BEDIT)
  savedMainView: null,

  // Camera transform: screenX = (worldX - camX) * zoom + canvasW/2
  //                   screenY = canvasH/2 - (worldY - camY) * zoom
  camX: 6000,
  camY: 4200,
  zoom: 0.08,

  // Interaction state
  isDragging: false,
  dragMode: null, // 'pan' | 'move-entity' | 'grip' | 'draw-line' | 'draw-rect' | 'draw-circle' | 'draw-plotwindow' | 'resize-plotwindow'
  dragStartScreen: { x: 0, y: 0 },
  dragStartWorld: { x: 0, y: 0 },
  dragCurrentWorld: { x: 0, y: 0 },
  dragEntitySnapshot: null,
  activeGripIndex: -1,
  activePlotCorner: null,
  pendingInsertBlockName: null,

  // Plot Window in CAD coordinates
  plotWindow: {
    xMin: -700,
    yMin: -1000,
    xMax: 12700,
    yMax: 8900,
  },

  // Options
  snapEnabled: true,
  orthoEnabled: false,
  gridEnabled: true,
  showPlotBox: true,
  lightCanvas: false,

  // Undo / Redo stacks
  undoStack: [],
  redoStack: [],
};

const canvas = document.getElementById('cadCanvas');
const ctx = canvas.getContext('2d');

// Coordinate conversions
function worldToScreen(wx, wy) {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  return {
    x: (wx - state.camX) * state.zoom + w / 2,
    y: h / 2 - (wy - state.camY) * state.zoom,
  };
}

function screenToWorld(sx, sy) {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  return {
    x: (sx - w / 2) / state.zoom + state.camX,
    y: (h / 2 - sy) / state.zoom + state.camY,
  };
}

function applySnap(pt, refPt = null) {
  let x = pt.x;
  let y = pt.y;
  if (state.snapEnabled) {
    const step = state.zoom > 0.4 ? 10 : state.zoom > 0.12 ? 50 : 100;
    x = Math.round(x / step) * step;
    y = Math.round(y / step) * step;
  }
  if (state.orthoEnabled && refPt) {
    if (Math.abs(x - refPt.x) > Math.abs(y - refPt.y)) {
      y = refPt.y;
    } else {
      x = refPt.x;
    }
  }
  return { x, y };
}

function getActiveEntityArray() {
  if (!state.doc) return [];
  if (state.editingBlockName && state.doc.blocks?.[state.editingBlockName]) {
    return state.doc.blocks[state.editingBlockName].entities;
  }
  return state.doc.entities;
}

function getSelectedEntity() {
  const list = getActiveEntityArray();
  return list.find((e) => e.id === state.selectedId) || null;
}

function pushUndoSnapshot() {
  if (!state.doc) return;
  state.undoStack.push(JSON.stringify(state.doc));
  if (state.undoStack.length > 40) state.undoStack.shift();
  state.redoStack = [];
}

function undo() {
  if (state.undoStack.length === 0) return;
  state.redoStack.push(JSON.stringify(state.doc));
  state.doc = JSON.parse(state.undoStack.pop());
  refreshAllSidebars();
  renderCanvas();
}

function redo() {
  if (state.redoStack.length === 0) return;
  state.undoStack.push(JSON.stringify(state.doc));
  state.doc = JSON.parse(state.redoStack.pop());
  refreshAllSidebars();
  renderCanvas();
}

// Resize Canvas for Retina displays
function resizeCanvas() {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.max(1, Math.floor(rect.width * dpr));
  canvas.height = Math.max(1, Math.floor(rect.height * dpr));
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  renderCanvas();
}

window.addEventListener('resize', resizeCanvas);

// Zoom to fit bounding box
function zoomToBox(box, padding = 0.84) {
  const w = canvas.clientWidth || 900;
  const h = canvas.clientHeight || 650;
  const bw = Math.max(10, (box.xMax ?? 1000) - (box.xMin ?? 0));
  const bh = Math.max(10, (box.yMax ?? 1000) - (box.yMin ?? 0));
  state.camX = (box.xMin + box.xMax) / 2;
  state.camY = (box.yMin + box.yMax) / 2;
  state.zoom = Math.min((w * padding) / bw, (h * padding) / bh);
  renderCanvas();
}

function zoomExtents() {
  if (!state.doc) return;
  if (state.editingBlockName) {
    const blk = state.doc.blocks?.[state.editingBlockName];
    if (blk) {
      zoomToBox({ xMin: -500, yMin: -500, xMax: 1500, yMax: 1200 });
      return;
    }
  }
  zoomToBox(state.doc.extents || { xMin: 0, yMin: 0, xMax: 12000, yMax: 8000 });
}

// Entity Color Resolution
function resolveDisplayColor(ent, parentColor = null, forWhiteBg = false) {
  const layers = state.doc?.layers || {};
  let hex = ent.colorHex;
  if (!hex || hex === 'BYLAYER') {
    hex = layers[ent.layer]?.colorHex || parentColor || '#e2e8f0';
  }
  if (forWhiteBg) {
    const clean = hex.replace('#', '');
    const r = parseInt(clean.slice(0, 2), 16) || 0;
    const g = parseInt(clean.slice(2, 4), 16) || 0;
    const b = parseInt(clean.slice(4, 6), 16) || 0;
    if (r > 215 && g > 215 && b > 215) return '#0f172a';
  }
  return hex;
}

// Compute Grip Points for Selected Entity
function getEntityGrips(ent) {
  if (!ent) return [];
  switch (ent.type) {
    case 'LINE':
      return [
        { x: ent.x1, y: ent.y1, role: 'p1' },
        { x: ent.x2, y: ent.y2, role: 'p2' },
        { x: (ent.x1 + ent.x2) / 2, y: (ent.y1 + ent.y2) / 2, role: 'mid' },
      ];
    case 'LWPOLYLINE':
    case 'POLYLINE':
      return (ent.vertices || []).map((v, i) => ({ x: v.x, y: v.y, role: 'vertex', index: i }));
    case 'CIRCLE':
    case 'ARC':
      return [
        { x: ent.cx, y: ent.cy, role: 'center' },
        { x: ent.cx + ent.radius, y: ent.cy, role: 'radius' },
      ];
    case 'TEXT':
    case 'MTEXT':
    case 'INSERT':
      return [{ x: ent.x, y: ent.y, role: 'origin' }];
    default:
      return [];
  }
}

// Distance helpers for hit testing
function distToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - x1, py - y1);
  let t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

function getBlockWorldBox(ent) {
  const blk = state.doc?.blocks?.[ent.blockName];
  if (!blk || !blk.entities?.length) {
    return { xMin: ent.x - 150, yMin: ent.y - 150, xMax: ent.x + 150, yMax: ent.y + 150 };
  }
  let xMin = Infinity, yMin = Infinity, xMax = -Infinity, yMax = -Infinity;
  const sx = Number(ent.scaleX ?? 1);
  const sy = Number(ent.scaleY ?? 1);
  const rad = ((ent.rotation || 0) * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const tf = (x, y) => ({
    x: ent.x + x * sx * cos - y * sy * sin,
    y: ent.y + x * sx * sin + y * sy * cos,
  });

  const addPt = (x, y) => {
    const p = tf(x, y);
    xMin = Math.min(xMin, p.x);
    yMin = Math.min(yMin, p.y);
    xMax = Math.max(xMax, p.x);
    yMax = Math.max(yMax, p.y);
  };

  for (const child of blk.entities) {
    if (child.type === 'LINE') {
      addPt(child.x1, child.y1);
      addPt(child.x2, child.y2);
    } else if (child.type === 'LWPOLYLINE' || child.type === 'POLYLINE') {
      (child.vertices || []).forEach((v) => addPt(v.x, v.y));
    } else if (child.type === 'CIRCLE' || child.type === 'ARC') {
      addPt(child.cx - child.radius, child.cy - child.radius);
      addPt(child.cx + child.radius, child.cy + child.radius);
    } else if (child.type === 'TEXT' || child.type === 'MTEXT') {
      addPt(child.x, child.y);
      addPt(child.x + (child.text?.length || 4) * (child.height || 80) * 0.7, child.y + (child.height || 80));
    }
  }
  if (!Number.isFinite(xMin)) {
    return { xMin: ent.x - 100, yMin: ent.y - 100, xMax: ent.x + 100, yMax: ent.y + 100 };
  }
  return { xMin, yMin, xMax, yMax };
}

function hitTestEntity(ent, wx, wy, tolWorld) {
  if (!ent || ent.visible === false) return false;
  const layer = state.doc?.layers?.[ent.layer];
  if (layer && layer.visible === false) return false;

  switch (ent.type) {
    case 'LINE':
      return distToSegment(wx, wy, ent.x1, ent.y1, ent.x2, ent.y2) <= tolWorld;
    case 'LWPOLYLINE':
    case 'POLYLINE': {
      const verts = ent.vertices || [];
      for (let i = 0; i < verts.length - 1; i++) {
        if (distToSegment(wx, wy, verts[i].x, verts[i].y, verts[i + 1].x, verts[i + 1].y) <= tolWorld) return true;
      }
      if (ent.closed && verts.length > 2) {
        const last = verts[verts.length - 1];
        if (distToSegment(wx, wy, last.x, last.y, verts[0].x, verts[0].y) <= tolWorld) return true;
      }
      return false;
    }
    case 'CIRCLE': {
      const d = Math.hypot(wx - ent.cx, wy - ent.cy);
      return Math.abs(d - ent.radius) <= tolWorld || d <= tolWorld * 0.8;
    }
    case 'ARC': {
      const d = Math.hypot(wx - ent.cx, wy - ent.cy);
      return Math.abs(d - ent.radius) <= tolWorld * 1.3;
    }
    case 'TEXT':
    case 'MTEXT': {
      const h = Number(ent.height || 120);
      const lines = String(ent.text || '').split(/\r?\n/);
      const maxChars = Math.max(2, ...lines.map((l) => l.length));
      const w = maxChars * h * 0.75;
      const totalH = lines.length * h * 1.25;
      return (
        wx >= ent.x - tolWorld &&
        wx <= ent.x + w + tolWorld &&
        wy >= ent.y - totalH + h * 0.2 - tolWorld &&
        wy <= ent.y + h * 1.2 + tolWorld
      );
    }
    case 'INSERT': {
      const box = getBlockWorldBox(ent);
      return (
        wx >= box.xMin - tolWorld &&
        wx <= box.xMax + tolWorld &&
        wy >= box.yMin - tolWorld &&
        wy <= box.yMax + tolWorld
      );
    }
    case 'DIMENSION':
      return distToSegment(wx, wy, ent.x1, ent.y1, ent.x2, ent.y2) <= tolWorld * 1.5;
    default:
      return false;
  }
}

function findEntityAtWorld(wx, wy) {
  const tolWorld = 9 / state.zoom;
  const list = getActiveEntityArray();
  // Prioritize TEXT and INSERT first so labels & blocks on top of polylines are easy to pick
  for (let i = list.length - 1; i >= 0; i--) {
    const e = list[i];
    if ((e.type === 'TEXT' || e.type === 'MTEXT' || e.type === 'INSERT') && hitTestEntity(e, wx, wy, tolWorld)) {
      return e;
    }
  }
  for (let i = list.length - 1; i >= 0; i--) {
    const e = list[i];
    if (hitTestEntity(e, wx, wy, tolWorld)) {
      return e;
    }
  }
  return null;
}

// Main Canvas Rendering
function renderCanvas() {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (!w || !h) return;

  const isLight = state.lightCanvas;
  ctx.fillStyle = isLight ? '#f8fafc' : '#0b1120';
  ctx.fillRect(0, 0, w, h);

  if (state.gridEnabled) {
    drawGrid(w, h, isLight);
  }

  if (!state.doc) return;

  const entities = getActiveEntityArray();
  for (const ent of entities) {
    const isSelected = ent.id === state.selectedId;
    const isHovered = ent.id === state.hoveredId;
    drawEntityOnContext(ctx, ent, worldToScreen, state.zoom, {
      isLight,
      isSelected,
      isHovered,
    });
  }

  // Draw grips for selected entity
  const selectedEnt = getSelectedEntity();
  if (selectedEnt) {
    const grips = getEntityGrips(selectedEnt);
    for (const g of grips) {
      const sp = worldToScreen(g.x, g.y);
      ctx.fillStyle = '#3b82f6';
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5;
      ctx.fillRect(sp.x - 4.5, sp.y - 4.5, 9, 9);
      ctx.strokeRect(sp.x - 4.5, sp.y - 4.5, 9, 9);
    }
  }

  // Draw Plot Window Overlay (when not inside block editor)
  if (state.showPlotBox && !state.editingBlockName && state.plotWindow) {
    drawPlotWindowOverlay();
  }

  // Draw active rubberband tool preview
  if (state.isDragging) {
    drawRubberbandPreview();
  }

  // Update status bar
  document.getElementById('zoomLevel').textContent = `${Math.round(state.zoom * 100)}%`;
  document.getElementById('entityCountLabel').textContent = String(entities.length);
}

function drawGrid(w, h, isLight) {
  const stepWorld = state.zoom > 0.35 ? 100 : state.zoom > 0.08 ? 500 : 1000;
  const topLeft = screenToWorld(0, 0);
  const bottomRight = screenToWorld(w, h);
  const startX = Math.floor(topLeft.x / stepWorld) * stepWorld;
  const endX = Math.ceil(bottomRight.x / stepWorld) * stepWorld;
  const startY = Math.floor(bottomRight.y / stepWorld) * stepWorld;
  const endY = Math.ceil(topLeft.y / stepWorld) * stepWorld;

  ctx.strokeStyle = isLight ? 'rgba(148, 163, 184, 0.25)' : 'rgba(51, 65, 85, 0.35)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = startX; x <= endX; x += stepWorld) {
    const sx = worldToScreen(x, 0).x;
    ctx.moveTo(sx, 0);
    ctx.lineTo(sx, h);
  }
  for (let y = startY; y <= endY; y += stepWorld) {
    const sy = worldToScreen(0, y).y;
    ctx.moveTo(0, sy);
    ctx.lineTo(w, sy);
  }
  ctx.stroke();

  // Origin axes (0,0)
  const orig = worldToScreen(0, 0);
  ctx.strokeStyle = isLight ? 'rgba(239, 68, 68, 0.35)' : 'rgba(239, 68, 68, 0.4)';
  ctx.beginPath();
  ctx.moveTo(orig.x, 0);
  ctx.lineTo(orig.x, h);
  ctx.moveTo(0, orig.y);
  ctx.lineTo(w, orig.y);
  ctx.stroke();
}

function drawEntityOnContext(targetCtx, ent, toScreenFn, zoomScale, opts = {}) {
  if (!ent || ent.visible === false) return;
  const layer = state.doc?.layers?.[ent.layer];
  if (layer && layer.visible === false) return;

  targetCtx.save();

  let strokeColor = resolveDisplayColor(ent, opts.parentColor, opts.isLight);
  if (opts.plotStyle === 'monochrome') {
    strokeColor = '#000000';
  } else if (opts.plotStyle === 'grayscale') {
    strokeColor = '#334155';
  }

  if (opts.isSelected) {
    strokeColor = '#f59e0b';
  } else if (opts.isHovered) {
    strokeColor = '#38bdf8';
  }

  targetCtx.strokeStyle = strokeColor;
  targetCtx.fillStyle = strokeColor;

  const baseLw = Math.max(1, Number(ent.lineweight || 0.25) * 4);
  targetCtx.lineWidth = opts.isSelected ? baseLw + 1.2 : baseLw;

  const lt = String(ent.lineType || layer?.lineType || 'CONTINUOUS').toUpperCase();
  if (opts.isSelected) {
    targetCtx.setLineDash([]);
  } else if (lt.includes('DASH') || lt.includes('HIDDEN')) {
    targetCtx.setLineDash([6, 4]);
  } else if (lt.includes('CENTER')) {
    targetCtx.setLineDash([10, 3, 2, 3]);
  } else {
    targetCtx.setLineDash([]);
  }

  switch (ent.type) {
    case 'LINE': {
      const p1 = toScreenFn(ent.x1, ent.y1);
      const p2 = toScreenFn(ent.x2, ent.y2);
      targetCtx.beginPath();
      targetCtx.moveTo(p1.x, p1.y);
      targetCtx.lineTo(p2.x, p2.y);
      targetCtx.stroke();
      break;
    }
    case 'LWPOLYLINE':
    case 'POLYLINE': {
      const verts = ent.vertices || [];
      if (verts.length < 2) break;
      targetCtx.beginPath();
      verts.forEach((v, idx) => {
        const p = toScreenFn(v.x, v.y);
        if (idx === 0) targetCtx.moveTo(p.x, p.y);
        else targetCtx.lineTo(p.x, p.y);
      });
      if (ent.closed) targetCtx.closePath();
      targetCtx.stroke();
      break;
    }
    case 'CIRCLE': {
      const c = toScreenFn(ent.cx, ent.cy);
      const rPx = Math.max(1, ent.radius * zoomScale);
      targetCtx.beginPath();
      targetCtx.arc(c.x, c.y, rPx, 0, Math.PI * 2);
      targetCtx.stroke();
      break;
    }
    case 'ARC': {
      const c = toScreenFn(ent.cx, ent.cy);
      const rPx = Math.max(1, ent.radius * zoomScale);
      // In screen coordinates (Y-down), CAD counter-clockwise angles are negated
      const startRad = -((ent.startAngle || 0) * Math.PI) / 180;
      const endRad = -((ent.endAngle || 0) * Math.PI) / 180;
      targetCtx.beginPath();
      targetCtx.arc(c.x, c.y, rPx, startRad, endRad, true);
      targetCtx.stroke();
      break;
    }
    case 'ELLIPSE': {
      const c = toScreenFn(ent.cx, ent.cy);
      const majorLen = Math.hypot(ent.majorX || 10, ent.majorY || 0) * zoomScale;
      const minorLen = majorLen * (ent.axisRatio || 0.5);
      const rot = -Math.atan2(ent.majorY || 0, ent.majorX || 10);
      targetCtx.beginPath();
      targetCtx.ellipse(c.x, c.y, Math.max(1, majorLen), Math.max(1, minorLen), rot, 0, Math.PI * 2);
      targetCtx.stroke();
      break;
    }
    case 'TEXT':
    case 'MTEXT': {
      const p = toScreenFn(ent.x, ent.y);
      const fontPx = Math.max(7, (ent.height || 120) * zoomScale);
      targetCtx.save();
      targetCtx.translate(p.x, p.y);
      if (ent.rotation) {
        targetCtx.rotate((-ent.rotation * Math.PI) / 180);
      }
      targetCtx.font = `600 ${fontPx}px "Apple SD Gothic Neo", "Pretendard", "Malgun Gothic", sans-serif`;
      targetCtx.textBaseline = 'alphabetic';
      const lines = String(ent.text || '').replace(/\\P/g, '\n').split(/\r?\n/);
      lines.forEach((line, i) => {
        targetCtx.fillText(line, 0, i * fontPx * 1.25);
      });
      targetCtx.restore();
      break;
    }
    case 'DIMENSION': {
      const p1 = toScreenFn(ent.x1, ent.y1);
      const p2 = toScreenFn(ent.x2, ent.y2);
      targetCtx.beginPath();
      targetCtx.moveTo(p1.x, p1.y);
      targetCtx.lineTo(p2.x, p2.y);
      targetCtx.stroke();
      const mx = (ent.x1 + ent.x2) / 2;
      const my = (ent.y1 + ent.y2) / 2;
      const tp = toScreenFn(ent.textX ?? mx, ent.textY ?? my);
      const fontPx = Math.max(8, (ent.height || 120) * zoomScale);
      targetCtx.font = `600 ${fontPx}px sans-serif`;
      targetCtx.textAlign = 'center';
      const dist = Math.round(Math.hypot(ent.x2 - ent.x1, ent.y2 - ent.y1));
      const label = ent.text && ent.text !== '<>' ? ent.text : String(dist);
      targetCtx.fillText(label, tp.x, tp.y - 4);
      break;
    }
    case 'INSERT': {
      const blk = state.doc?.blocks?.[ent.blockName];
      if (blk && Array.isArray(blk.entities)) {
        const sx = Number(ent.scaleX ?? 1);
        const sy = Number(ent.scaleY ?? 1);
        const rad = ((ent.rotation || 0) * Math.PI) / 180;
        const cos = Math.cos(rad);
        const sin = Math.sin(rad);
        const bx = blk.basePoint?.x || 0;
        const by = blk.basePoint?.y || 0;

        const childToScreen = (cx, cy) => {
          const dx = (cx - bx) * sx;
          const dy = (cy - by) * sy;
          const wx = ent.x + dx * cos - dy * sin;
          const wy = ent.y + dx * sin + dy * cos;
          return toScreenFn(wx, wy);
        };
        const childZoom = zoomScale * ((Math.abs(sx) + Math.abs(sy)) / 2);
        for (const child of blk.entities) {
          drawEntityOnContext(targetCtx, child, childToScreen, childZoom, {
            ...opts,
            parentColor: strokeColor,
          });
        }
      }
      // Draw highlight box if selected
      if (opts.isSelected) {
        const box = getBlockWorldBox(ent);
        const pMin = toScreenFn(box.xMin, box.yMax);
        const pMax = toScreenFn(box.xMax, box.yMin);
        targetCtx.strokeStyle = 'rgba(245, 158, 11, 0.7)';
        targetCtx.setLineDash([4, 3]);
        targetCtx.strokeRect(pMin.x, pMin.y, pMax.x - pMin.x, pMax.y - pMin.y);
      }
      break;
    }
    default:
      break;
  }

  targetCtx.restore();
}

function drawPlotWindowOverlay() {
  const pw = state.plotWindow;
  const pTopLeft = worldToScreen(pw.xMin, pw.yMax);
  const pBotRight = worldToScreen(pw.xMax, pw.yMin);
  const x = Math.min(pTopLeft.x, pBotRight.x);
  const y = Math.min(pTopLeft.y, pBotRight.y);
  const w = Math.abs(pBotRight.x - pTopLeft.x);
  const h = Math.abs(pBotRight.y - pTopLeft.y);

  ctx.save();
  ctx.strokeStyle = '#f59e0b';
  ctx.lineWidth = 2;
  ctx.setLineDash([8, 5]);
  ctx.strokeRect(x, y, w, h);

  // Corner handles
  ctx.setLineDash([]);
  ctx.fillStyle = '#f59e0b';
  const corners = [
    { x, y },
    { x: x + w, y },
    { x, y: y + h },
    { x: x + w, y: y + h },
  ];
  for (const c of corners) {
    ctx.fillRect(c.x - 5, c.y - 5, 10, 10);
  }

  // Badge label
  ctx.fillStyle = 'rgba(245, 158, 11, 0.92)';
  ctx.fillRect(x, Math.max(0, y - 22), 235, 20);
  ctx.fillStyle = '#0f172a';
  ctx.font = 'bold 11px sans-serif';
  const paper = document.getElementById('plotPaperSize')?.value || 'A3';
  ctx.fillText(
    `🖨️ 인쇄 범위 (${paper}): ${Math.round(pw.xMax - pw.xMin)} × ${Math.round(pw.yMax - pw.yMin)} mm`,
    x + 6,
    Math.max(14, y - 8)
  );
  ctx.restore();
}

function drawRubberbandPreview() {
  const s = worldToScreen(state.dragStartWorld.x, state.dragStartWorld.y);
  const c = worldToScreen(state.dragCurrentWorld.x, state.dragCurrentWorld.y);
  ctx.save();
  ctx.strokeStyle = '#38bdf8';
  ctx.lineWidth = 1.8;
  ctx.setLineDash([5, 4]);

  if (state.dragMode === 'draw-line') {
    ctx.beginPath();
    ctx.moveTo(s.x, s.y);
    ctx.lineTo(c.x, c.y);
    ctx.stroke();
  } else if (state.dragMode === 'draw-rect' || state.dragMode === 'draw-plotwindow') {
    if (state.dragMode === 'draw-plotwindow') {
      ctx.strokeStyle = '#f59e0b';
      ctx.fillStyle = 'rgba(245, 158, 11, 0.12)';
      ctx.fillRect(Math.min(s.x, c.x), Math.min(s.y, c.y), Math.abs(c.x - s.x), Math.abs(c.y - s.y));
    }
    ctx.strokeRect(Math.min(s.x, c.x), Math.min(s.y, c.y), Math.abs(c.x - s.x), Math.abs(c.y - s.y));
  } else if (state.dragMode === 'draw-circle') {
    const r = Math.hypot(c.x - s.x, c.y - s.y);
    ctx.beginPath();
    ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

// Mouse & Wheel Events on Canvas
canvas.addEventListener('mousedown', (e) => {
  const rect = canvas.getBoundingClientRect();
  const sx = e.clientX - rect.left;
  const sy = e.clientY - rect.top;
  const rawWorld = screenToWorld(sx, sy);
  const snappedWorld = applySnap(rawWorld);

  state.dragStartScreen = { x: sx, y: sy };
  state.dragStartWorld = snappedWorld;
  state.dragCurrentWorld = snappedWorld;

  // Middle click or Space/Pan tool
  if (e.button === 1 || state.activeTool === 'pan') {
    state.isDragging = true;
    state.dragMode = 'pan';
    return;
  }

  if (state.activeTool === 'plotwindow') {
    state.isDragging = true;
    state.dragMode = 'draw-plotwindow';
    state.dragStartWorld = rawWorld;
    state.dragCurrentWorld = rawWorld;
    return;
  }

  if (state.activeTool === 'line') {
    state.isDragging = true;
    state.dragMode = 'draw-line';
    return;
  }

  if (state.activeTool === 'rect') {
    state.isDragging = true;
    state.dragMode = 'draw-rect';
    return;
  }

  if (state.activeTool === 'circle') {
    state.isDragging = true;
    state.dragMode = 'draw-circle';
    return;
  }

  if (state.activeTool === 'text') {
    createNewTextAt(snappedWorld.x, snappedWorld.y);
    setActiveTool('select');
    return;
  }

  if (state.activeTool === 'insert') {
    const blkName = state.pendingInsertBlockName || Object.keys(state.doc?.blocks || {})[0];
    if (blkName) {
      createNewBlockInsertAt(blkName, snappedWorld.x, snappedWorld.y);
    }
    setActiveTool('select');
    return;
  }

  // SELECT mode:
  // 1. Check if clicking a grip of the currently selected entity
  const selectedEnt = getSelectedEntity();
  if (selectedEnt) {
    const grips = getEntityGrips(selectedEnt);
    for (let i = 0; i < grips.length; i++) {
      const gp = worldToScreen(grips[i].x, grips[i].y);
      if (Math.hypot(sx - gp.x, sy - gp.y) <= 9) {
        pushUndoSnapshot();
        state.isDragging = true;
        state.dragMode = 'grip';
        state.activeGripIndex = i;
        state.dragEntitySnapshot = JSON.parse(JSON.stringify(selectedEnt));
        return;
      }
    }
  }

  // 2. Check if clicking an entity
  const hit = findEntityAtWorld(rawWorld.x, rawWorld.y);
  if (hit) {
    selectEntity(hit.id);
    pushUndoSnapshot();
    state.isDragging = true;
    state.dragMode = 'move-entity';
    state.dragEntitySnapshot = JSON.parse(JSON.stringify(hit));
  } else {
    selectEntity(null);
    state.isDragging = true;
    state.dragMode = 'pan';
  }
});

canvas.addEventListener('mousemove', (e) => {
  const rect = canvas.getBoundingClientRect();
  const sx = e.clientX - rect.left;
  const sy = e.clientY - rect.top;
  const rawWorld = screenToWorld(sx, sy);

  document.getElementById('coordX').textContent = Math.round(rawWorld.x);
  document.getElementById('coordY').textContent = Math.round(rawWorld.y);

  if (!state.isDragging) {
    const hover = findEntityAtWorld(rawWorld.x, rawWorld.y);
    const nextHoverId = hover ? hover.id : null;
    if (nextHoverId !== state.hoveredId) {
      state.hoveredId = nextHoverId;
      renderCanvas();
    }
    return;
  }

  if (state.dragMode === 'pan') {
    const dx = sx - state.dragStartScreen.x;
    const dy = sy - state.dragStartScreen.y;
    state.camX -= dx / state.zoom;
    state.camY += dy / state.zoom;
    state.dragStartScreen = { x: sx, y: sy };
    renderCanvas();
    return;
  }

  const snapped = applySnap(rawWorld, state.dragStartWorld);
  state.dragCurrentWorld = state.dragMode === 'draw-plotwindow' ? rawWorld : snapped;

  if (state.dragMode === 'move-entity') {
    const ent = getSelectedEntity();
    const snap0 = state.dragEntitySnapshot;
    if (ent && snap0) {
      const dx = snapped.x - state.dragStartWorld.x;
      const dy = snapped.y - state.dragStartWorld.y;
      translateEntityFromSnapshot(ent, snap0, dx, dy);
      populateInspectorPanel(ent);
      renderCanvas();
    }
    return;
  }

  if (state.dragMode === 'grip') {
    const ent = getSelectedEntity();
    const snap0 = state.dragEntitySnapshot;
    if (ent && snap0) {
      applyGripDrag(ent, snap0, state.activeGripIndex, snapped);
      populateInspectorPanel(ent);
      renderCanvas();
    }
    return;
  }

  renderCanvas();
});

window.addEventListener('mouseup', () => {
  if (!state.isDragging) return;
  const mode = state.dragMode;
  state.isDragging = false;
  state.dragMode = null;

  const p1 = state.dragStartWorld;
  const p2 = state.dragCurrentWorld;

  if (mode === 'draw-line' && Math.hypot(p2.x - p1.x, p2.y - p1.y) > 2) {
    pushUndoSnapshot();
    const newLine = {
      id: `line_${Date.now()}`,
      type: 'LINE',
      layer: '0',
      colorHex: '#38bdf8',
      lineweight: 0.25,
      lineType: 'CONTINUOUS',
      x1: p1.x,
      y1: p1.y,
      x2: p2.x,
      y2: p2.y,
    };
    getActiveEntityArray().push(newLine);
    selectEntity(newLine.id);
    setActiveTool('select');
  } else if (mode === 'draw-rect' && Math.abs(p2.x - p1.x) > 2 && Math.abs(p2.y - p1.y) > 2) {
    pushUndoSnapshot();
    const newRect = {
      id: `poly_${Date.now()}`,
      type: 'LWPOLYLINE',
      layer: '0',
      colorHex: '#38bdf8',
      lineweight: 0.25,
      closed: true,
      vertices: [
        { x: p1.x, y: p1.y },
        { x: p2.x, y: p1.y },
        { x: p2.x, y: p2.y },
        { x: p1.x, y: p2.y },
      ],
    };
    getActiveEntityArray().push(newRect);
    selectEntity(newRect.id);
    setActiveTool('select');
  } else if (mode === 'draw-circle' && Math.hypot(p2.x - p1.x, p2.y - p1.y) > 2) {
    pushUndoSnapshot();
    const newCircle = {
      id: `circle_${Date.now()}`,
      type: 'CIRCLE',
      layer: '0',
      colorHex: '#38bdf8',
      lineweight: 0.25,
      cx: p1.x,
      cy: p1.y,
      radius: Math.round(Math.hypot(p2.x - p1.x, p2.y - p1.y)),
    };
    getActiveEntityArray().push(newCircle);
    selectEntity(newCircle.id);
    setActiveTool('select');
  } else if (mode === 'draw-plotwindow') {
    if (Math.abs(p2.x - p1.x) > 20 && Math.abs(p2.y - p1.y) > 20) {
      state.plotWindow = {
        xMin: Math.round(Math.min(p1.x, p2.x)),
        yMin: Math.round(Math.min(p1.y, p2.y)),
        xMax: Math.round(Math.max(p1.x, p2.x)),
        yMax: Math.round(Math.max(p1.y, p2.y)),
      };
      syncPlotWindowInputs();
      switchSidebarTab('tab-plot');
    }
    setActiveTool('select');
  }

  refreshAllSidebars();
  renderCanvas();
});

// Double-click on Canvas: Quick Edit for TEXT/MTEXT or Enter Block Editor for INSERT
canvas.addEventListener('dblclick', (e) => {
  const rect = canvas.getBoundingClientRect();
  const rawWorld = screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
  const hit = findEntityAtWorld(rawWorld.x, rawWorld.y);
  if (!hit) return;

  selectEntity(hit.id);
  if (hit.type === 'TEXT' || hit.type === 'MTEXT') {
    openQuickTextModal(hit);
  } else if (hit.type === 'INSERT') {
    enterBlockEditor(hit.blockName);
  }
});

// Zoom with mouse wheel / trackpad pinch
canvas.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const beforeWorld = screenToWorld(sx, sy);

    const factor = e.deltaY < 0 ? 1.12 : 0.89;
    state.zoom = Math.max(0.005, Math.min(20, state.zoom * factor));

    const afterWorld = screenToWorld(sx, sy);
    state.camX += beforeWorld.x - afterWorld.x;
    state.camY += beforeWorld.y - afterWorld.y;
    renderCanvas();
  },
  { passive: false }
);

function translateEntityFromSnapshot(ent, snap, dx, dy) {
  switch (ent.type) {
    case 'LINE':
    case 'DIMENSION':
      ent.x1 = Math.round(snap.x1 + dx);
      ent.y1 = Math.round(snap.y1 + dy);
      ent.x2 = Math.round(snap.x2 + dx);
      ent.y2 = Math.round(snap.y2 + dy);
      break;
    case 'LWPOLYLINE':
    case 'POLYLINE':
      ent.vertices = snap.vertices.map((v) => ({
        x: Math.round(v.x + dx),
        y: Math.round(v.y + dy),
      }));
      break;
    case 'CIRCLE':
    case 'ARC':
    case 'ELLIPSE':
      ent.cx = Math.round(snap.cx + dx);
      ent.cy = Math.round(snap.cy + dy);
      break;
    case 'TEXT':
    case 'MTEXT':
    case 'INSERT':
      ent.x = Math.round(snap.x + dx);
      ent.y = Math.round(snap.y + dy);
      break;
    default:
      break;
  }
}

function applyGripDrag(ent, snap, gripIdx, newPt) {
  if (ent.type === 'LINE') {
    if (gripIdx === 0) {
      ent.x1 = newPt.x;
      ent.y1 = newPt.y;
    } else if (gripIdx === 1) {
      ent.x2 = newPt.x;
      ent.y2 = newPt.y;
    } else if (gripIdx === 2) {
      const mx = (snap.x1 + snap.x2) / 2;
      const my = (snap.y1 + snap.y2) / 2;
      translateEntityFromSnapshot(ent, snap, newPt.x - mx, newPt.y - my);
    }
  } else if (ent.type === 'LWPOLYLINE' || ent.type === 'POLYLINE') {
    if (ent.vertices[gripIdx]) {
      ent.vertices[gripIdx].x = newPt.x;
      ent.vertices[gripIdx].y = newPt.y;
    }
  } else if (ent.type === 'CIRCLE' || ent.type === 'ARC') {
    if (gripIdx === 0) {
      ent.cx = newPt.x;
      ent.cy = newPt.y;
    } else if (gripIdx === 1) {
      ent.radius = Math.max(5, Math.round(Math.hypot(newPt.x - ent.cx, newPt.y - ent.cy)));
    }
  } else if (ent.type === 'TEXT' || ent.type === 'MTEXT' || ent.type === 'INSERT') {
    ent.x = newPt.x;
    ent.y = newPt.y;
  }
}

// Create new Text / Block Insert helpers
function createNewTextAt(wx, wy) {
  pushUndoSnapshot();
  const newText = {
    id: `txt_${Date.now()}`,
    type: 'TEXT',
    layer: state.doc?.layers?.['A-TEXT'] ? 'A-TEXT' : '0',
    colorHex: '#fef08a',
    lineweight: 0.25,
    text: '새 도면 주석 텍스트',
    x: Math.round(wx),
    y: Math.round(wy),
    height: 180,
    rotation: 0,
  };
  getActiveEntityArray().push(newText);
  selectEntity(newText.id);
  refreshAllSidebars();
  renderCanvas();
  openQuickTextModal(newText);
}

function createNewBlockInsertAt(blockName, wx, wy) {
  pushUndoSnapshot();
  const newIns = {
    id: `ins_${Date.now()}`,
    type: 'INSERT',
    layer: '0',
    blockName,
    x: Math.round(wx),
    y: Math.round(wy),
    scaleX: 1,
    scaleY: 1,
    rotation: 0,
    attributes: [],
  };
  getActiveEntityArray().push(newIns);
  selectEntity(newIns.id);
  refreshAllSidebars();
  renderCanvas();
}

// In-Place Block Editor (BEDIT)
function enterBlockEditor(blockName) {
  if (!state.doc?.blocks?.[blockName]) return;
  state.savedMainView = { camX: state.camX, camY: state.camY, zoom: state.zoom };
  state.editingBlockName = blockName;
  state.selectedId = null;
  document.getElementById('editingBlockName').textContent = blockName;
  document.getElementById('blockEditorBanner').classList.remove('hidden');
  zoomExtents();
  refreshAllSidebars();
}

function exitBlockEditor() {
  state.editingBlockName = null;
  state.selectedId = null;
  document.getElementById('blockEditorBanner').classList.add('hidden');
  if (state.savedMainView) {
    state.camX = state.savedMainView.camX;
    state.camY = state.savedMainView.camY;
    state.zoom = state.savedMainView.zoom;
  } else {
    zoomExtents();
  }
  refreshAllSidebars();
  renderCanvas();
}

// Explode Block Instance into individual entities
function explodeSelectedBlock() {
  const ent = getSelectedEntity();
  if (!ent || ent.type !== 'INSERT') return;
  const blk = state.doc?.blocks?.[ent.blockName];
  if (!blk || !Array.isArray(blk.entities)) return;

  pushUndoSnapshot();
  const list = getActiveEntityArray();
  const idx = list.findIndex((e) => e.id === ent.id);
  if (idx === -1) return;

  const sx = Number(ent.scaleX ?? 1);
  const sy = Number(ent.scaleY ?? 1);
  const rad = ((ent.rotation || 0) * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const tf = (x, y) => ({
    x: Math.round(ent.x + x * sx * cos - y * sy * sin),
    y: Math.round(ent.y + x * sx * sin + y * sy * cos),
  });

  const exploded = [];
  blk.entities.forEach((child, cIdx) => {
    const clone = JSON.parse(JSON.stringify(child));
    clone.id = `${ent.id}_exp_${cIdx}_${Date.now()}`;
    if (clone.type === 'LINE') {
      const p1 = tf(clone.x1, clone.y1);
      const p2 = tf(clone.x2, clone.y2);
      clone.x1 = p1.x; clone.y1 = p1.y;
      clone.x2 = p2.x; clone.y2 = p2.y;
    } else if (clone.type === 'LWPOLYLINE' || clone.type === 'POLYLINE') {
      clone.vertices = (clone.vertices || []).map((v) => tf(v.x, v.y));
    } else if (clone.type === 'CIRCLE' || clone.type === 'ARC') {
      const c = tf(clone.cx, clone.cy);
      clone.cx = c.x; clone.cy = c.y;
      clone.radius = Math.round(clone.radius * Math.abs(sx));
    } else if (clone.type === 'TEXT' || clone.type === 'MTEXT') {
      const p = tf(clone.x, clone.y);
      clone.x = p.x; clone.y = p.y;
      clone.rotation = (clone.rotation || 0) + (ent.rotation || 0);
    }
    exploded.push(clone);
  });

  list.splice(idx, 1, ...exploded);
  selectEntity(exploded[0]?.id || null);
  refreshAllSidebars();
  renderCanvas();
}

// Selection & Inspector Binding
function selectEntity(id) {
  state.selectedId = id;
  const ent = getSelectedEntity();
  populateInspectorPanel(ent);
  renderCanvas();
}

function populateInspectorPanel(ent) {
  const emptyBox = document.getElementById('emptySelectionState');
  const editorBox = document.getElementById('entityEditorPanel');

  if (!ent) {
    emptyBox.classList.remove('hidden');
    editorBox.classList.add('hidden');
    return;
  }

  emptyBox.classList.add('hidden');
  editorBox.classList.remove('hidden');

  document.getElementById('propTypeBadge').textContent = ent.type;
  document.getElementById('propIdLabel').textContent = `#${ent.id}`;

  // Populate Layer Select
  const layerSelect = document.getElementById('propLayer');
  layerSelect.innerHTML = '';
  for (const lName of Object.keys(state.doc?.layers || { '0': {} })) {
    const opt = document.createElement('option');
    opt.value = lName;
    opt.textContent = lName;
    if (lName === ent.layer) opt.selected = true;
    layerSelect.appendChild(opt);
  }

  const resolvedColor = resolveDisplayColor(ent, null, false);
  document.getElementById('propColor').value = resolvedColor.startsWith('#') ? resolvedColor : '#ffffff';
  document.getElementById('propLineweight').value = String(ent.lineweight || 0.25);

  // Hide all subgroups first
  ['textPropsGroup', 'linePropsGroup', 'circlePropsGroup', 'polyPropsGroup', 'insertPropsGroup'].forEach((gid) =>
    document.getElementById(gid).classList.add('hidden')
  );

  if (ent.type === 'TEXT' || ent.type === 'MTEXT') {
    document.getElementById('textPropsGroup').classList.remove('hidden');
    document.getElementById('propTextValue').value = ent.text || '';
    document.getElementById('propTextHeight').value = ent.height || 150;
    document.getElementById('propTextRotation').value = ent.rotation || 0;
    document.getElementById('propTextX').value = Math.round(ent.x || 0);
    document.getElementById('propTextY').value = Math.round(ent.y || 0);
  } else if (ent.type === 'LINE') {
    document.getElementById('linePropsGroup').classList.remove('hidden');
    document.getElementById('propLineX1').value = Math.round(ent.x1 || 0);
    document.getElementById('propLineY1').value = Math.round(ent.y1 || 0);
    document.getElementById('propLineX2').value = Math.round(ent.x2 || 0);
    document.getElementById('propLineY2').value = Math.round(ent.y2 || 0);
    document.getElementById('propLineLength').value = Math.round(Math.hypot(ent.x2 - ent.x1, ent.y2 - ent.y1));
    document.getElementById('propLineType').value = ent.lineType || 'CONTINUOUS';
  } else if (ent.type === 'CIRCLE' || ent.type === 'ARC') {
    document.getElementById('circlePropsGroup').classList.remove('hidden');
    document.getElementById('propCircleCx').value = Math.round(ent.cx || 0);
    document.getElementById('propCircleCy').value = Math.round(ent.cy || 0);
    document.getElementById('propCircleRadius').value = Math.round(ent.radius || 100);
    const arcRow = document.getElementById('arcAnglesRow');
    if (ent.type === 'ARC') {
      arcRow.classList.remove('hidden');
      document.getElementById('propArcStart').value = Math.round(ent.startAngle || 0);
      document.getElementById('propArcEnd').value = Math.round(ent.endAngle || 90);
    } else {
      arcRow.classList.add('hidden');
    }
  } else if (ent.type === 'LWPOLYLINE' || ent.type === 'POLYLINE') {
    document.getElementById('polyPropsGroup').classList.remove('hidden');
    document.getElementById('propPolyClosed').checked = Boolean(ent.closed);
    const vContainer = document.getElementById('polyVerticesList');
    vContainer.innerHTML = '';
    (ent.vertices || []).forEach((v, idx) => {
      const row = document.createElement('div');
      row.className = 'vertex-row';
      row.innerHTML = `
        <span>점 ${idx + 1}</span>
        <input type="number" class="text-input v-x" data-idx="${idx}" value="${Math.round(v.x)}" />
        <input type="number" class="text-input v-y" data-idx="${idx}" value="${Math.round(v.y)}" />
      `;
      vContainer.appendChild(row);
    });
    vContainer.querySelectorAll('input').forEach((inp) => {
      inp.addEventListener('input', () => {
        const i = Number(inp.dataset.idx);
        if (inp.classList.contains('v-x')) ent.vertices[i].x = Number(inp.value);
        else ent.vertices[i].y = Number(inp.value);
        renderCanvas();
      });
    });
  } else if (ent.type === 'INSERT') {
    document.getElementById('insertPropsGroup').classList.remove('hidden');
    const blkSelect = document.getElementById('propInsertBlockName');
    blkSelect.innerHTML = '';
    for (const bName of Object.keys(state.doc?.blocks || {})) {
      const opt = document.createElement('option');
      opt.value = bName;
      opt.textContent = bName;
      if (bName === ent.blockName) opt.selected = true;
      blkSelect.appendChild(opt);
    }
    document.getElementById('propInsertX').value = Math.round(ent.x || 0);
    document.getElementById('propInsertY').value = Math.round(ent.y || 0);
    document.getElementById('propInsertScaleX').value = Number(ent.scaleX ?? 1);
    document.getElementById('propInsertScaleY').value = Number(ent.scaleY ?? 1);
    document.getElementById('propInsertRotation').value = Number(ent.rotation ?? 0);
  }
}

// Bind Inspector Form Inputs
function bindInspectorEvents() {
  const updateSelected = (mutator) => {
    const ent = getSelectedEntity();
    if (!ent) return;
    pushUndoSnapshot();
    mutator(ent);
    refreshAllSidebars();
    renderCanvas();
  };

  document.getElementById('propLayer').addEventListener('change', (e) =>
    updateSelected((ent) => {
      ent.layer = e.target.value;
    })
  );
  document.getElementById('propColor').addEventListener('input', (e) =>
    updateSelected((ent) => {
      ent.colorHex = e.target.value;
    })
  );
  document.getElementById('propLineweight').addEventListener('change', (e) =>
    updateSelected((ent) => {
      ent.lineweight = Number(e.target.value);
    })
  );

  // Text properties
  document.getElementById('propTextValue').addEventListener('input', (e) => {
    const ent = getSelectedEntity();
    if (!ent) return;
    ent.text = e.target.value;
    refreshTextListSidebar();
    renderCanvas();
  });
  document.getElementById('propTextHeight').addEventListener('input', (e) =>
    updateSelected((ent) => {
      ent.height = Math.max(5, Number(e.target.value));
    })
  );
  document.getElementById('propTextRotation').addEventListener('input', (e) =>
    updateSelected((ent) => {
      ent.rotation = Number(e.target.value);
    })
  );
  document.getElementById('propTextX').addEventListener('input', (e) =>
    updateSelected((ent) => {
      ent.x = Number(e.target.value);
    })
  );
  document.getElementById('propTextY').addEventListener('input', (e) =>
    updateSelected((ent) => {
      ent.y = Number(e.target.value);
    })
  );

  // Line properties
  ['propLineX1', 'propLineY1', 'propLineX2', 'propLineY2'].forEach((id) => {
    document.getElementById(id).addEventListener('input', () => {
      const ent = getSelectedEntity();
      if (!ent || ent.type !== 'LINE') return;
      ent.x1 = Number(document.getElementById('propLineX1').value);
      ent.y1 = Number(document.getElementById('propLineY1').value);
      ent.x2 = Number(document.getElementById('propLineX2').value);
      ent.y2 = Number(document.getElementById('propLineY2').value);
      document.getElementById('propLineLength').value = Math.round(Math.hypot(ent.x2 - ent.x1, ent.y2 - ent.y1));
      renderCanvas();
    });
  });

  document.getElementById('propLineLength').addEventListener('change', (e) => {
    updateSelected((ent) => {
      const newLen = Math.max(1, Number(e.target.value));
      const ang = Math.atan2(ent.y2 - ent.y1, ent.x2 - ent.x1);
      ent.x2 = Math.round(ent.x1 + newLen * Math.cos(ang));
      ent.y2 = Math.round(ent.y1 + newLen * Math.sin(ang));
      populateInspectorPanel(ent);
    });
  });

  document.getElementById('propLineType').addEventListener('change', (e) =>
    updateSelected((ent) => {
      ent.lineType = e.target.value;
    })
  );

  // Circle / Arc properties
  ['propCircleCx', 'propCircleCy', 'propCircleRadius', 'propArcStart', 'propArcEnd'].forEach((id) => {
    document.getElementById(id).addEventListener('input', () => {
      const ent = getSelectedEntity();
      if (!ent) return;
      ent.cx = Number(document.getElementById('propCircleCx').value);
      ent.cy = Number(document.getElementById('propCircleCy').value);
      ent.radius = Math.max(1, Number(document.getElementById('propCircleRadius').value));
      if (ent.type === 'ARC') {
        ent.startAngle = Number(document.getElementById('propArcStart').value);
        ent.endAngle = Number(document.getElementById('propArcEnd').value);
      }
      renderCanvas();
    });
  });

  // Polyline closed toggle
  document.getElementById('propPolyClosed').addEventListener('change', (e) =>
    updateSelected((ent) => {
      ent.closed = e.target.checked;
    })
  );

  // Block Insert properties
  document.getElementById('propInsertBlockName').addEventListener('change', (e) =>
    updateSelected((ent) => {
      ent.blockName = e.target.value;
    })
  );
  ['propInsertX', 'propInsertY', 'propInsertScaleX', 'propInsertScaleY', 'propInsertRotation'].forEach((id) => {
    document.getElementById(id).addEventListener('input', () => {
      const ent = getSelectedEntity();
      if (!ent || ent.type !== 'INSERT') return;
      ent.x = Number(document.getElementById('propInsertX').value);
      ent.y = Number(document.getElementById('propInsertY').value);
      ent.scaleX = Number(document.getElementById('propInsertScaleX').value) || 1;
      ent.scaleY = Number(document.getElementById('propInsertScaleY').value) || 1;
      ent.rotation = Number(document.getElementById('propInsertRotation').value) || 0;
      renderCanvas();
    });
  });

  document.getElementById('btnEditBlockDef').addEventListener('click', () => {
    const ent = getSelectedEntity();
    if (ent && ent.type === 'INSERT') {
      enterBlockEditor(ent.blockName);
    }
  });

  document.getElementById('btnExplodeBlock').addEventListener('click', explodeSelectedBlock);

  document.getElementById('btnDeleteEntity').addEventListener('click', deleteSelectedEntity);
  document.getElementById('btnDuplicateEntity').addEventListener('click', duplicateSelectedEntity);
}

function deleteSelectedEntity() {
  if (!state.selectedId) return;
  pushUndoSnapshot();
  const list = getActiveEntityArray();
  const idx = list.findIndex((e) => e.id === state.selectedId);
  if (idx !== -1) {
    list.splice(idx, 1);
    selectEntity(null);
    refreshAllSidebars();
    renderCanvas();
  }
}

function duplicateSelectedEntity() {
  const ent = getSelectedEntity();
  if (!ent) return;
  pushUndoSnapshot();
  const clone = JSON.parse(JSON.stringify(ent));
  clone.id = `${ent.type.toLowerCase()}_${Date.now()}`;
  translateEntityFromSnapshot(clone, ent, 250, -250);
  getActiveEntityArray().push(clone);
  selectEntity(clone.id);
  refreshAllSidebars();
  renderCanvas();
}

// Refresh Right Sidebar Lists (Texts, Blocks, Layers)
function refreshAllSidebars() {
  refreshTextListSidebar();
  refreshBlockListSidebar();
  refreshLayerListSidebar();
  syncPlotWindowInputs();
}

function refreshTextListSidebar() {
  const container = document.getElementById('textEntityList');
  const query = (document.getElementById('textSearchInput')?.value || '').trim().toLowerCase();
  container.innerHTML = '';

  const texts = getActiveEntityArray().filter(
    (e) =>
      (e.type === 'TEXT' || e.type === 'MTEXT') &&
      (!query || String(e.text || '').toLowerCase().includes(query))
  );

  if (texts.length === 0) {
    container.innerHTML = `<div class="helper-note">조건에 맞는 글자 객체가 없습니다.</div>`;
    return;
  }

  for (const t of texts) {
    const card = document.createElement('div');
    card.className = `list-card ${t.id === state.selectedId ? 'selected' : ''}`;
    card.innerHTML = `
      <div class="list-card-main">
        <div class="list-card-title">${escapeHtml(String(t.text || '').replace(/\n/g, ' / '))}</div>
        <div class="list-card-sub">레이어: ${t.layer} · 크기: ${t.height} · (${Math.round(t.x)}, ${Math.round(t.y)})</div>
      </div>
      <button class="btn btn-sm">수정</button>
    `;
    card.addEventListener('click', () => {
      selectEntity(t.id);
      state.camX = t.x;
      state.camY = t.y;
      switchSidebarTab('tab-inspector');
      renderCanvas();
    });
    container.appendChild(card);
  }
}

function refreshBlockListSidebar() {
  const container = document.getElementById('blockDefList');
  container.innerHTML = '';
  const blocks = state.doc?.blocks || {};
  const entries = Object.entries(blocks);

  if (entries.length === 0) {
    container.innerHTML = `<div class="helper-note">등록된 블록 정의가 없습니다.</div>`;
    return;
  }

  for (const [bName, blk] of entries) {
    const instanceCount = (state.doc?.entities || []).filter(
      (e) => e.type === 'INSERT' && e.blockName === bName
    ).length;

    const card = document.createElement('div');
    card.className = 'list-card';
    card.innerHTML = `
      <div class="list-card-main">
        <div class="list-card-title">🧩 ${escapeHtml(bName)}</div>
        <div class="list-card-sub">${escapeHtml(blk.description || '')} · 도면 내 ${instanceCount}개 사용 중</div>
      </div>
      <div style="display:flex;gap:4px;">
        <button class="btn btn-sm btn-place-blk">배치</button>
        <button class="btn btn-primary btn-sm btn-edit-blk">내부편집</button>
      </div>
    `;
    card.querySelector('.btn-place-blk').addEventListener('click', (ev) => {
      ev.stopPropagation();
      state.pendingInsertBlockName = bName;
      setActiveTool('insert');
    });
    card.querySelector('.btn-edit-blk').addEventListener('click', (ev) => {
      ev.stopPropagation();
      enterBlockEditor(bName);
    });
    container.appendChild(card);
  }
}

function refreshLayerListSidebar() {
  const container = document.getElementById('layerList');
  container.innerHTML = '';
  const layers = state.doc?.layers || {};

  for (const [lName, layer] of Object.entries(layers)) {
    const count = getActiveEntityArray().filter((e) => e.layer === lName).length;
    const card = document.createElement('div');
    card.className = 'list-card';
    card.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;">
        <input type="checkbox" class="layer-vis" ${layer.visible !== false ? 'checked' : ''} title="레이어 표시/숨기기" />
        <input type="color" class="layer-col" value="${layer.colorHex || '#ffffff'}" style="width:22px;height:22px;border:none;background:none;cursor:pointer;" />
        <div>
          <div class="list-card-title">${escapeHtml(lName)}</div>
          <div class="list-card-sub">객체 ${count}개 · ${layer.lineType || 'CONTINUOUS'}</div>
        </div>
      </div>
    `;
    card.querySelector('.layer-vis').addEventListener('change', (ev) => {
      layer.visible = ev.target.checked;
      renderCanvas();
    });
    card.querySelector('.layer-col').addEventListener('input', (ev) => {
      layer.colorHex = ev.target.value;
      renderCanvas();
    });
    container.appendChild(card);
  }
}

// Plot Window Inputs & Preview Modal
function syncPlotWindowInputs() {
  const pw = state.plotWindow;
  if (!pw) return;
  document.getElementById('plotXMin').value = Math.round(pw.xMin);
  document.getElementById('plotYMin').value = Math.round(pw.yMin);
  document.getElementById('plotXMax').value = Math.round(pw.xMax);
  document.getElementById('plotYMax').value = Math.round(pw.yMax);
  document.getElementById('hudPlotWindowInfo').textContent = `인쇄 범위: [${Math.round(pw.xMin)}, ${Math.round(pw.yMin)}] ~ [${Math.round(pw.xMax)}, ${Math.round(pw.yMax)}] (${Math.round(pw.xMax - pw.xMin)}×${Math.round(pw.yMax - pw.yMin)}mm)`;
}

function getPlotOptionsFromUI() {
  return {
    paperSize: document.getElementById('plotPaperSize').value,
    orientation: document.getElementById('plotOrientation').value,
    scale: document.getElementById('plotScale').value,
    plotStyle: document.getElementById('plotStyle').value,
    showPlotStamp: document.getElementById('plotShowStamp').checked,
    plotWindow: { ...state.plotWindow },
  };
}

function renderPlotPreviewCanvas() {
  const pCanvas = document.getElementById('plotPreviewCanvas');
  const pCtx = pCanvas.getContext('2d');
  const opts = getPlotOptionsFromUI();

  const isLandscape = opts.orientation === 'landscape';
  pCanvas.width = isLandscape ? 840 : 594;
  pCanvas.height = isLandscape ? 594 : 840;

  // White paper background
  pCtx.fillStyle = '#ffffff';
  pCtx.fillRect(0, 0, pCanvas.width, pCanvas.height);

  const margin = 32;
  const printableW = pCanvas.width - margin * 2;
  const printableH = pCanvas.height - margin * 2 - (opts.showPlotStamp ? 22 : 0);

  // Printable dashed border
  pCtx.strokeStyle = '#cbd5e1';
  pCtx.lineWidth = 1;
  pCtx.strokeRect(margin, margin, printableW, printableH);

  const pw = opts.plotWindow;
  const cadW = Math.max(10, pw.xMax - pw.xMin);
  const cadH = Math.max(10, pw.yMax - pw.yMin);
  const scalePx = Math.min(printableW / cadW, printableH / cadH);

  const boxW = cadW * scalePx;
  const boxH = cadH * scalePx;
  const offX = margin + (printableW - boxW) / 2;
  const offY = margin + (printableH - boxH) / 2;

  pCtx.save();
  pCtx.beginPath();
  pCtx.rect(offX, offY, boxW, boxH);
  pCtx.clip();

  const toPreviewScreen = (wx, wy) => ({
    x: offX + (wx - pw.xMin) * scalePx,
    y: offY + boxH - (wy - pw.yMin) * scalePx,
  });

  for (const ent of state.doc?.entities || []) {
    drawEntityOnContext(pCtx, ent, toPreviewScreen, scalePx, {
      isLight: true,
      plotStyle: opts.plotStyle,
    });
  }
  pCtx.restore();

  if (opts.showPlotStamp) {
    pCtx.fillStyle = '#475569';
    pCtx.font = '11px sans-serif';
    pCtx.fillText(
      `DWG Lite Studio | 도면: ${state.doc?.filename || 'Drawing.dwg'} | 용지: ${opts.paperSize} (${opts.orientation}) | 축척: ${opts.scale} | 스타일: ${opts.plotStyle.toUpperCase()}`,
      margin,
      pCanvas.height - 14
    );
  }

  // Update summary box
  document.getElementById('plotSummaryBox').innerHTML = `
    <div>• <strong>파일명</strong>: ${escapeHtml(state.doc?.filename || '')}</div>
    <div>• <strong>인쇄 범위</strong>: (${Math.round(pw.xMin)}, ${Math.round(pw.yMin)}) ~ (${Math.round(pw.xMax)}, ${Math.round(pw.yMax)})</div>
    <div>• <strong>범위 크기</strong>: ${Math.round(cadW)} × ${Math.round(cadH)} mm</div>
    <div>• <strong>출력 용지</strong>: ${opts.paperSize} (${opts.orientation === 'landscape' ? '가로' : '세로'})</div>
    <div>• <strong>플롯 스타일</strong>: ${opts.plotStyle.toUpperCase()}</div>
  `;
}

async function downloadVectorPdf() {
  if (!state.doc) return;
  const opts = getPlotOptionsFromUI();
  const res = await fetch('/api/export-pdf', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ document: state.doc, options: opts }),
  });
  if (!res.ok) {
    alert('PDF 생성 중 오류가 발생했습니다.');
    return;
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = (state.doc.filename || 'drawing.dwg').replace(/\.(dwg|dxf)$/i, '') + '_plot.pdf';
  a.click();
  URL.revokeObjectURL(url);
}

function triggerSystemPrint() {
  renderPlotPreviewCanvas();
  const pCanvas = document.getElementById('plotPreviewCanvas');
  const dataUrl = pCanvas.toDataURL('image/png');
  const win = window.open('', '_blank');
  if (!win) {
    downloadVectorPdf();
    return;
  }
  win.document.write(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>${escapeHtml(state.doc?.filename || 'CAD_Plot')}</title>
      <style>
        @page { margin: 0; size: auto; }
        body { margin: 0; display: flex; align-items: center; justify-content: center; background: #fff; }
        img { max-width: 100vw; max-height: 100vh; object-fit: contain; }
      </style>
    </head>
    <body>
      <img src="${dataUrl}" onload="window.print();" />
    </body>
    </html>
  `);
  win.document.close();
}

// Export edited drawing as DXF
async function downloadEditedDxf() {
  if (!state.doc) return;
  const res = await fetch('/api/export-dxf', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ document: state.doc }),
  });
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = (state.doc.filename || 'drawing.dwg').replace(/\.(dwg|dxf)$/i, '') + '_edited.dxf';
  a.click();
  URL.revokeObjectURL(url);
}

// Quick Text Modal
let quickEditingEntity = null;
function openQuickTextModal(ent) {
  quickEditingEntity = ent;
  document.getElementById('quickTextInput').value = ent.text || '';
  document.getElementById('quickTextHeight').value = ent.height || 150;
  document.getElementById('quickTextRotation').value = ent.rotation || 0;
  document.getElementById('quickTextModal').classList.remove('hidden');
  setTimeout(() => document.getElementById('quickTextInput').focus(), 50);
}

document.getElementById('btnSaveQuickText').addEventListener('click', () => {
  if (quickEditingEntity) {
    pushUndoSnapshot();
    quickEditingEntity.text = document.getElementById('quickTextInput').value;
    quickEditingEntity.height = Math.max(5, Number(document.getElementById('quickTextHeight').value));
    quickEditingEntity.rotation = Number(document.getElementById('quickTextRotation').value);
    populateInspectorPanel(quickEditingEntity);
    refreshAllSidebars();
    renderCanvas();
  }
  document.getElementById('quickTextModal').classList.add('hidden');
});

// Tool & Tab Switching
function setActiveTool(toolName) {
  state.activeTool = toolName;
  document.querySelectorAll('.tool-btn[data-tool]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.tool === toolName);
  });

  const labels = {
    select: '도구: 객체 선택/편집 (클릭하여 선택 · 더블클릭하여 글자/블록 즉시 수정)',
    pan: '도구: 화면 이동 (드래그하여 도면 이동)',
    line: '도구: 선(LINE) 추가 — 도면 위에서 시작점부터 끝점까지 드래그하세요',
    rect: '도구: 사각형(POLYLINE) 추가 — 대각선 모서리를 드래그하세요',
    circle: '도구: 원(CIRCLE) 추가 — 중심점에서 반지름만큼 드래그하세요',
    text: '도구: 글자(TEXT) 추가 — 글자를 배치할 위치를 클릭하세요',
    insert: `도구: 블록 배치 (${state.pendingInsertBlockName || '기본 블록'}) — 배치할 위치를 클릭하세요`,
    plotwindow: '도구: ✂️ 인쇄 범위 지정 — PDF로 출력할 도면 영역을 마우스로 드래그하세요',
  };
  document.getElementById('hudActiveTool').textContent = labels[toolName] || labels.select;
}

function switchSidebarTab(tabId) {
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.tab === tabId);
  });
  document.querySelectorAll('.tab-panel').forEach((panel) => {
    panel.classList.toggle('active', panel.id === tabId);
  });
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Load Sample or Uploaded File
async function loadSampleDrawing(sampleId) {
  const res = await fetch(`/api/samples/${encodeURIComponent(sampleId)}`);
  const data = await res.json();
  if (data.document) {
    loadDocumentIntoState(data.document);
  }
}

function loadDocumentIntoState(doc) {
  // Normalize layers array to object map if needed
  if (Array.isArray(doc.layers)) {
    const map = {};
    for (const l of doc.layers) {
      map[l.name] = {
        ...l,
        colorHex: l.colorHex || l.color || '#e5e5ea',
        lineType: l.lineType || l.linetype || 'CONTINUOUS',
      };
    }
    doc.layers = map;
  }
  const normalizeEntList = (list) => {
    for (const e of list || []) {
      if (e.r != null && e.radius == null) e.radius = e.r;
      if (e.radius != null && e.r == null) e.r = e.radius;
      if (e.color && !e.colorHex) e.colorHex = e.color;
    }
  };
  normalizeEntList(doc.entities);
  for (const blk of Object.values(doc.blocks || {})) {
    normalizeEntList(blk.entities);
  }
  if (!doc.extents) {
    if (doc.plotWindow) {
      doc.extents = { ...doc.plotWindow };
    } else if (doc.bounds) {
      doc.extents = {
        xMin: doc.bounds.minX,
        yMin: doc.bounds.minY,
        xMax: doc.bounds.maxX,
        yMax: doc.bounds.maxY,
      };
    } else {
      doc.extents = { xMin: 0, yMin: 0, xMax: 12000, yMax: 8000 };
    }
  }

  state.doc = doc;
  state.selectedId = null;
  state.editingBlockName = null;
  state.undoStack = [];
  state.redoStack = [];
  document.getElementById('blockEditorBanner').classList.add('hidden');
  document.getElementById('currentFileLabel').textContent = `${doc.filename} (${doc.format || doc.formatVersion || 'AutoCAD DWG'})`;

  const ext = doc.extents;
  state.plotWindow = {
    xMin: Math.round(ext.xMin),
    yMin: Math.round(ext.yMin),
    xMax: Math.round(ext.xMax),
    yMax: Math.round(ext.yMax),
  };

  refreshAllSidebars();
  populateInspectorPanel(null);
  zoomExtents();
}

// Wire UI Events
function initUIEvents() {
  document.querySelectorAll('.tool-btn[data-tool]').forEach((btn) => {
    btn.addEventListener('click', () => setActiveTool(btn.dataset.tool));
  });

  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => switchSidebarTab(btn.dataset.tab));
  });

  document.getElementById('sampleSelect').addEventListener('change', (e) => {
    loadSampleDrawing(e.target.value);
  });

  document.getElementById('fileInput').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const buf = await file.arrayBuffer();
    const res = await fetch('/api/parse-dwg', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'X-Filename': encodeURIComponent(file.name),
      },
      body: buf,
    });
    const data = await res.json();
    if (!res.ok || data.error) {
      alert(`도면 파싱 오류: ${data.error || '알 수 없는 오류'}`);
      return;
    }
    loadDocumentIntoState(data.document);
  });

  document.getElementById('btnUndo').addEventListener('click', undo);
  document.getElementById('btnRedo').addEventListener('click', redo);
  document.getElementById('btnExitBlockEditor').addEventListener('click', exitBlockEditor);
  document.getElementById('btnZoomExtents').addEventListener('click', zoomExtents);
  document.getElementById('btnZoomPlotWindow').addEventListener('click', () => {
    zoomToBox(state.plotWindow, 0.88);
  });

  document.getElementById('btnSetPlotWindow').addEventListener('click', () => {
    setActiveTool('plotwindow');
  });
  document.getElementById('btnDragPlotWindowSidebar').addEventListener('click', () => {
    setActiveTool('plotwindow');
  });
  document.getElementById('btnResetPlotWindowExtents').addEventListener('click', () => {
    if (!state.doc?.extents) return;
    state.plotWindow = { ...state.doc.extents };
    syncPlotWindowInputs();
    renderCanvas();
  });

  ['plotXMin', 'plotYMin', 'plotXMax', 'plotYMax'].forEach((id) => {
    document.getElementById(id).addEventListener('input', () => {
      state.plotWindow.xMin = Number(document.getElementById('plotXMin').value);
      state.plotWindow.yMin = Number(document.getElementById('plotYMin').value);
      state.plotWindow.xMax = Number(document.getElementById('plotXMax').value);
      state.plotWindow.yMax = Number(document.getElementById('plotYMax').value);
      renderCanvas();
    });
  });

  document.getElementById('btnOpenPlotModal').addEventListener('click', () => {
    renderPlotPreviewCanvas();
    document.getElementById('plotPreviewModal').classList.remove('hidden');
  });
  document.getElementById('btnPreviewPlotSheet').addEventListener('click', () => {
    renderPlotPreviewCanvas();
    document.getElementById('plotPreviewModal').classList.remove('hidden');
  });
  document.getElementById('btnGeneratePdfNow').addEventListener('click', downloadVectorPdf);
  document.getElementById('btnModalDownloadVectorPdf').addEventListener('click', downloadVectorPdf);
  document.getElementById('btnModalSystemPrint').addEventListener('click', triggerSystemPrint);
  document.getElementById('btnExportDxf').addEventListener('click', downloadEditedDxf);

  // Search & Quick Add Text
  document.getElementById('textSearchInput').addEventListener('input', refreshTextListSidebar);
  document.getElementById('btnQuickAddText').addEventListener('click', () => {
    setActiveTool('text');
  });

  // Add Layer
  document.getElementById('btnAddLayer').addEventListener('click', () => {
    const nameInput = document.getElementById('newLayerName');
    const name = nameInput.value.trim();
    if (!name || !state.doc) return;
    state.doc.layers[name] = {
      name,
      colorHex: '#38bdf8',
      visible: true,
      locked: false,
      lineType: 'CONTINUOUS',
    };
    nameInput.value = '';
    refreshLayerListSidebar();
  });

  // Bottom toggles
  document.getElementById('chkSnap').addEventListener('change', (e) => {
    state.snapEnabled = e.target.checked;
  });
  document.getElementById('chkOrtho').addEventListener('change', (e) => {
    state.orthoEnabled = e.target.checked;
  });
  document.getElementById('chkGrid').addEventListener('change', (e) => {
    state.gridEnabled = e.target.checked;
    renderCanvas();
  });
  document.getElementById('chkShowPlotBox').addEventListener('change', (e) => {
    state.showPlotBox = e.target.checked;
    renderCanvas();
  });
  document.getElementById('chkLightCanvas').addEventListener('change', (e) => {
    state.lightCanvas = e.target.checked;
    renderCanvas();
  });

  // REA Report Modal
  document.getElementById('btnReaReport').addEventListener('click', async () => {
    const modal = document.getElementById('reaReportModal');
    const box = document.getElementById('reaReportContent');
    modal.classList.remove('hidden');
    const res = await fetch('/api/rea-report');
    const r = await res.json();
    box.innerHTML = `
      <div class="summary-kv">
        <div>• <strong>분석 대상 파일</strong>: <code>${escapeHtml(r.analyzedPath)}</code></div>
        <div>• <strong>컨테이너 포맷</strong>: ${escapeHtml(r.format)} (${escapeHtml(r.sizeFormatted)})</div>
        <div>• <strong>SHA-256 해시</strong>: <code>${escapeHtml(r.sha256)}</code></div>
        <div>• <strong>REA Evidence IDs</strong>:
          <ul style="margin-left:18px;margin-top:4px;">
            <li>Summary: <code>${escapeHtml(r.evidenceIds.summary)}</code></li>
            <li>Inventory: <code>${escapeHtml(r.evidenceIds.inventory)}</code></li>
            <li>Artifact Graph Manifest: <code>${escapeHtml(r.evidenceIds.artifactGraphManifest)}</code> (${r.graphStats.nodeCount} nodes / ${r.graphStats.occurrenceCount} occurrences)</li>
          </ul>
        </div>
      </div>
      <table class="rea-table">
        <thead>
          <tr><th>내부 패키지 / 바이너리 경로</th><th>역할 및 아키텍처</th><th>크기</th></tr>
        </thead>
        <tbody>
          ${r.components
            .map(
              (c) =>
                `<tr><td><code>${escapeHtml(c.name)}</code></td><td>${escapeHtml(c.role)}</td><td>${escapeHtml(c.size)}</td></tr>`
            )
            .join('')}
        </tbody>
      </table>
      <p class="helper-note" style="margin-top:12px;">💡 ${escapeHtml(r.designTakeaway)}</p>
    `;
  });

  // Close Modals
  document.querySelectorAll('[data-close]').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.getElementById(btn.dataset.close).classList.add('hidden');
    });
  });

  // Keyboard Shortcuts
  window.addEventListener('keydown', (e) => {
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) return;

    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'd') {
      e.preventDefault();
      duplicateSelectedEntity();
      return;
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      deleteSelectedEntity();
      return;
    }
    if (e.key === 'Escape') {
      setActiveTool('select');
      selectEntity(null);
      return;
    }
    const k = e.key.toLowerCase();
    if (k === 'v') setActiveTool('select');
    else if (k === 'h') setActiveTool('pan');
    else if (k === 'l') setActiveTool('line');
    else if (k === 'r') setActiveTool('rect');
    else if (k === 'c') setActiveTool('circle');
    else if (k === 't') setActiveTool('text');
    else if (k === 'b') setActiveTool('insert');
    else if (k === 'w') setActiveTool('plotwindow');
    else if (k === 'z') zoomExtents();
  });
}

// Initialize App
bindInspectorEvents();
initUIEvents();
resizeCanvas();
loadSampleDrawing('arch-floorplan');
