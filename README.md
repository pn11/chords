# chords

コード譜置き場。

## 構成

```
songs/       コード譜本体（1曲1ファイル）
templates/   新規作成用テンプレート
```

## 書式

[ChordPro](https://www.chordpro.org/) 形式（拡張子 `.cho`）で書く。
歌詞の中に `[コード]` を埋め込むだけのプレーンテキストなので、どのエディタでも書けて、
ChordPro 対応アプリ（ChordPro CLI, OnSong, SongbookPro など）でそのまま表示・PDF化できる。

```
{title: 曲名}
{artist: アーティスト}
{key: C}

{start_of_verse}
[C]歌詞の[F]途中で[G]コードが[C]変わる
{end_of_verse}
```

よく使うディレクティブ:

| ディレクティブ | 意味 |
| --- | --- |
| `{title: }` / `{artist: }` | 曲名 / アーティスト |
| `{key: }` / `{capo: }` / `{tempo: }` | キー / カポ / テンポ |
| `{start_of_verse}` … `{end_of_verse}` | Aメロなど |
| `{start_of_chorus}` … `{end_of_chorus}` | サビ |
| `{start_of_bridge}` … `{end_of_bridge}` | 間奏・Cメロ |
| `{comment: }` | 注釈（「×2」など） |

## ファイル名

`songs/アーティスト名-曲名.cho`（英数字・ハイフン推奨。日本語でも可）

## 新しい曲を追加する

```sh
cp templates/song.cho songs/artist-title.cho
```

## PDF にする（任意）

```sh
# ChordPro CLI: https://www.chordpro.org/chordpro/chordpro-installation/
chordpro songs/artist-title.cho -o artist-title.pdf
chordpro --transpose=2 songs/artist-title.cho   # 移調
```
