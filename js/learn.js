// Modo あ (aprender língua): encostar/pairar a S Pen numa palavra japonesa do PDF mostra a definição,
// no estilo Rikaikun. Usa só o texto que já existe no PDF (sem OCR).
import { lookup, kanjiInfo, isKanji } from './jdict.js';
import { esc } from './ui.js';

const mul = (m, n) => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
// posição de cada caractere dentro do trecho: largos = 1 quadratim, estreitos = meio;
// os espaços que o pdf.js insere nas lacunas ficam com a sobra da largura
function charPos(it) {
  if (it._pos) return it._pos;
  const arr = [...it.str], L = it.vert ? it.h : it.w, em = it.fh;
  const wide = ch => /[\u2e80-\u9fff\uf900-\ufaff\uff00-\uffef\u3000-\u303f\u3040-\u30ff]/.test(ch);
  const fixed = arr.map(ch => ch === ' ' ? 0 : wide(ch) ? em : em * 0.5);
  const sum = fixed.reduce((a, b) => a + b, 0), spaces = arr.filter(c => c === ' ').length;
  let scale = 1, sp = 0;
  if (spaces && L > sum) sp = (L - sum) / spaces; else if (sum > 0) scale = L / sum;
  let o = 0;
  it._pos = arr.map((ch, i) => { const w = ch === ' ' ? sp : fixed[i] * scale; const r = { ch, o, w }; o += w; return r; });
  return it._pos;
}
const norm = s => [...s].map(ch => { if (ch === '\u3000') return ch; const n = ch.normalize('NFKC'); return n.length === 1 ? n : ch; }).join('');

export class Learn {
  constructor(ed, stage) {
    this.ed = ed;
    this.stage = stage;
    this.cache = new WeakMap();
    this.pop = document.createElement('div');
    this.pop.className = 'jp-pop';
    this.pop.hidden = true;
    stage.appendChild(this.pop);
    this.pop.addEventListener('pointerdown', e => { e.stopPropagation(); this.hide(); });
    this.seq = 0;
    this.lastKey = '';
    this.warned = false;
  }

  async items(doc, p) {
    if (p.src?.t !== 'pdf' || !doc?.pdf) return null;
    let byPage = this.cache.get(doc);
    if (!byPage) { byPage = new Map(); this.cache.set(doc, byPage); }
    if (!byPage.has(p.src.i)) byPage.set(p.src.i, (async () => {
      const pg = await doc.pdf.getPage(p.src.i + 1);
      const tc = await pg.getTextContent();
      const m = p.m || pg.getViewport({ scale: 1 }).transform;
      const sx = Math.hypot(m[0], m[1]);
      const out = [];
      for (const it of tc.items) {
        if (!it.str || !it.str.trim()) continue;
        const tx = mul(m, it.transform);
        const fh = Math.hypot(tx[2], tx[3]) || 10;
        const vert = !!tc.styles[it.fontName]?.vertical;
        const str = norm(it.str);
        const box = vert
          ? { x: tx[4] - fh / 2, y: tx[5], w: fh, h: Math.max(fh, (it.height || fh * str.length) * sx) }
          : { x: tx[4], y: tx[5] - fh * 0.88, w: Math.max(fh * 0.5, it.width * sx), h: fh * 1.1 };
        out.push({ str, fh, vert, ...box });
      }
      return out;
    })());
    return byPage.get(p.src.i);
  }

  // Texto a partir do ponto tocado + posição de cada caractere (para sublinhar)
  async textAt(doc, p, pt) {
    const items = await this.items(doc, p);
    if (!items) return null;
    let k = -1, best = Infinity;
    items.forEach((it, i) => {
      const pad = it.fh * 0.15;
      if (pt.x < it.x - pad || pt.x > it.x + it.w + pad || pt.y < it.y - pad || pt.y > it.y + it.h + pad) return;
      const score = -it.fh;            // texto base vence o furigana
      if (score < best) { best = score; k = i; }
    });
    if (k < 0) return { items, none: true };
    const it = items[k];
    const pos = charPos(it);
    const rel = it.vert ? pt.y - it.y : pt.x - it.x;
    let idx = pos.findIndex(c => rel < c.o + c.w);
    if (idx < 0) idx = pos.length - 1;
    while (idx > 0 && pos[idx].ch === ' ') idx--;
    const chars = [];
    const push = (item, from) => {
      const P = charPos(item);
      for (let j = from; j < P.length && chars.length < 20; j++) {
        const c = P[j];
        if (c.ch === ' ') continue;
        chars.push({ ch: c.ch, r: item.vert ? { x: item.x, y: item.y + c.o, w: item.w, h: c.w } : { x: item.x + c.o, y: item.y, w: c.w, h: item.h } });
      }
    };
    push(it, idx);
    for (let j = k + 1; j < items.length && chars.length < 20; j++) {
      if (items[j].fh < it.fh * 0.7) continue;    // pula furigana
      if (Math.abs(items[j].fh - it.fh) > it.fh * 0.4) break;
      push(items[j], 0);
    }
    return { chars, text: chars.map(c => c.ch).join('') };
  }

  async at(doc, pageIndex, p, pt, anchor, { sticky = false } = {}) {
    const seq = ++this.seq;
    const t = await this.textAt(doc, p, pt);
    if (seq !== this.seq) return;
    if (!t) {
      if (!this.warned) { this.warned = true; this.ed.hooks.onToast?.('Esta página não tem texto do PDF (é imagem ou anotação).'); }
      return this.hide();
    }
    if (t.none || !t.text) { if (!sticky) this.hide(); return; }
    const key = pageIndex + ':' + t.text;
    if (key === this.lastKey && !this.pop.hidden) return;
    let r;
    try { r = await lookup(t.text); } catch (e) { this.ed.hooks.onToast?.('Não foi possível carregar o dicionário (' + e.message + ').'); return; }
    if (seq !== this.seq) return;
    if (!r.len) { if (!sticky) this.hide(); return; }
    this.lastKey = key;
    this.ed.drawHighlight(pageIndex, t.chars.slice(0, r.len).map(c => c.r));
    const kj = [...new Set([...t.text.slice(0, r.len)].filter(isKanji))].slice(0, 4);
    const infos = (await Promise.all(kj.map(kanjiInfo))).filter(Boolean);
    if (seq !== this.seq) return;
    this.render(r, infos);
    this.place(anchor);
  }

  render(r, infos) {
    const words = r.entries.map(e => {
      const head = e.kanji.length ? `<span class="jp-w">${esc(e.kanji.slice(0, 2).join('、'))}</span><span class="jp-r">【${esc(e.kana.slice(0, 2).join('、'))}】</span>` : `<span class="jp-w">${esc(e.kana.slice(0, 2).join('、'))}</span>`;
      const why = e.why.length ? `<span class="jp-why">« ${esc(e.why.slice().reverse().join(' « '))}</span>` : '';
      const senses = e.senses.slice(0, 4).map((s, i) => `<li>${s[0] ? `<i>${esc(s[0])}</i> ` : ''}${esc(s[1])}</li>`).join('');
      return `<div class="jp-e">${head}${e.common ? '<span class="jp-c">comum</span>' : ''}${why}<ol>${senses}</ol></div>`;
    }).join('');
    const kanji = infos.map(k => `<div class="jp-k"><div class="jp-kc">${esc(k.ch)}</div><div class="jp-kd">
      <b>${esc((k.pt.length ? k.pt : k.en).slice(0, 5).join(', '))}</b>
      ${k.on.length ? `<div>on: ${esc(k.on.slice(0, 4).join('、'))}</div>` : ''}
      ${k.kun.length ? `<div>kun: ${esc(k.kun.slice(0, 4).join('、'))}</div>` : ''}
      <div class="jp-meta">${k.strokes} traços${k.jlpt ? ` · JLPT N${k.jlpt === 4 ? '4/5' : k.jlpt}` : ''}${k.grade ? ` · ${k.grade <= 6 ? k.grade + 'º ano' : 'jōyō'}` : ''}</div></div></div>`).join('');
    this.pop.innerHTML = words + (kanji ? `<div class="jp-ks">${kanji}</div>` : '');
    this.pop.hidden = false;
  }

  place(a) {
    const W = this.stage.clientWidth, H = this.stage.clientHeight;
    const pw = Math.min(380, W - 16);
    this.pop.style.width = pw + 'px';
    const ph = this.pop.offsetHeight;
    let x = Math.min(Math.max(8, a.x - pw / 2), W - pw - 8);
    let y = a.y + a.h + 10;
    if (y + ph > H - 8) y = Math.max(8, a.y - ph - 10);
    this.pop.style.left = x + 'px'; this.pop.style.top = y + 'px';
  }

  hide() {
    this.seq++;
    this.lastKey = '';
    this.pop.hidden = true;
    this.ed.drawHighlight(-1, []);
  }
}
