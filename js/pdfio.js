// Abrir e salvar PDFs.
//
// Como as anotações ficam no arquivo:
//  * São desenhadas como vetores dentro de uma "camada opcional" (OCG) chamada
//    NotasApp-Anotacoes. Qualquer leitor (Drive, Samsung Notes, Acrobat...) mostra
//    a camada normalmente.
//  * Junto com cada página vai uma cópia compactada dos objetos (/NotasAppData),
//    para que este app consiga reabrir e continuar editando cada traço.
//  * Ao abrir no app a camada é escondida e os traços voltam a ser editáveis.
//  * Ao salvar de novo, a camada antiga é removida e uma nova é gravada,
//    então o arquivo não cresce a cada salvamento.
import * as pdfjsLib from '../vendor/pdfjs/pdf.min.mjs';
import { PDFDocument, PDFName, PDFArray, PDFDict, PDFRawStream, PDFString, PDFHexString, PDFRef, StandardFonts } from '../vendor/pdf-lib.esm.min.js';
import { objPdfOps, pdfRgb, newId } from './ink.js';
import { templatePdfOps, pageSize } from './templates.js';

const base = new URL('../vendor/pdfjs/', import.meta.url).href;
pdfjsLib.GlobalWorkerOptions.workerSrc = base + 'pdf.worker.min.mjs';

export const LAYER_NAME = 'NotasApp-Anotacoes';
const K_DATA = PDFName.of('NotasAppData');
const K_STREAMS = PDFName.of('NotasAppStreams');
const K_TPL = PDFName.of('NotasAppTpl');
const DATA_VERSION = 1;

export { pdfjsLib };

// ---------- compressão (gzip nativo do navegador) ----------
async function gzip(str) {
  const cs = new CompressionStream('gzip');
  const stream = new Blob([new TextEncoder().encode(str)]).stream().pipeThrough(cs);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
async function gunzip(bytes) {
  const ds = new DecompressionStream('gzip');
  const stream = new Blob([bytes]).stream().pipeThrough(ds);
  return new TextDecoder().decode(await new Response(stream).arrayBuffer());
}

function invert(m) {
  const [a, b, c, d, e, f] = m;
  const det = a * d - b * c;
  return [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det];
}
const fx = n => (Math.round(n * 10000) / 10000).toString();

// ---------- abrir ----------
// Devolve { pdf (pdf.js), ocConfig, pages: [{id,w,h,m,src,objs,tpl}], encrypted }
export async function openPdf(bytes, { onProgress } = {}) {
  bytes = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const task = pdfjsLib.getDocument({
    data: bytes.slice(),
    cMapUrl: base + 'cmaps/',
    cMapPacked: true,
    standardFontDataUrl: base + 'standard_fonts/',
    wasmUrl: base + 'wasm/',
    iccUrl: base + 'iccs/',
    isEvalSupported: false,
  });
  if (onProgress) task.onProgress = onProgress;
  const pdf = await task.promise;

  // Dados editáveis gravados pelo app (lidos com pdf-lib)
  let stored = [];
  let tpls = [];
  let encrypted = false;
  try {
    const lib = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
    encrypted = lib.isEncrypted;
    const pages = lib.getPages();
    stored = await Promise.all(pages.map(async p => {
      try {
        const ref = p.node.get(K_DATA);
        if (!ref) return null;
        const s = lib.context.lookup(ref);
        if (!(s instanceof PDFRawStream)) return null;
        const json = JSON.parse(await gunzip(s.getContents()));
        return json && json.v === DATA_VERSION ? json.objs : null;
      } catch (e) { console.warn('dados da página ilegíveis', e); return null; }
    }));
    tpls = pages.map(p => {
      try { const s = p.node.lookupMaybe(K_TPL, PDFString, PDFHexString); return s ? JSON.parse(s.decodeText()) : null; }
      catch { return null; }
    });
  } catch (e) {
    console.warn('pdf-lib não conseguiu ler o arquivo; anotações antigas não serão reeditáveis', e);
  }

  // Esconde a camada de anotações do app (os traços serão desenhados como objetos editáveis)
  let ocConfig = null;
  try {
    ocConfig = await pdf.getOptionalContentConfig();
    let hid = false;
    if (ocConfig) for (const [id, g] of ocConfig) if (g.name === LAYER_NAME) { ocConfig.setVisibility(id, false); hid = true; }
    if (!hid) ocConfig = null;
  } catch { ocConfig = null; }

  const pages = [];
  for (let i = 0; i < pdf.numPages; i++) {
    const page = await pdf.getPage(i + 1);
    const vp = page.getViewport({ scale: 1 });
    pages.push({
      id: newId(),
      w: vp.width, h: vp.height, m: Array.from(vp.transform),
      src: { t: 'pdf', i },
      tpl: tpls[i] || null,
      objs: stored[i] && stored.length === pdf.numPages ? stored[i] : [],
    });
  }
  return { pdf, ocConfig, pages, encrypted };
}

// ---------- página nova a partir de modelo ----------
export function templatePage(tpl) {
  const { w, h } = pageSize(tpl);
  return { id: newId(), w, h, m: [1, 0, 0, -1, 0, h], src: { t: 'tpl' }, tpl: { ...tpl }, objs: [] };
}

// ---------- salvar ----------
// baseBytes: PDF original (ou null para caderno novo). pages: modelo atual.
export async function buildPdf(baseBytes, pages, { title } = {}) {
  const doc = baseBytes ? await PDFDocument.load(baseBytes, { ignoreEncryption: true, updateMetadata: false }) : await PDFDocument.create();
  const ctx = doc.context;
  const original = doc.getPages();

  // 1) Monta a nova sequência de páginas
  const used = new Set();
  const seq = [];
  for (const p of pages) {
    if (p.src.t === 'pdf') {
      const i = p.src.i;
      if (!used.has(i)) { used.add(i); seq.push({ page: original[i], model: p }); }
      else { const [copy] = await doc.copyPages(doc, [i]); seq.push({ page: copy, model: p, isCopy: true }); }
    } else seq.push({ page: null, model: p });
  }
  const sameOrder = seq.length === original.length && seq.every((s, i) => s.page === original[i] && !s.isCopy);
  if (!sameOrder) {
    for (let i = doc.getPageCount() - 1; i >= 0; i--) doc.removePage(i);
    for (const s of seq) {
      if (!s.page) { const { w, h } = s.model; s.page = doc.addPage([w, h]); s.fresh = true; }
      else doc.addPage(s.page);
    }
  }

  // 2) Camada opcional (reaproveita a de um salvamento anterior)
  const ocgRef = ensureLayer(doc);

  // 3) Fonte para textos (só se houver texto)
  let font = null;
  if (pages.some(p => p.objs.some(o => o.t === 'text'))) font = await doc.embedFont(StandardFonts.Helvetica);

  const imgCache = new Map();
  for (const s of seq) {
    const leaf = s.page.node;
    const model = s.model;
    removeOldLayer(doc, leaf);
    leaf.delete(K_DATA);

    // Página de modelo: desenha o fundo (quadriculado etc.) como conteúdo normal
    if (s.fresh) {
      const t = templatePdfOps(model.tpl, model.w, model.h, pdfRgb);
      const ref = ctx.register(ctx.flateStream(`q 1 0 0 -1 0 ${fx(model.h)} cm\n${t}Q\n`));
      leaf.set(PDFName.of('Contents'), ctx.obj([ref]));
      leaf.set(PDFName.of('Resources'), ctx.obj({}));
      leaf.set(K_TPL, PDFHexString.fromText(JSON.stringify(model.tpl)));
    }
    if (!model.objs.length) continue;

    const res = ownResources(doc, leaf);
    const props = subDict(ctx, res, 'Properties');
    props.set(PDFName.of('NAoc'), ocgRef);
    const egs = subDict(ctx, res, 'ExtGState');
    const gsName = alpha => {
      const n = 'NAgs' + Math.round(alpha * 100);
      if (!egs.get(PDFName.of(n))) egs.set(PDFName.of(n), ctx.obj({ Type: 'ExtGState', ca: alpha, CA: alpha }));
      return n;
    };
    let fontRef = null;
    if (font && model.objs.some(o => o.t === 'text')) {
      const fonts = subDict(ctx, res, 'Font');
      fonts.set(PDFName.of('NAF1'), font.ref);
      fontRef = {
        name: 'NAF1',
        encode: str => {
          const safe = [...str].map(ch => { try { font.encodeText(ch); return ch; } catch { return '?'; } }).join('');
          return font.encodeText(safe).toString();
        },
      };
    }

    // recortes (imagens)
    const xo = model.objs.some(o => o.t === 'img') ? subDict(ctx, res, 'XObject') : null;
    const imgNames = new Map();
    for (const o of model.objs) {
      if (o.t !== 'img' || imgNames.has(o.src)) continue;
      let emb = imgCache.get(o.src);
      if (!emb) {
        const b64 = o.src.split(',')[1] || '';
        const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
        try { emb = /^data:image\/png/.test(o.src) ? await doc.embedPng(bytes) : await doc.embedJpg(bytes); } catch { emb = null; }
        imgCache.set(o.src, emb);
      }
      if (!emb) continue;
      const n = 'NAim' + (imgNames.size + 1);
      xo.set(PDFName.of(n), emb.ref);
      imgNames.set(o.src, n);
    }
    const imgName = o => imgNames.get(o.src);

    const inv = invert(model.m);
    let body = '';
    for (const o of model.objs) body += objPdfOps(o, gsName, fontRef, imgName);
    const ink = `/OC /NAoc BDC\nq ${inv.map(fx).join(' ')} cm\n${body}Q\nEMC\n`;

    const pre = ctx.register(ctx.stream('q\n'));
    const post = ctx.register(ctx.stream('Q\n'));
    const inkRef = ctx.register(ctx.flateStream(ink));
    const contents = contentsArray(ctx, leaf);
    contents.insert(0, pre);
    contents.push(post);
    contents.push(inkRef);
    leaf.set(PDFName.of('Contents'), contents);
    leaf.set(K_STREAMS, ctx.obj([pre, post, inkRef]));

    const data = await gzip(JSON.stringify({ v: DATA_VERSION, objs: model.objs }));
    leaf.set(K_DATA, ctx.register(ctx.stream(data, { Length: data.length })));
  }

  if (title) doc.setTitle(title, { showInWindowTitleBar: false });
  doc.setModificationDate(new Date());
  doc.setProducer('Caderno PDF (app pessoal) + pdf-lib');
  return await doc.save({ useObjectStreams: true });
}

function contentsArray(ctx, leaf) {
  const raw = leaf.get(PDFName.of('Contents'));
  if (!raw) return ctx.obj([]);
  const v = ctx.lookup(raw);
  if (v instanceof PDFArray) return v;
  return ctx.obj([raw]);
}

function removeOldLayer(doc, leaf) {
  const ctx = doc.context;
  const mine = leaf.lookupMaybe(K_STREAMS, PDFArray);
  if (!mine) return;
  const refs = new Set(mine.asArray().map(r => r.toString()));
  const contents = contentsArray(ctx, leaf);
  const keep = contents.asArray().filter(r => !refs.has(r.toString()));
  leaf.set(PDFName.of('Contents'), ctx.obj(keep));
  for (const r of mine.asArray()) if (r instanceof PDFRef) ctx.delete(r);
  leaf.delete(K_STREAMS);
  const oldData = leaf.get(K_DATA);
  if (oldData instanceof PDFRef) ctx.delete(oldData);
}

// Garante um dicionário Resources próprio da página (não altera recursos herdados de outras páginas)
function ownResources(doc, leaf) {
  const ctx = doc.context;
  const own = leaf.get(PDFName.of('Resources'));
  if (own) {
    const d = ctx.lookup(own);
    if (d instanceof PDFDict) {
      if (own instanceof PDFRef) { const c = d.clone(ctx); leaf.set(PDFName.of('Resources'), c); return c; }
      return d;
    }
  }
  const inherited = leaf.Resources();
  const d = inherited ? inherited.clone(ctx) : ctx.obj({});
  leaf.set(PDFName.of('Resources'), d);
  return d;
}

function subDict(ctx, res, key) {
  const raw = res.get(PDFName.of(key));
  const cur = raw ? ctx.lookup(raw) : null;
  if (cur instanceof PDFDict) {
    // copia para não alterar um dicionário compartilhado por outras páginas
    const c = cur.clone(ctx);
    res.set(PDFName.of(key), c);
    return c;
  }
  const d = ctx.obj({});
  res.set(PDFName.of(key), d);
  return d;
}

function ensureLayer(doc) {
  const ctx = doc.context;
  const cat = doc.catalog;
  let ocp = cat.lookupMaybe(PDFName.of('OCProperties'), PDFDict);
  let existing = null;
  if (ocp) {
    const ocgs = ocp.lookupMaybe(PDFName.of('OCGs'), PDFArray);
    if (ocgs) for (const r of ocgs.asArray()) {
      const g = ctx.lookup(r);
      if (g instanceof PDFDict) {
        const n = g.lookupMaybe(PDFName.of('Name'), PDFString, PDFHexString);
        if (n && n.decodeText() === LAYER_NAME) { existing = r; break; }
      }
    }
  }
  if (existing) return existing;
  const ref = ctx.register(ctx.obj({ Type: 'OCG', Name: PDFString.of(LAYER_NAME) }));
  if (!ocp) {
    ocp = ctx.obj({ OCGs: [ref], D: { Name: PDFString.of('Padrao'), ON: [ref], Order: [ref] } });
    cat.set(PDFName.of('OCProperties'), ocp);
    return ref;
  }
  const arr = (k, parent) => {
    let a = parent.lookupMaybe(PDFName.of(k), PDFArray);
    if (!a) { a = ctx.obj([]); parent.set(PDFName.of(k), a); }
    return a;
  };
  arr('OCGs', ocp).push(ref);
  let d = ocp.lookupMaybe(PDFName.of('D'), PDFDict);
  if (!d) { d = ctx.obj({}); ocp.set(PDFName.of('D'), d); }
  arr('ON', d).push(ref);
  arr('Order', d).push(ref);
  return ref;
}
