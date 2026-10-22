// 公開用のサイトを組み立てる。
//   node scripts/build-site.mjs [出力先=_site]
// - songs/*.md を読んで曲一覧 songs.json を生成する
// - sw.js のキャッシュ名をビルドごとに変える
import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSong, parseChord } from '../assets/parser.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.resolve(root, process.argv[2] ?? '_site');

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
for (const name of ['index.html', 'manifest.webmanifest', 'assets', 'data', 'songs']) {
  await cp(path.join(root, name), path.join(out, name), { recursive: true });
}

const build = (process.env.GITHUB_SHA ?? Date.now().toString(36)).slice(0, 12);
const sw = await readFile(path.join(root, 'sw.js'), 'utf8');
await writeFile(path.join(out, 'sw.js'), sw.replace('__BUILD__', build));

const files = (await readdir(path.join(root, 'songs'))).filter((f) => f.endsWith('.md')).sort();
const songs = [];
let warnings = 0;
for (const f of files) {
  const song = parseSong(await readFile(path.join(root, 'songs', f), 'utf8'));
  songs.push({
    file: `songs/${f}`,
    title: song.title || f.replace(/\.md$/, ''),
    artist: song.meta.artist ?? '',
    key: song.meta.key ?? '',
    capo: song.meta.capo ?? '',
  });
  // コードとして読めない記号を知らせる（表示はそのまま文字で出る）
  const unknown = new Set();
  for (const s of song.sections) {
    for (const item of s.items) {
      for (const bar of item.bars ?? []) {
        for (const c of bar.chords ?? []) if (!parseChord(c) && !/^(N\.?C\.?|-|\/|\.)$/i.test(c)) unknown.add(c);
      }
    }
  }
  if (unknown.size) {
    warnings++;
    console.warn(`::warning file=songs/${f}::コードとして読めない記号: ${[...unknown].join(' ')}`);
  }
}
await writeFile(path.join(out, 'songs.json'), JSON.stringify(songs, null, 1));
console.log(`${songs.length} 曲 → ${path.relative(root, out) || '.'}/ (build ${build}${warnings ? `, 警告 ${warnings} 件` : ''})`);
