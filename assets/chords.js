// コードの押さえ方の検索と、ダイヤグラム（SVG）の描画。
// 押さえ方は { frets: number[6], baseFret, barres: number[] } で扱う。
// frets は 6弦→1弦の絶対フレット（-1=ミュート, 0=開放）。barres も絶対フレット。
import { parseChord, noteName } from './parser.js';

const DB_KEYS = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const OPEN_STRINGS = [4, 9, 2, 7, 11, 4]; // E A D G B E のピッチクラス

// 表記ゆれ → chords-db のサフィックス
const SUFFIX_ALIASES = {
  '': 'major', M: 'major', maj: 'major',
  m: 'minor', min: 'minor', '-': 'minor',
  M7: 'maj7', Maj7: 'maj7', '△7': 'maj7', '△': 'maj7', 'Δ7': 'maj7', 'Δ': 'maj7',
  '-7': 'm7', min7: 'm7',
  'm7-5': 'm7b5', 'm7(b5)': 'm7b5', 'm7(-5)': 'm7b5', 'ø': 'm7b5', 'ø7': 'm7b5',
  '°': 'dim', o: 'dim', '°7': 'dim7', o7: 'dim7',
  '+': 'aug', '+5': 'aug', '#5': 'aug',
  sus: 'sus4', '7sus': '7sus4',
  '6/9': '69', 'm6/9': 'm69',
  mM7: 'mmaj7', 'm(maj7)': 'mmaj7', 'mMaj7': 'mmaj7', 'm△7': 'mmaj7',
  '7-5': '7b5', '7(b5)': '7b5', '7-9': '7b9', '7(b9)': '7b9', '7+9': '7#9', '7(#9)': '7#9',
  '7+5': 'aug7', '7#5': 'aug7', '+7': 'aug7',
  M9: 'maj9', Maj9: 'maj9', add2: 'add9', 'madd2': 'madd9',
  M13: 'maj13', M11: 'maj11',
};

let db = null;

export async function loadChordDb(url) {
  const res = await fetch(url);
  db = await res.json();
}

function dbPositions(root, suffix) {
  const list = db?.[DB_KEYS[root]]?.[suffix];
  if (!list) return null;
  return list.map((p) => {
    const toAbs = (n) => (n > 0 ? n + p.b - 1 : n);
    return {
      frets: [...p.f].map((c) => (c === 'x' ? -1 : toAbs(Number(c)))),
      baseFret: p.b,
      barres: p.r.map(toAbs),
    };
  });
}

/** 絶対フレットの配列から押さえ方を作る（曲内の指定用） */
export function shapeFromFrets(frets) {
  const played = frets.filter((f) => f > 0);
  const lo = played.length ? Math.min(...played) : 1;
  const hi = played.length ? Math.max(...played) : 1;
  const baseFret = hi <= 4 ? 1 : lo;
  return { frets, baseFret, barres: guessBarres(frets) };
}

function guessBarres(frets) {
  const played = frets.filter((f) => f > 0);
  if (!played.length) return [];
  const lo = Math.min(...played);
  const idx = frets.map((f, i) => (f === lo ? i : -1)).filter((i) => i >= 0);
  if (idx.length < 2) return [];
  const first = idx[0];
  const last = idx[idx.length - 1];
  for (let i = first; i <= last; i++) if (frets[i] < lo) return [];
  return [lo];
}

function isPlayable(shape) {
  for (const b of shape.barres) {
    const idx = shape.frets.map((f, i) => (f === b ? i : -1)).filter((i) => i >= 0);
    if (idx.length < 2) return false;
    for (let i = idx[0]; i <= idx[idx.length - 1]; i++) if (shape.frets[i] < b) return false;
  }
  return true;
}

/** 元の押さえ方の最低音を bass に差し替えて分数コードを作る（6弦→5弦の順に試す） */
function withBass(shape, bass) {
  const played = shape.frets.filter((f) => f > 0);
  const lo = played.length ? Math.min(...played) : 0;
  const hi = played.length ? Math.max(...played) : 0;
  for (const s of [0, 1]) {
    for (let f = 0; f <= Math.max(hi + 1, 4); f++) {
      if ((OPEN_STRINGS[s] + f) % 12 !== bass) continue;
      if (f > 0 && (f < lo - 1 || Math.max(hi, f) - Math.min(lo || f, f) > 4)) continue;
      const frets = shape.frets.map((x, i) => (i < s ? -1 : i === s ? f : x));
      const candidate = { ...shape, frets, barres: shape.barres.filter((b) => frets.filter((x) => x === b).length >= 2) };
      if (isPlayable(candidate)) return { ...candidate, baseFret: Math.max(...frets) <= 4 ? 1 : candidate.baseFret };
    }
  }
  return null;
}

/** 押さえ方を半音 n 個ぶんずらす（曲内指定のコードを移調したとき用） */
export function shiftShape(frets, n) {
  let shift = ((n % 12) + 12) % 12;
  const played = frets.filter((f) => f > 0);
  // 下にずらせるならそのほうが低いポジションになる
  if (frets.every((f) => f !== 0) && played.length && Math.min(...played) - (12 - shift) >= 1) shift -= 12;
  return shapeFromFrets(frets.map((f) => (f < 0 ? f : f + shift)));
}

/**
 * コード名から押さえ方の候補を返す（見つからなければ空配列）。
 * defs: 曲内で指定された押さえ方 { 元のコード名: frets }
 * original: 移調前のコード名、transpose: 移調量
 */
export function findShapes(name, { defs = {}, original = name, transpose = 0 } = {}) {
  if (!transpose && defs[name]) return [shapeFromFrets(defs[name])];
  const fromDb = lookupDb(name);
  if (fromDb.length) return fromDb;
  if (defs[original]) return [shiftShape(defs[original], transpose)];
  return [];
}

function lookupDb(name) {
  const c = parseChord(name);
  if (!c || !db) return [];
  const suffix = SUFFIX_ALIASES[c.quality] ?? c.quality;
  if (c.bass === null || c.bass === c.root) return dbPositions(c.root, suffix) ?? [];

  // chords-db にある分数コード（"/E", "m/G" など）はそのまま使う
  const slashPrefix = suffix === 'major' ? '' : suffix === 'minor' ? 'm' : null;
  if (slashPrefix !== null) {
    for (const flats of [false, true]) {
      const found = dbPositions(c.root, `${slashPrefix}/${noteName(c.bass, flats)}`);
      if (found) return found;
    }
  }
  const base = dbPositions(c.root, suffix) ?? [];
  return base.map((s) => withBass(s, c.bass)).filter(Boolean);
}

/** ダイヤグラムの SVG 文字列 */
export function diagramSvg(shape) {
  const strings = 6;
  const x0 = 16;
  const dx = 14;
  const y0 = 26;
  const dy = 18;
  const rel = (f) => f - shape.baseFret + 1;
  const maxRel = Math.max(4, ...shape.frets.filter((f) => f > 0).map(rel));
  const frets = Math.min(maxRel, 6);
  const width = x0 * 2 + dx * (strings - 1);
  const height = y0 + dy * frets + 8;
  const sx = (i) => x0 + dx * i;
  const parts = [];

  for (let i = 0; i < strings; i++) {
    parts.push(`<line x1="${sx(i)}" y1="${y0}" x2="${sx(i)}" y2="${y0 + dy * frets}" class="d-line"/>`);
  }
  for (let j = 0; j <= frets; j++) {
    const y = y0 + dy * j;
    const nut = j === 0 && shape.baseFret === 1;
    parts.push(`<line x1="${sx(0)}" y1="${y}" x2="${sx(5)}" y2="${y}" class="${nut ? 'd-nut' : 'd-line'}"/>`);
  }
  if (shape.baseFret > 1) {
    parts.push(`<text x="${x0 - 6}" y="${y0 + dy / 2 + 4}" class="d-base" text-anchor="end">${shape.baseFret}</text>`);
  }
  shape.frets.forEach((f, i) => {
    if (f < 0) parts.push(`<text x="${sx(i)}" y="${y0 - 8}" class="d-mark" text-anchor="middle">×</text>`);
    else if (f === 0) parts.push(`<circle cx="${sx(i)}" cy="${y0 - 12}" r="4" class="d-open"/>`);
  });
  for (const b of shape.barres) {
    const idx = shape.frets.map((f, i) => (f === b ? i : -1)).filter((i) => i >= 0);
    if (idx.length < 2) continue;
    const y = y0 + dy * (rel(b) - 0.5);
    const x1 = sx(idx[0]);
    const x2 = sx(idx[idx.length - 1]);
    parts.push(`<rect x="${x1 - 6}" y="${y - 6}" width="${x2 - x1 + 12}" height="12" rx="6" class="d-dot"/>`);
  }
  shape.frets.forEach((f, i) => {
    if (f > 0 && !shape.barres.includes(f)) {
      parts.push(`<circle cx="${sx(i)}" cy="${y0 + dy * (rel(f) - 0.5)}" r="6" class="d-dot"/>`);
    }
  });
  return `<svg viewBox="0 0 ${width} ${height}" class="diagram" role="img">${parts.join('')}</svg>`;
}

/** フレットの文字列表記（"x32010" や "x 10 12 12 11 10"） */
export function fretsLabel(frets) {
  const big = frets.some((f) => f > 9);
  return frets.map((f) => (f < 0 ? 'x' : String(f))).join(big ? ' ' : '');
}
