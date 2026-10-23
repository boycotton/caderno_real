import { Editor } from './editor.js';
import { openPdf, buildPdf, templatePage } from './pdfio.js';
import { store, prefs, setPref, persistStorage } from './store.js';
import { drawTemplateCanvas, PAPERS, KINDS, SPACINGS, DEFAULT_TPL, pageSize, tplLabel } from './templates.js';
import { drawObj, newId } from './ink.js';
import * as drive from './drive.js';
import { driveExplorer } from './explorer.js';
import { icon, $, $$, h, esc, toast, modal, confirmBox, promptBox, popover, closePopovers, fmtDate, fmtSize } from './ui.js';

const COLORS = ['#1a1a1a', '#1f4fd1', '#d32f2f', '#2e7d32', '#f4846a', '#8e24aa', '#ef6c00', '#00838f', '#795548', '#ffffff'];
const MARKER_COLORS = ['#ffd400', '#7ee36f', '#ff86c8', '#6ec6ff', '#ffb74d', '#c792ea'];
const SIZES = {
  pen: [1, 2.2, 3.5, 6], pencil: [0.8, 1.6, 2.6, 4], marker: [8, 14, 22, 32],
  shape: [0.8, 1.6, 3, 5], text: [10, 14, 20, 28], eraser: [10, 16, 28, 48],
};
const TOOLS = [
  ['pen', 'pen', 'Caneta'], ['pencil', 'pencil', 'Lápis'], ['marker', 'marker', 'Marca-texto'],
  ['eraser', 'eraser', 'Borracha'], ['shape', 'shapes', 'Formas'], ['text', 'text', 'Texto'], ['lasso', 'lasso', 'Laço (selecionar)'],
];
const SHAPES = [['line', 'Linha'], ['arrow', 'Seta'], ['rect', 'Retângulo'], ['ellipse', 'Elipse / círculo'], ['triangle', 'Triângulo'], ['rtriangle', 'Triângulo retângulo']];

let ed;           // Editor
let cur = null;   // documento aberto
let saving = false;
let autosaveTimer;

// ============================================================ início
window.addEventListener('DOMContentLoaded', init);

function init() {
  buildEditorChrome();
  ed = new Editor($('#editor'), {
    onChange: () => { if (cur) { cur.dirty = true; updateSaveState(); scheduleAutosave(); } },
    onHistory: () => { $('#b-undo').disabled = !ed.canUndo(); $('#b-redo').disabled = !ed.canRedo(); },
    onTool: () => renderToolbar(),
    onPage: (i, n) => { $('#pageind').textContent = `${i + 1}/${n}`; },
    onZoom: z => { $('#zoomind').textContent = z + '%'; },
    onSelection: () => {},
    onClip: () => renderToolbar(),
    onToast: m => toast(m, { ms: 4200 }),
    onPenOnly: () => renderToolbar(),
  });
  window.__caderno = { get ed() { return ed; }, get doc() { return cur; } };
  showHome();
  persistStorage();
  // Abrir PDF pelo "Abrir com" do sistema (quando o navegador suporta)
  if ('launchQueue' in window) window.launchQueue.setConsumer(async lp => {
    const fh = lp.files?.[0];
    if (!fh) return;
    const f = await fh.getFile();
    openFromBytes(new Uint8Array(await f.arrayBuffer()), { name: f.name.replace(/\.pdf$/i, ''), source: { t: 'local' } });
  });
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
  window.addEventListener('beforeunload', e => { if (cur?.dirty) { saveLocal(); } });
  document.addEventListener('visibilitychange', () => { if (document.hidden && cur) saveLocal(); });
}

// ============================================================ tela inicial
async function showHome() {
  if (cur) { await saveLocal(); }
  cur = null;
  $('#editor').hidden = true;
  $('#home').hidden = false;
  closePopovers();
  const home = $('#home');
  home.innerHTML = `
    <div class="geo-wrap">
      <header class="geo-head">
        <span class="logo">${icon('pen')}</span>
        <h1 class="wordart">Caderno PDF</h1>
      </header>
      <section class="window files-win">
        <div class="win-title"><span class="win-title-text">${icon('folder', 'sm')} Arquivos</span></div>
        <div class="win-body" id="home-drive"></div>
      </section>
    </div>
    <input type="file" id="h-file" accept="application/pdf,.pdf" hidden>`;
  driveExplorer($('#home-drive'), {
    mode: 'browse',
    on: {
      openFile: openDriveFile,
      newNote: folder => newNoteDialog(drive.isSignedIn() ? folder : undefined),
      configure: openSettings,
      openLocal: () => $('#h-file').click(),
      renderLocal: el => renderRecents(el),
      pickFolder: title => driveBrowser({ mode: 'folder', title, button: 'Mover para cá' }),
    },
  });
  $('#h-file').onchange = async e => {
    const f = e.target.files[0];
    if (!f) return;
    const bytes = new Uint8Array(await f.arrayBuffer());
    await openFromBytes(bytes, { name: f.name.replace(/\.pdf$/i, ''), source: { t: 'local' } });
  };
}

async function renderRecents(list) {
  const docs = await store.listDocs().catch(() => []);
  list.innerHTML = '';
  if (!docs.length) { list.innerHTML = '<p class="pad muted">Vazio.</p>'; return 0; }
  for (const d of docs) {
    const src = d.source?.t === 'drive' ? icon('drive', 'sm') : d.source?.t === 'local' ? icon('folder', 'sm') : icon('file', 'sm');
    const el = h(`<div class="d-row" role="listitem" tabindex="0">
      <span class="r-thumb"></span>
      <span class="d-name">${esc(d.name)}${d.dirty ? ' <span class="badge warn">não enviado</span>' : ''}</span>
      <span class="d-meta">${src}</span>
      <span class="d-meta d-date">${fmtDate(d.updatedAt)}</span>
      <button class="btn tiny-btn d-more" title="Opções">${icon('more', 'sm')}</button></div>`);
    el.addEventListener('click', ev => { if (!ev.target.closest('.d-more')) resumeDoc(d.id); });
    $('.d-more', el).onclick = ev => popover(ev.currentTarget, (pop, close) => {
      pop.append(menuItem('trash', 'Remover deste tablet', async () => {
        close();
        if (d.dirty && !(await confirmBox('Remover?', 'Há alterações não salvas no Drive. Remover mesmo assim?', { ok: 'Remover', danger: true }))) return;
        await store.deleteDoc(d.id); renderRecents(list);
      }));
    }, { align: 'right' });
    list.appendChild(el);
    drawRecentThumb($('.r-thumb', el), d);
  }
  return docs.length;
}

function drawRecentThumb(holder, d) {
  const p = d.pages?.[0];
  if (!p) return;
  const c = document.createElement('canvas');
  const s = 56 / p.h;
  c.width = Math.round(p.w * s * 2); c.height = Math.round(p.h * s * 2);
  const ctx = c.getContext('2d');
  ctx.setTransform(s * 2, 0, 0, s * 2, 0, 0);
  if (p.src.t === 'tpl' || p.tpl) drawTemplateCanvas(ctx, p.tpl || DEFAULT_TPL, p.w, p.h);
  else { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, p.w, p.h); }
  for (const o of p.objs || []) drawObj(ctx, o);
  holder.appendChild(c);
}

function menuItem(ic, label, fn, extra = '') {
  const b = h(`<button class="menu-item ${extra}">${icon(ic)}<span>${esc(label)}</span></button>`);
  b.onclick = fn;
  return b;
}

// ============================================================ abrir / criar
function busy(msg) {
  const el = $('#busy');
  if (msg === false) { el.hidden = true; return; }
  el.hidden = false;
  $('#busy-msg').textContent = msg;
}

async function openFromBytes(bytes, { name, source }) {
  busy('Abrindo PDF…');
  try {
    const r = await openPdf(bytes);
    const id = newId();
    cur = { id, name, source, baseBytes: bytes, pages: r.pages, pdf: r.pdf, ocConfig: r.ocConfig, dirty: false };
    await store.putBytes(id, bytes);
    await saveLocal();
    enterEditor();
    if (r.encrypted) toast('Este PDF é protegido; salvar pode não funcionar.', { kind: 'warn', ms: 5000 });
  } catch (e) {
    console.error(e);
    toast('Não foi possível abrir: ' + (e.message || e), { kind: 'err', ms: 6000 });
  } finally { busy(false); }
}

async function resumeDoc(id) {
  busy('Abrindo…');
  try {
    const d = await store.getDoc(id);
    const bytes = await store.getBytes(id);
    let pdf = null, ocConfig = null;
    if (bytes) {
      const r = await openPdf(bytes);
      pdf = r.pdf; ocConfig = r.ocConfig;
      for (const p of d.pages) if (p.src.t === 'pdf' && p.src.i >= r.pages.length) p.src = { t: 'tpl' };
    }
    cur = { ...d, baseBytes: bytes || null, pdf, ocConfig };
    enterEditor();
  } catch (e) {
    console.error(e);
    toast('Não foi possível abrir: ' + (e.message || e), { kind: 'err', ms: 6000 });
  } finally { busy(false); }
}

function enterEditor() {
  $('#home').hidden = true;
  $('#editor').hidden = false;
  $('#doc-title').textContent = cur.name;
  ed.setDoc(cur);
  if (!ed.tool) ed.setTool('pen');
  renderToolbar();
  updateSaveState();
  requestAnimationFrame(() => ed._onResize());
}

async function newNoteDialog(folder = null) {
  const r = await templateDialog({ title: folder ? `Nova nota em “${folder.name}”` : 'Nova nota', forNew: true });
  if (!r) return;
  const pages = Array.from({ length: r.count }, () => templatePage(r.tpl));
  const source = folder ? { t: 'new', parentId: folder.id, parentName: folder.name } : { t: 'new' };
  cur = { id: newId(), name: r.name, source, baseBytes: null, pages, pdf: null, ocConfig: null, dirty: true };
  setPref('lastTpl', r.tpl);
  await saveLocal();
  enterEditor();
}

// ============================================================ escolha de modelo
function templateDialog({ title, forNew = false, initial }) {
  const tpl = { ...DEFAULT_TPL, ...(initial || prefs().lastTpl || {}) };
  let name = `Nota ${new Date().toLocaleDateString('pt-BR')}`;
  let count = 1;
  return modal({
    title, wide: true, className: 'tpl-modal',
    build: (b) => {
      b.innerHTML = `
        ${forNew ? `<label class="lbl">Nome<input class="field" id="t-name" value="${esc(name)}"></label>` : ''}
        <div class="lbl">Tipo de folha</div>
        <div class="tpl-grid" id="t-kinds"></div>
        <div class="opt-row">
          <div><div class="lbl">Cor do papel</div><div class="chips" id="t-paper"></div></div>
          <div id="t-sp-wrap"><div class="lbl">Tamanho do quadrado / linha</div><div class="chips" id="t-sp"></div></div>
        </div>
        <div class="opt-row">
          <div><div class="lbl">Orientação</div><div class="chips" id="t-or"></div></div>
          ${forNew ? `<div><div class="lbl">Páginas</div><div class="chips" id="t-count"></div></div>` : ''}
        </div>`;
      const paint = () => {
        const kinds = $('#t-kinds', b); kinds.innerHTML = '';
        for (const k of Object.keys(KINDS)) {
          const t = { ...tpl, kind: k };
          const card = h(`<button class="tpl-card ${tpl.kind === k ? 'on' : ''}"><span class="prev"></span><span>${KINDS[k]}</span></button>`);
          card.onclick = () => { tpl.kind = k; paint(); };
          $('.prev', card).appendChild(tplPreview(t, 92));
          kinds.appendChild(card);
        }
        const pc = $('#t-paper', b); pc.innerHTML = '';
        for (const [k, p] of Object.entries(PAPERS)) {
          const c = h(`<button class="chip swatch-chip ${tpl.paper === k ? 'on' : ''}" title="${esc(p.nome)}"><span class="sw" style="background:${p.bg};border-color:${p.line}"></span>${esc(p.nome.split(' (')[0])}</button>`);
          c.onclick = () => { tpl.paper = k; paint(); };
          pc.appendChild(c);
        }
        const sp = $('#t-sp', b); sp.innerHTML = '';
        $('#t-sp-wrap', b).style.visibility = ['grid', 'lines', 'dots', 'cornell'].includes(tpl.kind) ? 'visible' : 'hidden';
        for (const s of SPACINGS) {
          const c = h(`<button class="chip ${tpl.spacing === s ? 'on' : ''}">${String(s).replace('.', ',')} mm${s === 8.6 ? ' (exemplo)' : ''}</button>`);
          c.onclick = () => { tpl.spacing = s; paint(); };
          sp.appendChild(c);
        }
        const or = $('#t-or', b); or.innerHTML = '';
        for (const [k, l] of [['portrait', 'Retrato (A4 em pé)'], ['landscape', 'Paisagem (A4 deitado)']]) {
          const c = h(`<button class="chip ${tpl.orient === k ? 'on' : ''}">${l}</button>`);
          c.onclick = () => { tpl.orient = k; paint(); };
          or.appendChild(c);
        }
        const cc = $('#t-count', b);
        if (cc) {
          cc.innerHTML = '';
          for (const n of [1, 5, 10, 20]) {
            const c = h(`<button class="chip ${count === n ? 'on' : ''}">${n}</button>`);
            c.onclick = () => { count = n; paint(); };
            cc.appendChild(c);
          }
        }
      };
      paint();
      const ni = $('#t-name', b);
      if (ni) ni.oninput = () => { name = ni.value; };
    },
    actions: [
      { label: 'Cancelar', value: () => null },
      { label: forNew ? 'Criar' : 'Adicionar', primary: true, value: () => ({ tpl: { ...tpl }, name: (name || 'Nota').trim(), count }) },
    ],
  });
}

function tplPreview(tpl, height) {
  const { w, h: hh } = pageSize(tpl);
  const c = document.createElement('canvas');
  const s = height / hh;
  const dpr = Math.min(2, devicePixelRatio || 1);
  c.width = Math.round(w * s * dpr); c.height = Math.round(hh * s * dpr);
  c.style.width = Math.round(w * s) + 'px'; c.style.height = height + 'px';
  const ctx = c.getContext('2d');
  // amplia o desenho do padrão para ficar legível na miniatura
  const zoom = 2.2;
  ctx.setTransform(s * dpr * zoom, 0, 0, s * dpr * zoom, 0, 0);
  drawTemplateCanvas(ctx, tpl, w / zoom + 1, hh / zoom + 1);
  return c;
}

// ============================================================ barra de ferramentas
function buildEditorChrome() {
  const e = $('#editor');
  e.innerHTML = `
    <header class="topbar">
      <div class="tb-group">
        <button class="icon-btn" id="b-home" title="Fechar e voltar ao início">${icon('back')}</button>
        <button class="icon-btn" id="b-undo" title="Desfazer">${icon('undo')}</button>
        <button class="icon-btn" id="b-redo" title="Refazer">${icon('redo')}</button>
      </div>
      <div class="tb-group tools" id="tools"></div>
      <div class="tb-group">
        <button class="icon-btn" id="b-paste" title="Colar (toque na página)">${icon('paste')}</button>
        <button class="icon-btn" id="b-stamps" title="Carimbos salvos">${icon('stamp')}</button>
      </div>
      <div class="optbar" id="optbar"></div>
      <div class="tb-group tb-right">
        <button class="icon-btn" id="b-spen" title="Só a S Pen desenha">${icon('spen')}</button>
        <button class="icon-btn" id="b-pages" title="Páginas">${icon('pages')}</button>
        <button class="save-btn" id="b-save" title="Salvar">${icon('floppy')}<span id="save-lbl">Salvar</span></button>
        <button class="icon-btn" id="b-more" title="Mais">${icon('more')}</button>
      </div>
    </header>
    <div id="stage">
      <div id="viewer"><div id="sheet"></div></div>
      <canvas id="overlay"></canvas>
      <div id="selmenu" class="selmenu" hidden></div>
      <button class="fab" id="b-addpage" title="Adicionar página">${icon('plus')}</button>
      <aside id="pagepanel" class="pagepanel" hidden></aside>
    </div>
    <footer class="statusbar">
      <button class="sb-panel sb-title" id="b-title" title="Renomear"><span id="doc-src"></span><span id="doc-title"></span></button>
      <span class="sb-panel sb-grow" id="st-save">Pronto</span>
      <span class="sb-panel" id="pageind">1 / 1</span>
      <button class="sb-panel" id="b-fitw" title="Ajustar à largura"><span id="zoomind">100%</span></button>
    </footer>`;
  $('#b-fitw').onclick = () => ed.fitWidth();

  const tools = $('#tools');
  for (const [id, ic, label] of TOOLS) {
    const b = h(`<button class="tool" data-tool="${id}" title="${label}">${icon(ic)}<span class="tool-dot"></span></button>`);
    b.onclick = () => {
      if (ed.tool === id && id === 'shape') return shapeMenu(b);
      ed.setTool(id);
    };
    tools.appendChild(b);
  }
  $('#b-home').onclick = leaveEditor;
  $('#b-title').onclick = renameDoc;
  $('#b-undo').onclick = () => ed.undo();
  $('#b-redo').onclick = () => ed.redo();
  $('#b-paste').onclick = () => {
    if (!ed.clip) return toast('Nada copiado ainda. Selecione com o laço e toque em Copiar.');
    ed.setTool('paste', { stamp: ed.clip });
    toast('Toque na página para colar. Cada toque cola mais uma cópia.');
  };
  $('#b-stamps').onclick = ev => stampsMenu(ev.currentTarget);
  $('#b-spen').onclick = () => {
    ed.setPenOnly(!ed.penOnly);
    toast(ed.penOnly ? 'Só a S Pen desenha. Dedo: rolar e zoom.' : 'Dedo também desenha. Dois dedos: rolar e zoom.');
  };
  $('#b-pages').onclick = togglePagePanel;
  $('#b-save').onclick = () => saveDoc();
  $('#b-more').onclick = ev => moreMenu(ev.currentTarget);
  $('#b-addpage').onclick = () => addPageDialog();

  const sm = $('#selmenu');
  const smBtn = (ic, label, fn) => { const b = h(`<button title="${label}">${icon(ic)}<span>${label}</span></button>`); b.onclick = fn; sm.appendChild(b); };
  smBtn('copy', 'Copiar', () => { ed.copySelection(); renderToolbar(); toast('Copiado. Toque em Colar e depois na página.'); });
  smBtn('cut', 'Recortar', () => { ed.cutSelection(); renderToolbar(); });
  smBtn('dup', 'Duplicar', () => ed.duplicateSelection());
  smBtn('palette', 'Cor', ev => colorPop(ev.currentTarget, c => ed.recolorSelection(c)));
  smBtn('stamp', 'Carimbo', saveSelectionAsStamp);
  smBtn('trash', 'Excluir', () => ed.deleteSelection());
}

function renderToolbar() {
  if (!ed) return;
  for (const b of $$('#tools .tool')) {
    const t = b.dataset.tool;
    b.classList.toggle('on', ed.tool === t);
    const dot = $('.tool-dot', b);
    const c = ed.cfg[t]?.color;
    dot.style.background = c || 'transparent';
    dot.style.display = c ? '' : 'none';
    if (t === 'shape') b.innerHTML = icon(ed.cfg.shape.kind) + b.innerHTML.replace(/^<svg[\s\S]*?<\/svg>/, '');
  }
  $('#b-paste').classList.toggle('on', ed.tool === 'paste');
  $('#b-paste').disabled = !ed.clip;
  $('#b-spen').classList.toggle('on', ed.penOnly);
  renderOptbar();
}

function renderOptbar() {
  const ob = $('#optbar');
  const t = ed.tool;
  ob.innerHTML = '';
  if (t === 'paste') {
    ob.innerHTML = `<span class="hint">${icon('paste', 'sm')} Toque para colar (cada toque = 1 cópia)</span>`;
    return;
  }
  if (t === 'lasso') {
    ob.innerHTML = `<span class="hint">${icon('lasso', 'sm')} Circule ou toque para selecionar</span>`;
    if (ed.clip) { const b = h(`<button class="chip">${icon('paste', 'sm')} Colar</button>`); b.onclick = () => ed.pasteCenter(); ob.appendChild(b); }
    return;
  }
  const cfg = ed.cfg[t];
  if (t !== 'eraser') {
    const sw = h('<div class="swatches"></div>');
    const colors = t === 'marker' ? MARKER_COLORS : COLORS;
    for (const c of colors) {
      const b = h(`<button class="swatch ${cfg.color.toLowerCase() === c ? 'on' : ''}" style="--c:${c}" title="${c}"></button>`);
      b.onclick = () => { ed.setCfg(t, { color: c }); renderToolbar(); };
      sw.appendChild(b);
    }
    const custom = h(`<label class="swatch custom ${colors.includes(cfg.color.toLowerCase()) ? '' : 'on'}" style="--c:${cfg.color}" title="Outra cor"><input type="color" value="${cfg.color}"></label>`);
    $('input', custom).oninput = e => { ed.setCfg(t, { color: e.target.value }); custom.style.setProperty('--c', e.target.value); };
    $('input', custom).onchange = () => renderToolbar();
    sw.appendChild(custom);
    ob.appendChild(sw);
  } else ob.appendChild(h(`<span class="hint">${icon('eraser', 'sm')} Apaga o traço inteiro</span>`));

  const sizes = h('<div class="sizes"></div>');
  for (const s of SIZES[t]) {
    const vis = t === 'text' ? `<span class="aa" style="font-size:${8 + s / 2.2}px">A</span>` : `<span class="dot" style="width:${Math.min(26, 3 + s * (t === 'marker' ? 0.7 : t === 'eraser' ? 0.45 : 2.2))}px;height:${Math.min(26, 3 + s * (t === 'marker' ? 0.7 : t === 'eraser' ? 0.45 : 2.2))}px"></span>`;
    const b = h(`<button class="size ${Math.abs(cfg.size - s) < 0.01 ? 'on' : ''}" title="${String(s).replace('.', ',')}">${vis}</button>`);
    b.onclick = () => { ed.setCfg(t, { size: s }); renderOptbar(); };
    sizes.appendChild(b);
  }
  ob.appendChild(sizes);

  if (t === 'shape') {
    const sh = h('<div class="shapes"></div>');
    for (const [k, l] of SHAPES) {
      const b = h(`<button class="size ${cfg.kind === k ? 'on' : ''}" title="${l}">${icon(k)}</button>`);
      b.onclick = () => { ed.setCfg('shape', { kind: k }); renderToolbar(); };
      sh.appendChild(b);
    }
    const fill = h(`<button class="chip ${cfg.fill ? 'on' : ''}">Preencher</button>`);
    fill.onclick = () => { ed.setCfg('shape', { fill: cfg.fill ? null : cfg.color }); renderOptbar(); };
    sh.appendChild(fill);
    ob.appendChild(sh);
  }
}

function shapeMenu(anchor) {
  popover(anchor, (pop, close) => {
    for (const [k, l] of SHAPES) pop.append(menuItem(k, l, () => { ed.setCfg('shape', { kind: k }); close(); renderToolbar(); }, ed.cfg.shape.kind === k ? 'on' : ''));
  });
}

function colorPop(anchor, fn) {
  popover(anchor, (pop, close) => {
    const sw = h('<div class="swatches pad"></div>');
    for (const c of [...COLORS, ...MARKER_COLORS]) {
      const b = h(`<button class="swatch" style="--c:${c}"></button>`);
      b.onclick = () => { fn(c); close(); };
      sw.appendChild(b);
    }
    pop.appendChild(sw);
  });
}

// ============================================================ carimbos (itens reutilizáveis)
async function getStamps() { return (await store.get('stamps')) || []; }

async function saveSelectionAsStamp() {
  const s = ed.selectionAsStamp();
  if (!s) return;
  const name = await promptBox('Salvar como carimbo', 'Item', { ok: 'Salvar', placeholder: 'Nome (ex.: resistor, capacitor)' });
  if (name == null) return;
  const list = await getStamps();
  list.unshift({ id: newId(), name: name || 'Item', ...s });
  await store.set('stamps', list.slice(0, 60));
  toast('Carimbo salvo. Abra pelo botão de carimbos.');
}

async function stampsMenu(anchor) {
  const list = await getStamps();
  popover(anchor, (pop, close) => {
    pop.classList.add('stamps-pop');
    pop.innerHTML = `<div class="pop-title">Carimbos</div>`;
    if (!list.length) pop.appendChild(h('<p class="muted small pad">Selecione algo com o laço e toque em “Carimbo” para guardar aqui. Depois é só tocar para colar quantas vezes quiser — em qualquer documento.</p>'));
    const grid = h('<div class="stamp-grid"></div>');
    for (const s of list) {
      const b = h(`<div class="stamp"><button class="st-use"><span class="st-prev"></span><small>${esc(s.name)}</small></button><button class="st-del" title="Excluir">${icon('x', 'sm')}</button></div>`);
      $('.st-prev', b).appendChild(stampThumb(s));
      $('.st-use', b).onclick = () => { close(); ed.setTool('paste', { stamp: s }); toast(`Toque na página para colar “${s.name}”.`); };
      $('.st-del', b).onclick = async ev => {
        ev.stopPropagation();
        const all = (await getStamps()).filter(x => x.id !== s.id);
        await store.set('stamps', all); b.remove();
      };
      grid.appendChild(b);
    }
    pop.appendChild(grid);
  }, { align: 'right' });
}

function stampThumb(s) {
  const c = document.createElement('canvas');
  const box = 64, dpr = 2;
  const sc = Math.min(box / Math.max(1, s.w), box / Math.max(1, s.h), 3);
  c.width = box * dpr; c.height = box * dpr;
  c.style.width = box + 'px'; c.style.height = box + 'px';
  const ctx = c.getContext('2d');
  ctx.setTransform(sc * dpr, 0, 0, sc * dpr, (box - s.w * sc) / 2 * dpr, (box - s.h * sc) / 2 * dpr);
  for (const o of s.objs) drawObj(ctx, o);
  return c;
}

// ============================================================ páginas
async function addPageDialog() {
  const i = ed.currentPageIndex();
  const p = ed.pages[i];
  const r = await templateDialog({ title: 'Adicionar página', initial: p?.tpl || prefs().lastTpl });
  if (!r) return;
  setPref('lastTpl', r.tpl);
  ed.insertPage(templatePage(r.tpl), i + 1);
  ed.scrollToPage(i + 1, true);
  if (!$('#pagepanel').hidden) renderPagePanel();
}

function togglePagePanel() {
  const pp = $('#pagepanel');
  pp.hidden = !pp.hidden;
  $('#b-pages').classList.toggle('on', !pp.hidden);
  if (!pp.hidden) renderPagePanel();
}

let thumbObs;
function renderPagePanel() {
  const pp = $('#pagepanel');
  const curI = ed.currentPageIndex();
  pp.innerHTML = `<div class="pp-head"><b>Páginas</b><span class="muted">${ed.pages.length}</span><button class="icon-btn" id="pp-close">${icon('x')}</button></div>
    <div class="pp-actions">
      <button class="chip" id="pp-add">${icon('plus', 'sm')} Nova</button>
      <button class="chip" id="pp-dup">${icon('dup', 'sm')} Duplicar</button>
      <button class="chip" id="pp-up">${icon('up', 'sm')}</button>
      <button class="chip" id="pp-down">${icon('down', 'sm')}</button>
      <button class="chip danger" id="pp-del">${icon('trash', 'sm')}</button>
    </div>
    <div class="pp-list" id="pp-list"></div>`;
  $('#pp-close').onclick = togglePagePanel;
  $('#pp-add').onclick = addPageDialog;
  $('#pp-dup').onclick = () => { const i = ed.currentPageIndex(); ed.duplicatePage(i); ed.scrollToPage(i + 1); renderPagePanel(); };
  $('#pp-up').onclick = () => { const i = ed.currentPageIndex(); ed.movePage(i, -1); ed.scrollToPage(Math.max(0, i - 1)); renderPagePanel(); };
  $('#pp-down').onclick = () => { const i = ed.currentPageIndex(); ed.movePage(i, 1); ed.scrollToPage(Math.min(ed.pages.length - 1, i + 1)); renderPagePanel(); };
  $('#pp-del').onclick = async () => {
    const i = ed.currentPageIndex();
    if (ed.pages.length <= 1) return toast('O documento precisa de pelo menos uma página.');
    if (!(await confirmBox('Excluir página?', `A página ${i + 1} será removida (dá para desfazer).`, { ok: 'Excluir', danger: true }))) return;
    ed.deletePage(i); renderPagePanel();
  };
  const list = $('#pp-list');
  thumbObs?.disconnect();
  thumbObs = new IntersectionObserver(ents => {
    for (const en of ents) if (en.isIntersecting) { thumbObs.unobserve(en.target); drawThumb(en.target); }
  }, { root: list, rootMargin: '200px' });
  ed.pages.forEach((p, i) => {
    const item = h(`<button class="pp-item ${i === curI ? 'on' : ''}"><span class="pp-thumb" style="aspect-ratio:${p.w}/${p.h}"></span><small>${i + 1}</small></button>`);
    item.onclick = () => { ed.scrollToPage(i); $$('.pp-item', list).forEach(x => x.classList.remove('on')); item.classList.add('on'); };
    item._page = p;
    list.appendChild(item);
    thumbObs.observe(item);
  });
  $('.pp-item.on', list)?.scrollIntoView({ block: 'center' });
}

async function drawThumb(item) {
  const p = item._page;
  const holder = $('.pp-thumb', item);
  const W = 150, s = W / p.w;
  const c = document.createElement('canvas');
  c.width = Math.round(p.w * s * 1.5); c.height = Math.round(p.h * s * 1.5);
  const ctx = c.getContext('2d');
  const k = c.width / p.w;
  try {
    if (p.src.t === 'tpl') { ctx.setTransform(k, 0, 0, k, 0, 0); drawTemplateCanvas(ctx, p.tpl, p.w, p.h); }
    else {
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
      const pg = await cur.pdf.getPage(p.src.i + 1);
      const params = { canvasContext: ctx, viewport: pg.getViewport({ scale: k }) };
      if (cur.ocConfig) params.optionalContentConfigPromise = Promise.resolve(cur.ocConfig);
      await pg.render(params).promise;
    }
    ctx.setTransform(k, 0, 0, k, 0, 0);
    for (const o of p.objs) drawObj(ctx, o);
  } catch {}
  holder.appendChild(c);
}

// ============================================================ menus
function moreMenu(anchor) {
  popover(anchor, (pop, close) => {
    pop.append(
      menuItem('fit', 'Ajustar à largura', () => { close(); ed.fitWidth(); }),
      menuItem('plus', 'Adicionar página', () => { close(); addPageDialog(); }),
      menuItem('trash', 'Limpar anotações desta página', async () => {
        close();
        if (await confirmBox('Limpar página?', 'Remove tudo o que você escreveu nesta página (dá para desfazer).', { ok: 'Limpar', danger: true })) ed.clearPage(ed.currentPageIndex());
      }),
      h('<hr>'),
      menuItem('drive', cur.source.t === 'drive' ? 'Salvar cópia no Drive…' : 'Salvar no Drive…', () => { close(); saveToDriveAs(); }),
      menuItem('download', 'Baixar PDF no tablet', () => { close(); downloadPdf(); }),
    );
    if (navigator.canShare) pop.append(menuItem('drive', 'Enviar ao app Drive…', () => { close(); sendToDriveApp(); }));
    if (navigator.canShare) pop.append(menuItem('upload', 'Compartilhar PDF…', () => { close(); sharePdf(); }));
    pop.append(h('<hr>'), menuItem('settings', 'Configurações', () => { close(); openSettings(); }));
  }, { align: 'right' });
}

async function renameDoc() {
  const n = await promptBox('Nome do documento', cur.name, { ok: 'Renomear' });
  if (!n) return;
  cur.name = n;
  $('#doc-title').textContent = n;
  if (cur.source.t === 'drive') cur.renamePending = true;
  cur.dirty = true; updateSaveState(); scheduleAutosave();
}

async function leaveEditor() {
  if (cur?.dirty && cur.source.t === 'drive') {
    const v = await modal({
      title: 'Enviar alterações para o Drive?',
      build: b => { b.innerHTML = '<p class="muted">As alterações ficam guardadas no tablet de qualquer forma. Você pode enviar agora ou depois.</p>'; },
      actions: [{ label: 'Sair sem enviar', value: () => 'leave' }, { label: 'Salvar no Drive', primary: true, value: () => 'save' }],
    });
    if (v === null) return;
    if (v === 'save') { const ok = await saveDoc(); if (!ok) return; }
  }
  showHome();
}

// ============================================================ salvar
function updateSaveState() {
  const b = $('#b-save'), l = $('#save-lbl');
  if (!cur || !b) return;
  const src = cur.source.t;
  $('#doc-src').innerHTML = src === 'drive' ? icon('drive', 'sm') : src === 'local' ? icon('folder', 'sm') : icon('file', 'sm');
  b.classList.toggle('dirty', !!cur.dirty);
  b.classList.toggle('busy', saving);
  l.textContent = saving ? 'Salvando…' : cur.dirty ? (src === 'drive' ? 'Salvar' : 'Salvar…') : (src === 'drive' ? 'No Drive' : 'Salvo');
  const st = $('#st-save');
  if (st) st.textContent = saving ? 'Salvando… aguarde' : cur.dirty ? (src === 'drive' ? 'Não enviado ao Drive (guardado no tablet)' : 'Guardado no tablet') : (src === 'drive' ? 'Salvo no Drive' : 'Pronto');
  b.title = src === 'drive' ? 'Salvar no Google Drive (substitui o arquivo; o Drive guarda versões anteriores)' : 'Salvar no Google Drive ou baixar';
}

function scheduleAutosave() {
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(saveLocal, 1200);
}

async function saveLocal() {
  if (!cur) return;
  clearTimeout(autosaveTimer);
  const rec = {
    id: cur.id, name: cur.name, source: cur.source, dirty: !!cur.dirty, renamePending: !!cur.renamePending,
    pages: cur.pages.map(p => ({ id: p.id, w: p.w, h: p.h, m: p.m, src: p.src, tpl: p.tpl, objs: p.objs })),
    pageCount: cur.pages.length, updatedAt: Date.now(),
  };
  try { await store.putDoc(rec); } catch (e) { console.warn('rascunho não salvo', e); }
}

async function build() {
  return buildPdf(cur.baseBytes, cur.pages, { title: cur.name });
}

// Depois de gravar, o PDF salvo passa a ser a nova base do documento
async function adoptSaved(bytes) {
  cur.pages.forEach((p, k) => { p.src = { t: 'pdf', i: k }; });
  const r = await openPdf(bytes);
  cur.baseBytes = bytes;
  cur.pdf?.destroy?.();
  cur.pdf = r.pdf; cur.ocConfig = r.ocConfig;
  ed.undoStack = ed.undoStack.filter(a => a.kind !== 'pages');
  ed.redoStack = ed.redoStack.filter(a => a.kind !== 'pages');
  ed.hooks.onHistory();
  ed.refreshAll();
  await store.putBytes(cur.id, bytes);
}

async function saveDoc() {
  if (!cur || saving) return false;
  if (cur.source.t === 'new' && cur.source.parentId && drive.isConfigured()) {
    return saveToDriveAs({ id: cur.source.parentId, name: cur.source.parentName || 'pasta' });
  }
  if (cur.source.t !== 'drive') {
    const api = drive.isConfigured();
    const v = await modal({
      title: 'Salvar',
      build: b => { b.innerHTML = '<p class="muted">Onde salvar?</p>'; },
      actions: [
        { label: 'Baixar no tablet', value: () => 'down' },
        ...(navigator.canShare ? [{ label: 'Enviar ao app Drive', primary: !api, value: () => 'app' }] : []),
        ...(api ? [{ label: 'Salvar no Google Drive', primary: true, value: () => 'drive' }] : []),
      ],
    });
    if (v === 'drive') return saveToDriveAs();
    if (v === 'down') return downloadPdf();
    if (v === 'app') return sendToDriveApp();
    return false;
  }
  saving = true; updateSaveState();
  try {
    await drive.signIn();
    const meta = await drive.getMeta(cur.source.fileId);
    if (cur.source.modifiedTime && meta.modifiedTime !== cur.source.modifiedTime) {
      saving = false; updateSaveState();
      const v = await modal({
        title: 'O arquivo mudou no Drive',
        build: b => { b.innerHTML = `<p class="muted">“${esc(meta.name)}” foi alterado em outro lugar depois que você abriu. Substituir mesmo assim? (O Drive guarda a versão anterior em “Gerenciar versões”.)</p>`; },
        actions: [{ label: 'Cancelar', value: () => null }, { label: 'Salvar como cópia', value: () => 'copy' }, { label: 'Substituir', primary: true, value: () => 'over' }],
      });
      if (v === 'copy') return saveToDriveAs();
      if (v !== 'over') return false;
      saving = true; updateSaveState();
    }
    busy('Gerando PDF…');
    const bytes = await build();
    busy('Enviando para o Drive…');
    let res = await drive.updateFile(cur.source.fileId, bytes);
    if (cur.renamePending) {
      res = await renameOnDrive(cur.source.fileId, cur.name);
      cur.renamePending = false;
    }
    cur.source = { ...cur.source, modifiedTime: res.modifiedTime };
    await adoptSaved(bytes);
    cur.dirty = false;
    await saveLocal();
    toast('Salvo no Google Drive', { kind: 'ok' });
    return true;
  } catch (e) {
    console.error(e);
    toast('Não foi possível salvar no Drive: ' + (e.message || e) + ' — suas alterações estão guardadas no tablet.', { kind: 'err', ms: 7000 });
    return false;
  } finally { saving = false; busy(false); updateSaveState(); }
}

async function renameOnDrive(id, name) {
  const t = await drive.signIn();
  const r = await fetch(`https://www.googleapis.com/drive/v3/files/${id}?supportsAllDrives=true&fields=id,name,modifiedTime,parents`, {
    method: 'PATCH', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: name.endsWith('.pdf') ? name : name + '.pdf' }),
  });
  return r.json();
}

async function saveToDriveAs(folder = null) {
  if (!drive.isConfigured()) { toast('Configure o Google Drive primeiro.'); openSettings(); return false; }
  if (!folder) folder = await driveBrowser({ mode: 'folder', startFolder: cur.source.parentId || prefs().lastFolder || 'root' });
  if (!folder) return false;
  const name = await promptBox(`Salvar em “${folder.name}” com o nome`, cur.name, { ok: 'Salvar' });
  if (!name) return false;
  saving = true; updateSaveState();
  try {
    busy('Gerando PDF…');
    const bytes = await build();
    busy('Enviando para o Drive…');
    const res = await drive.createFile(name.endsWith('.pdf') ? name : name + '.pdf', folder.id, bytes);
    setPref('lastFolder', folder.id);
    cur.name = name.replace(/\.pdf$/i, '');
    $('#doc-title').textContent = cur.name;
    cur.source = { t: 'drive', fileId: res.id, parentId: folder.id, modifiedTime: res.modifiedTime };
    cur.renamePending = false;
    await adoptSaved(bytes);
    cur.dirty = false;
    await saveLocal();
    toast(`Salvo em “${folder.name}” no Drive`, { kind: 'ok' });
    return true;
  } catch (e) {
    console.error(e);
    toast('Não foi possível salvar no Drive: ' + (e.message || e), { kind: 'err', ms: 7000 });
    return false;
  } finally { saving = false; busy(false); updateSaveState(); }
}

async function pdfBlob() {
  busy('Gerando PDF…');
  try { return new Blob([await build()], { type: 'application/pdf' }); } finally { busy(false); }
}

async function downloadPdf() {
  try {
    const blob = await pdfBlob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (cur.name || 'nota') + '.pdf';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 30000);
    if (cur.source.t !== 'drive') { cur.dirty = false; updateSaveState(); saveLocal(); }
    toast('PDF baixado (pasta Downloads).', { kind: 'ok' });
    return true;
  } catch (e) { toast('Erro ao gerar PDF: ' + e.message, { kind: 'err' }); return false; }
}

// Sem Google Cloud: gera o PDF e entrega ao app do Google Drive pela folha de compartilhamento do Android.
// (O Android só deixa abrir a lista de apps logo após um toque, então o PDF é gerado antes e o toque em "Enviar" abre a lista.)
async function sendToDriveApp() {
  let file;
  try {
    busy('Gerando PDF…');
    file = new File([await build()], (cur.name || 'nota') + '.pdf', { type: 'application/pdf' });
  } catch (e) { toast('Erro ao gerar PDF: ' + e.message, { kind: 'err' }); return false; }
  finally { busy(false); }
  if (!navigator.canShare?.({ files: [file] })) { toast('Este navegador não envia arquivos para outros apps. Use “Baixar no tablet”.', { kind: 'err' }); return false; }
  let sent = null;
  const v = await modal({
    title: 'Enviar ao Google Drive',
    build: b => { b.innerHTML = '<p>Toque em <b>Enviar</b> e escolha <b>Drive</b>.</p>'; },
    actions: [
      { label: 'Cancelar', value: () => null },
      { label: 'Enviar', primary: true, value: () => { sent = navigator.share({ files: [file], title: cur.name }); return 'go'; } },
    ],
  });
  if (v !== 'go' || !sent) return false;
  try {
    await sent;
    if (cur.source.t !== 'drive') { cur.dirty = false; updateSaveState(); saveLocal(); }
    toast('Enviado. Confira no app do Drive.', { kind: 'ok' });
    return true;
  } catch (e) { if (e.name !== 'AbortError') toast('Não foi possível enviar: ' + e.message, { kind: 'err' }); return false; }
}

async function sharePdf() {
  try {
    const blob = await pdfBlob();
    const file = new File([blob], (cur.name || 'nota') + '.pdf', { type: 'application/pdf' });
    if (navigator.canShare({ files: [file] })) await navigator.share({ files: [file], title: cur.name });
  } catch (e) { if (e.name !== 'AbortError') toast('Não foi possível compartilhar: ' + e.message, { kind: 'err' }); }
}

// ============================================================ Google Drive
async function driveOpenDialog() {
  const f = await driveBrowser({ mode: 'open' });
  if (f) openDriveFile(f);
}

async function openDriveFile(f) {
  busy('Baixando do Drive…');
  try {
    const bytes = await drive.download(f.id, (got, total) => busy(`Baixando do Drive… ${total ? Math.round(got / total * 100) + '%' : fmtSize(got)}`));
    busy(false);
    await openFromBytes(bytes, { name: f.name.replace(/\.pdf$/i, ''), source: { t: 'drive', fileId: f.id, parentId: f.parents?.[0], modifiedTime: f.modifiedTime } });
  } catch (e) {
    busy(false);
    toast('Erro ao abrir do Drive: ' + (e.message || e), { kind: 'err', ms: 6000 });
  }
}

function driveBrowser({ mode, startFolder, title, button }) {
  return modal({
    title: title || (mode === 'open' ? 'Abrir do Google Drive' : 'Salvar em…'), wide: true, className: 'drive-modal',
    build: (b, close, foot) => {
      const ex = driveExplorer(b, {
        mode, startFolder,
        on: { openFile: f => close(f), configure: () => { close(null); openSettings(); } },
      });
      if (mode === 'folder') {
        foot.innerHTML = '';
        const cancel = h('<button class="btn">Cancelar</button>');
        const here = h(`<button class="btn primary">${esc(button || 'Salvar nesta pasta')}</button>`);
        cancel.onclick = () => close(null);
        here.onclick = () => close(ex.current());
        foot.append(cancel, here);
      } else foot.remove();
    },
  });
}

// ============================================================ configurações
function openSettings() {
  modal({
    title: 'Configurações', wide: true,
    build: (b, close) => {
      const p = prefs();
      b.innerHTML = `
        <h4>Google Drive</h4>
        <p class="muted small">Cole aqui o <b>ID do cliente OAuth</b> que você criou no Google Cloud (passo a passo no guia que veio com o app). É configurado uma vez só e fica salvo neste tablet.</p>
        <label class="lbl">ID do cliente OAuth<input class="field mono" id="s-cid" placeholder="123456-abc.apps.googleusercontent.com" value="${esc(p.clientId || '')}"></label>
        <p class="muted small">Endereço deste app (cadastre em “Origens JavaScript autorizadas”): <code>${esc(location.origin)}</code></p>
        <div class="row gap">
          <button class="btn" id="s-test">${icon('drive', 'sm')} Testar conexão</button>
          <button class="btn" id="s-out">${icon('logout', 'sm')} Sair da conta Google</button>
        </div>
        <h4>Escrita</h4>
        <label class="switch"><input type="checkbox" id="s-pen" ${p.penOnly ? 'checked' : ''}><span></span>Só a S Pen desenha (o dedo rola e dá zoom)</label>
        <h4>Armazenamento</h4>
        <p class="muted small" id="s-store">…</p>
        <p class="muted small">Caderno PDF — app pessoal. Usa pdf.js (Mozilla), pdf-lib e perfect-freehand, todos de código aberto.</p>`;
      $('#s-cid', b).onchange = e => { setPref('clientId', e.target.value.trim()); drive.signOut(); };
      $('#s-pen', b).onchange = e => ed.setPenOnly(e.target.checked);
      $('#s-test', b).onclick = async () => {
        setPref('clientId', $('#s-cid', b).value.trim());
        try { await drive.signIn(); const f = await drive.listFolder('root'); toast(`Conectado ✓ (${f.length} itens no Meu Drive)`, { kind: 'ok' }); }
        catch (e) { toast(e.message, { kind: 'err', ms: 6000 }); }
      };
      $('#s-out', b).onclick = () => { drive.signOut(); localStorage.removeItem('caderno.driveUsed'); toast('Você saiu da conta Google.'); };
      navigator.storage?.estimate?.().then(est => { $('#s-store', b).textContent = `Usando ${fmtSize(est.usage)} de rascunhos locais neste tablet.`; });
    },
    actions: [{ label: 'Fechar', primary: true, value: () => { setPref('clientId', $('#s-cid')?.value.trim() || prefs().clientId || ''); if (!$('#home').hidden) showHome(); return true; } }],
  });
}
