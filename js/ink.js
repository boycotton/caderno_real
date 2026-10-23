// Objetos desenhados na página: traços (caneta, lápis, marca-texto), formas e texto.
// Coordenadas sempre em pontos da página (origem no canto superior esquerdo).

let _id = 0;
export const newId = () => Date.now().toString(36) + (_id++).toString(36) + Math.random().toString(36).slice(2, 6);

export const TOOL_STYLE = {
  pen:    { thinning: 0.5, opacity: 1 },
  pencil: { thinning: 0.25, opacity: 1 },
  marker: { thinning: 0, opacity: 0.35 },
};

// Traço = segmentos com pontas redondas, largura pela pressão. É determinístico: o que já foi desenhado
// nunca muda quando chegam pontos novos (sem "tremer"), e o desenho ao vivo é idêntico ao final.
export function strokeWidth(o, pr) {
  const th = (TOOL_STYLE[o.tool] || TOOL_STYLE.pen).thinning * (o.sim ? 0 : 1);
  return Math.max(0.3, o.size * 2 * (0.5 - th * (0.5 - (pr ?? 0.5))));
}

// desenha os segmentos a partir do ponto `from` (para o traço ao vivo ir só acrescentando)
export function drawStrokeSegs(ctx, o, from = 0) {
  const pts = o.pts;
  if (!pts.length) return;
  ctx.save();
  ctx.strokeStyle = ctx.fillStyle = o.color;
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  if (o.tool === 'marker') {
    // largura constante: um caminho só (a transparência não escurece nas emendas)
    ctx.globalAlpha = TOOL_STYLE.marker.opacity;
    ctx.lineWidth = o.size;
    ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
    for (let k = 1; k < pts.length; k++) ctx.lineTo(pts[k][0], pts[k][1]);
    if (pts.length === 1) ctx.lineTo(pts[0][0] + 0.01, pts[0][1]);
    ctx.stroke();
    ctx.restore();
    return;
  }
  if (from === 0) {
    ctx.beginPath(); ctx.arc(pts[0][0], pts[0][1], strokeWidth(o, pts[0][2]) / 2, 0, Math.PI * 2); ctx.fill();
  }
  for (let k = Math.max(1, from); k < pts.length; k++) {
    ctx.lineWidth = strokeWidth(o, (pts[k - 1][2] + pts[k][2]) / 2);
    ctx.beginPath(); ctx.moveTo(pts[k - 1][0], pts[k - 1][1]); ctx.lineTo(pts[k][0], pts[k][1]); ctx.stroke();
  }
  ctx.restore();
}

export const FONT_STACK = 'Helvetica, Arial, "Liberation Sans", sans-serif';

import { curvePoints } from './recognize.js';
const cache = new WeakMap(); // objeto -> { path, poly, bbox }

function ellipsePoints(cx, cy, rx, ry, n = 56) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    out.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]);
  }
  return out;
}

// Pontos-guia de uma forma (contorno), usados para desenhar, testar toque e seleção.
export function shapeOutline(o) {
  const { x1, y1, x2, y2 } = o;
  const l = Math.min(x1, x2), r = Math.max(x1, x2), t = Math.min(y1, y2), b = Math.max(y1, y2);
  switch (o.kind) {
    case 'line': case 'arrow': return { closed: false, pts: [[x1, y1], [x2, y2]] };
    case 'rect': return { closed: true, pts: [[l, t], [r, t], [r, b], [l, b]] };
    case 'ellipse': return { closed: true, pts: ellipsePoints((l + r) / 2, (t + b) / 2, (r - l) / 2, (b - t) / 2) };
    case 'triangle': return { closed: true, pts: [[(l + r) / 2, t], [r, b], [l, b]] };
    case 'rtriangle': return { closed: true, pts: [[l, t], [r, b], [l, b]] };
    case 'poly': return { closed: true, pts: o.pts };
    case 'curve': return { closed: false, pts: curvePoints(o) };
    default: return { closed: false, pts: [[x1, y1], [x2, y2]] };
  }
}

export function arrowHead(o) {
  const ang = Math.atan2(o.y2 - o.y1, o.x2 - o.x1);
  const len = Math.max(8, o.size * 4);
  const spread = 0.45;
  return [
    [o.x2, o.y2],
    [o.x2 - Math.cos(ang - spread) * len, o.y2 - Math.sin(ang - spread) * len],
    [o.x2 - Math.cos(ang + spread) * len, o.y2 - Math.sin(ang + spread) * len],
  ];
}

let measureCtx;
export function textLines(o) { return String(o.text || '').split('\n'); }
export function textWidth(str, size) {
  if (!measureCtx) measureCtx = (typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(4, 4) : document.createElement('canvas')).getContext('2d');
  measureCtx.font = `${size}px ${FONT_STACK}`;
  return measureCtx.measureText(str).width;
}
export const LINE_H = 1.25;

export function geom(o) {
  let g = cache.get(o);
  if (g) return g;
  g = {};
  if (o.t === 'stroke') {
    g.bbox = bboxOf(o.pts, o.size * 1.6);
  } else if (o.t === 'shape') {
    const sh = shapeOutline(o);
    g.outline = sh;
    const p = new Path2D();
    if (o.kind === 'ellipse') {
      const l = Math.min(o.x1, o.x2), r = Math.max(o.x1, o.x2), t = Math.min(o.y1, o.y2), b = Math.max(o.y1, o.y2);
      p.ellipse((l + r) / 2, (t + b) / 2, Math.max(0.1, (r - l) / 2), Math.max(0.1, (b - t) / 2), 0, 0, Math.PI * 2);
    } else {
      p.moveTo(sh.pts[0][0], sh.pts[0][1]);
      for (let i = 1; i < sh.pts.length; i++) p.lineTo(sh.pts[i][0], sh.pts[i][1]);
      if (sh.closed) p.closePath();
    }
    g.path = p;
    if (o.kind === 'arrow') {
      const h = arrowHead(o); const hp = new Path2D();
      hp.moveTo(h[0][0], h[0][1]); hp.lineTo(h[1][0], h[1][1]); hp.lineTo(h[2][0], h[2][1]); hp.closePath();
      g.head = hp; g.headPts = h;
      g.bbox = bboxOf(sh.pts.concat(h), o.size / 2);
    } else g.bbox = bboxOf(sh.pts, o.size / 2);
  } else if (o.t === 'text') {
    const lines = textLines(o);
    const w = Math.max(4, ...lines.map(l => textWidth(l, o.size)));
    const h = lines.length * o.size * LINE_H;
    g.bbox = { x: o.x, y: o.y, w, h };
  } else if (o.t === 'img') {
    g.bbox = { x: o.x, y: o.y, w: o.w, h: o.h };
  }
  cache.set(o, g);
  return g;
}

export function bboxOf(pts, pad = 0) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of pts) { if (p[0] < x0) x0 = p[0]; if (p[1] < y0) y0 = p[1]; if (p[0] > x1) x1 = p[0]; if (p[1] > y1) y1 = p[1]; }
  if (x0 === Infinity) return { x: 0, y: 0, w: 0, h: 0 };
  return { x: x0 - pad, y: y0 - pad, w: x1 - x0 + pad * 2, h: y1 - y0 + pad * 2 };
}

export function unionBox(objs) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const o of objs) {
    const b = geom(o).bbox;
    x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y); x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h);
  }
  if (x0 === Infinity) return null;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export function drawObj(ctx, o) {
  const g = geom(o);
  ctx.save();
  if (o.t === 'stroke') {
    drawStrokeSegs(ctx, o);
  } else if (o.t === 'shape') {
    ctx.lineWidth = o.size; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.strokeStyle = o.color;
    if (o.fill) { ctx.fillStyle = o.fill; ctx.globalAlpha = 0.35; ctx.fill(g.path); ctx.globalAlpha = 1; }
    ctx.stroke(g.path);
    if (g.head) { ctx.fillStyle = o.color; ctx.fill(g.head); ctx.stroke(g.head); }
  } else if (o.t === 'text') {
    ctx.fillStyle = o.color;
    ctx.font = `${o.size}px ${FONT_STACK}`;
    ctx.textBaseline = 'alphabetic';
    textLines(o).forEach((line, i) => ctx.fillText(line, o.x, o.y + o.size * (0.95 + i * LINE_H)));
  } else if (o.t === 'img') {
    const im = imageFor(o.src);
    if (im.complete && im.naturalWidth) ctx.drawImage(im, o.x, o.y, o.w, o.h);
    else { ctx.fillStyle = '#e8e8e8'; ctx.fillRect(o.x, o.y, o.w, o.h); }
  }
  ctx.restore();
}

// imagens (recortes): decodificadas uma vez; quando terminam de carregar, avisa para redesenhar
const images = new Map();
export const imageHooks = { onLoad: null };
export function imageFor(src) {
  let im = images.get(src);
  if (!im) {
    im = new Image();
    im.onload = () => imageHooks.onLoad?.();
    im.src = src;
    images.set(src, im);
  }
  return im;
}

// ---------- geometria / toque ----------
function distSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const l2 = dx * dx + dy * dy;
  let t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  const x = ax + t * dx, y = ay + t * dy;
  return Math.hypot(px - x, py - y);
}

export function hitObj(o, x, y, r) {
  const g = geom(o);
  const b = g.bbox;
  if (x < b.x - r || x > b.x + b.w + r || y < b.y - r || y > b.y + b.h + r) return false;
  if (o.t === 'stroke') {
    const p = o.pts, rr = r + o.size / 2;
    if (p.length === 1) return Math.hypot(p[0][0] - x, p[0][1] - y) <= rr;
    for (let i = 1; i < p.length; i++) if (distSeg(x, y, p[i - 1][0], p[i - 1][1], p[i][0], p[i][1]) <= rr) return true;
    return false;
  }
  if (o.t === 'shape') {
    const { pts, closed } = g.outline;
    const rr = r + o.size / 2;
    const n = closed ? pts.length : pts.length - 1;
    for (let i = 0; i < n; i++) {
      const a = pts[i], c = pts[(i + 1) % pts.length];
      if (distSeg(x, y, a[0], a[1], c[0], c[1]) <= rr) return true;
    }
    if (o.fill && closed && pointInPoly(x, y, pts)) return true;
    return false;
  }
  return true; // texto e imagem: dentro da caixa
}

export function pointInPoly(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function inLasso(o, poly) {
  let pts;
  if (o.t === 'stroke') pts = o.pts;
  else if (o.t === 'shape') pts = geom(o).outline.pts;
  else { const b = geom(o).bbox; pts = [[b.x + b.w / 2, b.y + b.h / 2]]; }
  const step = Math.max(1, Math.floor(pts.length / 40));
  let n = 0, k = 0;
  for (let i = 0; i < pts.length; i += step) { n++; if (pointInPoly(pts[i][0], pts[i][1], poly)) k++; }
  return n > 0 && k / n >= 0.5;
}

// Novo objeto movido/escalado (objetos são imutáveis: sempre devolve um novo).
export function transformObj(o, dx, dy, s = 1, ox = 0, oy = 0, keepId = true) {
  const X = x => ox + (x - ox) * s + dx;
  const Y = y => oy + (y - oy) * s + dy;
  const n = { ...o, id: keepId ? o.id : newId() };
  if (o.t === 'stroke') { n.pts = o.pts.map(p => [X(p[0]), Y(p[1]), p[2]]); n.size = o.size * s; }
  else if (o.t === 'shape') { n.x1 = X(o.x1); n.y1 = Y(o.y1); n.x2 = X(o.x2); n.y2 = Y(o.y2); n.size = Math.max(0.3, o.size * s); if (o.pts) n.pts = o.pts.map(p => [X(p[0]), Y(p[1])]); if (o.cx != null) { n.cx = X(o.cx); n.cy = Y(o.cy); } }
  else if (o.t === 'text') { n.x = X(o.x); n.y = Y(o.y); n.size = o.size * s; }
  else if (o.t === 'img') { n.x = X(o.x); n.y = Y(o.y); n.w = o.w * s; n.h = o.h * s; }
  return n;
}

// Reduz pontos muito próximos para economizar espaço no arquivo.
export function simplifyPts(pts, minDist = 0.35) {
  if (pts.length < 3) return pts.map(roundPt);
  const out = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    const a = out[out.length - 1], p = pts[i];
    if (Math.hypot(p[0] - a[0], p[1] - a[1]) >= minDist) out.push(p);
  }
  out.push(pts[pts.length - 1]);
  return out.map(roundPt);
}
const roundPt = p => [Math.round(p[0] * 100) / 100, Math.round(p[1] * 100) / 100, Math.round((p[2] ?? 0.5) * 100) / 100];

// ---------- saída PDF ----------
export function hexToRgb(hex) {
  let h = String(hex || '#000').replace('#', '');
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  const n = parseInt(h.slice(0, 6), 16) || 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export const pdfRgb = hex => hexToRgb(hex).map(v => (Math.round((v / 255) * 1000) / 1000).toString()).join(' ');
const f = n => (Math.round(n * 100) / 100).toString();

// Gera operadores PDF para um objeto. `gs(alpha)` devolve o nome do ExtGState de opacidade,
// `font` = { name, encode(text) -> hex } para texto.
export function objPdfOps(o, gs, font, img) {
  const g = geom(o);
  let out = 'q\n';
  if (o.t === 'stroke') {
    const pts = o.pts;
    out += `${pdfRgb(o.color)} RG ${pdfRgb(o.color)} rg 1 J 1 j\n`;
    if (o.tool === 'marker') {
      out += `/${gs(TOOL_STYLE.marker.opacity)} gs ${f(o.size)} w ${f(pts[0][0])} ${f(pts[0][1])} m\n`;
      for (let k = 1; k < pts.length; k++) out += `${f(pts[k][0])} ${f(pts[k][1])} l\n`;
      if (pts.length === 1) out += `${f(pts[0][0] + 0.01)} ${f(pts[0][1])} l\n`;
      out += 'S\n';
    } else {
      // segmentos agrupados por largura (arredondada) para o arquivo não ficar grande
      let curW = null, path = '';
      const flush = () => { if (path) out += `${f(curW)} w ${path}S\n`; path = ''; };
      if (pts.length === 1) out += `${f(strokeWidth(o, pts[0][2]))} w ${f(pts[0][0])} ${f(pts[0][1])} m ${f(pts[0][0] + 0.01)} ${f(pts[0][1])} l S\n`;
      for (let k = 1; k < pts.length; k++) {
        const w = Math.round(strokeWidth(o, (pts[k - 1][2] + pts[k][2]) / 2) * 20) / 20;
        if (w !== curW) { flush(); curW = w; path = `${f(pts[k - 1][0])} ${f(pts[k - 1][1])} m `; }
        path += `${f(pts[k][0])} ${f(pts[k][1])} l `;
      }
      flush();
    }
  } else if (o.t === 'shape') {
    out += `${pdfRgb(o.color)} RG ${f(o.size)} w 1 J 1 j\n`;
    const pathOps = shapePathOps(o, g);
    if (o.fill) out += `q /${gs(0.35)} gs ${pdfRgb(o.fill)} rg\n${pathOps}f\nQ\n`;
    out += pathOps + 'S\n';
    if (g.headPts) {
      const h = g.headPts;
      out += `${pdfRgb(o.color)} rg ${f(h[0][0])} ${f(h[0][1])} m ${f(h[1][0])} ${f(h[1][1])} l ${f(h[2][0])} ${f(h[2][1])} l h B\n`;
    }
  } else if (o.t === 'text' && font) {
    out += `${pdfRgb(o.color)} rg\n`;
    textLines(o).forEach((line, i) => {
      if (!line) return;
      const y = o.y + o.size * (0.95 + i * LINE_H);
      out += `BT /${font.name} ${f(o.size)} Tf 1 0 0 -1 ${f(o.x)} ${f(y)} Tm ${font.encode(line)} Tj ET\n`;
    });
  } else if (o.t === 'img' && img) {
    const name = img(o);
    if (name) out += `${f(o.w)} 0 0 ${f(-o.h)} ${f(o.x)} ${f(o.y + o.h)} cm /${name} Do\n`;
  }
  return out + 'Q\n';
}

function shapePathOps(o, g) {
  if (o.kind === 'ellipse') {
    const l = Math.min(o.x1, o.x2), r = Math.max(o.x1, o.x2), t = Math.min(o.y1, o.y2), b = Math.max(o.y1, o.y2);
    const cx = (l + r) / 2, cy = (t + b) / 2, rx = (r - l) / 2, ry = (b - t) / 2, k = 0.5523;
    return `${f(cx + rx)} ${f(cy)} m\n` +
      `${f(cx + rx)} ${f(cy + ry * k)} ${f(cx + rx * k)} ${f(cy + ry)} ${f(cx)} ${f(cy + ry)} c\n` +
      `${f(cx - rx * k)} ${f(cy + ry)} ${f(cx - rx)} ${f(cy + ry * k)} ${f(cx - rx)} ${f(cy)} c\n` +
      `${f(cx - rx)} ${f(cy - ry * k)} ${f(cx - rx * k)} ${f(cy - ry)} ${f(cx)} ${f(cy - ry)} c\n` +
      `${f(cx + rx * k)} ${f(cy - ry)} ${f(cx + rx)} ${f(cy - ry * k)} ${f(cx + rx)} ${f(cy)} c\nh\n`;
  }
  const { pts, closed } = g.outline;
  let s = `${f(pts[0][0])} ${f(pts[0][1])} m\n`;
  for (let i = 1; i < pts.length; i++) s += `${f(pts[i][0])} ${f(pts[i][1])} l\n`;
  return s + (closed ? 'h\n' : '');
}
