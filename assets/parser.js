// 曲ファイル（songs/*.md）のパーサと、コード名の移調。
// ブラウザと Node（scripts/build-site.mjs）の両方から読み込む。

const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLAT_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const NATURAL_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
// フラット系の長調（F, Bb, Eb, Ab, Db）の主音
const FLAT_MAJOR_KEYS = new Set([5, 10, 3, 8, 1]);

const CHORD_RE = /^([A-G])([#b♯♭]?)((?:6\/9|[^/])*)(?:\/([A-G])([#b♯♭]?))?$/;
const META_KEY_RE = /(?:^|\s)([A-Za-z_぀-ヿ一-鿿][\w\-぀-ヿ一-鿿]*)\s*:\s*/g;
const DEF_RE = /^(\S+)\s*=\s*([0-9xX][0-9xX\s]*)$/;
const REPEAT_RE = /\|\s*[xX×](\d+)\s*$/;

/**
 * 曲ファイルのテキストを解析する。
 * @returns {{title: string, meta: Record<string,string>, sections: Section[], defs: Record<string, number[]>}}
 *   Section = { name, items: (Row | Note)[] }
 *   Row = { type: 'row', bars: Bar[], repeat: number }
 *   Bar = { chords: string[] } | { simile: true }
 *   Note = { type: 'note', text }
 */
export function parseSong(text) {
  const song = { title: '', meta: {}, sections: [], defs: {} };
  let section = null;
  const current = () => {
    if (!section) {
      section = { name: '', items: [] };
      song.sections.push(section);
    }
    return section;
  };

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    let m;
    if ((m = line.match(/^#\s+(.+)$/))) {
      if (!song.title) song.title = m[1].trim();
      continue;
    }
    if ((m = line.match(/^##\s+(.+)$/))) {
      section = { name: m[1].trim(), items: [] };
      song.sections.push(section);
      continue;
    }
    if (line.startsWith('>')) {
      current().items.push({ type: 'note', text: line.slice(1).trim() });
      continue;
    }
    if (line.startsWith('|')) {
      current().items.push(parseRow(line));
      continue;
    }
    if ((m = line.match(DEF_RE))) {
      const frets = parseFrets(m[2]);
      if (frets) {
        song.defs[normalizeAccidentals(m[1])] = frets;
        continue;
      }
    }
    const meta = parseMeta(line);
    if (meta) {
      Object.assign(song.meta, meta);
      continue;
    }
    // どれにも当てはまらない行はメモとして表示する
    current().items.push({ type: 'note', text: line });
  }
  // 中身のない無名セクション（メタ情報の前など）は除く
  song.sections = song.sections.filter((s) => s.name || s.items.length);
  return song;
}

function parseRow(line) {
  let body = line;
  let repeat = 1;
  const m = body.match(REPEAT_RE);
  if (m) {
    repeat = Number(m[1]);
    body = body.slice(0, m.index + 1);
  }
  const parts = body.split('|').slice(1);
  if (parts.length && parts[parts.length - 1].trim() === '') parts.pop();
  const bars = parts.map((p) => {
    const tokens = p.trim().split(/\s+/).filter((t) => t && t !== ':');
    if (tokens.length === 1 && tokens[0] === '%') return { simile: true };
    return { chords: tokens.map(normalizeAccidentals) };
  });
  return { type: 'row', bars, repeat };
}

/** "2x0232" または "x 10 12 12 11 10" → [2,-1,0,2,3,2]（6弦→1弦、-1=ミュート） */
export function parseFrets(s) {
  const tokens = /\s/.test(s.trim()) ? s.trim().split(/\s+/) : [...s.trim()];
  if (tokens.length !== 6) return null;
  return tokens.map((t) => (t.toLowerCase() === 'x' ? -1 : Number(t)));
}

function parseMeta(line) {
  const matches = [...line.matchAll(META_KEY_RE)];
  if (!matches.length || matches[0].index !== 0) return null;
  const meta = {};
  matches.forEach((m, i) => {
    const start = m.index + m[0].length;
    const end = i + 1 < matches.length ? matches[i + 1].index : line.length;
    meta[m[1].toLowerCase()] = line.slice(start, end).trim();
  });
  return meta;
}

function normalizeAccidentals(s) {
  return s.replace(/♯/g, '#').replace(/♭/g, 'b');
}

/** コード名を分解する。コードとして読めなければ null。 */
export function parseChord(name) {
  const m = normalizeAccidentals(name).match(CHORD_RE);
  if (!m) return null;
  const pc = (letter, acc) => (NATURAL_PC[letter] + (acc === '#' ? 1 : acc === 'b' ? -1 : 0) + 12) % 12;
  return {
    root: pc(m[1], m[2]),
    quality: m[3],
    bass: m[4] ? pc(m[4], m[5]) : null,
    flat: m[2] === 'b' || m[5] === 'b',
  };
}

export function isChord(token) {
  return parseChord(token) !== null;
}

export function noteName(pc, flats) {
  return (flats ? FLAT_NAMES : SHARP_NAMES)[((pc % 12) + 12) % 12];
}

/** 移調後のキー（"G", "Em" など）がフラット系かどうか */
export function keyUsesFlats(key) {
  const c = parseChord(key);
  if (!c) return null;
  const minor = /^m(?!aj)/.test(c.quality);
  const major = minor ? (c.root + 3) % 12 : c.root;
  return FLAT_MAJOR_KEYS.has(major);
}

/**
 * コード名を半音 n 個ぶん移調する。
 * flats: true/false で表記を指定。null なら元のコード名の表記に合わせる。
 */
export function transposeChord(name, n, flats = null) {
  if (!n) return name;
  const c = parseChord(name);
  if (!c) return name;
  const useFlats = flats ?? c.flat;
  return (
    noteName(c.root + n, useFlats) + c.quality + (c.bass !== null ? '/' + noteName(c.bass + n, useFlats) : '')
  );
}

/** キー名を移調する（"G" → "Ab" など）。表記は移調後のキーで決める。 */
export function transposeKey(key, n) {
  if (!n || !key) return key;
  const c = parseChord(key);
  if (!c) return key;
  const moved = noteName(c.root + n, false) + c.quality;
  return transposeChord(key, n, keyUsesFlats(moved));
}

/** 曲で使われるコード名を登場順に返す */
export function chordsInSong(song) {
  const seen = new Set();
  for (const section of song.sections) {
    for (const item of section.items) {
      if (item.type !== 'row') continue;
      for (const bar of item.bars) {
        for (const ch of bar.chords ?? []) if (isChord(ch)) seen.add(ch);
      }
    }
  }
  return [...seen];
}
