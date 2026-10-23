// Armazenamento local (IndexedDB): rascunhos automáticos, arquivos recentes e carimbos.
const DB_NAME = 'caderno-pdf';
let dbp;

function db() {
  if (!dbp) dbp = new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => {
      const d = r.result;
      d.createObjectStore('docs', { keyPath: 'id' });   // metadados + páginas
      d.createObjectStore('bytes');                      // PDF base de cada documento
      d.createObjectStore('kv');                         // diversos (carimbos, etc.)
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbp;
}

function tx(store, mode, fn) {
  return db().then(d => new Promise((res, rej) => {
    const t = d.transaction(store, mode);
    const s = t.objectStore(store);
    let out;
    const r = fn(s);
    if (r) r.onsuccess = () => { out = r.result; };
    t.oncomplete = () => res(out);
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error);
  }));
}

export const store = {
  listDocs: () => tx('docs', 'readonly', s => s.getAll()).then(a => (a || []).sort((x, y) => y.updatedAt - x.updatedAt)),
  getDoc: id => tx('docs', 'readonly', s => s.get(id)),
  putDoc: doc => tx('docs', 'readwrite', s => s.put(doc)),
  deleteDoc: async id => { await tx('docs', 'readwrite', s => s.delete(id)); await tx('bytes', 'readwrite', s => s.delete(id)); },
  getBytes: id => tx('bytes', 'readonly', s => s.get(id)),
  putBytes: (id, bytes) => tx('bytes', 'readwrite', s => s.put(bytes, id)),
  get: key => tx('kv', 'readonly', s => s.get(key)),
  set: (key, val) => tx('kv', 'readwrite', s => s.put(val, key)),
};

// Preferências simples
const PREF_KEY = 'caderno.prefs';
export function prefs() {
  try { return JSON.parse(localStorage.getItem(PREF_KEY)) || {}; } catch { return {}; }
}
export function setPref(k, v) {
  const p = prefs(); p[k] = v;
  try { localStorage.setItem(PREF_KEY, JSON.stringify(p)); } catch {}
}

// Pede ao navegador para não apagar os dados locais
export async function persistStorage() {
  try { if (navigator.storage?.persist) await navigator.storage.persist(); } catch {}
}
