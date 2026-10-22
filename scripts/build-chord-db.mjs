// chords-db (https://github.com/tombatossals/chords-db) の guitar.json を
// ビューア用のコンパクトな形式に変換する。
//   npm pack @tombatossals/chords-db && tar xzf tombatossals-chords-db-*.tgz
//   node scripts/build-chord-db.mjs package/lib/guitar.json
// 出力: data/guitar-chords.json
//   { "C": { "major": [ { "f": "x32010", "b": 1, "r": [] }, ... ] }, ... }
//   f: 6弦→1弦の相対フレット (x=ミュート, 0=開放), b: 基準フレット, r: セーハの相対フレット
import { readFile, writeFile } from 'node:fs/promises';

const MAX_POSITIONS = 4;
const src = JSON.parse(await readFile(process.argv[2], 'utf8'));
const out = {};
for (const list of Object.values(src.chords)) {
  for (const chord of list) {
    const key = chord.key.replace('sharp', '#');
    out[key] ??= {};
    out[key][chord.suffix] = chord.positions.slice(0, MAX_POSITIONS).map((p) => ({
      f: p.frets.map((n) => (n < 0 ? 'x' : String(n))).join(''),
      b: p.baseFret,
      r: p.barres ?? [],
    }));
  }
}
const dest = new URL('../data/guitar-chords.json', import.meta.url);
await writeFile(dest, JSON.stringify(out));
console.log(`wrote ${dest.pathname}`);
