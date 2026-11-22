// テキストのタブ譜を SVG で描く。
// 文字の位置（列）はそのまま使うので、上下に書いたコード名や拍の目安もずれない。
// 弦の行: 線・小節線・フレット番号・奏法（/ \ スライド、h p の弧、b r ~ などは小さく添える）
// それ以外の行: そのまま文字で出す

const FONT = 14; // SVG 内の基準の文字サイズ。表示サイズは CSS の font-size で決まる
const CW = FONT * 0.6; // 1文字の幅（等幅）
const STRING_GAP = FONT * 1.15;
const TEXT_GAP = FONT * 1.35;
const BLANK_GAP = FONT * 0.8;
const STRING_RE = /^([A-Ga-g][#b]?)(\s*)\|/;

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const cx = (col) => col * CW + CW / 2;

export function tabSvg(lines) {
  // 行を「弦のかたまり（system）」と「文字の行」に分ける
  const blocks = [];
  for (const line of lines) {
    if (STRING_RE.test(line)) {
      const last = blocks[blocks.length - 1];
      if (last?.type === 'system') last.rows.push(line);
      else blocks.push({ type: 'system', rows: [line] });
    } else {
      blocks.push({ type: line.trim() ? 'text' : 'blank', line });
    }
  }

  const parts = [];
  let y = 0;
  let maxCol = 0;
  for (const block of blocks) {
    if (block.type === 'blank') {
      y += BLANK_GAP;
    } else if (block.type === 'text') {
      y += TEXT_GAP;
      parts.push(textLine(block.line, y - FONT * 0.35));
      maxCol = Math.max(maxCol, block.line.length);
    } else {
      const top = y + STRING_GAP * 0.7;
      parts.push(system(block.rows, top));
      y = top + STRING_GAP * (block.rows.length - 1) + STRING_GAP * 0.7;
      maxCol = Math.max(maxCol, ...block.rows.map((r) => r.length));
    }
  }
  const width = maxCol * CW + CW;
  const height = y + FONT * 0.3;
  return `<svg class="tab-svg" viewBox="0 0 ${width} ${height}" style="width:${width / FONT}em" role="img">${parts.join('')}</svg>`;
}

// 等幅の列に合わせて文字の行を置く（フォントの実際の幅に関係なく列をそろえる）
function textLine(line, baseline) {
  const lead = line.length - line.trimStart().length;
  const text = line.trim();
  return `<text x="${lead * CW}" y="${baseline}" class="t-text" textLength="${text.length * CW}" lengthAdjust="spacingAndGlyphs" xml:space="preserve">${esc(text)}</text>`;
}

function system(rows, top) {
  const parts = [];
  const ys = rows.map((_, i) => top + STRING_GAP * i);
  const bars = new Set(); // 小節線のある列
  let first = Infinity;
  let last = 0;

  const parsed = rows.map((row) => {
    const start = row.indexOf('|');
    const end = row.lastIndexOf('|');
    first = Math.min(first, start);
    last = Math.max(last, end);
    return { row, start, end };
  });

  parsed.forEach(({ row, start, end }, i) => {
    const y = ys[i];
    // 弦の名前と線
    parts.push(`<text x="${cx(0)}" y="${y + FONT * 0.33}" class="t-name" text-anchor="middle">${esc(row.slice(0, start).trim())}</text>`);
    parts.push(`<line x1="${cx(start)}" y1="${y}" x2="${cx(end)}" y2="${y}" class="t-string"/>`);
    for (let c = start; c <= end; c++) if (row[c] === '|') bars.add(c);
    // 最後の | より後ろ（"x4" など）は注記として文字で出す
    const tail = row.slice(end + 1).trim();
    if (tail) parts.push(`<text x="${cx(end) + CW * 1.5}" y="${y + FONT * 0.33}" class="t-note">${esc(tail)}</text>`);
  });

  for (const c of bars) {
    parts.push(`<line x1="${cx(c)}" y1="${ys[0]}" x2="${cx(c)}" y2="${ys[ys.length - 1]}" class="t-bar"/>`);
  }

  // フレット番号と奏法
  parsed.forEach(({ row, start, end }, i) => {
    const y = ys[i];
    const tokens = tokenize(row, start + 1, end);
    tokens.forEach((t, k) => {
      if (t.kind === 'note') {
        const w = t.text.length * CW + 4;
        const x = (cx(t.from) + cx(t.to)) / 2;
        parts.push(`<rect x="${x - w / 2}" y="${y - FONT * 0.55}" width="${w}" height="${FONT * 1.1}" class="t-bg"/>`);
        parts.push(`<text x="${x}" y="${y + FONT * 0.36}" class="t-num" text-anchor="middle">${esc(t.text)}</text>`);
        return;
      }
      const prev = tokens[k - 1]?.kind === 'note' ? tokens[k - 1] : null;
      const next = tokens[k + 1]?.kind === 'note' ? tokens[k + 1] : null;
      const x = cx(t.from);
      if ((t.text === '/' || t.text === '\\') && prev && next) {
        // スライド: 前後の音を斜めの線でつなぐ
        const up = t.text === '/' ? 1 : -1;
        parts.push(`<line x1="${cx(prev.to) + CW * 0.6}" y1="${y + FONT * 0.18 * up}" x2="${cx(next.from) - CW * 0.6}" y2="${y - FONT * 0.18 * up}" class="t-slide"/>`);
      } else if ((t.text === 'h' || t.text === 'p') && prev && next) {
        // ハンマリング・プリング: 弧と小さな文字
        const x1 = cx(prev.from);
        const x2 = cx(next.to);
        const yy = y - FONT * 0.6;
        parts.push(`<path d="M${x1} ${yy} Q${(x1 + x2) / 2} ${yy - FONT * 0.7} ${x2} ${yy}" class="t-arc"/>`);
        parts.push(`<text x="${(x1 + x2) / 2}" y="${yy - FONT * 0.45}" class="t-tech" text-anchor="middle">${t.text.toUpperCase()}</text>`);
      } else {
        // その他（b r s ~ ^ など）は小さく添える
        parts.push(`<rect x="${x - CW / 2}" y="${y - FONT * 0.4}" width="${CW}" height="${FONT * 0.8}" class="t-bg"/>`);
        parts.push(`<text x="${x}" y="${y + FONT * 0.25}" class="t-tech" text-anchor="middle">${esc(t.text)}</text>`);
      }
    });
  });
  return parts.join('');
}

// 1本の弦の行を、音（数字、(0)、x）と奏法の記号に分ける
function tokenize(row, from, to) {
  const tokens = [];
  let c = from;
  while (c < to) {
    const ch = row[c];
    if (ch === '-' || ch === '|' || ch === ' ') {
      c++;
      continue;
    }
    const m = row.slice(c, to).match(/^(\(\d+\)|\d+|[xX])/);
    if (m) {
      tokens.push({ kind: 'note', text: m[1], from: c, to: c + m[1].length - 1 });
      c += m[1].length;
    } else {
      tokens.push({ kind: 'tech', text: ch, from: c, to: c });
      c++;
    }
  }
  return tokens;
}
