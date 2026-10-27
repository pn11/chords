import { parseSong, isChord, chordsInSong, transposeChord, transposeKey, keyUsesFlats } from './parser.js';
import { loadChordDb, findShapes, diagramSvg, fretsLabel, chordId } from './chords.js';

const SONG_CACHE = 'songs';
const SCROLL_SPEEDS = [8, 12, 16, 22, 30, 40, 55, 75, 100]; // px/秒
const FONT_MIN = 14;
const FONT_MAX = 72;

const $ = (sel) => document.querySelector(sel);
const main = $('#main');
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const store = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v === null ? fallback : JSON.parse(v);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* プライベートモードなど */
    }
  },
};

let songIndex = null;
let current = null; // { file, song, transpose }
const chordDbReady = loadChordDb('data/guitar-chords.json').catch(() => {});

// ---------- 曲一覧 ----------

async function loadIndex() {
  if (songIndex) return songIndex;
  const res = await fetch('songs.json', { cache: 'no-cache' });
  songIndex = await res.json();
  songIndex.sort((a, b) => a.title.localeCompare(b.title, 'ja'));
  precacheSongs(songIndex);
  return songIndex;
}

// オフラインで開けるように、全曲をキャッシュしておく
async function precacheSongs(list) {
  if (!('caches' in window) || !navigator.serviceWorker?.controller) return;
  try {
    const cache = await caches.open(SONG_CACHE);
    await cache.addAll(list.map((s) => s.file));
  } catch {
    /* オフライン時などは次回に任せる */
  }
}

const normalize = (s) => (s ?? '').normalize('NFKC').toLowerCase();

async function showList() {
  stopScroll();
  setChrome({ title: 'Chords', back: false, toolbar: false });
  main.innerHTML = '<p class="empty">読み込み中…</p>';
  let list;
  try {
    list = await loadIndex();
  } catch {
    main.innerHTML = '<p class="empty">曲一覧を読み込めませんでした。</p>';
    return;
  }
  const query = sessionStorage.getItem('query') ?? '';
  main.innerHTML = `
    <input class="search" type="search" placeholder="曲名・アーティスト・キーで検索" value="${esc(query)}" aria-label="検索">
    <ul class="song-list"></ul>`;
  const input = main.querySelector('.search');
  const ul = main.querySelector('.song-list');
  const render = () => {
    const words = normalize(input.value).split(/\s+/).filter(Boolean);
    const hits = list.filter((s) => {
      const hay = normalize(`${s.title} ${s.artist} ${s.key} ${s.file}`);
      return words.every((w) => hay.includes(w));
    });
    ul.innerHTML = hits.length
      ? hits
          .map(
            (s) => `<li><a href="#/song/${encodeURIComponent(songId(s.file))}">
              <span class="title">${esc(s.title)}${s.artist ? `<span class="artist">${esc(s.artist)}</span>` : ''}</span>
              <span class="key">${s.key ? `key: ${esc(s.key)}` : ''}${s.capo && s.capo !== '0' ? ` capo: ${esc(s.capo)}` : ''}</span>
            </a></li>`,
          )
          .join('')
      : '<li class="empty">見つかりませんでした</li>';
  };
  input.addEventListener('input', () => {
    sessionStorage.setItem('query', input.value);
    render();
  });
  render();
}

const songId = (file) => file.replace(/^songs\//, '').replace(/\.md$/, '');

// ---------- 曲の表示 ----------

async function showSong(id) {
  stopScroll();
  const file = `songs/${id}.md`;
  setChrome({ title: '', back: true, toolbar: true });
  main.innerHTML = '<p class="empty">読み込み中…</p>';
  let text;
  try {
    const res = await fetch(file, { cache: 'no-cache' });
    if (!res.ok) throw new Error(res.status);
    text = await res.text();
  } catch {
    main.innerHTML = '<p class="empty">曲を読み込めませんでした。</p>';
    return;
  }
  const song = parseSong(text);
  current = { file, song, transpose: store.get(`transpose:${file}`, 0) };
  document.title = `${song.title || id} - Chords`;
  $('#page-title').textContent = song.title || id;
  window.scrollTo(0, 0);
  await chordDbReady;
  renderSong();
}

function chordNamer() {
  const { song, transpose } = current;
  const key = song.meta.key;
  const flats = transpose && key ? keyUsesFlats(transposeKey(key, transpose)) : null;
  return (name) => transposeChord(name, transpose, flats);
}

function renderSong() {
  const { song, transpose } = current;
  const name = chordNamer();
  const meta = Object.entries(song.meta)
    .map(([k, v]) => {
      if (k === 'key' && transpose) {
        return `<span>key: <b class="changed">${esc(transposeKey(v, transpose))}</b>（元 ${esc(v)}）</span>`;
      }
      return `<span>${esc(k)}: <b>${esc(v)}</b></span>`;
    })
    .join('');

  const chords = chordsInSong(song);
  const known = chords.filter((orig) => isKnown(name(orig)));
  const strip = chords
    .filter((orig) => !isKnown(name(orig)))
    .map((orig) => {
      const shape = shapesFor(orig)[0];
      return `<div class="chord-card">
        <button data-chord="${esc(orig)}">
          <div class="name">${esc(name(orig))}</div>
          ${shape ? diagramSvg(shape) : '<div class="none">押さえ方なし</div>'}
        </button>
        <button class="mark-known" data-known="${esc(orig)}">覚えた</button>
      </div>`;
    })
    .join('');
  const knownList = known.length
    ? `<div class="known-chords">覚えたコード ${known
        .map((orig) => `<button data-chord="${esc(orig)}">${esc(name(orig))}</button>`)
        .join('')}</div>`
    : '';

  const ctx = { prev: null }; // % の小節のために、直前の小節を覚えておく
  const sections = song.sections
    .map((section) => {
      const rows = section.items.filter((i) => i.type === 'row');
      const cols = Math.max(1, ...rows.map((r) => r.bars.length));
      const repeatCol = rows.some((r) => r.repeat > 1);
      const body = section.items
        .map((item) =>
          item.type === 'note' ? `<div class="note">${esc(item.text)}</div>` : renderRow(item, cols, repeatCol, name, ctx),
        )
        .join('');
      return `<section class="section">${section.name ? `<h2>${esc(section.name)}</h2>` : ''}${body}</section>`;
    })
    .join('');

  main.innerHTML = `
    ${meta ? `<div class="song-meta">${meta}</div>` : ''}
    ${strip ? `<div class="chord-strip">${strip}</div>` : ''}
    ${knownList}
    ${sections}`;

  fitBeats();
  const value = $('#tr-value');
  value.textContent = `${transpose > 0 ? '+' : ''}${transpose}`;
  value.classList.toggle('changed', transpose !== 0);
}

// 1小節に複数コードがあって入りきらないときは、その小節だけ文字を小さくする。
// それでも入らなければ折り返す。
function fitBeats() {
  for (const bar of main.querySelectorAll('.bar')) {
    const beats = [...bar.querySelectorAll('.beat')];
    if (beats.length < 2) continue;
    bar.classList.remove('loose');
    bar.style.removeProperty('--fit');
    const overflowing = () => beats.some((b) => b.scrollWidth > b.clientWidth);
    for (let scale = 0.9; overflowing() && scale >= 0.65; scale -= 0.1) {
      bar.style.setProperty('--fit', scale.toFixed(2));
    }
    if (overflowing()) bar.classList.add('loose');
  }
}

let resizeTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => current && fitBeats(), 150);
});

function renderRow(row, cols, repeatCol, name, ctx) {
  const cells = row.bars.map((bar, i) => {
    const last = i === row.bars.length - 1 ? ' last' : '';
    // % は直前の小節のコードをそのまま書く
    if (bar.simile) bar = { chords: ctx.prev ?? [] };
    ctx.prev = bar.chords;
    const beats = bar.chords.length
      ? bar.chords
          .map((c) =>
            isChord(c)
              ? `<button class="beat" data-chord="${esc(c)}">${esc(name(c))}</button>`
              : `<div class="beat text">${esc(c)}</div>`,
          )
          .join('')
      : '<div class="beat"></div>';
    return `<div class="bar${last}">${beats}</div>`;
  });
  for (let i = row.bars.length; i < cols; i++) cells.push('<div class="bar pad"></div>');
  if (repeatCol) cells.push(row.repeat > 1 ? `<div class="repeat">×${row.repeat}</div>` : '<div></div>');
  return `<div class="row${repeatCol ? ' has-repeat' : ''}" style="--cols:${cols}">${cells.join('')}</div>`;
}

function shapesFor(orig) {
  const { song, transpose } = current;
  return findShapes(chordNamer()(orig), { defs: song.defs, original: orig, transpose });
}

// ---------- 覚えたコード ----------
// 覚えたコードは一覧のダイヤグラムを出さず、名前だけ並べる。全曲共通で、この端末に記録する。
// 移調後の名前で判定するので、移調して覚えていないコードになれば押さえ方が出る。

let knownChords = new Set(store.get('knownChords', []));

const isKnown = (shown) => knownChords.has(chordId(shown));

function setKnown(shown, value) {
  if (value) knownChords.add(chordId(shown));
  else knownChords.delete(chordId(shown));
  store.set('knownChords', [...knownChords]);
}

// ---------- コードのポップアップ ----------

const dialog = $('#chord-dialog');
let dlgShapes = [];
let dlgIndex = 0;
let dlgChord = null;

function openChord(orig) {
  dlgChord = orig;
  $('#dlg-name').textContent = chordNamer()(orig);
  dlgShapes = shapesFor(orig);
  dlgIndex = 0;
  renderDialog();
  dialog.showModal();
}

$('#dlg-known').addEventListener('click', () => {
  const shown = chordNamer()(dlgChord);
  setKnown(shown, !isKnown(shown));
  renderDialog();
  renderSong();
});

function renderDialog() {
  const shape = dlgShapes[dlgIndex];
  $('#dlg-body').innerHTML = shape
    ? `${diagramSvg(shape)}<div class="frets">${fretsLabel(shape.frets)}</div>`
    : '<div class="none">押さえ方が見つかりません。<br>曲ファイルに「コード名 = x32010」の形で書けます。</div>';
  const known = isKnown(chordNamer()(dlgChord));
  const knownBtn = $('#dlg-known');
  knownBtn.textContent = known ? '✓ 覚えた（押さえ方を一覧に戻す）' : '覚えた（一覧に押さえ方を出さない）';
  knownBtn.setAttribute('aria-pressed', String(known));
  const many = dlgShapes.length > 1;
  $('.dlg-nav').hidden = !many;
  $('#dlg-count').textContent = many ? `${dlgIndex + 1} / ${dlgShapes.length}` : '';
}

$('#dlg-prev').addEventListener('click', () => {
  dlgIndex = (dlgIndex - 1 + dlgShapes.length) % dlgShapes.length;
  renderDialog();
});
$('#dlg-next').addEventListener('click', () => {
  dlgIndex = (dlgIndex + 1) % dlgShapes.length;
  renderDialog();
});
dialog.addEventListener('click', (e) => {
  if (e.target === dialog) dialog.close(); // 背景をタップで閉じる
});

main.addEventListener('click', (e) => {
  const mark = e.target.closest('[data-known]');
  if (mark) {
    setKnown(chordNamer()(mark.dataset.known), true);
    renderSong();
    return;
  }
  const el = e.target.closest('[data-chord]');
  if (el) openChord(el.dataset.chord);
});

// ---------- 文字サイズ ----------

function applyFontSize() {
  const size = store.get('fontSize', null);
  if (size) document.documentElement.style.setProperty('--chord-size', `${size}px`);
}

function changeFontSize(delta) {
  const now = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--chord-size'));
  const size = Math.min(FONT_MAX, Math.max(FONT_MIN, Math.round(now * (delta > 0 ? 1.15 : 1 / 1.15))));
  store.set('fontSize', size);
  applyFontSize();
  if (current) fitBeats();
}

// ---------- 自動スクロール ----------

let scrollFrame = null;
let scrollLast = 0;
let scrollCarry = 0;
let speedIndex = store.get('scrollSpeed', 3);

function scrollStep(t) {
  const dt = scrollLast ? (t - scrollLast) / 1000 : 0;
  scrollLast = t;
  scrollCarry += SCROLL_SPEEDS[speedIndex] * dt;
  const px = Math.floor(scrollCarry);
  if (px > 0) {
    scrollCarry -= px;
    window.scrollBy(0, px);
  }
  const atBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2;
  if (atBottom) {
    stopScroll();
    return;
  }
  scrollFrame = requestAnimationFrame(scrollStep);
}

function startScroll() {
  scrollLast = 0;
  scrollCarry = 0;
  scrollFrame = requestAnimationFrame(scrollStep);
  updateScrollButton();
  updateWakeLock();
}

function stopScroll() {
  if (scrollFrame) cancelAnimationFrame(scrollFrame);
  scrollFrame = null;
  updateScrollButton();
  updateWakeLock();
}

function updateScrollButton() {
  const btn = $('#sc-toggle');
  btn.setAttribute('aria-pressed', String(Boolean(scrollFrame)));
  btn.textContent = scrollFrame ? `⏸ ${speedIndex + 1}` : '▶';
}

function changeSpeed(delta) {
  speedIndex = Math.min(SCROLL_SPEEDS.length - 1, Math.max(0, speedIndex + delta));
  store.set('scrollSpeed', speedIndex);
  updateScrollButton();
}

// ---------- 画面の消灯を防ぐ ----------

let wakeWanted = false;
let wakeLock = null;

async function updateWakeLock() {
  const want = wakeWanted || Boolean(scrollFrame); // 自動スクロール中も消灯しない
  if (!('wakeLock' in navigator)) return;
  if (want && !wakeLock && document.visibilityState === 'visible') {
    try {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => {
        wakeLock = null;
      });
    } catch {
      wakeLock = null;
    }
  } else if (!want && wakeLock) {
    await wakeLock.release();
    wakeLock = null;
  }
}

document.addEventListener('visibilitychange', updateWakeLock);
if (!('wakeLock' in navigator)) $('#wake').hidden = true;

// ---------- ツールバー ----------

$('#toolbar').addEventListener('click', (e) => {
  const act = e.target.closest('button')?.dataset.act;
  if (!act) return;
  switch (act) {
    case 'tr-up':
    case 'tr-down': {
      if (!current) return;
      let t = current.transpose + (act === 'tr-up' ? 1 : -1);
      if (t > 6) t -= 12;
      if (t < -6) t += 12;
      current.transpose = t;
      store.set(`transpose:${current.file}`, t);
      renderSong();
      break;
    }
    case 'fs-up':
      changeFontSize(1);
      break;
    case 'fs-down':
      changeFontSize(-1);
      break;
    case 'sc-toggle':
      if (scrollFrame) stopScroll();
      else startScroll();
      break;
    case 'sc-faster':
      changeSpeed(1);
      break;
    case 'sc-slower':
      changeSpeed(-1);
      break;
    case 'wake':
      wakeWanted = !wakeWanted;
      $('#wake').setAttribute('aria-pressed', String(wakeWanted));
      updateWakeLock();
      break;
  }
});

// ---------- ルーティング ----------

function setChrome({ title, back, toolbar }) {
  $('#page-title').textContent = title;
  if (title) document.title = title;
  $('#back').hidden = !back;
  $('#toolbar').hidden = !toolbar;
  if (!toolbar) current = null;
}

function route() {
  const m = location.hash.match(/^#\/song\/(.+)$/);
  if (m) showSong(decodeURIComponent(m[1]));
  else showList();
}

window.addEventListener('hashchange', route);
applyFontSize();
route();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').then(() => {
    // 初回はまだ制御下にないので、制御が始まってから曲をキャッシュする
    navigator.serviceWorker.addEventListener('controllerchange', () => songIndex && precacheSongs(songIndex));
  });
}
