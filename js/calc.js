// Calculadora científica no estilo da Calculadora do Windows 95: janela arrastável por cima da página.
import { h, $, $$ } from './ui.js';

// ---------- avaliação segura (sem eval) ----------
const FN = {
  sin: (x, d) => Math.sin(d ? x * Math.PI / 180 : x), cos: (x, d) => Math.cos(d ? x * Math.PI / 180 : x), tan: (x, d) => Math.tan(d ? x * Math.PI / 180 : x),
  asin: (x, d) => (d ? 180 / Math.PI : 1) * Math.asin(x), acos: (x, d) => (d ? 180 / Math.PI : 1) * Math.acos(x), atan: (x, d) => (d ? 180 / Math.PI : 1) * Math.atan(x),
  sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh,
  ln: Math.log, log: Math.log10, sqrt: Math.sqrt, cbrt: Math.cbrt, abs: Math.abs, exp: Math.exp,
};
const fact = n => { if (n < 0 || n !== Math.floor(n)) return gamma(n + 1); let r = 1; for (let i = 2; i <= n; i++) r *= i; return r; };
function gamma(z) { // Lanczos
  if (z < 0.5) return Math.PI / (Math.sin(Math.PI * z) * gamma(1 - z));
  z -= 1; const g = 7, c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  let x = c[0]; for (let i = 1; i < g + 2; i++) x += c[i] / (z + i);
  const t = z + g + 0.5; return Math.sqrt(2 * Math.PI) * Math.pow(t, z + 0.5) * Math.exp(-t) * x;
}

export function evaluate(src, { deg = true, ans = 0 } = {}) {
  const s = src.replace(/×/g, '*').replace(/÷/g, '/').replace(/−/g, '-').replace(/π/g, 'pi').replace(/√/g, 'sqrt').replace(/,/g, '.');
  let i = 0;
  const peek = () => s[i], ws = () => { while (s[i] === ' ') i++; };
  const num = () => { const m = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i.exec(s.slice(i)); if (!m) return null; i += m[0].length; return parseFloat(m[0]); };
  function primary() {
    ws();
    if (peek() === '(') { i++; const v = expr(); ws(); if (s[i] === ')') i++; return v; }
    if (peek() === '-') { i++; return -power(); }
    if (peek() === '+') { i++; return power(); }
    const n = num(); if (n !== null) return n;
    const m = /^[a-z]+/i.exec(s.slice(i));
    if (m) {
      const w = m[0].toLowerCase(); i += m[0].length;
      if (w === 'pi') return Math.PI;
      if (w === 'e') return Math.E;
      if (w === 'ans') return ans;
      if (FN[w]) { const a = power(); return FN[w](a, deg); }
      throw new Error('?');
    }
    throw new Error('?');
  }
  function postfix() {
    let v = primary();
    for (;;) { ws(); if (s[i] === '!') { i++; v = fact(v); } else if (s[i] === '%') { i++; v /= 100; } else if (s[i] === '²') { i++; v *= v; } else break; }
    return v;
  }
  function power() { const b = postfix(); ws(); if (s[i] === '^') { i++; return Math.pow(b, power()); } return b; }
  function term() {
    let v = power();
    for (;;) {
      ws();
      const c = s[i];
      if (c === '*') { i++; v *= power(); }
      else if (c === '/') { i++; v /= power(); }
      else if (c && /[(a-zπ\d.]/i.test(c)) v *= power();      // multiplicação implícita: 2π, 3(4)
      else break;
    }
    return v;
  }
  function expr() { let v = term(); for (;;) { ws(); if (s[i] === '+') { i++; v += term(); } else if (s[i] === '-') { i++; v -= term(); } else break; } return v; }
  const v = expr(); ws();
  if (i < s.length) throw new Error('?');
  return v;
}

const fmt = v => {
  if (!isFinite(v)) return isNaN(v) ? 'Erro' : (v > 0 ? '∞' : '-∞');
  const a = Math.abs(v);
  let t = (a !== 0 && (a >= 1e12 || a < 1e-9)) ? v.toExponential(8).replace(/\.?0+e/, 'e') : String(+v.toPrecision(12));
  return t.replace('.', ',');
};

// ---------- janela ----------
const KEYS = [
  ['sin', 'cos', 'tan', 'ln', 'log', '(', ')', 'C'],
  ['asin', 'acos', 'atan', '√', 'x²', '7', '8', '9', '÷', '⌫'],
  ['π', 'e', 'x^y', '!', '%', '4', '5', '6', '×', 'Ans'],
  ['sinh', 'cosh', 'tanh', '1/x', '±', '1', '2', '3', '−', '='],
  ['DEG', 'EXP', 'abs', '∛', 'MS', '0', ',', 'MR', '+'],
];
const INS = { 'x²': '²', 'x^y': '^', '√': '√(', '∛': 'cbrt(', 'EXP': 'e', sin: 'sin(', cos: 'cos(', tan: 'tan(', asin: 'asin(', acos: 'acos(', atan: 'atan(', sinh: 'sinh(', cosh: 'cosh(', tanh: 'tanh(', ln: 'ln(', log: 'log(', abs: 'abs(', Ans: 'Ans' };

export class Calculator {
  constructor(host) {
    this.host = host; this.el = null; this.expr = ''; this.ans = 0; this.mem = 0; this.deg = true; this.fresh = false;
  }
  toggle() { if (this.el && !this.el.hidden) this.close(); else this.open(); }
  close() { if (this.el) this.el.hidden = true; }
  open() {
    if (!this.el) this.build();
    this.el.hidden = false;
    this.paint();
  }
  build() {
    const el = h(`<div class="calc window" hidden>
      <div class="win-title calc-title"><span class="win-title-text">Calculadora</span><span class="win-ctrls"><button class="calc-x" title="Fechar">×</button></span></div>
      <div class="calc-body">
        <div class="calc-lcd"><div class="calc-expr"></div><div class="calc-out">0</div><div class="calc-flags"><span class="calc-deg">DEG</span><span class="calc-m"></span></div></div>
        <div class="calc-keys"></div>
      </div></div>`);
    const keys = $('.calc-keys', el);
    KEYS.flat().forEach(k => {
      const b = h(`<button class="ck ${/^[0-9,]$/.test(k) ? 'num' : ''} ${['÷', '×', '−', '+', '='].includes(k) ? 'op' : ''} ${['C', '⌫'].includes(k) ? 'red' : ''}">${k}</button>`);
      b.onclick = () => this.key(k);
      keys.appendChild(b);
    });
    $('.calc-x', el).onclick = () => this.close();
    // arrastar pela barra de título
    const t = $('.calc-title', el);
    t.addEventListener('pointerdown', e => {
      if (e.target.closest('button')) return;
      const r = el.getBoundingClientRect(), hr = this.host.getBoundingClientRect();
      const ox = e.clientX - r.left, oy = e.clientY - r.top;
      t.setPointerCapture(e.pointerId);
      const mv = ev => {
        el.style.left = Math.max(0, Math.min(hr.width - r.width, ev.clientX - hr.left - ox)) + 'px';
        el.style.top = Math.max(0, Math.min(hr.height - 40, ev.clientY - hr.top - oy)) + 'px';
        el.style.right = 'auto';
      };
      const up = () => { t.removeEventListener('pointermove', mv); t.removeEventListener('pointerup', up); };
      t.addEventListener('pointermove', mv); t.addEventListener('pointerup', up);
    });
    el.addEventListener('pointerdown', e => e.stopPropagation());
    this.host.appendChild(el);
    this.el = el;
  }
  key(k) {
    if (k === 'C') { this.expr = ''; this.out = '0'; }
    else if (k === '⌫') { this.expr = this.expr.replace(/(asin\(|acos\(|atan\(|sinh\(|cosh\(|tanh\(|sin\(|cos\(|tan\(|ln\(|log\(|abs\(|cbrt\(|√\(|Ans|.)$/, ''); }
    else if (k === '=') {
      try { const v = evaluate(this.expr || '0', { deg: this.deg, ans: this.ans }); this.ans = v; this.out = fmt(v); this.last = this.expr; this.expr = ''; this.fresh = true; }
      catch { this.out = 'Erro'; }
      return this.paint();
    }
    else if (k === 'DEG') { this.deg = !this.deg; }
    else if (k === 'MS') { this.mem = this.ans; }
    else if (k === 'MR') { this.expr += String(this.mem).replace('.', ','); }
    else if (k === '±') { this.expr = this.expr ? `-(${this.expr})` : '-'; }
    else if (k === '1/x') { this.expr = this.expr ? `1/(${this.expr})` : (this.fresh ? '1/Ans' : '1/'); }
    else {
      const ins = INS[k] ?? k;
      if (this.fresh && /^[²^÷×−+!%]/.test(ins)) this.expr = 'Ans';
      this.expr += ins;
    }
    this.fresh = false;
    this.paint();
  }
  paint() {
    const e = this.el;
    const ex = this.expr || (this.last ? this.last + ' =' : '');
    $('.calc-expr', e).textContent = ex.length > 34 ? '…' + ex.slice(-33) : ex;
    $('.calc-out', e).textContent = this.expr ? this.preview() : (this.out || '0');
    $('.calc-deg', e).textContent = this.deg ? 'DEG' : 'RAD';
    $('.calc-m', e).textContent = this.mem ? 'M' : '';
    $$('.ck', e).find(b => b.textContent === 'DEG' || b.textContent === 'RAD').textContent = this.deg ? 'DEG' : 'RAD';
  }
  preview() { try { return fmt(evaluate(this.expr, { deg: this.deg, ans: this.ans })); } catch { return '…'; } }
}
