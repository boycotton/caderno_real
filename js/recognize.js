// Reconhecimento de formas: desenhe e segure a caneta parada para virar reta, seta, círculo, elipse,
// retângulo, triângulo ou polígono. Recebe os pontos do traço (coordenadas da página).

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

function distSeg(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  if (!l2) return dist(p, a);
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

function rdp(pts, eps) {
  if (pts.length < 3) return pts.slice();
  let idx = -1, max = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = distSeg(pts[i], pts[0], pts[pts.length - 1]);
    if (d > max) { max = d; idx = i; }
  }
  if (max <= eps) return [pts[0], pts[pts.length - 1]];
  const a = rdp(pts.slice(0, idx + 1), eps), b = rdp(pts.slice(idx), eps);
  return a.slice(0, -1).concat(b);
}

function bbox(P) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of P) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 };
}

const pathLen = P => { let L = 0; for (let i = 1; i < P.length; i++) L += dist(P[i - 1], P[i]); return L; };

// erro médio dos pontos até o contorno fechado do polígono, relativo à diagonal
function polyErr(P, V, diag) {
  let s = 0;
  for (const p of P) {
    let m = Infinity;
    for (let i = 0; i < V.length; i++) m = Math.min(m, distSeg(p, V[i], V[(i + 1) % V.length]));
    s += m;
  }
  return s / P.length / diag;
}

// remove vértices quase alinhados (ângulo perto de 180°) e vértices colados
function cleanPoly(V, diag) {
  let changed = true;
  V = V.slice();
  while (changed && V.length > 3) {
    changed = false;
    for (let i = 0; i < V.length; i++) {
      const a = V[(i - 1 + V.length) % V.length], b = V[i], c = V[(i + 1) % V.length];
      const v1 = [a[0] - b[0], a[1] - b[1]], v2 = [c[0] - b[0], c[1] - b[1]];
      const ang = Math.acos(Math.max(-1, Math.min(1, (v1[0] * v2[0] + v1[1] * v2[1]) / ((Math.hypot(...v1) * Math.hypot(...v2)) || 1))));
      if (ang > Math.PI * 0.82 || dist(a, b) < diag * 0.08) { V.splice(i, 1); changed = true; break; }
    }
  }
  return V;
}

export function recognize(raw) {
  if (!raw || raw.length < 5) return null;
  const P = raw.map(p => [p[0], p[1]]);
  const L = pathLen(P);
  const b = bbox(P);
  const diag = Math.hypot(b.w, b.h);
  if (diag < 20) return null;   // letras pequenas não viram forma
  const a = P[0], z = P[P.length - 1];
  const D = dist(a, z);

  const closed = D < Math.max(diag * 0.22, L * 0.12) && L > diag * 1.6;

  if (!closed) {
    // reta
    let dev = 0;
    for (const p of P) dev = Math.max(dev, distSeg(p, a, z));
    if (D > L * 0.85 && dev < Math.max(2, D * 0.06)) return { kind: 'line', x1: a[0], y1: a[1], x2: z[0], y2: z[1] };
    // seta: haste reta até a ponta e depois as "asas" voltando perto da ponta
    let t = 0, far = 0;
    for (const p of P) far = Math.max(far, dist(a, p));
    t = P.findIndex(p => dist(a, p) >= far * 0.96);
    const tip = P[t];
    if (t > 2 && t < P.length - 2) {
      let sdev = 0;
      for (let i = 0; i <= t; i++) sdev = Math.max(sdev, distSeg(P[i], a, tip));
      const tail = P.slice(t);
      const tailLen = pathLen(tail);
      const nearTip = tail.every(p => dist(p, tip) < far * 0.45);
      if (sdev < far * 0.08 && tailLen > far * 0.08 && tailLen < far * 1.2 && nearTip) return { kind: 'arrow', x1: a[0], y1: a[1], x2: tip[0], y2: tip[1] };
    }
    // curva suave: Bézier que passa pelo início, pelo meio do traço e pelo fim
    return fitCurve(P, L, D);
  }

  // fechado: polígono simplificado
  let V = rdp(P, diag * 0.07);
  if (dist(V[0], V[V.length - 1]) < diag * 0.25) V.pop();
  V = cleanPoly(V, diag);

  // elipse / círculo
  const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2, rx = b.w / 2, ry = b.h / 2;
  let e = 0;
  for (const [x, y] of P) e += Math.abs(Math.hypot((x - cx) / (rx || 1), (y - cy) / (ry || 1)) - 1);
  e /= P.length;

  if (V.length === 3 && polyErr(P, V, diag) < 0.045) return polyShape(V);
  if (V.length === 4 && polyErr(P, V, diag) < 0.045) {
    // quase alinhado aos eixos -> retângulo certinho
    const straight = V.every((v, i) => {
      const w = V[(i + 1) % 4];
      const ang = Math.abs(Math.atan2(w[1] - v[1], w[0] - v[0])) % (Math.PI / 2);
      return ang < 0.21 || ang > Math.PI / 2 - 0.21;
    });
    if (straight) {
      if (Math.abs(b.w - b.h) / Math.max(b.w, b.h) < 0.1) { const s = (b.w + b.h) / 2; return { kind: 'rect', x1: cx - s / 2, y1: cy - s / 2, x2: cx + s / 2, y2: cy + s / 2 }; }
      return { kind: 'rect', x1: b.x0, y1: b.y0, x2: b.x1, y2: b.y1 };
    }
    return polyShape(V);
  }
  if (e < 0.14) {
    if (Math.abs(rx - ry) / Math.max(rx, ry) < 0.15) { const r = (rx + ry) / 2; return { kind: 'ellipse', x1: cx - r, y1: cy - r, x2: cx + r, y2: cy + r }; }
    return { kind: 'ellipse', x1: b.x0, y1: b.y0, x2: b.x1, y2: b.y1 };
  }
  if (V.length >= 5 && V.length <= 8 && polyErr(P, V, diag) < 0.04) return polyShape(V);
  return null;
}

function polyShape(V) {
  const b = bbox(V);
  return { kind: 'poly', pts: V.map(([x, y]) => [Math.round(x * 100) / 100, Math.round(y * 100) / 100]), x1: b.x0, y1: b.y0, x2: b.x1, y2: b.y1 };
}

export function curveCtrl(o) { return [2 * o.cx - (o.x1 + o.x2) / 2, 2 * o.cy - (o.y1 + o.y2) / 2]; }

export function curvePoints(o, n = 32) {
  const [qx, qy] = curveCtrl(o), out = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, u = 1 - t;
    out.push([u * u * o.x1 + 2 * u * t * qx + t * t * o.x2, u * u * o.y1 + 2 * u * t * qy + t * t * o.y2]);
  }
  return out;
}

function fitCurve(P, L, D) {
  if (D < 20 || P.length < 6) return null;
  // ponto do meio pelo comprimento do traço
  let acc = 0, M = P[0];
  for (let i = 1; i < P.length; i++) { acc += dist(P[i - 1], P[i]); if (acc >= L / 2) { M = P[i]; break; } }
  const o = { x1: P[0][0], y1: P[0][1], x2: P[P.length - 1][0], y2: P[P.length - 1][1], cx: M[0], cy: M[1] };
  const S = curvePoints(o, 48);
  let maxE = 0, sumE = 0;
  for (const p of P) {
    let m = Infinity;
    for (let i = 1; i < S.length; i++) m = Math.min(m, distSeg(p, S[i - 1], S[i]));
    maxE = Math.max(maxE, m); sumE += m;
  }
  const ref = Math.max(D, dist(P[0], M) + dist(M, P[P.length - 1]));
  if (maxE > ref * 0.09 || sumE / P.length > ref * 0.035) return null;
  return { kind: 'curve', ...o };
}
