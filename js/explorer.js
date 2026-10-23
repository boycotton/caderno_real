// Explorador do Google Drive (estilo Windows Explorer, ícones grandes).
// Usado nas janelas da área de trabalho e nas janelas "Abrir" e "Salvar em".
import * as drive from './drive.js';
import { prefs, setPref } from './store.js';
import { icon, $, $$, h, esc, toast, confirmBox, promptBox, popover, fmtDate, fmtSize } from './ui.js';

export const ROOTS = {
  root: { id: 'root', name: 'Meu Drive' },
  shared: { id: 'shared', name: 'Compartilhados comigo' },
  recent: { id: 'recent', name: 'Recentes' },
  local: { id: 'local', name: 'Neste tablet' },
};
const SPECIAL = new Set(['recent', 'shared', 'local']);

// Ícones grandes no estilo Windows 95 (desenhados, não dependem de imagens).
export const BIG = {
  folder: `<svg viewBox="0 0 48 40" class="big"><path d="M2 6h16l4 4h24v28H2z" fill="#c9a227" stroke="#000" stroke-width="1.5"/><path d="M2 14h44v24H2z" fill="#ffd94a" stroke="#000" stroke-width="1.5"/><path d="M4 16h40" stroke="#fff6c0" stroke-width="2"/></svg>`,
  pdf: `<svg viewBox="0 0 40 48" class="big"><path d="M4 2h22l10 10v34H4z" fill="#fff" stroke="#000" stroke-width="1.5"/><path d="M26 2v10h10" fill="#c0c0c0" stroke="#000" stroke-width="1.5"/><rect x="4" y="28" width="32" height="12" fill="#c00000"/><text x="20" y="37.5" font-family="Arial,sans-serif" font-weight="700" font-size="9" fill="#fff" text-anchor="middle">PDF</text><path d="M9 16h14M9 21h22" stroke="#808080" stroke-width="2"/></svg>`,
  drive: `<svg viewBox="0 0 48 44" class="big"><path d="M16 2h16l16 28H32z" fill="#ffc107" stroke="#000" stroke-width="1.5"/><path d="M16 2L0 30l8 14 16-28z" fill="#1fa463" stroke="#000" stroke-width="1.5"/><path d="M8 44h32l8-14H16z" fill="#4285f4" stroke="#000" stroke-width="1.5"/></svg>`,
  shared: `<svg viewBox="0 0 48 40" class="big"><path d="M2 6h16l4 4h24v28H2z" fill="#c9a227" stroke="#000" stroke-width="1.5"/><path d="M2 14h44v24H2z" fill="#ffd94a" stroke="#000" stroke-width="1.5"/><circle cx="24" cy="23" r="4" fill="#000080"/><path d="M15 35c1-5 5-7 9-7s8 2 9 7z" fill="#000080"/></svg>`,
  tablet: `<svg viewBox="0 0 40 48" class="big"><rect x="3" y="2" width="34" height="44" rx="3" fill="#404040" stroke="#000" stroke-width="1.5"/><rect x="7" y="6" width="26" height="34" fill="#008080"/><rect x="11" y="10" width="13" height="17" fill="#ffecb3" stroke="#000"/><circle cx="20" cy="43" r="1.5" fill="#c0c0c0"/></svg>`,
  clock: `<svg viewBox="0 0 44 44" class="big"><circle cx="22" cy="22" r="19" fill="#fff" stroke="#000" stroke-width="1.5"/><circle cx="22" cy="22" r="15" fill="none" stroke="#c0c0c0" stroke-width="2"/><path d="M22 10v12l8 5" stroke="#000080" stroke-width="3" fill="none"/></svg>`,
};

/**
 * mode: 'browse' (janela da área de trabalho) | 'open' (escolher PDF) | 'folder' (escolher pasta)
 * start: pasta inicial ({id,name}) — vira a "raiz" da janela
 * on: { openFile(f), newNote(folder), configure(), pickFolder(title), pin(folder), renderLocal(listEl), title(name) }
 */
export function driveExplorer(root, { mode = 'browse', start, startPath, startFolder, on = {} } = {}) {
  let path = startPath?.length ? startPath.slice() : [start || ROOTS.root];
  let search = '';
  const back = [];
  let items = [];
  let loadSeq = 0;
  const side = mode !== 'browse';

  root.classList.add('dx');
  root.innerHTML = `
    <div class="dx-tools">
      <button class="btn dx-b dx-ico" data-a="back" title="Voltar">${icon('back', 'sm')}</button>
      <button class="btn dx-b dx-ico" data-a="up" title="Pasta acima">${icon('up', 'sm')}</button>
      <button class="btn dx-b dx-ico" data-a="reload" title="Atualizar">${icon('redo', 'sm')}</button>
      <span class="dx-sep"></span>
      ${mode === 'browse' ? `<button class="btn dx-b" data-a="newnote">${icon('plus', 'sm')}<span>Nova nota</span></button>` : ''}
      <button class="btn dx-b" data-a="newfolder">${icon('folderplus', 'sm')}<span>Nova pasta</span></button>
      ${mode === 'browse' ? `<button class="btn dx-b" data-a="upload">${icon('upload', 'sm')}<span>Enviar PDF</span></button>` : ''}
      <span class="dx-grow"></span>
      <label class="search">${icon('search', 'sm')}<input type="search" placeholder="Buscar"></label>
      <input type="file" class="dx-file" accept="application/pdf,.pdf" multiple hidden>
    </div>
    <div class="dx-main ${side ? '' : 'noside'}">
      ${side ? `<nav class="dx-side">
        <button data-root="root">${icon('drive', 'sm')}<span>Meu Drive</span></button>
        <button data-root="shared">${icon('folder', 'sm')}<span>Compartilhados</span></button>
        ${mode !== 'folder' ? `<button data-root="recent">${icon('clock', 'sm')}<span>Recentes</span></button>` : ''}
      </nav>` : ''}
      <div class="dx-pane">
        <div class="crumbs"></div>
        <div class="d-list ${mode === 'browse' ? 'icons' : ''}" role="list"></div>
      </div>
    </div>
    <div class="dx-status"><span class="sb-panel sb-grow dx-count"></span><span class="sb-panel dx-where"></span></div>`;

  const list = $('.d-list', root);
  const crumbs = $('.crumbs', root);
  const searchInput = $('input[type=search]', root);
  const here = () => path[path.length - 1];

  function go(newPath, { push = true } = {}) {
    if (push) back.push({ path: path.slice(), search });
    path = newPath;
    search = '';
    searchInput.value = '';
    load();
  }
  function enter(folder) { go([...path, { id: folder.id, name: folder.name }]); }

  root.addEventListener('click', e => {
    const b = e.target.closest('[data-a]');
    if (b) {
      const a = b.dataset.a;
      if (a === 'back') { const prev = back.pop(); if (prev) { path = prev.path; search = prev.search; searchInput.value = search; load(); } }
      else if (a === 'up') { if (path.length > 1) go(path.slice(0, -1)); }
      else if (a === 'reload') load();
      else if (a === 'newfolder') newFolder();
      else if (a === 'newnote') on.newNote?.(folderInfo());
      else if (a === 'upload') $('.dx-file', root).click();
      return;
    }
    const t = e.target.closest('[data-root]');
    if (t) go([ROOTS[t.dataset.root]]);
  });

  let st;
  searchInput.addEventListener('input', () => {
    clearTimeout(st);
    st = setTimeout(() => { search = searchInput.value.trim(); load(); }, 350);
  });

  $('.dx-file', root).addEventListener('change', async e => {
    const files = [...e.target.files];
    e.target.value = '';
    if (!files.length) return;
    const dest = folderInfo();
    try {
      for (const [k, f] of files.entries()) {
        toast(`Enviando ${k + 1}/${files.length}: ${f.name}…`, { ms: 0 });
        await drive.createFile(f.name, dest.id, new Uint8Array(await f.arrayBuffer()));
      }
      toast(`${files.length > 1 ? files.length + ' PDFs enviados' : 'PDF enviado'}`, { kind: 'ok' });
      load();
    } catch (x) { toast('Falha ao enviar: ' + x.message, { kind: 'err', ms: 6000 }); }
  });

  function folderInfo() {
    const f = here();
    if (SPECIAL.has(f.id)) return ROOTS.root;
    return { id: f.id, name: f.name };
  }

  async function newFolder() {
    const dest = folderInfo();
    const n = await promptBox('Nova pasta', 'Nova pasta', { ok: 'Criar' });
    if (!n) return;
    try {
      await drive.signIn();
      const f = await drive.createFolder(n, dest.id);
      toast(`Pasta “${f.name}” criada`, { kind: 'ok' });
      if (here().id !== dest.id) go([ROOTS.root]);
      if (mode === 'folder') enter(f); else await load();
    } catch (x) { toast('Não foi possível criar a pasta: ' + x.message, { kind: 'err', ms: 6000 }); }
  }

  function paintChrome() {
    $$('.dx-side [data-root]', root).forEach(b => b.classList.toggle('on', !search && path[0].id === b.dataset.root));
    crumbs.innerHTML = '';
    if (search) crumbs.innerHTML = `<span>Busca: “${esc(search)}”</span>`;
    else path.forEach((p, k) => {
      if (k) crumbs.appendChild(h('<span class="sep">\\</span>'));
      const c = h(`<button class="crumb">${esc(p.name)}</button>`);
      c.onclick = () => { if (k < path.length - 1) go(path.slice(0, k + 1)); };
      crumbs.appendChild(c);
    });
    $('[data-a=back]', root).disabled = !back.length;
    $('[data-a=up]', root).disabled = path.length <= 1 || !!search;
    const special = SPECIAL.has(here().id);
    $('[data-a=newfolder]', root).disabled = special || !!search;
    $$('[data-a=upload]', root).forEach(b => b.disabled = special || !!search);
    $('.dx-tools .search', root).hidden = here().id === 'local';
    $('.dx-where', root).textContent = here().id === 'local' ? 'Tablet' : folderInfo().name;
    on.title?.(search ? 'Busca' : here().name);
    if (!search) on.navigate?.(path.slice());
  }

  async function load() {
    const seq = ++loadSeq;
    paintChrome();
    if (here().id === 'local' && !search) {
      const n = await on.renderLocal?.(list);
      if (seq === loadSeq) $('.dx-count', root).textContent = `${n || 0} documento(s)`;
      return;
    }
    if (!drive.isConfigured()) return loginButton(() => on.configure?.());
    if (!drive.isSignedIn() && mode === 'browse') return showLogin();
    list.innerHTML = '<div class="d-loading"><span class="spinner"></span> Carregando…</div>';
    $('.dx-count', root).textContent = 'Carregando…';
    try {
      const f = here();
      const res = await drive.listFolder(f.id, { search, recent: f.id === 'recent' && !search });
      if (seq !== loadSeq) return;
      items = res;
      if (!search && !SPECIAL.has(f.id)) setPref('lastFolder', f.id);
      paintList();
    } catch (e) {
      if (seq !== loadSeq) return;
      showLogin(e.message);
    }
  }

  function paintList() {
    const folders = items.filter(f => f.mimeType === drive.FOLDER_MIME);
    const pdfs = items.filter(f => f.mimeType !== drive.FOLDER_MIME);
    const shown = mode === 'folder' ? folders : [...folders, ...pdfs];
    list.innerHTML = '';
    if (!shown.length) list.innerHTML = `<p class="pad muted">${search ? 'Nada encontrado.' : 'Pasta vazia.'}</p>`;
    const icons = list.classList.contains('icons');
    for (const f of shown) {
      const isF = f.mimeType === drive.FOLDER_MIME;
      const more = mode !== 'folder' && path[0].id !== 'recent' ? `<button class="btn tiny-btn d-more" title="Opções">${icon('more', 'sm')}</button>` : '<span></span>';
      const row = icons
        ? h(`<div class="d-tile" role="listitem" tabindex="0">${isF ? BIG.folder : BIG.pdf}<span class="d-name">${esc(f.name.replace(/\.pdf$/i, ''))}</span>${more}</div>`)
        : h(`<div class="d-row" role="listitem" tabindex="0">
            ${icon(isF ? 'folder' : 'file', isF ? 'folder-ic' : 'pdf-ic')}
            <span class="d-name">${esc(f.name)}</span>
            <span class="d-meta">${isF ? 'Pasta' : fmtSize(f.size)}</span>
            <span class="d-meta d-date">${f.modifiedTime ? fmtDate(f.modifiedTime) : ''}</span>
            ${more}
          </div>`);
      const act = () => isF ? enter(f) : on.openFile?.(f);
      row.addEventListener('click', e => { if (!e.target.closest('.d-more')) act(); });
      row.addEventListener('keydown', e => { if (e.key === 'Enter') act(); });
      row.addEventListener('contextmenu', e => { if (mode !== 'folder') { e.preventDefault(); itemMenu(row, f, isF); } });
      $('.d-more', row)?.addEventListener('click', e => itemMenu(e.currentTarget, f, isF));
      list.appendChild(row);
    }
    const n = [folders.length && `${folders.length} pasta${folders.length > 1 ? 's' : ''}`, mode !== 'folder' && pdfs.length && `${pdfs.length} PDF${pdfs.length > 1 ? 's' : ''}`].filter(Boolean).join(', ');
    $('.dx-count', root).textContent = n || '0 objeto(s)';
  }

  function itemMenu(anchor, f, isF) {
    popover(anchor, (pop, close) => {
      const mi = (ic, label, fn) => { const b = h(`<button class="menu-item">${icon(ic)}<span>${label}</span></button>`); b.onclick = () => { close(); fn(); }; pop.appendChild(b); };
      if (isF) {
        mi('folder', 'Abrir', () => enter(f));
        if (on.pin) mi('home', 'Fixar na área de trabalho', () => on.pin({ id: f.id, name: f.name }));
      } else mi('file', 'Abrir', () => on.openFile?.(f));
      mi('rename', 'Renomear…', async () => {
        const n = await promptBox('Renomear', f.name, { ok: 'Renomear' });
        if (!n || n === f.name) return;
        try { await drive.renameItem(f.id, isF || /\.pdf$/i.test(n) ? n : n + '.pdf'); toast('Renomeado', { kind: 'ok' }); load(); }
        catch (x) { toast('Não foi possível renomear: ' + x.message, { kind: 'err' }); }
      });
      mi('folder', 'Mover para…', async () => {
        const dest = await on.pickFolder?.(`Mover “${f.name}” para…`);
        if (!dest) return;
        if (dest.id === f.id) return toast('Não dá para mover uma pasta para dentro dela mesma.');
        try { await drive.moveItem(f.id, dest.id, f.parents || []); toast(`Movido para “${dest.name}”`, { kind: 'ok' }); load(); }
        catch (x) { toast('Não foi possível mover: ' + x.message, { kind: 'err' }); }
      });
      pop.appendChild(h('<hr>'));
      mi('trash', 'Mover para a lixeira', async () => {
        const ok = await confirmBox('Mover para a lixeira?', `“${f.name}”${isF ? ' e tudo o que está dentro' : ''}`, { ok: 'Mover para a lixeira', danger: true });
        if (!ok) return;
        try { await drive.trashItem(f.id); toast('Movido para a lixeira.'); load(); }
        catch (x) { toast('Não foi possível: ' + x.message, { kind: 'err' }); }
      });
    }, { align: 'right' });
  }

  function loginButton(onClick) {
    list.innerHTML = '';
    const el = h(`<div class="dx-login"><button class="btn primary">${icon('drive', 'sm')} Entrar com Google</button></div>`);
    $('button', el).onclick = onClick;
    list.appendChild(el);
    $('.dx-count', root).textContent = 'Desconectado';
  }

  function showLogin(err) {
    loginButton(async () => { try { await drive.signIn(); load(); } catch (x) { toast(x.message, { kind: 'err' }); } });
    if (err) toast(err, { kind: 'err', ms: 5000 });
  }

  (async () => {
    paintChrome();
    const s = startFolder;
    if (!start && s && s !== 'root' && drive.isConfigured()) {
      try {
        if (mode !== 'browse') await drive.signIn();
        if (drive.isSignedIn()) {
          const p = await drive.folderPath(s);
          if (p?.length) path = p.map((x, k) => (k === 0 ? ROOTS.root : x));
        }
      } catch {}
    }
    load();
  })();

  return { current: folderInfo, reload: load };
}
