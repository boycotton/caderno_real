// Dicionário japonês (JMdict + KANJIDIC2 da EDRDG, CC BY-SA 4.0), fatiado em dict/N.json pelo 1º caractere.
// Só a fatia necessária é baixada; o service worker guarda para funcionar offline.

const N = 512;
const shards = new Map();
const shardOf = s => s.codePointAt(0) % N;

function load(n) {
  if (!shards.has(n)) shards.set(n, fetch(`dict/${n}.json`).then(r => { if (!r.ok) throw new Error('dicionário ' + r.status); return r.json(); }).catch(e => { shards.delete(n); throw e; }));
  return shards.get(n);
}

// ---------- tipos para a deflexão ----------
const V1 = 1, V5 = 2, VK = 4, VS = 8, ADJ = 16, TE = 32, ALL = 63;
function entryMask(senses) {
  let m = 0;
  for (const [pos] of senses) for (const p of pos.split(',')) {
    if (p === 'v1') m |= V1;
    else if (p.startsWith('v5')) m |= V5;
    else if (p === 'vk') m |= VK;
    else if (p === 'vs-i') m |= VS;
    else if (p === 'adj-i' || p === 'adj-ix') m |= ADJ;
  }
  return m;
}

const U = 'うくぐすつぬぶむる', A = 'わかがさたなばまら', I = 'いきぎしちにびみり', E = 'えけげせてねべめれ', O = 'おこごそとのぼもろ';
const PAST5 = { 'く': ['いた', 'いて'], 'ぐ': ['いだ', 'いで'], 'す': ['した', 'して'], 'つ': ['った', 'って'], 'う': ['った', 'って'], 'る': ['った', 'って'], 'ぬ': ['んだ', 'んで'], 'ぶ': ['んだ', 'んで'], 'む': ['んだ', 'んで'] };

// [terminação flexionada, terminação de dicionário, tipo exigido da forma atual, tipo resultante, nome]
const RULES = [];
const R = (f, t, need, res, why) => RULES.push([f, t, need, res, why]);
(function build() {
  const polite = [['ます', 'polido'], ['ました', 'polido passado'], ['ません', 'polido negativo'], ['ませんでした', 'polido neg. passado'], ['ましょう', 'polido volitivo'], ['まして', 'polido -te']];
  for (const [p, w] of polite) {
    R(p, 'る', ALL, V1, w);
    for (let k = 0; k < 9; k++) R(I[k] + p, U[k], ALL, V5, w);
    R('し' + p, 'する', ALL, VS, w); R('き' + p, 'くる', ALL, VK, w); R('来' + p, '来る', ALL, VK, w);
  }
  // negativo (comporta-se como adjetivo -i)
  R('ない', 'る', ADJ, V1, 'negativo');
  for (let k = 0; k < 9; k++) R(A[k] + 'ない', U[k], ADJ, V5, 'negativo');
  R('しない', 'する', ADJ, VS, 'negativo'); R('こない', 'くる', ADJ, VK, 'negativo'); R('来ない', '来る', ADJ, VK, 'negativo');
  R('ず', 'る', ALL, V1, 'negativo (-zu)'); for (let k = 0; k < 9; k++) R(A[k] + 'ず', U[k], ALL, V5, 'negativo (-zu)');
  R('せず', 'する', ALL, VS, 'negativo (-zu)');
  R('ん', 'る', ALL, V1, 'negativo coloquial'); for (let k = 0; k < 9; k++) R(A[k] + 'ん', U[k], ALL, V5, 'negativo coloquial');
  // passado / -te / -tara / -tari
  const pastForms = (f, t, res) => {
    const te = f.replace(/た$/, 'て').replace(/だ$/, 'で');
    R(f, t, ALL, res, 'passado'); R(te, t, ALL | TE, res, 'forma -te');
    R(f + 'ら', t, ALL, res, 'condicional -tara'); R(f + 'り', t, ALL, res, '-tari');
  };
  pastForms('た', 'る', V1);
  for (const [u, [ta]] of Object.entries(PAST5)) pastForms(ta, u, V5);
  pastForms('いった', 'いく', V5); pastForms('行った', '行く', V5);
  pastForms('した', 'する', VS); pastForms('きた', 'くる', VK); pastForms('来た', '来る', VK);
  // -te iru / -te shimau
  for (const [x, y] of [['ている', 'て'], ['てる', 'て'], ['でいる', 'で'], ['でる', 'で']]) R(x, y, V1, TE, 'progressivo (-te iru)');
  for (const [x, y] of [['てしまう', 'て'], ['でしまう', 'で'], ['ちゃう', 'て'], ['じゃう', 'で']]) R(x, y, V5, TE, 'completo (-te shimau)');
  for (const [x, y] of [['ておく', 'て'], ['でおく', 'で'], ['とく', 'て'], ['どく', 'で']]) R(x, y, V5, TE, '-te oku');
  for (const [x, y] of [['てある', 'て'], ['である', 'で']]) R(x, y, V5, TE, '-te aru');
  for (const [x, y] of [['てくる', 'て'], ['でくる', 'で']]) R(x, y, VK, TE, '-te kuru');
  for (const [x, y] of [['ていく', 'て'], ['でいく', 'で']]) R(x, y, V5, TE, '-te iku');
  // potencial / passiva / causativa (resultam em verbo ichidan)
  R('られる', 'る', V1, V1, 'passiva/potencial'); R('させる', 'る', V1, V1, 'causativa'); R('れる', 'る', V1, V1, 'potencial');
  for (let k = 0; k < 9; k++) {
    R(A[k] + 'れる', U[k], V1, V5, 'passiva'); R(A[k] + 'せる', U[k], V1, V5, 'causativa');
    R(E[k] + 'る', U[k], V1, V5, 'potencial'); R(A[k] + 'す', U[k], V5, V5, 'causativa curta');
  }
  R('される', 'する', V1, VS, 'passiva'); R('させる', 'する', V1, VS, 'causativa'); R('できる', 'する', V1, VS, 'potencial');
  R('こられる', 'くる', V1, VK, 'passiva/potencial'); R('こさせる', 'くる', V1, VK, 'causativa');
  // volitivo, condicional, imperativo, desejo
  R('よう', 'る', ALL, V1, 'volitivo'); for (let k = 0; k < 9; k++) R(O[k] + 'う', U[k], ALL, V5, 'volitivo');
  R('しよう', 'する', ALL, VS, 'volitivo'); R('こよう', 'くる', ALL, VK, 'volitivo');
  R('れば', 'る', ALL, V1, 'condicional -ba'); for (let k = 0; k < 9; k++) R(E[k] + 'ば', U[k], ALL, V5, 'condicional -ba');
  R('すれば', 'する', ALL, VS, 'condicional -ba'); R('くれば', 'くる', ALL, VK, 'condicional -ba');
  R('ろ', 'る', ALL, V1, 'imperativo'); R('よ', 'る', ALL, V1, 'imperativo'); for (let k = 0; k < 9; k++) R(E[k], U[k], ALL, V5, 'imperativo');
  R('しろ', 'する', ALL, VS, 'imperativo'); R('せよ', 'する', ALL, VS, 'imperativo'); R('こい', 'くる', ALL, VK, 'imperativo');
  R('たい', 'る', ADJ, V1, 'desejo (-tai)'); for (let k = 0; k < 9; k++) R(I[k] + 'たい', U[k], ADJ, V5, 'desejo (-tai)');
  R('したい', 'する', ADJ, VS, 'desejo (-tai)'); R('きたい', 'くる', ADJ, VK, 'desejo (-tai)');
  R('なさい', 'る', ALL, V1, 'imperativo polido'); for (let k = 0; k < 9; k++) R(I[k] + 'なさい', U[k], ALL, V5, 'imperativo polido');
  R('ながら', 'る', ALL, V1, 'enquanto (-nagara)'); for (let k = 0; k < 9; k++) R(I[k] + 'ながら', U[k], ALL, V5, 'enquanto (-nagara)');
  R('そう', 'る', ALL, V1, 'parece (-sou)'); for (let k = 0; k < 9; k++) R(I[k] + 'そう', U[k], ALL, V5, 'parece (-sou)');
  // adjetivos -i
  R('く', 'い', ALL, ADJ, 'advérbio'); R('くて', 'い', ALL | TE, ADJ, 'forma -te'); R('かった', 'い', ALL, ADJ, 'passado');
  R('くない', 'い', ADJ, ADJ, 'negativo'); R('ければ', 'い', ALL, ADJ, 'condicional'); R('かったら', 'い', ALL, ADJ, 'condicional -tara');
  R('さ', 'い', ALL, ADJ, 'substantivo (-sa)'); R('そう', 'い', ALL, ADJ, 'parece (-sou)'); R('すぎる', 'い', V1, ADJ, 'demais (-sugiru)');
  R('くなる', 'い', V5, ADJ, 'ficar (-ku naru)'); R('かろう', 'い', ALL, ADJ, 'presuntivo');
  R('すぎる', 'る', V1, V1, 'demais (-sugiru)'); for (let k = 0; k < 9; k++) R(I[k] + 'すぎる', U[k], V1, V5, 'demais (-sugiru)');
})();

export function deinflect(word) {
  const out = [{ word, type: ALL, why: [] }];
  const seen = new Map([[word, ALL]]);
  for (let i = 0; i < out.length && out.length < 200; i++) {
    const c = out[i];
    if (c.why.length >= 5) continue;
    for (const [f, t, need, res, why] of RULES) {
      if (!(c.type & need) || c.word.length <= f.length - 1 || !c.word.endsWith(f)) continue;
      const w = c.word.slice(0, c.word.length - f.length) + t;
      if (!w || w === c.word) continue;
      const prev = seen.get(w);
      if (prev !== undefined && (prev & res) === res) continue;
      seen.set(w, (prev || 0) | res);
      out.push({ word: w, type: res, why: [why, ...c.why] });
    }
  }
  return out;
}

const kata2hira = s => s.replace(/[ァ-ヶ]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0x60));

// Procura a palavra mais longa no começo de `text` (como o Rikaikun). Devolve { len, entries:[...] }.
export async function lookup(text, max = 6, { exact = false } = {}) {
  text = text.slice(0, 20);
  const results = [];
  const got = new Set();
  let bestLen = 0;
  for (let len = text.length; len >= (exact ? text.length : 1) && results.length < max; len--) {
    const sub = text.slice(0, len);
    if (!/[぀-ヿ㐀-鿿豈-﫿々〆ヶ]/.test(sub[0])) break;
    const cands = deinflect(sub);
    const alt = kata2hira(sub);
    if (alt !== sub) cands.push({ word: alt, type: ALL, why: [] });
    for (const c of cands) {
      let S;
      try { S = await load(shardOf(c.word)); } catch { continue; }
      const idx = S.i[c.word];
      if (!idx) continue;
      for (const k of idx) {
        const e = S.e[k];
        const key = e[0].join() + '|' + e[1].join();
        if (got.has(key)) continue;
        if (c.type !== ALL && !(entryMask(e[2]) & c.type)) continue;
        got.add(key);
        results.push({ len, kanji: e[0], kana: e[1], senses: e[2], common: !!e[3], why: c.why, word: c.word });
        if (!bestLen) bestLen = len;
      }
    }
  }
  // mais longas primeiro; entre iguais, as comuns primeiro
  results.sort((a, b) => b.len - a.len || b.common - a.common);
  return { len: bestLen, entries: results.slice(0, max) };
}

export async function kanjiInfo(ch) {
  try {
    const S = await load(shardOf(ch));
    const k = S.K[ch];
    if (!k) return null;
    const [strokes, grade, jlpt, freq, on, kun, en, pt] = k;
    return { ch, strokes, grade, jlpt, freq, on, kun, en, pt };
  } catch { return null; }
}

export const isKanji = ch => /[㐀-鿿豈-﫿々]/.test(ch);
