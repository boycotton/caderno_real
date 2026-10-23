// Pequenos utilitários de interface: ícones, diálogos, avisos.
const P = {
  back: '<path d="M15 18l-6-6 6-6"/>',
  undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 010 11H11"/>',
  redo: '<path d="M15 14l5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 000 11H13"/>',
  pen: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z"/>',
  pencil: '<path d="M4 20l1.5-5.5L15.8 4.2a2 2 0 012.8 0l1.2 1.2a2 2 0 010 2.8L9.5 18.5z"/><path d="M13.5 6.5l4 4"/><path d="M4 20l3-.8"/>',
  marker: '<path d="M9 11l-5 5v3h3l5-5"/><path d="M14.5 5.5l4 4-6.5 6.5-4-4z"/><path d="M14.5 5.5l2-2 4 4-2 2"/>',
  eraser: '<path d="M7 21h10"/><path d="M5.5 15.5l9-9a2 2 0 012.8 0l2.2 2.2a2 2 0 010 2.8L13 18H8z"/><path d="M9.5 11.5l5 5"/>',
  shapes: '<rect x="3" y="12" width="9" height="9" rx="1"/><circle cx="16.5" cy="7.5" r="4.5"/>',
  text: '<path d="M5 6V4h14v2"/><path d="M12 4v16"/><path d="M9 20h6"/>',
  lasso: '<path d="M7 18.5C4 17 2.5 14.8 2.5 12.5 2.5 7.8 6.8 4 12 4s9.5 3.8 9.5 8.5S17.2 21 12 21c-1 0-2-.1-2.9-.4"/><circle cx="7.5" cy="19" r="1.8"/><path d="M7 20.5L6 23"/>',
  paste: '<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 012 2v14a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2h2"/>',
  stamp: '<path d="M5 22h14"/><path d="M5 18h14v-2a2 2 0 00-2-2h-3V9.5a3.5 3.5 0 10-4 0V14H7a2 2 0 00-2 2z"/>',
  pages: '<rect x="7" y="3" width="13" height="16" rx="1.5"/><path d="M4 7v12.5A1.5 1.5 0 005.5 21H16"/>',
  save: '<path d="M7 18a4.5 4.5 0 01-.8-8.9A6 6 0 0117.7 8 4 4 0 0117 18"/><path d="M12 12v9"/><path d="M8.5 15.5L12 12l3.5 3.5"/>',
  folderplus: '<path d="M3 6a2 2 0 012-2h4l2 2h8a2 2 0 012 2v10a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><path d="M12 10v6M9 13h6"/>',
  floppy: '<path d="M4 3h13l3 3v15H4z"/><path d="M7 3v6h9V3"/><path d="M13 5v2"/><path d="M7 21v-7h10v7"/>',
  more: '<circle cx="12" cy="5" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="12" cy="19" r="1.2"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  trash: '<path d="M4 7h16"/><path d="M10 11v6M14 11v6"/><path d="M6 7l1 13a1 1 0 001 1h8a1 1 0 001-1l1-13"/><path d="M9 7V4h6v3"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 01-1-1V4a1 1 0 011-1h10a1 1 0 011 1v1"/>',
  cut: '<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M20 4L8.1 15.9M14.5 14.5L20 20M8.1 8.1L12 12"/>',
  dup: '<rect x="3" y="3" width="12" height="12" rx="2"/><path d="M9 21h10a2 2 0 002-2V9"/><path d="M9 9h0"/>',
  home: '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/>',
  drive: '<path d="M8.3 3h7.4l6 10.5-3.7 6.5H6L2.3 13.5z"/><path d="M8.3 3l6 10.5H2.3M15.7 3L9.8 13.5M18 20l-3.7-6.5"/>',
  folder: '<path d="M3 6a2 2 0 012-2h4l2 2h8a2 2 0 012 2v10a2 2 0 01-2 2H5a2 2 0 01-2-2z"/>',
  file: '<path d="M14 3H6a1 1 0 00-1 1v16a1 1 0 001 1h12a1 1 0 001-1V8z"/><path d="M14 3v5h5"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z"/>',
  fit: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  line: '<path d="M5 19L19 5"/>',
  arrow: '<path d="M5 19L19 5"/><path d="M10 5h9v9"/>',
  rect: '<rect x="4" y="5" width="16" height="14" rx="1"/>',
  ellipse: '<ellipse cx="12" cy="12" rx="9" ry="7"/>',
  triangle: '<path d="M12 4l9 16H3z"/>',
  rtriangle: '<path d="M4 4v16h16z"/>',
  download: '<path d="M12 3v12"/><path d="M7 10l5 5 5-5"/><path d="M5 21h14"/>',
  upload: '<path d="M12 21V9"/><path d="M7 14l5-5 5 5"/><path d="M5 3h14"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
  hand: '<path d="M8 13V5.5a1.5 1.5 0 013 0V12"/><path d="M11 11.5V4a1.5 1.5 0 013 0v7.5"/><path d="M14 11.5V5.5a1.5 1.5 0 013 0V13"/><path d="M17 9.5a1.5 1.5 0 013 0V15a7 7 0 01-7 7h-1a7 7 0 01-6-3.5L3.5 14a1.6 1.6 0 012.6-1.8L8 14.5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  up: '<path d="M12 19V5M6 11l6-6 6 6"/>',
  down: '<path d="M12 5v14M6 13l6 6 6-6"/>',
  palette: '<circle cx="12" cy="12" r="9"/><circle cx="8" cy="10" r="1.2"/><circle cx="12" cy="7.5" r="1.2"/><circle cx="16" cy="10" r="1.2"/><path d="M13 21a2 2 0 01-1-3.7 2 2 0 00-1-3.8H9"/>',
  spen: '<path d="M14 4l6 6"/><path d="M4 20l2-6 9.5-9.5 4 4L10 18z"/><path d="M15 7l2 2"/>',
  cloud: '<path d="M7 18a4.5 4.5 0 01-.8-8.9A6 6 0 0117.7 8 4 4 0 0117 18z"/>',
  cloudoff: '<path d="M3 3l18 18"/><path d="M8.5 8.4A6 6 0 0117.7 8 4 4 0 0119.6 15M16 18H7a4.5 4.5 0 01-1.6-8.7"/>',
  logout: '<path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><path d="M16 17l5-5-5-5M21 12H9"/>',
  rename: '<path d="M4 20h16"/><path d="M14.5 4.5l3 3L8 17H5v-3z"/>',
};

export function icon(name, cls = '') {
  return `<svg class="ic ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || ''}</svg>`;
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function h(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let toastTimer;
export function toast(msg, { kind = '', ms = 2600 } = {}) {
  const el = $('#toast');
  el.className = 'toast show ' + kind;
  el.textContent = msg;
  clearTimeout(toastTimer);
  if (ms) toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

// Diálogo genérico. `build(body, close)` monta o conteúdo. Retorna Promise com o valor de close().
export function modal({ title, build, wide = false, actions = null, className = '' }) {
  return new Promise(resolve => {
    const root = $('#modal-root');
    const el = h(`<div class="modal-back">
      <div class="modal ${wide ? 'wide' : ''} ${className}" role="dialog" aria-modal="true">
        <div class="modal-head"><h2>${esc(title)}</h2><button class="icon-btn" data-close title="Fechar">${icon('x')}</button></div>
        <div class="modal-body"></div>
        <div class="modal-foot"></div>
      </div></div>`);
    let done = false;
    const close = v => { if (done) return; done = true; el.classList.add('out'); setTimeout(() => el.remove(), 160); resolve(v); };
    el.addEventListener('pointerdown', e => { if (e.target === el) close(null); });
    $('[data-close]', el).onclick = () => close(null);
    const body = $('.modal-body', el), foot = $('.modal-foot', el);
    if (actions) for (const a of actions) {
      const b = h(`<button class="btn ${a.primary ? 'primary' : ''} ${a.danger ? 'danger' : ''}">${esc(a.label)}</button>`);
      b.onclick = () => { const v = a.value?.(); if (v !== false) close(v === undefined ? a.label : v); };
      foot.appendChild(b);
    }
    build?.(body, close, foot);
    if (!foot.children.length) foot.remove();
    root.appendChild(el);
    const first = $('input,textarea', body);
    if (first && first.type !== 'checkbox' && first.type !== 'radio') setTimeout(() => first.focus(), 60);
  });
}

export function confirmBox(title, text, { ok = 'OK', cancel = 'Cancelar', danger = false } = {}) {
  return modal({
    title,
    build: b => { b.innerHTML = `<p class="muted">${esc(text)}</p>`; },
    actions: [{ label: cancel, value: () => null }, { label: ok, primary: !danger, danger, value: () => true }],
  }).then(v => v === true);
}

export function promptBox(title, value = '', { ok = 'OK', placeholder = '' } = {}) {
  let input;
  return modal({
    title,
    build: (b, close) => {
      b.innerHTML = `<input class="field" type="text" value="${esc(value)}" placeholder="${esc(placeholder)}">`;
      input = $('input', b);
      input.addEventListener('keydown', e => { if (e.key === 'Enter') close(input.value.trim()); });
      setTimeout(() => input.select(), 80);
    },
    actions: [{ label: 'Cancelar', value: () => null }, { label: ok, primary: true, value: () => input.value.trim() }],
  });
}

// Menu suspenso ancorado num botão
export function popover(anchor, build, { align = 'left' } = {}) {
  closePopovers();
  const r = anchor.getBoundingClientRect();
  const el = h('<div class="popover"></div>');
  build(el, closePopovers);
  document.body.appendChild(el);
  const w = el.offsetWidth, hgt = el.offsetHeight;
  let left = align === 'right' ? r.right - w : r.left;
  left = Math.max(8, Math.min(left, innerWidth - w - 8));
  let top = r.bottom + 6;
  if (top + hgt > innerHeight - 8) top = Math.max(8, r.top - hgt - 6);
  el.style.left = left + 'px'; el.style.top = top + 'px';
  setTimeout(() => {
    const off = e => { if (!el.contains(e.target) && e.target !== anchor && !anchor.contains(e.target)) { closePopovers(); document.removeEventListener('pointerdown', off, true); } };
    document.addEventListener('pointerdown', off, true);
    el._off = off;
  }, 0);
  return el;
}
export function closePopovers() {
  for (const p of $$('.popover')) { if (p._off) document.removeEventListener('pointerdown', p._off, true); p.remove(); }
}

export function fmtDate(t) {
  const d = new Date(t);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  return sameDay ? `hoje, ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}` : d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' });
}
export function fmtSize(n) {
  if (!n) return '';
  n = +n;
  return n > 1e6 ? (n / 1e6).toFixed(1).replace('.', ',') + ' MB' : Math.max(1, Math.round(n / 1e3)) + ' KB';
}
