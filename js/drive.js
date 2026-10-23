// Google Drive: login (Google Identity Services) + API REST v3.
// Uso estritamente pessoal: o "ID do cliente OAuth" é criado por você no Google Cloud
// (veja o README) e colado nas Configurações do app.
import { prefs } from './store.js';

const SCOPE = 'https://www.googleapis.com/auth/drive';
const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
export const FOLDER_MIME = 'application/vnd.google-apps.folder';
const FIELDS = 'id,name,mimeType,modifiedTime,size,parents,headRevisionId,iconLink';

let gisLoaded;
let tokenClient = null;
let token = null;       // { access_token, expires_at }
let pending = null;

export function clientId() {
  return (prefs().clientId || window.CADERNO_CLIENT_ID || '').trim();
}
export const isConfigured = () => !!clientId();
export const isSignedIn = () => !!token && token.expires_at > Date.now() + 60_000;

function loadGis() {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  if (!gisLoaded) gisLoaded = new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = () => res();
    s.onerror = () => { gisLoaded = null; rej(new Error('Não foi possível carregar o login do Google. Verifique a internet.')); };
    document.head.appendChild(s);
  });
  return gisLoaded;
}

try {
  const saved = JSON.parse(localStorage.getItem('caderno.token'));
  if (saved && saved.expires_at > Date.now() + 60_000) token = saved;
} catch {}

// Pede (ou renova) o token. Precisa ser chamado a partir de um toque do usuário
// na primeira vez, porque abre a janela de login do Google.
export async function signIn({ silent = false, force = false } = {}) {
  if (isSignedIn() && !force) return token.access_token;
  if (!isConfigured()) throw new Error('Configure o ID do cliente do Google em Configurações.');
  await loadGis();
  if (!tokenClient || tokenClient._cid !== clientId()) {
    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: clientId(),
      scope: SCOPE,
      hint: localStorage.getItem('caderno.email') || undefined,
      callback: r => {
        const p = pending; pending = null;
        if (!p) return;
        if (r.error) return p.rej(new Error(r.error_description || r.error));
        token = { access_token: r.access_token, expires_at: Date.now() + (r.expires_in - 30) * 1000 };
        try { localStorage.setItem('caderno.token', JSON.stringify(token)); } catch {}
        localStorage.setItem('caderno.driveUsed', '1');
        p.res(token.access_token);
        window.dispatchEvent(new Event('drive-signed-in'));
        // guarda o e-mail para os próximos logins irem direto, sem escolher conta
        if (!localStorage.getItem('caderno.email')) fetch(`${API}/about?fields=user(emailAddress)`, { headers: { Authorization: `Bearer ${token.access_token}` } })
          .then(r => r.json()).then(j => { if (j.user?.emailAddress) { localStorage.setItem('caderno.email', j.user.emailAddress); tokenClient = null; } }).catch(() => {});
      },
      error_callback: e => {
        const p = pending; pending = null;
        if (p) p.rej(new Error(e?.type === 'popup_closed' ? 'Login cancelado.' : (e?.message || 'Falha no login do Google.')));
      },
    });
    tokenClient._cid = clientId();
  }
  return new Promise((res, rej) => {
    pending = { res, rej };
    const hint = localStorage.getItem('caderno.email');
    tokenClient.requestAccessToken({ prompt: silent || localStorage.getItem('caderno.driveUsed') ? '' : 'consent', ...(hint ? { hint } : {}) });
  });
}

// O Google só dá acesso por 1 hora de cada vez (app sem servidor). Renova sozinho num toque antes de vencer,
// já com a conta certa — a janelinha do Google abre e fecha sem pedir nada.
let renewing = null;
export function renewIfNeeded() {
  if (!isConfigured() || !localStorage.getItem('caderno.driveUsed')) return Promise.resolve(false);
  if (token && token.expires_at > Date.now() + 10 * 60_000) return Promise.resolve(false);
  if (!renewing) renewing = signIn({ silent: true, force: true }).then(() => true, () => false).finally(() => { renewing = null; });
  return renewing;
}

export function signOut() {
  if (token && window.google?.accounts?.oauth2) google.accounts.oauth2.revoke(token.access_token, () => {});
  token = null;
  localStorage.removeItem('caderno.token');
  localStorage.removeItem('caderno.email');
  tokenClient = null;
}

async function api(url, opts = {}, retry = true) {
  const t = await signIn();
  const r = await fetch(url, { ...opts, headers: { ...(opts.headers || {}), Authorization: `Bearer ${t}` } });
  if (r.status === 401 && retry) { token = null; return api(url, opts, false); }
  if (!r.ok) {
    let msg = `Erro do Google Drive (${r.status})`;
    try { const j = await r.json(); msg = j.error?.message || msg; } catch {}
    throw new Error(msg);
  }
  return r;
}

const q = s => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

export async function listFolder(folderId = 'root', { search = '', recent = false } = {}) {
  let query;
  if (folderId === 'shared' && !search) query = `sharedWithMe = true and trashed = false and (mimeType = 'application/pdf' or mimeType = '${FOLDER_MIME}')`;
  else if (search) query = `name contains '${q(search)}' and trashed = false and (mimeType = 'application/pdf' or mimeType = '${FOLDER_MIME}')`;
  else if (recent) query = `mimeType = 'application/pdf' and trashed = false`;
  else query = `'${q(folderId)}' in parents and trashed = false and (mimeType = 'application/pdf' or mimeType = '${FOLDER_MIME}')`;
  const params = new URLSearchParams({
    q: query,
    fields: `nextPageToken,files(${FIELDS})`,
    orderBy: recent ? 'modifiedTime desc' : 'folder,name_natural',
    pageSize: recent ? '50' : '200',
    supportsAllDrives: 'true',
    includeItemsFromAllDrives: 'true',
    spaces: 'drive',
  });
  const files = [];
  let pageToken = '';
  do {
    if (pageToken) params.set('pageToken', pageToken);
    const r = await (await api(`${API}/files?${params}`)).json();
    files.push(...r.files);
    pageToken = recent ? '' : r.nextPageToken;
  } while (pageToken && files.length < 1000);
  return files;
}

export async function getMeta(id) {
  return (await api(`${API}/files/${id}?fields=${FIELDS}&supportsAllDrives=true`)).json();
}

export async function download(id, onProgress) {
  const r = await api(`${API}/files/${id}?alt=media&supportsAllDrives=true`);
  const total = +r.headers.get('Content-Length') || 0;
  if (!r.body || !onProgress) return new Uint8Array(await r.arrayBuffer());
  const reader = r.body.getReader();
  const chunks = []; let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value); got += value.length;
    onProgress(got, total);
  }
  const out = new Uint8Array(got); let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

// Envio "resumable" (recomendado pelo Google para arquivos grandes), com
// recurso ao envio simples se o navegador não expuser o cabeçalho Location.
async function upload(method, url, meta, bytes) {
  const t = await signIn();
  const init = await fetch(`${url}${url.includes('?') ? '&' : '?'}uploadType=resumable&supportsAllDrives=true&fields=${FIELDS}`, {
    method,
    headers: {
      Authorization: `Bearer ${t}`,
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Type': 'application/pdf',
      'X-Upload-Content-Length': String(bytes.length),
    },
    body: JSON.stringify(meta || {}),
  });
  const loc = init.ok && init.headers.get('Location');
  if (loc) {
    const r = await fetch(loc, { method: 'PUT', headers: { 'Content-Type': 'application/pdf' }, body: bytes });
    if (!r.ok) throw new Error(`Falha ao enviar para o Drive (${r.status})`);
    return r.json();
  }
  // Envio multipart (metadados + arquivo numa só requisição)
  const boundary = 'caderno' + Math.random().toString(36).slice(2);
  const head = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta || {})}\r\n--${boundary}\r\nContent-Type: application/pdf\r\n\r\n`;
  const body = new Blob([head, bytes, `\r\n--${boundary}--`]);
  const r = await api(`${url}${url.includes('?') ? '&' : '?'}uploadType=multipart&supportsAllDrives=true&fields=${FIELDS}`, {
    method, headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body,
  });
  return r.json();
}

export function updateFile(id, bytes) {
  return upload('PATCH', `${UPLOAD}/files/${id}`, {}, bytes);
}

export function createFile(name, parentId, bytes) {
  return upload('POST', `${UPLOAD}/files`, { name, mimeType: 'application/pdf', parents: parentId ? [parentId] : undefined }, bytes);
}

export async function createFolder(name, parentId = 'root') {
  const r = await api(`${API}/files?supportsAllDrives=true&fields=${FIELDS}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [parentId] }),
  });
  return r.json();
}

export async function folderPath(id) {
  // Caminho de pastas até a raiz (para mostrar onde o arquivo está)
  const out = [];
  let cur = id;
  for (let i = 0; i < 8 && cur; i++) {
    const m = await (await api(`${API}/files/${cur}?fields=id,name,parents&supportsAllDrives=true`)).json();
    out.unshift({ id: m.id, name: m.parents ? m.name : 'Meu Drive' });
    cur = m.parents?.[0];
  }
  return out;
}

export async function renameItem(id, name) {
  const r = await api(`${API}/files/${id}?supportsAllDrives=true&fields=${FIELDS}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }),
  });
  return r.json();
}

// Move para a lixeira do Drive (dá para restaurar pelo Drive por 30 dias)
export async function trashItem(id) {
  const r = await api(`${API}/files/${id}?supportsAllDrives=true&fields=id,trashed`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ trashed: true }),
  });
  return r.json();
}

export async function moveItem(id, toFolder, fromFolders = []) {
  const params = new URLSearchParams({ addParents: toFolder, supportsAllDrives: 'true', fields: FIELDS });
  if (fromFolders.length) params.set('removeParents', fromFolders.join(','));
  const r = await api(`${API}/files/${id}?${params}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  return r.json();
}
