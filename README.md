# chords

ギターのコード譜置き場とビューア。GitHub Pages で公開し、スマホでもオフラインで見られる（PWA）。

**サイト: https://pn11.github.io/chords/**

## 曲の書き方

`songs/` に 1 曲 1 ファイルの Markdown（`.md`）を置く。push すると曲一覧が自動で更新される。

```
# 曲名
artist: アーティスト
key: G  capo: 2

## Intro
| G | Em | C D | G |

## A
| G | Em | C | D |
| G | Em | C D | G | x2
> 2回目はミュート

D/F# = 2x0232
```

| 書き方 | 意味 |
| --- | --- |
| `# 曲名` | タイトル |
| `key: G  capo: 2` | 曲の情報。「名前: 値」を空白2つ以上で区切って並べる。`key` / `capo` / `artist` / `tempo` など何でも可。`key` は移調表示に使う |
| `## セクション名` | Intro, A, B, サビ など |
| `\| C \| Am \| F G \| C \|` | 小節ごとのコード。1小節に複数あれば拍を均等に分ける |
| `%` | 前の小節と同じ（表示ではコード名に置き換わる） |
| `x2`（行末） | その行を繰り返す |
| `> メモ` | メモ |
| `D/F# = 2x0232` | 押さえ方の指定。6弦→1弦の順、`x` はミュート。2桁のフレットがあるときは `x 10 12 12 11 10` のように空白で区切る |

- コード名の表記ゆれ（`M7` / `maj7` / `△7`、`m7-5` / `m7b5` など）はある程度吸収する
- `N.C.` などコードとして読めないものは、そのまま文字で表示する

ファイル名は英数字とハイフン推奨（例: `songs/artist-title.md`）。URL は `#/song/artist-title` になる。

## ビューアの機能

- 曲一覧と検索（曲名・アーティスト・キー）
- セクションごとの小節グリッド
- 移調（♭ / ♯。曲ごとに記憶）、文字サイズ（A− / A＋）
- 自動スクロール（− / ▶ / ＋）
- 画面の消灯を防ぐ（☀。自動スクロール中は自動でオン）
- コードダイヤグラム：曲で使うコードの一覧と、コードをタップしてのポップアップ表示（‹ › で別の押さえ方）
  - 押さえ方は曲内の指定を優先し、なければ [chords-db](https://github.com/tombatossals/chords-db) から引く
  - 辞書にない分数コードは、元のコードの低音を差し替えて作る
  - 「覚えた」にしたコードは押さえ方を出さず、名前だけ並べる（全曲共通。端末ごとに記録）
- オフライン表示（一度開いた端末では、全曲をキャッシュする）

## 公開の設定（最初の1回）

1. リポジトリを public にする（Settings → General → Danger Zone → Change visibility）
2. Settings → Pages → Build and deployment → Source を **GitHub Actions** にする
3. デフォルトブランチ（main）に push すると `.github/workflows/pages.yml` が動き、https://pn11.github.io/chords/ に公開される

ワークフローは、テスト、`songs.json`（曲一覧）の生成、Pages へのデプロイを行う。`songs.json` はコミットしない。

## 手元で確認する

```sh
npm test          # パーサなどのテスト
npm run serve     # _site/ を組み立てて http://localhost:8000 で表示
```

## 構成

```
songs/*.md               曲
index.html, assets/      ビューア（ビルド不要の素の HTML/JS/CSS）
sw.js, manifest.webmanifest  PWA
data/guitar-chords.json  コードの押さえ方の辞書（chords-db を変換したもの, MIT）
scripts/build-site.mjs   公開用サイトの組み立てと songs.json の生成
scripts/build-chord-db.mjs  chords-db からの辞書の再生成
```
