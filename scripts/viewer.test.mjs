import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseSong, parseChord, transposeChord, transposeKey, chordsInSong } from '../assets/parser.js';
import { loadChordDb, findShapes } from '../assets/chords.js';

const EXAMPLE = `# 曲名
key: G  capo: 2

## Intro
| G | Em | C D | G |

## A
| G | Em | C | D |
| G | Em | C D | G | x2
> 2回目はミュート
| % | Am7 | D/F# | N.C. |

D/F# = 2x0232
`;

test('記法を解析する', () => {
  const song = parseSong(EXAMPLE);
  assert.equal(song.title, '曲名');
  assert.deepEqual(song.meta, { key: 'G', capo: '2' });
  assert.deepEqual(song.sections.map((s) => s.name), ['Intro', 'A']);
  const [r1, r2, note, r3] = song.sections[1].items;
  assert.equal(r1.repeat, 1);
  assert.equal(r2.repeat, 2);
  assert.deepEqual(r2.bars[2], { chords: ['C', 'D'] });
  assert.deepEqual(note, { type: 'note', text: '2回目はミュート' });
  assert.deepEqual(r3.bars[0], { simile: true });
  assert.deepEqual(song.defs, { 'D/F#': [2, -1, 0, 2, 3, 2] });
  assert.deepEqual(chordsInSong(song), ['G', 'Em', 'C', 'D', 'Am7', 'D/F#']);
});

test('2桁フレットの指定と閉じていない小節', () => {
  const song = parseSong('## A\n| C | G\nBb = x 1 3 3 3 1\nE7 = 0 2 0 1 0 0\nB = x 14 13 11 12 11');
  assert.deepEqual(song.sections[0].items[0].bars, [{ chords: ['C'] }, { chords: ['G'] }]);
  assert.deepEqual(song.defs.B, [-1, 14, 13, 11, 12, 11]);
  assert.deepEqual(song.defs.E7, [0, 2, 0, 1, 0, 0]);
});

test('コード名の解析', () => {
  assert.deepEqual(parseChord('F#m7b5'), { root: 6, quality: 'm7b5', bass: null, flat: false });
  assert.deepEqual(parseChord('Bb/D'), { root: 10, quality: '', bass: 2, flat: true });
  assert.equal(parseChord('C6/9').quality, '6/9');
  assert.equal(parseChord('N.C.'), null);
  assert.equal(parseChord('%'), null);
});

test('移調', () => {
  assert.equal(transposeChord('D/F#', 2), 'E/G#');
  assert.equal(transposeChord('Am7', 3), 'Cm7');
  assert.equal(transposeChord('G', 1, true), 'Ab');
  assert.equal(transposeChord('G', 1, false), 'G#');
  assert.equal(transposeKey('G', 1), 'Ab');
  assert.equal(transposeKey('G', -1), 'F#');
  assert.equal(transposeKey('Em', 1), 'Fm');
  assert.equal(transposeKey('Em', 2), 'F#m');
});

test('押さえ方の検索', async () => {
  const json = await readFile(new URL('../data/guitar-chords.json', import.meta.url), 'utf8');
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ json: async () => JSON.parse(json) });
  try {
    await loadChordDb('data/guitar-chords.json');
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.deepEqual(findShapes('C')[0].frets, [-1, 3, 2, 0, 1, 0]);
  assert.deepEqual(findShapes('CM7')[0].frets, findShapes('Cmaj7')[0].frets);
  assert.ok(findShapes('Bbm7').length > 0);
  assert.ok(findShapes('A#m7').length > 0);
  // chords-db にある分数コード
  assert.deepEqual(findShapes('C/E')[0].frets.slice(0, 2), [0, 3]);
  // ない分数コードは低音を差し替えて作る
  assert.deepEqual(findShapes('D/F#')[0].frets.slice(0, 1), [2]);
  assert.deepEqual(findShapes('G/B')[0].frets.slice(0, 2), [-1, 2]);
  // 曲内の指定が優先、移調したら辞書から引く
  const defs = { G: [3, 2, 0, 0, 3, 3] };
  assert.deepEqual(findShapes('G', { defs })[0].frets, [3, 2, 0, 0, 3, 3]);
  assert.notDeepEqual(findShapes('A', { defs, original: 'G', transpose: 2 })[0].frets, [5, 4, 2, 2, 5, 5]);
  // 辞書にないコードは指定をずらして使う
  const odd = { Gx: [3, -1, 0, 0, 3, 3] };
  assert.equal(findShapes('Gx', { defs: odd })[0].frets[0], 3);
  assert.equal(findShapes('Hx', { defs: {} }).length, 0);
});
