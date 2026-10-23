// Modelos de página (fundo das folhas). Usados tanto para desenhar no canvas
// quanto para gravar no PDF, então o resultado é idêntico nos dois lugares.

export const MM = 72 / 25.4; // pontos PDF por milímetro
export const A4 = { w: 595.28, h: 841.89 };

export const PAPERS = {
  creme:   { nome: 'Creme (como o exemplo)', bg: '#FFECB3', line: '#D8CDAA', dot: '#B9AC85', margin: '#F0A08A' },
  branco:  { nome: 'Branco',                 bg: '#FFFFFF', line: '#D3DAE3', dot: '#A9B3C0', margin: '#F2A7A7' },
  amarelo: { nome: 'Amarelo claro',          bg: '#FFF8DC', line: '#E2D7B0', dot: '#BFB48C', margin: '#F0A8A0' },
  verde:   { nome: 'Verde suave',            bg: '#EAF4E6', line: '#C5D8BF', dot: '#9DB596', margin: '#E5A9A1' },
  azul:    { nome: 'Azul suave',             bg: '#EAF1FA', line: '#C6D4E8', dot: '#98AACB', margin: '#E9A9A9' },
  escuro:  { nome: 'Escuro',                 bg: '#26272B', line: '#3E4047', dot: '#5A5D66', margin: '#7A4A4A' },
};

export const KINDS = {
  grid:   'Quadriculado',
  lines:  'Pautado',
  dots:   'Pontilhado',
  graph:  'Milimetrado',
  cornell:'Cornell',
  blank:  'Em branco',
};

// 8,6 mm reproduz o quadriculado do PDF de exemplo (30,5 pt numa folha de 743,5 pt).
export const SPACINGS = [5, 6, 7, 8.6, 10];

export const DEFAULT_TPL = { kind: 'grid', paper: 'creme', spacing: 8.6, orient: 'portrait' };

export function pageSize(tpl) {
  return tpl.orient === 'landscape' ? { w: A4.h, h: A4.w } : { w: A4.w, h: A4.h };
}

export function tplLabel(tpl) {
  const k = KINDS[tpl.kind] || tpl.kind;
  const p = (PAPERS[tpl.paper] || PAPERS.branco).nome.split(' (')[0];
  const s = ['grid', 'lines', 'dots', 'cornell'].includes(tpl.kind) ? ` ${String(tpl.spacing).replace('.', ',')} mm` : '';
  return `${k}${s} · ${p}`;
}

// Gera a lista de primitivas do modelo: retângulos, linhas e pontos,
// em coordenadas de página (pt, origem no canto superior esquerdo).
export function templateOps(tpl, w, h) {
  const paper = PAPERS[tpl.paper] || PAPERS.branco;
  const s = (tpl.spacing || 8.6) * MM;
  const ops = [{ t: 'rect', x: 0, y: 0, w, h, color: paper.bg }];
  const lw = 0.75;
  const line = (x1, y1, x2, y2, color = paper.line, width = lw) => ops.push({ t: 'line', x1, y1, x2, y2, color, w: width });

  switch (tpl.kind) {
    case 'grid':
      for (let x = 0; x <= w + 0.01; x += s) line(x, 0, x, h);
      for (let y = 0; y <= h + 0.01; y += s) line(0, y, w, y);
      break;
    case 'lines': {
      for (let y = s * 3; y <= h - s * 0.5; y += s) line(0, y, w, y);
      line(25 * MM, 0, 25 * MM, h, paper.margin, 0.9);
      break;
    }
    case 'dots':
      for (let y = s; y < h; y += s)
        for (let x = s; x < w; x += s) ops.push({ t: 'dot', x, y, r: 0.85, color: paper.dot });
      break;
    case 'graph': {
      const m = MM;
      for (let i = 0, x = 0; x <= w + 0.01; i++, x = i * m) {
        const major = i % 10 === 0, mid = i % 5 === 0;
        line(x, 0, x, h, major || mid ? paper.dot : paper.line, major ? 0.8 : mid ? 0.5 : 0.25);
      }
      for (let i = 0, y = 0; y <= h + 0.01; i++, y = i * m) {
        const major = i % 10 === 0, mid = i % 5 === 0;
        line(0, y, w, y, major || mid ? paper.dot : paper.line, major ? 0.8 : mid ? 0.5 : 0.25);
      }
      break;
    }
    case 'cornell': {
      const top = 30 * MM, bottom = h - 50 * MM, col = 60 * MM;
      for (let y = top + s; y < bottom; y += s) line(0, y, w, y);
      line(0, top, w, top, paper.dot, 1.2);
      line(col, top, col, bottom, paper.margin, 1.2);
      line(0, bottom, w, bottom, paper.dot, 1.2);
      break;
    }
    default: break; // em branco
  }
  return ops;
}

export function drawTemplateCanvas(ctx, tpl, w, h) {
  for (const op of templateOps(tpl, w, h)) {
    if (op.t === 'rect') { ctx.fillStyle = op.color; ctx.fillRect(op.x, op.y, op.w, op.h); }
  }
  // Agrupa linhas por cor/espessura para desenhar rápido
  const groups = new Map();
  const dots = new Map();
  for (const op of templateOps(tpl, w, h)) {
    if (op.t === 'line') {
      const k = op.color + '|' + op.w;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(op);
    } else if (op.t === 'dot') {
      if (!dots.has(op.color)) dots.set(op.color, []);
      dots.get(op.color).push(op);
    }
  }
  for (const [k, list] of groups) {
    const [color, width] = k.split('|');
    ctx.strokeStyle = color; ctx.lineWidth = +width; ctx.beginPath();
    for (const l of list) { ctx.moveTo(l.x1, l.y1); ctx.lineTo(l.x2, l.y2); }
    ctx.stroke();
  }
  for (const [color, list] of dots) {
    ctx.fillStyle = color; ctx.beginPath();
    for (const d of list) { ctx.moveTo(d.x + d.r, d.y); ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2); }
    ctx.fill();
  }
}

// Operadores de conteúdo PDF (coordenadas já com o eixo Y invertido pelo "cm" do chamador).
export function templatePdfOps(tpl, w, h, rgb) {
  const ops = templateOps(tpl, w, h);
  const f = n => (Math.round(n * 100) / 100).toString();
  let out = '';
  const groups = new Map();
  const dots = new Map();
  for (const op of ops) {
    if (op.t === 'rect') out += `${rgb(op.color)} rg ${f(op.x)} ${f(op.y)} ${f(op.w)} ${f(op.h)} re f\n`;
    else if (op.t === 'line') {
      const k = op.color + '|' + op.w;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(op);
    } else if (op.t === 'dot') {
      if (!dots.has(op.color)) dots.set(op.color, []);
      dots.get(op.color).push(op);
    }
  }
  for (const [k, list] of groups) {
    const [color, width] = k.split('|');
    out += `${rgb(color)} RG ${f(+width)} w 0 J\n`;
    for (const l of list) out += `${f(l.x1)} ${f(l.y1)} m ${f(l.x2)} ${f(l.y2)} l\n`;
    out += 'S\n';
  }
  for (const [color, list] of dots) {
    out += `${rgb(color)} rg\n`;
    for (const d of list) {
      const s = d.r * 2;
      out += `${f(d.x - d.r)} ${f(d.y - d.r)} ${f(s)} ${f(s)} re\n`;
    }
    out += 'f\n';
  }
  return out;
}
