// Editor de páginas: exibição, zoom, ferramentas e entrada da S Pen.
import { drawObj, geom, hitObj, inLasso, transformObj, unionBox, simplifyPts, newId, TOOL_STYLE, imageHooks, drawStrokeSegs } from './ink.js';
import { drawTemplateCanvas } from './templates.js';
import { recognize } from './recognize.js';
import { prefs, setPref } from './store.js';

const GAP = 18, PAD = 18;
const MAXPX = 6e6;          // limite de pixels por canvas (memória do tablet; acima disso o Android pinta de preto)
const UNDO_MAX = 250;

export const DEFAULT_CFG = {
  pen:    { color: '#1a1a1a', size: 2.2 },
  pencil: { color: '#4a4a4a', size: 1.6 },
  marker: { color: '#ffd400', size: 14 },
  shape:  { color: '#1a1a1a', size: 1.6, kind: 'rect', fill: null },
  text:   { color: '#1a1a1a', size: 14 },
  eraser: { size: 16 },
};

export class Editor {
  constructor(root, hooks = {}) {
    this.root = root;
    this.hooks = hooks;
    this.stage = root.querySelector('#stage');
    this.viewer = root.querySelector('#viewer');
    this.sheet = root.querySelector('#sheet');
    this.overlay = root.querySelector('#overlay');
    // sem 'desynchronized': em tablets Android esse modo deixa o fundo transparente preto
    this.octx = this.overlay.getContext('2d');
    this.doc = null;
    this.views = new Map();
    this.layout = [];
    this.zoom = 1;
    this.fitMode = true;
    this.tool = 'pen';
    const saved = prefs().toolCfg || {};
    this.cfg = {};
    for (const k in DEFAULT_CFG) this.cfg[k] = { ...DEFAULT_CFG[k], ...(saved[k] || {}) };
    this.undoStack = []; this.redoStack = [];
    this.sel = null;
    this.clip = null;
    try { this.clip = JSON.parse(localStorage.getItem('caderno.clip')); } catch {}
    this.stamp = null;               // conteúdo do modo "colar/carimbo"
    this.penOnly = prefs().penOnly ?? false;
    this.shapeAssist = !!prefs().shapeAssist;
    this.ptrs = new Map();
    this.gesture = null;
    this.activePen = null;
    this.textEd = null;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.penSeen = 0;
    this._bind();
    imageHooks.onLoad = () => this.refreshAll();
    // o Android descarta a memória dos canvas quando o app vai para segundo plano: redesenha ao voltar
    document.addEventListener('visibilitychange', () => { if (!document.hidden) { this._resetOverlay(); this.refreshAll(); } });
    this.overlay.addEventListener('contextrestored', () => this._clearOverlay());
    new ResizeObserver(() => this._onResize()).observe(this.viewer);
  }

  // ---------------- documento ----------------
  setDoc(doc, { keepView = false } = {}) {
    const prev = keepView ? { top: this.viewer.scrollTop, left: this.viewer.scrollLeft, zoom: this.zoom, fit: this.fitMode } : null;
    this._closeText(true);
    this.clearSelection();
    this._endShapeEdit();
    for (const v of this.views.values()) this._dropView(v, true);
    this.views.clear();
    this.sheet.innerHTML = '';
    this.doc = doc;
    if (!keepView) { this.undoStack = []; this.redoStack = []; this.fitMode = true; }
    this._relayout();
    if (prev) {
      if (!prev.fit) { this.zoom = prev.zoom; this.fitMode = false; this._relayout(); }
      this.viewer.scrollTop = prev.top; this.viewer.scrollLeft = prev.left;
    } else { this.viewer.scrollTop = 0; this.viewer.scrollLeft = 0; }
    this._scheduleRender();
    this._emitPage();
    this.hooks.onHistory?.();
  }

  get pages() { return this.doc?.pages || []; }
  pageById(id) { return this.pages.find(p => p.id === id); }

  currentPageIndex() {
    if (!this.layout.length) return 0;
    const mid = this.viewer.scrollTop + this.viewer.clientHeight * 0.4;
    for (let i = 0; i < this.layout.length; i++) if (this.layout[i].y + this.layout[i].h + GAP / 2 >= mid) return i;
    return this.layout.length - 1;
  }

  scrollToPage(i, smooth = false) {
    const L = this.layout[i];
    if (!L) return;
    this.viewer.scrollTo({ top: L.y - PAD, behavior: smooth ? 'smooth' : 'auto' });
  }

  // ---------------- layout e zoom ----------------
  _fitZoom() {
    const maxW = Math.max(100, ...this.pages.map(p => p.w));
    const vw = this.viewer.clientWidth || 800;
    return Math.max(0.1, (vw - PAD * 2) / maxW);
  }

  _relayout() {
    const pages = this.pages;
    const fit = this._fitZoom();
    if (this.fitMode) this.zoom = fit;
    const z = this.zoom;
    if (this._lastZ !== z) { this._lastZ = z; for (const v of this.views.values()) this._dropDetail(v); }
    const vw = this.viewer.clientWidth || 800;
    const maxW = Math.max(100, ...pages.map(p => p.w));
    const contentW = Math.max(vw, maxW * z + PAD * 2);
    let y = PAD;
    this.layout = pages.map(p => {
      const w = p.w * z, h = p.h * z;
      const L = { x: (contentW - w) / 2, y, w, h };
      y += h + GAP;
      return L;
    });
    const contentH = Math.max(y - GAP + PAD, this.viewer.clientHeight);
    this.sheet.style.width = contentW + 'px';
    this.sheet.style.height = contentH + 'px';

    // cria/atualiza os elementos de página
    const alive = new Set();
    pages.forEach((p, i) => {
      let v = this.views.get(p.id);
      if (!v) {
        const el = document.createElement('div');
        el.className = 'page';
        el.style.background = p.src.t === 'tpl' ? '#fff' : '#fff';
        this.sheet.appendChild(el);
        v = { page: p, el, base: null, ink: null, baseZoom: 0, inkZoom: 0, inkDirty: true, busy: false };
        this.views.set(p.id, v);
      }
      v.page = p; v.index = i;
      alive.add(p.id);
      const L = this.layout[i];
      v.el.style.left = L.x + 'px'; v.el.style.top = L.y + 'px';
      v.el.style.width = L.w + 'px'; v.el.style.height = L.h + 'px';
      v.el.dataset.i = i;
    });
    for (const [id, v] of this.views) if (!alive.has(id)) { this._dropView(v, true); v.el.remove(); this.views.delete(id); }
    this._placeSelection();
    this._placeText();
    this._placeShapeEdit();
  }

  _onResize() {
    const w = this.viewer.clientWidth, hgt = this.viewer.clientHeight;
    if (w === this._vw && hgt === this._vh) return;      // nada mudou: não apaga a camada do traço
    this._vw = w; this._vh = hgt;
    this.overlay.width = Math.round(w * this.dpr);
    this.overlay.height = Math.round(hgt * this.dpr);
    this.overlay.style.width = w + 'px';
    this.overlay.style.height = hgt + 'px';
    if (!this.doc) return;
    if (this.textEd) return; // teclado abrindo: não mexe no zoom
    const idx = this.currentPageIndex();
    const L = this.layout[idx];
    const rel = L ? (this.viewer.scrollTop - L.y) / L.h : 0;
    this._relayout();
    const L2 = this.layout[idx];
    if (L2) this.viewer.scrollTop = L2.y + rel * L2.h;
    this._scheduleRender();
  }

  fitWidth() {
    const idx = this.currentPageIndex();
    this.fitMode = true;
    this._relayout();
    this.scrollToPage(idx);
    this._scheduleRender();
    this.hooks.onZoom?.(this.zoomPercent());
  }

  zoomPercent() { return Math.round((this.zoom / this._fitZoom()) * 100); }

  // muda o zoom mantendo fixo o ponto (mx,my) da tela (coords locais do viewer)
  setZoom(newZoom, mx = this.viewer.clientWidth / 2, my = this.viewer.clientHeight / 2) {
    const fit = this._fitZoom();
    newZoom = Math.max(fit * 0.35, Math.min(fit * 6, newZoom));
    const cx = mx + this.viewer.scrollLeft, cy = my + this.viewer.scrollTop;
    const hit = this._nearestPage(cx, cy);
    const old = this.zoom;
    let px = 0, py = 0;
    if (hit) { const L = this.layout[hit.i]; px = (cx - L.x) / old; py = (cy - L.y) / old; }
    this.fitMode = Math.abs(newZoom - fit) / fit < 0.03;
    this.zoom = this.fitMode ? fit : newZoom;
    this._relayout();
    if (hit) {
      const L = this.layout[hit.i];
      this.viewer.scrollLeft = L.x + px * this.zoom - mx;
      this.viewer.scrollTop = L.y + py * this.zoom - my;
    }
    this._scheduleRender();
    this.hooks.onZoom?.(this.zoomPercent());
  }

  _nearestPage(cx, cy) {
    let best = null;
    this.layout.forEach((L, i) => {
      const dy = cy < L.y ? L.y - cy : cy > L.y + L.h ? cy - (L.y + L.h) : 0;
      if (!best || dy < best.d) best = { i, d: dy };
    });
    return best;
  }

  // ---------------- renderização ----------------
  _scheduleRender() {
    if (this._rq) return;
    this._rq = requestAnimationFrame(() => { this._rq = 0; this._renderVisible(); });
  }

  _pxRatio(p) {
    return Math.min(this.dpr * this.zoom, Math.sqrt(MAXPX / (p.w * p.h)));
  }

  async _renderVisible() {
    if (!this.doc) return;
    const top = this.viewer.scrollTop, vh = this.viewer.clientHeight;
    const near = [], keep = new Set();
    this.layout.forEach((L, i) => {
      const p = this.pages[i];
      if (L.y + L.h >= top - vh * 0.6 && L.y <= top + vh * 1.6) near.push(i);
      if (L.y + L.h >= top - vh * 1.2 && L.y <= top + vh * 2.2) keep.add(p.id);
    });
    // libera memória das páginas distantes
    for (const v of this.views.values()) if (!keep.has(v.page.id)) this._dropView(v);
    // primeiro as páginas na tela
    near.sort((a, b) => Math.abs(this.layout[a].y - top) - Math.abs(this.layout[b].y - top));
    for (const i of near) {
      const v = this.views.get(this.pages[i].id);
      if (!v) continue;
      if (v.inkZoom !== this.zoom || v.inkDirty) this._renderInk(v);
      if (v.baseZoom !== this.zoom && !v.busy) await this._renderBase(v);
    }
    this._scheduleDetail();
  }

  // ---------- camada de detalhe: com zoom alto, a parte visível da página é redesenhada em resolução total ----------
  _scheduleDetail() {
    clearTimeout(this._dtT);
    this._dtT = setTimeout(() => this._renderDetails(), 140);
  }

  async _renderDetails() {
    if (!this.doc || this.gesture?.kind === 'nav') return;
    const top = this.viewer.scrollTop, left = this.viewer.scrollLeft, vw = this.viewer.clientWidth, vh = this.viewer.clientHeight;
    for (const [i, L] of this.layout.entries()) {
      const p = this.pages[i], v = this.views.get(p.id);
      if (!v || v.dead) continue;
      const vis = L.y + L.h > top && L.y < top + vh && L.x + L.w > left && L.x < left + vw;
      const need = this._pxRatio(p) < this.dpr * this.zoom * 0.99;
      if (!vis || !need) { this._dropDetail(v); continue; }
      const z = this.zoom, s = this.dpr * z;
      const mx = vw * 0.15, my = vh * 0.15;
      const x0 = Math.max(0, (left - mx - L.x) / z), y0 = Math.max(0, (top - my - L.y) / z);
      const x1 = Math.min(p.w, (left + vw + mx - L.x) / z), y1 = Math.min(p.h, (top + vh + my - L.y) / z);
      if (x1 <= x0 || y1 <= y0) continue;
      const d = v.dt;
      if (d && d.z === z && d.x <= x0 + 0.5 && d.y <= y0 + 0.5 && d.x + d.w >= x1 - 0.5 && d.y + d.h >= y1 - 0.5) continue;  // já cobre
      const seq = (v.dtSeq = (v.dtSeq || 0) + 1);
      const base = await this.renderRegion(p, { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, s, { ink: false });
      if (!base || v.dead || v.dtSeq !== seq || this.zoom !== z) continue;
      let c = v.dt?.c;
      if (!c) { c = document.createElement('canvas'); c.className = 'detail'; v.el.appendChild(c); }
      c.width = base.width; c.height = base.height;
      c.style.left = x0 * z + 'px'; c.style.top = y0 * z + 'px'; c.style.width = (x1 - x0) * z + 'px'; c.style.height = (y1 - y0) * z + 'px';
      v.dt = { c, base, x: x0, y: y0, w: x1 - x0, h: y1 - y0, s, z };
      this._composeDetail(v);
    }
  }

  _composeDetail(v) {
    const d = v.dt;
    if (!d) return;
    const ctx = d.c.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(d.base, 0, 0);
    ctx.setTransform(d.s, 0, 0, d.s, -d.x * d.s, -d.y * d.s);
    const hide = this.sel?.moving && this.sel.pageId === v.page.id ? this.sel.ids : null;
    for (const o of v.page.objs) if (!hide || !hide.has(o.id)) drawObj(ctx, o);
  }

  _dropDetail(v) {
    if (!v.dt) return;
    v.dt.c.width = 0; v.dt.c.remove(); v.dt.base.width = 0; v.dt = null;
  }

  // Desenha um pedaço da página (fundo + anotações) num canvas, em `scale` pixels por ponto.
  async renderRegion(p, r, scale, { ink = true } = {}) {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(r.w * scale)); c.height = Math.max(1, Math.round(r.h * scale));
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    try {
      if (p.src.t === 'tpl' || !this.doc?.pdf) {
        ctx.setTransform(scale, 0, 0, scale, -r.x * scale, -r.y * scale);
        if (p.tpl) drawTemplateCanvas(ctx, p.tpl, p.w, p.h);
      } else {
        const pg = await this.doc.pdf.getPage(p.src.i + 1);
        const vp = pg.getViewport({ scale });
        const params = { canvasContext: ctx, viewport: vp, transform: [1, 0, 0, 1, -r.x * scale, -r.y * scale] };
        if (this.doc.ocConfig) params.optionalContentConfigPromise = Promise.resolve(this.doc.ocConfig);
        await pg.render(params).promise;
      }
    } catch (e) { if (e?.name !== 'RenderingCancelledException') console.warn('falha ao desenhar trecho', e); return null; }
    if (ink) {
      ctx.setTransform(scale, 0, 0, scale, -r.x * scale, -r.y * scale);
      for (const o of p.objs) drawObj(ctx, o);
    }
    return c;
  }

  _dropView(v, hard = false) {
    if (v.task) { try { v.task.cancel(); } catch {} v.task = null; }
    for (const k of ['base', 'ink']) if (v[k]) { v[k].width = 0; v[k].height = 0; v[k].remove(); v[k] = null; }
    this._dropDetail(v);
    v.baseZoom = 0; v.inkZoom = 0; v.inkDirty = true; v.busy = false;
    if (hard) v.dead = true;
  }

  async _renderBase(v) {
    const p = v.page;
    const z = this.zoom;
    const pr = this._pxRatio(p);
    v.busy = true;
    const c = document.createElement('canvas');
    c.className = 'base';
    this._watchLoss(c, v);
    c.width = Math.max(1, Math.floor(p.w * pr));
    c.height = Math.max(1, Math.floor(p.h * pr));
    const ctx = c.getContext('2d');
    try {
      if (p.src.t === 'tpl') {
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
        ctx.setTransform(c.width / p.w, 0, 0, c.height / p.h, 0, 0);
        drawTemplateCanvas(ctx, p.tpl, p.w, p.h);
      } else {
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
        const pg = await this.doc.pdf.getPage(p.src.i + 1);
        if (v.dead || this.zoom !== z) { v.busy = false; c.width = 0; this._scheduleRender(); return; }
        const vp = pg.getViewport({ scale: c.width / p.w });
        const params = { canvasContext: ctx, viewport: vp };
        if (this.doc.ocConfig) params.optionalContentConfigPromise = Promise.resolve(this.doc.ocConfig);
        v.task = pg.render(params);
        await v.task.promise;
        v.task = null;
      }
    } catch (e) {
      v.busy = false;
      c.width = 0;
      if (e?.name !== 'RenderingCancelledException') console.warn('falha ao desenhar página', e);
      return;
    }
    v.busy = false;
    if (v.dead) { c.width = 0; return; }
    if (v.base) { v.base.width = 0; v.base.remove(); }
    v.el.prepend(c);
    v.base = c;
    v.baseZoom = z;
    if (this.zoom !== z) this._scheduleRender();
  }

  _renderInk(v) {
    const p = v.page;
    const pr = this._pxRatio(p);
    let c = v.ink;
    const W = Math.max(1, Math.floor(p.w * pr)), H = Math.max(1, Math.floor(p.h * pr));
    if (!c) { c = document.createElement('canvas'); c.className = 'ink'; this._watchLoss(c, v); v.el.appendChild(c); v.ink = c; }
    if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
    const ctx = c.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.setTransform(W / p.w, 0, 0, H / p.h, 0, 0);
    const hide = this.sel?.moving && this.sel.pageId === p.id ? this.sel.ids : null;
    for (const o of p.objs) if (!hide || !hide.has(o.id)) drawObj(ctx, o);
    v.inkZoom = this.zoom;
    v.inkDirty = false;
    if (v.dt) { if (v.dt.z === this.zoom) this._composeDetail(v); else this._dropDetail(v); }
  }

  // se o Android tirar a memória de um canvas, ele volta vazio: manda redesenhar
  _watchLoss(c, v) {
    c.addEventListener('contextrestored', () => { v.baseZoom = 0; v.inkDirty = true; this._scheduleRender(); });
  }

  _resetOverlay() {
    const w = this.viewer.clientWidth, hgt = this.viewer.clientHeight;
    this.overlay.width = 0;
    this.overlay.width = Math.round(w * this.dpr); this.overlay.height = Math.round(hgt * this.dpr);
  }

  _inkAdd(p, o) {
    const v = this.views.get(p.id);
    if (!v?.ink || v.inkDirty) { if (v) { v.inkDirty = true; this._scheduleRender(); } return; }
    const ctx = v.ink.getContext('2d');
    ctx.setTransform(v.ink.width / p.w, 0, 0, v.ink.height / p.h, 0, 0);
    drawObj(ctx, o);
    if (v.dt) { const d = v.dt, dc = d.c.getContext('2d'); dc.setTransform(d.s, 0, 0, d.s, -d.x * d.s, -d.y * d.s); drawObj(dc, o); }
  }

  _refreshPage(p) {
    const v = this.views.get(p.id);
    if (v) { v.inkDirty = true; if (v.ink) this._renderInk(v); else this._scheduleRender(); }
  }

  refreshAll() {
    for (const v of this.views.values()) { v.inkDirty = true; v.baseZoom = 0; }
    this._scheduleRender();
  }

  // ---------------- histórico ----------------
  _setObjs(p, objs, label) {
    const before = p.objs;
    p.objs = objs;
    this._push({ kind: 'objs', pageId: p.id, before, after: objs, label });
  }

  _push(a) {
    this.undoStack.push(a);
    if (this.undoStack.length > UNDO_MAX) this.undoStack.shift();
    this.redoStack = [];
    this._changed();
  }

  _changed() {
    this.hooks.onChange?.();
    this.hooks.onHistory?.();
  }

  canUndo() { return this.undoStack.length > 0; }
  canRedo() { return this.redoStack.length > 0; }

  undo() { this._closeText(); this._endShapeEdit(); this._apply(this.undoStack, this.redoStack, 'before'); }
  redo() { this._closeText(); this._endShapeEdit(); this._apply(this.redoStack, this.undoStack, 'after'); }

  _apply(from, to, which) {
    const a = from.pop();
    if (!a) return;
    this.clearSelection();
    if (a.kind === 'objs') {
      const p = this.pageById(a.pageId);
      if (p) { p.objs = a[which]; this._refreshPage(p); }
    } else if (a.kind === 'pages') {
      this.doc.pages = a[which].slice();
      this._relayout(); this._scheduleRender(); this._emitPage();
    }
    to.push(a);
    this._changed();
  }

  // ---------------- páginas ----------------
  insertPage(page, index) {
    const before = this.pages.slice();
    this.doc.pages.splice(index, 0, page);
    this._push({ kind: 'pages', before, after: this.pages.slice() });
    this._relayout(); this._scheduleRender(); this._emitPage();
  }

  duplicatePage(i) {
    const p = this.pages[i];
    const copy = { ...p, id: newId(), objs: p.objs.map(o => ({ ...o, id: newId() })) };
    this.insertPage(copy, i + 1);
  }

  deletePage(i) {
    if (this.pages.length <= 1) return false;
    const before = this.pages.slice();
    this.doc.pages.splice(i, 1);
    this._push({ kind: 'pages', before, after: this.pages.slice() });
    this.clearSelection();
    this._relayout(); this._scheduleRender(); this._emitPage();
    return true;
  }

  movePage(i, dir) {
    const j = i + dir;
    if (j < 0 || j >= this.pages.length) return;
    const before = this.pages.slice();
    const arr = this.doc.pages;
    [arr[i], arr[j]] = [arr[j], arr[i]];
    this._push({ kind: 'pages', before, after: arr.slice() });
    this._relayout(); this._scheduleRender(); this._emitPage();
  }

  clearPage(i) {
    const p = this.pages[i];
    if (p?.objs.length) { this._setObjs(p, [], 'limpar'); this._refreshPage(p); }
  }

  _emitPage() { this.hooks.onPage?.(this.currentPageIndex(), this.pages.length); }

  // ---------------- ferramentas ----------------
  setTool(t, opts = {}) {
    this._closeText();
    this._endShapeEdit();
    if (t !== 'lasso' && !opts.keepSel) this.clearSelection();
    if (t === 'paste') this.stamp = opts.stamp || this.clip;
    else this.stamp = null;
    this.tool = t;
    this._clearOverlay();
    this.hooks.onTool?.(t);
  }

  setCfg(tool, patch) {
    Object.assign(this.cfg[tool], patch);
    const save = {};
    for (const k in this.cfg) save[k] = this.cfg[k];
    setPref('toolCfg', save);
  }

  setShapeAssist(v) { this.shapeAssist = !!v; setPref('shapeAssist', this.shapeAssist); this.hooks.onTool?.(); }

  setPenOnly(v) { this.penOnly = !!v; setPref('penOnly', this.penOnly); this.hooks.onPenOnly?.(this.penOnly); }

  // ---------------- entrada ----------------
  _bind() {
    const v = this.viewer;
    v.addEventListener('pointerdown', e => this._down(e));
    // pointermove já vem alinhado com a tela (um por quadro, com os pontos intermediários juntos)
    v.addEventListener('pointermove', e => this._move(e));
    v.addEventListener('pointerup', e => this._up(e));
    v.addEventListener('pointercancel', e => this._up(e, true));
    v.addEventListener('pointerleave', e => { if (e.pointerType !== 'touch' && !this.ptrs.has(e.pointerId)) this._clearOverlay(); });
    v.addEventListener('contextmenu', e => e.preventDefault());
    v.addEventListener('scroll', () => {
      if (this._hl) { this._hl = null; this._clearOverlay(); this.hooks.onLearn?.(-1); }
      this._scheduleRender();
      this._placeSelMenu();
      clearTimeout(this._pt); this._pt = setTimeout(() => this._emitPage(), 80);
    }, { passive: true });
    v.addEventListener('wheel', e => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const r = v.getBoundingClientRect();
        this.setZoom(this.zoom * Math.exp(-e.deltaY * 0.0025), e.clientX - r.left, e.clientY - r.top);
      }
    }, { passive: false });
    window.addEventListener('keydown', e => this._key(e));
  }

  _local(e) {
    const r = this.viewer.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  _pagePoint(e, i) {
    const l = this._local(e);
    const L = this.layout[i];
    return { x: (l.x + this.viewer.scrollLeft - L.x) / this.zoom, y: (l.y + this.viewer.scrollTop - L.y) / this.zoom };
  }

  _pageAtEvent(e) {
    const l = this._local(e);
    const cx = l.x + this.viewer.scrollLeft, cy = l.y + this.viewer.scrollTop;
    for (let i = 0; i < this.layout.length; i++) {
      const L = this.layout[i];
      if (cy >= L.y - 4 && cy <= L.y + L.h + 4 && cx >= L.x - 4 && cx <= L.x + L.w + 4) return i;
    }
    return -1;
  }

  _isNavPointer(e) {
    if (e.pointerType !== 'touch') return false;
    if (this.penOnly) return true;
    return this.ptrs.size > 0 || this._touchCount() > 0;
  }
  _touchCount() { let n = 0; for (const p of this.ptrs.values()) if (p.type === 'touch') n++; return n; }

  _down(e) {
    if (e.target.closest('.text-ed, .sel-handle, .sh-handle')) return;
    // tocar fora das alças confirma a forma ajustada (e esse toque não desenha)
    if (this._shEdit && (e.pointerType !== 'touch' || !this.penOnly)) {
      this._endShapeEdit();
      this.gesture = { kind: 'draw', tool: 'noop', pointerId: e.pointerId, ptrType: e.pointerType };
      this.ptrs.set(e.pointerId, { id: e.pointerId, type: e.pointerType, x: e.clientX, y: e.clientY });
      return;
    }
    if (e.pointerType === 'pen' && !this.penOnly && !prefs().penAuto) {
      // primeira vez que a S Pen é usada: o dedo passa a só rolar/zoom
      setPref('penAuto', true);
      this.setPenOnly(true);
      this.hooks.onToast?.('S Pen detectada: o dedo agora só rola e dá zoom (dá para mudar no botão da caneta).');
    }
    if (e.pointerType === 'pen') {
      this.penSeen = performance.now();
      // a palma encostou antes da caneta e começou a rolar/dar zoom: desfaz isso
      if (this.gesture?.kind === 'nav') this._abortNav();
    }
    if (e.pointerType === 'touch') {
      // rejeição da palma: caneta encostada, caneta pairando perto da tela, ou área de contato grande
      if (this.activePen != null) return;
      if (this.penOnly && performance.now() - this.penSeen < 700) return;
      if (Math.max(e.width || 0, e.height || 0) > 56) return;
    }

    this._stopMomentum();
    const info = { id: e.pointerId, type: e.pointerType, x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t: performance.now() };

    if (this.snipping && e.pointerType === 'touch' && !this.ptrs.size) { this.ptrs.set(e.pointerId, info); this._startDraw(e); return; }
    if (e.pointerType === 'touch') {
      this.ptrs.set(e.pointerId, info);
      const touches = [...this.ptrs.values()].filter(p => p.type === 'touch');
      const drawingWithTouch = this.gesture && this.gesture.kind === 'draw' && this.gesture.ptrType === 'touch';
      if (this.penOnly || touches.length >= 2 || drawingWithTouch) {
        if (drawingWithTouch) this._cancelDraw();
        this._closeText();
        this._startNav(touches);
        e.preventDefault();
        return;
      }
    } else {
      this.ptrs.set(e.pointerId, info);
    }

    if (e.pointerType === 'mouse' && e.button === 1) { this._startNav([info]); return; }
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    this._startDraw(e);
  }

  _move(e) {
    const info = this.ptrs.get(e.pointerId);
    if (!info) {
      // caneta pairando sobre a tela (hover)
      if (e.pointerType === 'pen') this.penSeen = performance.now();
      if (e.pointerType !== 'touch') this._hover(e);
      return;
    }
    info.x = e.clientX; info.y = e.clientY;
    const g = this.gesture;
    if (!g) return;
    if (g.kind === 'nav') { this._navMove(); e.preventDefault(); return; }
    if (g.kind === 'draw' && g.pointerId === e.pointerId) this._drawMove(e);
  }

  _up(e, cancel = false) {
    const info = this.ptrs.get(e.pointerId);
    if (!info) return;
    this.ptrs.delete(e.pointerId);
    const g = this.gesture;
    if (g?.kind === 'nav') {
      const touches = [...this.ptrs.values()].filter(p => p.type === 'touch');
      if (touches.length === 0) this._endNav();
      else this._startNav(touches, true);
      return;
    }
    if (g?.kind === 'draw' && g.pointerId === e.pointerId) this._drawEnd(e, cancel);
  }

  // ---------- navegação (dedos) ----------
  _startNav(touches, cont = false) {
    if (this.gesture?.kind === 'nav' && this.gesture.mode === 'pinch' && touches.length < 2) this._commitPinch();
    const vr = this.viewer.getBoundingClientRect();
    if (touches.length >= 2) {
      const [a, b] = touches;
      this.sheet.style.willChange = 'transform';
      const mid = { x: (a.x + b.x) / 2 - vr.left, y: (a.y + b.y) / 2 - vr.top };
      this.gesture = {
        kind: 'nav', mode: 'pinch', a: a.id, b: b.id,
        d0: Math.hypot(a.x - b.x, a.y - b.y) || 1,
        m0: mid, c0: { x: mid.x + this.viewer.scrollLeft, y: mid.y + this.viewer.scrollTop },
        s: 1, m: mid,
      };
      this._closeText();
    } else {
      const a = touches[0];
      this.gesture = { kind: 'nav', mode: 'pan', id: a.id, lx: a.x, ly: a.y, hist: [{ x: a.x, y: a.y, t: performance.now() }], cont };
    }
  }

  _navMove() {
    const g = this.gesture;
    const vr = this.viewer.getBoundingClientRect();
    if (g.mode === 'pan') {
      const p = this.ptrs.get(g.id);
      if (!p) return;
      this.viewer.scrollLeft -= p.x - g.lx;
      this.viewer.scrollTop -= p.y - g.ly;
      g.lx = p.x; g.ly = p.y;
      const t = performance.now();
      g.hist.push({ x: p.x, y: p.y, t });
      while (g.hist.length > 2 && t - g.hist[0].t > 120) g.hist.shift();
    } else {
      const a = this.ptrs.get(g.a), b = this.ptrs.get(g.b);
      if (!a || !b) return;
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const fit = this._fitZoom();
      let s = d / g.d0;
      const nz = Math.max(fit * 0.35, Math.min(fit * 6, this.zoom * s));
      s = nz / this.zoom;
      const m = { x: (a.x + b.x) / 2 - vr.left, y: (a.y + b.y) / 2 - vr.top };
      g.s = s; g.m = m;
      const tx = m.x + this.viewer.scrollLeft - g.c0.x * s;
      const ty = m.y + this.viewer.scrollTop - g.c0.y * s;
      this.sheet.style.transform = `translate(${tx}px, ${ty}px) scale(${s})`;
      this._hideSelMenu();
    }
  }

  _abortNav() {
    this._stopMomentum();
    this.sheet.style.transform = ''; this.sheet.style.willChange = '';
    this.gesture = null;
    for (const [id, p] of this.ptrs) if (p.type === 'touch') this.ptrs.delete(id);
  }

  _commitPinch() {
    const g = this.gesture;
    this.sheet.style.transform = ''; this.sheet.style.willChange = '';
    if (!g || g.mode !== 'pinch' || Math.abs(g.s - 1) < 0.001) {
      if (g && g.mode === 'pinch') { this.viewer.scrollLeft -= g.m.x - g.m0.x; this.viewer.scrollTop -= g.m.y - g.m0.y; }
      return;
    }
    const old = this.zoom;
    const hit = this._nearestPage(g.c0.x, g.c0.y);
    let px = 0, py = 0;
    if (hit) { const L = this.layout[hit.i]; px = (g.c0.x - L.x) / old; py = (g.c0.y - L.y) / old; }
    const fit = this._fitZoom();
    const nz = old * g.s;
    this.fitMode = Math.abs(nz - fit) / fit < 0.04;
    this.zoom = this.fitMode ? fit : nz;
    this._relayout();
    if (hit) {
      const L = this.layout[hit.i];
      this.viewer.scrollLeft = L.x + px * this.zoom - g.m.x;
      this.viewer.scrollTop = L.y + py * this.zoom - g.m.y;
    }
    this._scheduleRender();
    this.hooks.onZoom?.(this.zoomPercent());
  }

  _endNav() {
    const g = this.gesture;
    this.gesture = null;
    if (!g) return;
    if (g.mode === 'pinch') { this._commitPinch(); this._placeSelMenu(); return; }
    const h = g.hist;
    if (this.learn && h.length && Math.hypot(h[h.length - 1].x - h[0].x, h[h.length - 1].y - h[0].y) < 8 && performance.now() - h[0].t < 400) {
      const ev = { clientX: h[0].x, clientY: h[0].y };
      const i = this._pageAtEvent(ev);
      this.hooks.onLearn?.(i, i >= 0 ? this._pagePoint(ev, i) : null, ev, 'tap');
      this.hooks.onLearn?.(0, null, ev, 'up');
      return;
    }
    // inércia
    if (h.length >= 2) {
      const a = h[0], b = h[h.length - 1];
      const dt = b.t - a.t;
      if (dt > 0 && performance.now() - b.t < 80) {
        let vx = (b.x - a.x) / dt, vy = (b.y - a.y) / dt;
        if (Math.hypot(vx, vy) > 0.15) this._momentum(vx, vy);
      }
    }
    this._placeSelMenu();
  }

  _momentum(vx, vy) {
    let last = performance.now();
    const step = t => {
      const dt = Math.min(40, t - last); last = t;
      this.viewer.scrollLeft -= vx * dt;
      this.viewer.scrollTop -= vy * dt;
      const k = Math.pow(0.95, dt / 16);
      vx *= k; vy *= k;
      if (Math.hypot(vx, vy) > 0.02) this._mom = requestAnimationFrame(step);
      else this._mom = 0;
    };
    this._mom = requestAnimationFrame(step);
  }
  _stopMomentum() { if (this._mom) cancelAnimationFrame(this._mom); this._mom = 0; }

  // ---------- desenho (caneta / mouse / dedo) ----------
  _effectiveTool(e) {
    // botão lateral da S Pen (ou ponta borracha) = borracha temporária
    if (e.pointerType === 'pen' && ((e.buttons & 2) || (e.buttons & 32) || e.button === 5)) return 'eraser';
    if (this.learn) return 'learn';
    return this.tool;
  }

  _startDraw(e) {
    const i = this._pageAtEvent(e);
    const tool = this._effectiveTool(e);
    if (e.pointerType === 'pen') this.activePen = e.pointerId;
    try { this.viewer.setPointerCapture(e.pointerId); } catch {}
    e.preventDefault();

    // Arrastar a seleção (com qualquer ferramenta, se tocar dentro dela)
    if (this.sel && tool !== 'eraser') {
      const pi = this.pages.findIndex(p => p.id === this.sel.pageId);
      if (pi === i) {
        const pt = this._pagePoint(e, i);
        const b = this.sel.box, pad = 8 / this.zoom;
        if (pt.x >= b.x - pad && pt.x <= b.x + b.w + pad && pt.y >= b.y - pad && pt.y <= b.y + b.h + pad) {
          this._startMove(e, 'move', pt);
          return;
        }
      }
      if (tool !== 'paste') this.clearSelection();
    }
    if (this.textEd) { this._closeText(); if (tool === 'text') { this.gesture = { kind: 'draw', tool: 'noop', pointerId: e.pointerId, ptrType: e.pointerType }; return; } }
    if (this.snipping) {
      this.gesture = { kind: 'draw', tool: 'snip', pointerId: e.pointerId, ptrType: e.pointerType, pageIndex: i, sx: e.clientX, sy: e.clientY, ex: e.clientX, ey: e.clientY };
      return;
    }
    if (tool === 'learn') {
      this.gesture = { kind: 'draw', tool: 'learn', pointerId: e.pointerId, ptrType: e.pointerType };
      if (i >= 0) this.hooks.onLearn?.(i, this._pagePoint(e, i), e, 'tap');
      else this.hooks.onLearn?.(-1);
      return;
    }
    if (i < 0) { this.gesture = { kind: 'draw', tool: 'noop', pointerId: e.pointerId, ptrType: e.pointerType }; return; }

    const p = this.pages[i];
    const pt = this._pagePoint(e, i);
    const g = { kind: 'draw', tool, pointerId: e.pointerId, ptrType: e.pointerType, pageIndex: i, page: p, start: pt, last: pt, moved: false };
    this.gesture = g;

    if (tool === 'pen' || tool === 'pencil' || tool === 'marker') {
      const c = this.cfg[tool];
      g.obj = { t: 'stroke', tool, color: c.color, size: c.size, sim: e.pointerType !== 'pen', pts: [[pt.x, pt.y, this._pressure(e)]] };
      this._drawLive();
    } else if (tool === 'eraser') {
      g.before = p.objs;
      g.removed = new Set();
      this._eraseAt(g, pt);
    } else if (tool === 'lasso') {
      g.poly = [[pt.x, pt.y]];
    } else if (tool === 'shape') {
      const c = this.cfg.shape;
      g.obj = { t: 'shape', kind: c.kind, color: c.color, size: c.size, fill: c.fill, x1: pt.x, y1: pt.y, x2: pt.x, y2: pt.y };
    }
  }

  _pressure(e) {
    if (e.pointerType === 'pen') return Math.max(0.05, Math.min(1, e.pressure || 0.5));
    return 0.5;
  }

  _drawMove(e) {
    const g = this.gesture;
    if (g.tool === 'noop') return;
    if (g.tool === 'snip') { g.ex = e.clientX; g.ey = e.clientY; this._drawSnipRect(g); return; }
    if (g.tool === 'learn') { const i = this._pageAtEvent(e); if (i >= 0) this.hooks.onLearn?.(i, this._pagePoint(e, i), e, 'drag'); return; }
    if (g.tool === 'move' || g.tool === 'scale') return this._moveSel(e);
    const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    const list = evs.length ? evs : [e];
    const pt = this._pagePoint(e, g.pageIndex);
    if (Math.hypot((pt.x - g.start.x) * this.zoom, (pt.y - g.start.y) * this.zoom) > 4) g.moved = true;

    if (g.snapped) {
      // forma reconhecida: reta/seta seguem a caneta; as outras ficam como foram reconhecidas
      if (g.obj.kind === 'line' || g.obj.kind === 'arrow') {
        const sn = this._lineSnap(g.page, g.obj.x1, g.obj.y1, pt.x, pt.y);
        g.obj = { ...g.obj, x2: sn.x, y2: sn.y };
        this._drawLiveObj(g.pageIndex, g.obj);
        this._drawAngle(g.pageIndex, sn);
      }
    } else if (g.obj?.t === 'stroke') {
      if (this.shapeAssist) this._holdCheck(g, e);
      for (const ce of list) {
        const q = this._pagePoint(ce, g.pageIndex);
        const lastP = g.obj.pts[g.obj.pts.length - 1];
        if (Math.hypot(q.x - lastP[0], q.y - lastP[1]) * this.zoom < 0.6) continue;
        // suavização leve e só para frente (o que já foi desenhado não muda); a pressão da S Pen oscila, então é a mais suavizada
        const pr = lastP[2] + (this._pressure(ce) - lastP[2]) * 0.35;
        g.obj.pts.push([q.x, q.y, pr]);
      }
      this._drawLive();
    } else if (g.tool === 'eraser') {
      for (const ce of list) this._eraseAt(g, this._pagePoint(ce, g.pageIndex));
      this._drawEraserCursor(g.pageIndex, pt);
    } else if (g.tool === 'lasso') {
      for (const ce of list) { const q = this._pagePoint(ce, g.pageIndex); g.poly.push([q.x, q.y]); }
      this._drawLasso(g);
    } else if (g.tool === 'shape') {
      this._updateShape(g, pt);
      this._drawLiveObj(g.pageIndex, g.obj);
    }
    g.last = pt;
  }

  _drawEnd(e, cancel) {
    const g = this.gesture;
    this.gesture = null;
    if (e.pointerType === 'pen') this.activePen = null;
    if (!g) return;
    if (g.tool === 'learn') { this.hooks.onLearn?.(0, null, e, 'up'); return; }
    if (g.tool === 'snip') { this._finishSnip(g, cancel); return; }
    if (g.tool === 'move' || g.tool === 'scale') return this._endMove(g);
    clearTimeout(g.holdT);
    const p = g.page;
    if (g.snapped) {
      this._clearOverlay();
      if (cancel) return;
      const n = { ...g.obj, id: newId() };
      this._setObjs(p, [...p.objs, n]);
      this._inkAdd(p, n);
      if (n.kind === 'curve' || n.kind === 'line' || n.kind === 'arrow') this._startShapeEdit(p, n.id);
      return;
    }
    // botão "prever formas" ligado: ao soltar, o traço vira reta/seta/curva/círculo/… se for reconhecido
    if (g.obj?.t === 'stroke' && this.shapeAssist && !cancel && g.tool !== 'marker') {
      const r = recognize(g.obj.pts);
      if (r && (r.kind === 'line' || r.kind === 'arrow')) { const sn = this._lineSnap(p, r.x1, r.y1, r.x2, r.y2); r.x2 = sn.x; r.y2 = sn.y; }
      if (r) {
        const n = { t: 'shape', color: g.obj.color, size: Math.max(0.8, g.obj.size * (g.tool === 'pencil' ? 0.9 : 0.75)), fill: null, ...r, id: newId() };
        this._clearOverlay();
        this._setObjs(p, [...p.objs, n]);
        this._inkAdd(p, n);
        if (n.kind === 'curve' || n.kind === 'line' || n.kind === 'arrow') this._startShapeEdit(p, n.id);
        return;
      }
    }
    if (g.obj?.t === 'stroke') {
      if (cancel && g.obj.pts.length < 3) { this._clearOverlay(); return; }
      const o = { ...g.obj, id: newId(), pts: simplifyPts(g.obj.pts, 0.08 / Math.max(0.5, this.zoom)) };
      this._setObjs(p, [...p.objs, o]);
      this._inkAdd(p, o);
      this._clearOverlay();
    } else if (g.tool === 'eraser') {
      this._clearOverlay();
      if (g.removed.size) {
        const after = p.objs;
        p.objs = g.before;
        this._setObjs(p, after, 'apagar');
      }
    } else if (g.tool === 'lasso') {
      this._clearOverlay();
      let ids;
      if (!g.moved || g.poly.length < 4) {
        const r = 8 / this.zoom;
        const hit = [...p.objs].reverse().find(o => hitObj(o, g.start.x, g.start.y, r));
        ids = hit ? [hit.id] : [];
      } else ids = p.objs.filter(o => inLasso(o, g.poly)).map(o => o.id);
      if (ids.length) this.select(p, ids);
    } else if (g.tool === 'shape') {
      this._clearOverlay();
      const o = g.obj;
      if (Math.hypot(o.x2 - o.x1, o.y2 - o.y1) * this.zoom > 6) {
        const n = { ...o, id: newId() };
        this._setObjs(p, [...p.objs, n]);
        this._inkAdd(p, n);
      }
    } else if (g.tool === 'text') {
      if (!g.moved && !cancel) this._openText(g.pageIndex, g.start);
    } else if (g.tool === 'paste') {
      if (!g.moved && !cancel) this._pasteAt(p, g.start);
    }
  }

  // ✨ ligado: segurar a caneta parada (~0,5 s) transforma o traço na hora; reta/seta continuam
  // seguindo a caneta (esticar/girar) com o ângulo na tela até soltar.
  _holdCheck(g, e) {
    if (g.tool === 'marker') return;
    const x = e.clientX, y = e.clientY;
    if (g.hold && Math.hypot(x - g.hold.x, y - g.hold.y) < 5) return;
    g.hold = { x, y };
    clearTimeout(g.holdT);
    g.holdT = setTimeout(() => this._snapShape(g), 500);
  }

  _snapShape(g) {
    if (this.gesture !== g || g.snapped || g.obj?.t !== 'stroke') return;
    const r = recognize(g.obj.pts);
    if (!r) return;
    g.snapped = true;
    g.obj = { t: 'shape', color: g.obj.color, size: Math.max(0.8, g.obj.size * (g.tool === 'pencil' ? 0.9 : 0.75)), fill: null, ...r };
    this._drawLiveObj(g.pageIndex, g.obj);
    if (r.kind === 'line' || r.kind === 'arrow') this._drawAngle(g.pageIndex, this._lineSnap(g.page, r.x1, r.y1, r.x2, r.y2));
    try { navigator.vibrate?.(10); } catch {}
  }

  // Encaixa a ponta (x2,y2) da reta: paralela ou perpendicular às retas da página, ou múltiplos de 15°.
  _lineSnap(p, x1, y1, x2, y2, skipId) {
    const len = Math.hypot(x2 - x1, y2 - y1);
    const ang = Math.atan2(y2 - y1, x2 - x1);
    const TOL = 2.5 * Math.PI / 180;
    const diff = (a, b) => { let d = (a - b) % Math.PI; if (d > Math.PI / 2) d -= Math.PI; if (d < -Math.PI / 2) d += Math.PI; return d; };
    let best = null;
    for (const o of p?.objs || []) {
      if (o.t !== 'shape' || !(o.kind === 'line' || o.kind === 'arrow') || o.id === skipId) continue;
      if (Math.hypot(o.x2 - o.x1, o.y2 - o.y1) < 8) continue;
      const a = Math.atan2(o.y2 - o.y1, o.x2 - o.x1);
      for (const [ref, tag] of [[a, '∥'], [a + Math.PI / 2, '⊥']]) {
        const d = diff(ang, ref);
        if (Math.abs(d) < TOL && (!best || Math.abs(d) < Math.abs(best.d))) best = { d, tag };
      }
    }
    if (!best) {
      const step = Math.PI / 12, d = diff(ang, Math.round(ang / step) * step);
      if (Math.abs(d) < TOL) best = { d, tag: '' };
    }
    const fa = best ? ang - best.d : ang;
    const nx = x1 + Math.cos(fa) * len, ny = y1 + Math.sin(fa) * len;
    let deg = Math.round((-fa * 180 / Math.PI) * 10) / 10;
    deg = ((deg % 180) + 180) % 180;
    return { x: nx, y: ny, deg, tag: best?.tag || '', snapped: !!best };
  }

  // Ângulo ao lado da ponta da reta (desenhado na camada de cima)
  _drawAngle(i, sn) {
    const ctx = this.octx, L = this.layout[i];
    if (!L) return;
    const sx = (L.x + sn.x * this.zoom - this.viewer.scrollLeft) * this.dpr, sy = (L.y + sn.y * this.zoom - this.viewer.scrollTop) * this.dpr;
    const txt = `${String(sn.deg % 1 ? sn.deg.toFixed(1) : sn.deg).replace('.', ',')}°${sn.tag ? ' ' + sn.tag : ''}`;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.font = `bold ${13 * this.dpr}px "Pixelify Sans", sans-serif`;
    const w = ctx.measureText(txt).width + 10 * this.dpr, hgt = 20 * this.dpr;
    const bx = sx + 14 * this.dpr, by = sy - 30 * this.dpr;
    ctx.fillStyle = sn.snapped ? '#000080' : '#ffffe1'; ctx.strokeStyle = '#000'; ctx.lineWidth = this.dpr;
    ctx.fillRect(bx, by, w, hgt); ctx.strokeRect(bx, by, w, hgt);
    ctx.fillStyle = sn.snapped ? '#fff' : '#000'; ctx.textBaseline = 'middle';
    ctx.fillText(txt, bx + 5 * this.dpr, by + hgt / 2);
    ctx.restore();
  }

  _cancelDraw() {
    const g = this.gesture;
    if (g) clearTimeout(g.holdT);
    if (g?.tool === 'eraser' && g.removed.size) { g.page.objs = g.before; this._refreshPage(g.page); }
    if (g?.tool === 'move' || g?.tool === 'scale') { this.sel.moving = false; this._refreshPage(this.pageById(this.sel.pageId)); this._placeSelection(); }
    this.gesture = null;
    this._clearOverlay();
  }

  _updateShape(g, pt) {
    const o = g.obj;
    let x = pt.x, y = pt.y;
    const dx = x - o.x1, dy = y - o.y1;
    if (o.kind === 'line' || o.kind === 'arrow') {
      // encaixa em múltiplos de 15° quando perto
      const ang = Math.atan2(dy, dx), len = Math.hypot(dx, dy);
      const step = Math.PI / 12;
      const snapped = Math.round(ang / step) * step;
      if (Math.abs(snapped - ang) < 0.06) { x = o.x1 + Math.cos(snapped) * len; y = o.y1 + Math.sin(snapped) * len; }
    } else {
      // quase quadrado/círculo -> perfeito
      const ax = Math.abs(dx), ay = Math.abs(dy);
      if (ax > 0 && ay > 0 && Math.abs(ax - ay) / Math.max(ax, ay) < 0.08) {
        const m = Math.max(ax, ay); x = o.x1 + Math.sign(dx) * m; y = o.y1 + Math.sign(dy) * m;
      }
    }
    g.obj = { ...o, x2: x, y2: y };
  }

  _eraseAt(g, pt) {
    const r = this.cfg.eraser.size / 2 / this.zoom;
    const p = g.page;
    const hits = p.objs.filter(o => hitObj(o, pt.x, pt.y, r));
    if (!hits.length) return;
    for (const o of hits) g.removed.add(o.id);
    p.objs = p.objs.filter(o => !g.removed.has(o.id));
    this._refreshPage(p);
  }

  // ---------- overlay (pré-visualização ao vivo) ----------
  _clearOverlay() {
    this.overlay.style.opacity = '';
    const c = this.octx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, this.overlay.width, this.overlay.height);
  }

  _overlayFor(i) {
    const L = this.layout[i];
    const z = this.zoom * this.dpr;
    this.octx.setTransform(z, 0, 0, z, (L.x - this.viewer.scrollLeft) * this.dpr, (L.y - this.viewer.scrollTop) * this.dpr);
    return this.octx;
  }

  // Traço ao vivo: acrescenta só os segmentos novos (o marca-texto, de largura fixa, é redesenhado inteiro).
  _drawLive() {
    // desenha na hora (sem esperar o próximo quadro): só os segmentos novos
    const g = this.gesture;
    if (!g?.obj || g.obj.t !== 'stroke') return;
    const n = g.obj.pts.length;
    if (g.liveN === n) return;
    if (g.obj.tool === 'marker') {
      // largura fixa e translúcido: redesenha inteiro, mas no máximo uma vez por quadro
      if (this._liveRaf) return;
      this._liveRaf = requestAnimationFrame(() => {
        this._liveRaf = 0;
        if (this.gesture !== g) return;
        this._clearOverlay();
        drawStrokeSegs(this._overlayFor(g.pageIndex), g.obj, 0);
        g.liveN = g.obj.pts.length;
      });
      return;
    }
    const ctx = this._overlayFor(g.pageIndex);
    if (!g.liveN) { this._clearOverlay(); this._overlayFor(g.pageIndex); }
    drawStrokeSegs(ctx, g.obj, g.liveN || 0);
    g.liveN = n;
  }

  _drawLiveObj(i, o) {
    this._clearOverlay();
    if (this.gesture && !o.live) this.gesture.liveN = 0;
    const ctx = this._overlayFor(i);
    drawObj(ctx, o);
  }

  _drawLasso(g) {
    this._clearOverlay();
    const ctx = this._overlayFor(g.pageIndex);
    ctx.save();
    ctx.lineWidth = 1.5 / this.zoom;
    ctx.setLineDash([6 / this.zoom, 5 / this.zoom]);
    ctx.strokeStyle = '#3b5bdb';
    ctx.fillStyle = 'rgba(59,91,219,0.07)';
    ctx.beginPath();
    g.poly.forEach((p, k) => k ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]));
    ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.restore();
  }

  _drawEraserCursor(i, pt) {
    this._clearOverlay();
    const ctx = this._overlayFor(i);
    ctx.save();
    ctx.lineWidth = 1 / this.zoom;
    ctx.strokeStyle = 'rgba(0,0,0,.55)';
    ctx.fillStyle = 'rgba(255,255,255,.35)';
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, this.cfg.eraser.size / 2 / this.zoom, 0, Math.PI * 2);
    ctx.fill(); ctx.stroke();
    ctx.restore();
  }

  _hover(e) {
    const i = this._pageAtEvent(e);
    if (this.learn) return;
    if (i < 0) { this._clearOverlay(); return; }
    const t = this._effectiveTool(e);
    if (t === 'eraser') this._drawEraserCursor(i, this._pagePoint(e, i));
    else if (t === 'paste' && this.stamp) this._drawGhost(i, this._pagePoint(e, i));
  }

  _drawGhost(i, pt) {
    this._clearOverlay();
    const ctx = this._overlayFor(i);
    ctx.save();
    ctx.globalAlpha = 0.45;
    const s = this.stamp;
    for (const o of s.objs) drawObj(ctx, transformObj(o, pt.x - s.w / 2, pt.y - s.h / 2));
    ctx.restore();
  }

  // ---------------- ajuste de forma reconhecida (alças) ----------------
  // Reta/seta: 2 pontas. Curva: início, meio e fim. Arraste as bolinhas; tocar fora confirma.
  _startShapeEdit(p, id) {
    this._endShapeEdit();
    const v = this.views.get(p.id);
    if (!v) return;
    const o = p.objs.find(x => x.id === id);
    if (!o) return;
    const keys = o.kind === 'curve' ? [['x1', 'y1'], ['cx', 'cy'], ['x2', 'y2']] : [['x1', 'y1'], ['x2', 'y2']];
    const hs = keys.map(([kx, ky], n) => {
      const el = document.createElement('div');
      el.className = 'sh-handle' + (kx === 'cx' ? ' mid' : '');
      el.addEventListener('pointerdown', e => {
        e.stopPropagation(); e.preventDefault();
        try { el.setPointerCapture(e.pointerId); } catch {}
        const cur = p.objs.find(x => x.id === this._shEdit.id);
        this._shEdit.drag = { kx, ky, before: p.objs, startObj: cur };
      });
      el.addEventListener('pointermove', e => {
        const d = this._shEdit?.drag;
        if (!d || d.kx !== kx) return;
        const i = this.pages.indexOf(p);
        const pt = this._pagePoint(e, i);
        const cur = p.objs.find(x => x.id === this._shEdit.id);
        let n = { ...cur, [kx]: pt.x, [ky]: pt.y };
        let sn = null;
        if (cur.kind === 'line' || cur.kind === 'arrow') {
          const [ox, oy] = kx === 'x1' ? [cur.x2, cur.y2] : [cur.x1, cur.y1];
          sn = this._lineSnap(p, ox, oy, pt.x, pt.y, cur.id);
          n = { ...cur, [kx]: sn.x, [ky]: sn.y };
        }
        p.objs = p.objs.map(x => (x.id === cur.id ? n : x));
        this._shEdit.id = n.id;
        this._placeShapeEdit();
        this._clearOverlay();
        if (sn) this._drawAngle(i, sn);
        if (!this._shRaf) this._shRaf = requestAnimationFrame(() => { this._shRaf = 0; this._refreshPage(p); });
      });
      const up = () => {
        const d = this._shEdit?.drag;
        if (!d || d.kx !== kx) return;
        this._shEdit.drag = null;
        const after = p.objs;
        p.objs = d.before;
        this._setObjs(p, after, 'ajustar forma');
        this._refreshPage(p);
        this._clearOverlay();
      };
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
      v.el.appendChild(el);
      return { el, kx, ky };
    });
    this._shEdit = { pageId: p.id, id, hs };
    this._placeShapeEdit();
  }

  _placeShapeEdit() {
    const s = this._shEdit;
    if (!s) return;
    const p = this.pageById(s.pageId);
    const o = p?.objs.find(x => x.id === s.id);
    if (!o) return this._endShapeEdit();
    for (const h of s.hs) { h.el.style.left = o[h.kx] * this.zoom + 'px'; h.el.style.top = o[h.ky] * this.zoom + 'px'; }
  }

  _endShapeEdit() {
    if (!this._shEdit) return;
    for (const h of this._shEdit.hs) h.el.remove();
    this._shEdit = null;
  }

  // ---------------- modo あ ----------------
  setLearn(v) {
    this.learn = !!v;
    if (!v) this.drawHighlight(-1, []);
    this.hooks.onTool?.();
  }

  drawHighlight(i, rects) {
    this._clearOverlay();
    this._hl = i >= 0 && rects.length ? { i, rects } : null;
    if (!this._hl) return;
    const ctx = this._overlayFor(i);
    ctx.save();
    ctx.fillStyle = 'rgba(255, 230, 0, .38)';
    for (const r of rects) ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.fillStyle = '#d00000';
    for (const r of rects) ctx.fillRect(r.x, r.y + r.h - Math.max(1, r.h * 0.07), r.w, Math.max(1, r.h * 0.07));
    ctx.restore();
  }

  // ponto da página -> coordenadas do palco (para posicionar o balão)
  toStage(i, x, y) {
    const L = this.layout[i];
    const vr = this.viewer.getBoundingClientRect(), sr = this.stage.getBoundingClientRect();
    return { x: L.x + x * this.zoom - this.viewer.scrollLeft + (vr.left - sr.left), y: L.y + y * this.zoom - this.viewer.scrollTop + (vr.top - sr.top) };
  }

  // ---------------- seleção ----------------
  select(p, ids) {
    this.clearSelection();
    const set = new Set(ids);
    const objs = p.objs.filter(o => set.has(o.id));
    if (!objs.length) return;
    this.sel = { pageId: p.id, ids: set, box: unionBox(objs) };
    const v = this.views.get(p.id);
    const box = document.createElement('div');
    box.className = 'sel-box';
    const hnd = document.createElement('div');
    hnd.className = 'sel-handle';
    hnd.title = 'Arraste para redimensionar';
    box.appendChild(hnd);
    v.el.appendChild(box);
    this.sel.el = box;
    hnd.addEventListener('pointerdown', e => {
      e.stopPropagation(); e.preventDefault();
      if (e.pointerType === 'pen') this.activePen = e.pointerId;
      this.ptrs.set(e.pointerId, { id: e.pointerId, type: e.pointerType, x: e.clientX, y: e.clientY });
      try { this.viewer.setPointerCapture(e.pointerId); } catch {}
      const i = this.pages.indexOf(p);
      this._startMove(e, 'scale', this._pagePoint(e, i));
    });
    this._placeSelection();
    this.hooks.onSelection?.(true);
  }

  selectedObjs() {
    if (!this.sel) return [];
    const p = this.pageById(this.sel.pageId);
    return p ? p.objs.filter(o => this.sel.ids.has(o.id)) : [];
  }

  clearSelection() {
    if (!this.sel) return;
    this.sel.el?.remove();
    const wasMoving = this.sel.moving;
    const pid = this.sel.pageId;
    this.sel = null;
    if (wasMoving) this._refreshPage(this.pageById(pid));
    this._hideSelMenu();
    this.hooks.onSelection?.(false);
  }

  _placeSelection() {
    if (!this.sel?.el) return;
    const b = this.sel.box, z = this.zoom, pad = 6;
    Object.assign(this.sel.el.style, {
      left: (b.x * z - pad) + 'px', top: (b.y * z - pad) + 'px',
      width: (b.w * z + pad * 2) + 'px', height: (b.h * z + pad * 2) + 'px',
    });
    this._placeSelMenu();
  }

  _placeSelMenu() {
    const menu = this.root.querySelector('#selmenu');
    if (!this.sel || this.sel.moving) { menu.hidden = true; return; }
    const i = this.pages.findIndex(p => p.id === this.sel.pageId);
    const L = this.layout[i];
    if (!L) return;
    const b = this.sel.box, z = this.zoom;
    menu.hidden = false;
    const mw = menu.offsetWidth, mh = menu.offsetHeight;
    const sx = L.x - this.viewer.scrollLeft, sy = L.y - this.viewer.scrollTop;
    let left = sx + (b.x + b.w / 2) * z - mw / 2;
    let top = sy + b.y * z - mh - 14;
    if (top < 8) top = sy + (b.y + b.h) * z + 18;
    left = Math.max(8, Math.min(left, this.viewer.clientWidth - mw - 8));
    top = Math.max(8, Math.min(top, this.viewer.clientHeight - mh - 8));
    menu.style.left = left + 'px'; menu.style.top = top + 'px';
  }
  _hideSelMenu() { const m = this.root.querySelector('#selmenu'); if (m) m.hidden = true; }

  _startMove(e, mode, pt) {
    const p = this.pageById(this.sel.pageId);
    const i = this.pages.indexOf(p);
    this.sel.moving = true;
    this.sel.orig = this.selectedObjs();
    this.gesture = { kind: 'draw', tool: mode, pointerId: e.pointerId, ptrType: e.pointerType, pageIndex: i, page: p, start: pt, dx: 0, dy: 0, s: 1 };
    this._refreshPage(p);
    this._hideSelMenu();
    this._moveSel(e);
  }

  _moveSel(e) {
    const g = this.gesture;
    const pt = this._pagePoint(e, g.pageIndex);
    const b = this.sel.box;
    if (g.tool === 'move') { g.dx = pt.x - g.start.x; g.dy = pt.y - g.start.y; g.s = 1; }
    else {
      const w0 = Math.max(4, b.w), h0 = Math.max(4, b.h);
      const s = Math.max((pt.x - b.x) / w0, (pt.y - b.y) / h0);
      g.s = Math.max(0.1, Math.min(10, s)); g.dx = 0; g.dy = 0;
    }
    this._clearOverlay();
    const ctx = this._overlayFor(g.pageIndex);
    for (const o of this.sel.orig) drawObj(ctx, transformObj(o, g.dx, g.dy, g.s, b.x, b.y));
    const z = this.zoom;
    this.sel.el.style.transform = g.tool === 'move' ? `translate(${g.dx * z}px, ${g.dy * z}px)` : '';
    if (g.tool === 'scale') {
      Object.assign(this.sel.el.style, { width: (b.w * g.s * z + 12) + 'px', height: (b.h * g.s * z + 12) + 'px' });
    }
  }

  _endMove(g) {
    const sel = this.sel;
    if (!sel) return;
    sel.moving = false;
    sel.el.style.transform = '';
    this._clearOverlay();
    const p = this.pageById(sel.pageId);
    const b = sel.box;
    const changed = g.tool === 'move' ? Math.hypot(g.dx, g.dy) * this.zoom > 1 : Math.abs(g.s - 1) > 0.005;
    if (changed) {
      const map = new Map(sel.orig.map(o => [o.id, transformObj(o, g.dx, g.dy, g.s, b.x, b.y)]));
      this._setObjs(p, p.objs.map(o => map.get(o.id) || o), g.tool === 'move' ? 'mover' : 'redimensionar');
      sel.box = unionBox([...map.values()]);
    }
    this._refreshPage(p);
    this._placeSelection();
  }

  // ---------------- copiar / colar ----------------
  copySelection() {
    const objs = this.selectedObjs();
    if (!objs.length) return false;
    const b = unionBox(objs);
    this.clip = { w: b.w, h: b.h, objs: objs.map(o => transformObj(o, -b.x, -b.y)), t: Date.now() };
    try { localStorage.setItem('caderno.clip', JSON.stringify(this.clip)); } catch {}
    this.hooks.onClip?.(this.clip);
    return true;
  }

  cutSelection() { if (this.copySelection()) this.deleteSelection(); }

  deleteSelection() {
    if (!this.sel) return;
    const p = this.pageById(this.sel.pageId);
    const ids = this.sel.ids;
    this.clearSelection();
    this._setObjs(p, p.objs.filter(o => !ids.has(o.id)), 'excluir');
    this._refreshPage(p);
  }

  duplicateSelection() {
    const objs = this.selectedObjs();
    if (!objs.length) return;
    const p = this.pageById(this.sel.pageId);
    const off = 12;
    const copies = objs.map(o => transformObj(o, off, off, 1, 0, 0, false));
    this._setObjs(p, [...p.objs, ...copies], 'duplicar');
    this._refreshPage(p);
    this.select(p, copies.map(o => o.id));
  }

  recolorSelection(color) {
    if (!this.sel) return;
    const p = this.pageById(this.sel.pageId);
    const ids = this.sel.ids;
    this._setObjs(p, p.objs.map(o => ids.has(o.id) ? { ...o, color } : o), 'cor');
    this._refreshPage(p);
  }

  selectionAsStamp() {
    const objs = this.selectedObjs();
    if (!objs.length) return null;
    const b = unionBox(objs);
    return { w: b.w, h: b.h, objs: objs.map(o => transformObj(o, -b.x, -b.y)) };
  }

  // cola o conteúdo da área de transferência no centro da tela atual
  pasteCenter() {
    if (!this.clip) return;
    const i = this.currentPageIndex();
    const p = this.pages[i], L = this.layout[i];
    const cx = (this.viewer.scrollLeft + this.viewer.clientWidth / 2 - L.x) / this.zoom;
    const cy = (this.viewer.scrollTop + this.viewer.clientHeight / 2 - L.y) / this.zoom;
    const pt = { x: Math.max(this.clip.w / 2, Math.min(p.w - this.clip.w / 2, cx)), y: Math.max(this.clip.h / 2, Math.min(p.h - this.clip.h / 2, cy)) };
    const ids = this._place(p, this.clip, pt);
    this.select(p, ids);
  }

  _pasteAt(p, pt) {
    if (!this.stamp) return;
    const s = this.stamp;
    const ids = this._place(p, s, pt);
    if (s.objs.some(o => o.t === 'img')) { this.setTool('lasso'); this.select(p, ids); this.hooks.onTool?.(); }
  }

  // ---------------- recorte (snip) ----------------
  startSnip() {
    this._closeText(); this.clearSelection(); this._endShapeEdit();
    this.snipping = true;
    this.viewer.classList.add('snipping');
  }
  cancelSnip() { this.snipping = false; this.viewer.classList.remove('snipping'); this._clearOverlay(); }

  _drawSnipRect(g) {
    this._clearOverlay();
    const vr = this.viewer.getBoundingClientRect(), d = this.dpr, ctx = this.octx;
    const x = (Math.min(g.sx, g.ex) - vr.left) * d, y = (Math.min(g.sy, g.ey) - vr.top) * d;
    const w = Math.abs(g.ex - g.sx) * d, hh = Math.abs(g.ey - g.sy) * d;
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = 'rgba(0, 0, 128, .12)'; ctx.fillRect(x, y, w, hh);
    ctx.setLineDash([6 * d, 4 * d]); ctx.lineWidth = 1.5 * d; ctx.strokeStyle = '#000080'; ctx.strokeRect(x, y, w, hh);
    ctx.restore();
  }

  async _finishSnip(g, cancel) {
    this.cancelSnip();
    if (cancel || Math.abs(g.ex - g.sx) < 8 || Math.abs(g.ey - g.sy) < 8) return;
    const mid = { clientX: (g.sx + g.ex) / 2, clientY: (g.sy + g.ey) / 2 };
    let i = this._pageAtEvent(mid);
    if (i < 0) i = g.pageIndex;
    if (i == null || i < 0) return;
    const p = this.pages[i];
    const a = this._pagePoint({ clientX: Math.min(g.sx, g.ex), clientY: Math.min(g.sy, g.ey) }, i);
    const b = this._pagePoint({ clientX: Math.max(g.sx, g.ex), clientY: Math.max(g.sy, g.ey) }, i);
    const r = { x: Math.max(0, a.x), y: Math.max(0, a.y) };
    r.w = Math.min(p.w, b.x) - r.x; r.h = Math.min(p.h, b.y) - r.y;
    if (r.w < 3 || r.h < 3) return;
    const scale = Math.min(4, Math.sqrt(4e6 / (r.w * r.h)), Math.max(2, this.dpr * this.zoom));
    const c = await this.renderRegion(p, r, scale);
    if (!c) return;
    const src = c.toDataURL('image/jpeg', 0.9);
    c.width = 0;
    this.hooks.onSnip?.({ src, w: r.w, h: r.h });
  }

  _place(p, s, pt) {
    const objs = s.objs.map(o => transformObj(o, pt.x - s.w / 2, pt.y - s.h / 2, 1, 0, 0, false));
    this._setObjs(p, [...p.objs, ...objs], 'colar');
    for (const o of objs) this._inkAdd(p, o);
    return objs.map(o => o.id);
  }

  // ---------------- texto ----------------
  _openText(i, pt, existing = null) {
    const p = this.pages[i];
    if (!existing) {
      const r = 6 / this.zoom;
      existing = [...p.objs].reverse().find(o => o.t === 'text' && hitObj(o, pt.x, pt.y, r)) || null;
    }
    const c = this.cfg.text;
    const ta = document.createElement('textarea');
    ta.className = 'text-ed';
    ta.spellcheck = true;
    ta.setAttribute('autocapitalize', 'sentences');
    const o = existing || { t: 'text', id: newId(), x: pt.x, y: pt.y - c.size * 0.6, text: '', size: c.size, color: c.color };
    ta.value = o.text;
    this.textEd = { pageId: p.id, obj: o, el: ta, existing: !!existing };
    if (existing) { p.objs = p.objs.filter(x => x.id !== existing.id); this._refreshPage(p); }
    this.views.get(p.id).el.appendChild(ta);
    this._placeText();
    ta.addEventListener('input', () => this._placeText());
    ta.addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); this._closeText(); } e.stopPropagation(); });
    ta.addEventListener('blur', () => setTimeout(() => { if (this.textEd?.el === ta && document.activeElement !== ta) this._closeText(); }, 150));
    // foco imediato (dentro do toque) para o teclado do Android abrir
    ta.focus({ preventScroll: true });
    setTimeout(() => { if (this.textEd?.el === ta && document.activeElement !== ta) ta.focus({ preventScroll: true }); }, 40);
  }

  _placeText() {
    const t = this.textEd;
    if (!t) return;
    const z = this.zoom, o = t.obj, el = t.el;
    el.style.left = o.x * z + 'px';
    el.style.top = o.y * z + 'px';
    el.style.fontSize = o.size * z + 'px';
    el.style.color = o.color;
    el.style.width = '10px'; el.style.height = '10px';
    el.style.width = Math.max(120, el.scrollWidth + 16) + 'px';
    el.style.height = el.scrollHeight + 4 + 'px';
  }

  _closeText(discard = false) {
    const t = this.textEd;
    if (!t) return;
    this.textEd = null;
    t.el.remove();
    const p = this.pageById(t.pageId);
    if (!p) return;
    const text = t.el.value.replace(/\s+$/, '');
    const before = t.existing ? [...p.objs, t.obj] : p.objs;
    if (discard) { p.objs = before; this._refreshPage(p); return; }
    p.objs = before;
    if (!text) { if (t.existing) this._setObjs(p, before.filter(o => o.id !== t.obj.id), 'texto'); }
    else if (!t.existing || text !== t.obj.text) {
      const n = { ...t.obj, text };
      this._setObjs(p, t.existing ? before.map(o => o.id === n.id ? n : o) : [...before, n], 'texto');
    }
    this._refreshPage(p);
  }

  // ---------------- teclado ----------------
  _key(e) {
    if (!this.doc || this.root.hidden) return;
    if (e.target.matches('input, textarea, [contenteditable]')) return;
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    if (mod && k === 'z' && !e.shiftKey) { e.preventDefault(); this.undo(); }
    else if (mod && (k === 'y' || (k === 'z' && e.shiftKey))) { e.preventDefault(); this.redo(); }
    else if (mod && k === 'c') { if (this.copySelection()) { e.preventDefault(); this.hooks.onToast?.('Copiado'); } }
    else if (mod && k === 'x') { e.preventDefault(); this.cutSelection(); }
    else if (mod && k === 'v') { e.preventDefault(); this.pasteCenter(); }
    else if (mod && k === 'd') { e.preventDefault(); this.duplicateSelection(); }
    else if ((k === 'delete' || k === 'backspace') && this.sel) { e.preventDefault(); this.deleteSelection(); }
    else if (k === 'escape') { this.clearSelection(); if (this.tool === 'paste') this.setTool('pen'); }
  }
}
