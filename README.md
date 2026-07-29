# Anime Data Create

入力作業用アプリ集です。Next.js App Router と TypeScript で実装し、Cloudflare Pages では静的サイトとして配信します。

## アプリ

- `/` - アプリ一覧
- `/apps/keyframe/` - 原画キーフレーム入力
- `/apps/layout-rough/` - レイアウト・ラフ原画入力
- `/apps/timesheet/` - タイムシート入力

## 原画キーフレーム入力

ブラウザ上でローカル画像フォルダを読み込み、注釈 CSV を作成します。既存の `fix_flag` は修正判定の出力として維持し、確定した資料種別、色、合成指示の追加列も書き出します。

CSV カラム:

```csv
image_filename,layer,keyframe_number,fix_flag,x1,y1,x2,y2,colored_paper_flag,paper_color,paper_color_other,explicit_correction_flag,explicit_inbetween_reference_flag,related_material_flag,blank_paper_flag,composite_instruction_flag,material_type,classification
```

主な機能:

- ローカル画像フォルダの一括読み込み
- フォルダ内に CSV がある場合の同時読み込み
- `tif` / `tiff` を含む画像ファイルの読み込み
- 画像の順送り、前後移動
- テキスト入力式のレイヤー、番号、資料種別、色
- 資料種別は修正、参考、関連資料(その他)、白紙をラジオボタンで排他入力
- 色は白、ピンク、黄、その他をラジオボタンで排他入力し、その他は自由入力
- 資料種別が原画かつ白以外の色で同じレイヤー番号の別画像がある場合は修正、なければ中割り参考として推定
- 原画がない修正を中割り参考へ変更し、タイムラインで確認する適用ボタン
- CSV 書き出し時は、同じレイヤー番号に原画がない修正を中割り参考として出力
- 修正、中割り参考、関連資料(その他)が明示的に分かる場合の上書き指定
- 合成指示は資料種別とは別の領域フラグとして入力
- `tif` / `tiff` の PNG プレビュー変換
- ドラッグによる矩形座標入力
- 同じ画像への複数行追加
- 選択中の保存済み行、または未保存の矩形を削除
- レイヤー別タイムラインでサムネイルと資料種別を横並び確認
- タイムラインのサムネイル左上に色の丸印を表示
- 合成指示はタイムライン上のレイヤー位置に置かず、その他に表示
- 同じレイヤー番号に複数行がある場合は同じ列内に縦積み表示
- CSV の読み込みと編集
- `keyframe.csv` の書き出し

主なショートカット:

- `Ctrl+Enter` - 保存して次へ
- `Ctrl+I` - ローカル画像を読み込む
- `Ctrl+O` - CSV を読み込む
- `Ctrl+0` - 原画にする
- `Ctrl+1` - 修正にする
- `Ctrl+2` - 中割り参考にする
- `Ctrl+3` - 関連資料(その他)にする
- `Ctrl+4` - 白紙にする
- `Ctrl+5` - 色を白にする
- `Ctrl+6` - 色をピンクにする
- `Ctrl+7` - 色を黄にする
- `Ctrl+8` - 色をその他にする
- `Ctrl+Q` - 合成指示を切り替える
- `Ctrl+N` - 同じ画像に枠と番号を追加
- `Ctrl+E` - 選択中の既存行を編集
- `←/→` - 入力欄外で前後の画像へ移動
- `Ctrl+←/→` または `Ctrl+[/]` - 前後の画像へ移動
- `Ctrl+S` - CSV 書き出し

## レイアウト・ラフ原画入力

原画キーフレーム入力と同じ画面構成で、レイアウト・ラフ原画用の注釈 CSV を作成します。
フォルダ内に `layout_rough.csv` などの CSV がある場合は、画像と同時に読み込みます。

CSV カラム:

```csv
image_filename,layer,keyframe_number,x1,y1,x2,y2,paper_color,paper_color_other,layout_flag,correction_layout_flag,rough_keyframe_flag,correction_rough_keyframe_flag,reference_flag,book_flag,blank_paper_flag,composite_instruction_flag,material_type,classification
```

資料種別:

- レイアウト
- 修正レイアウト
- ラフ原画
- 修正ラフ原画
- 参考
- Book
- 白紙

主なショートカット:

- `Ctrl+1` - レイアウトにする
- `Ctrl+2` - 修正レイアウトにする
- `Ctrl+3` - ラフ原画にする
- `Ctrl+4` - 修正ラフ原画にする
- `Ctrl+5` - 参考にする
- `Ctrl+6` - Bookにする
- `Ctrl+7` - 白紙にする
- `Ctrl+8` - 色を白にする
- `Ctrl+9` - 色をピンクにする
- `Ctrl+0` - 色を黄にする
- `Ctrl+-` - 色をその他にする
- `Ctrl+Q` - 合成指示を切り替える

## タイムシート入力

タイムシート入力アプリ用のフォルダを読み込み、画像と `.xlsx` をブラウザ内で編集します。フォルダ内に `.xlsx` がない場合は新規タイムシートを作成します。

主な機能:

- フォルダ内の画像と `.xlsx` の同時読み込み
- フォルダ内に `.xlsx` が複数ある場合の選択読み込み
- XLSX がない場合は0Fから新規作成
- タイムシート名の編集
- 秒数・追加フレーム数の入力と `更新` ボタンでの行数反映
- 合計フレーム数を `秒数×24 + フレーム` で計算して行数を自動調整
- フレーム番号が途中で止まっていても、下のセル入力が続くXLSXを読み込み
- 原画・動画の両ブロックを1セル分空けて編集
- 原画側でのレイヤー名編集と動画側への同期
- `レイヤー+`、レイヤー名の間に出る `+` での差し込み、選択したレイヤーの `レイヤー-`
- `原画変換` で `r(start,end)` の展開と動画欄への連番化
- フォルダ内 `.txt` の内容を `原画変換` 横に表示
- セル幅の拡大縮小
- セルの直接編集、Enterまたはフォーカス移動で確定
- 折りたたみ可能な画像選択欄で表示画像を複数選択
- 画像エリアのポップアップ表示、移動、拡大縮小、スクロール
- 画像ポップアップ中・非表示中はセルエリアを全幅表示
- 1行目からフレーム列・レイヤー名を並べた `.xlsx` 書き出し

## 開発

```bash
npm run dev
```

## ビルド

```bash
npm run build
```

`next.config.ts` の `output: "export"` により、成果物は `out/` に生成されます。

## Cloudflare Pages

Cloudflare Pages の設定:

- Build command: `npm run build`
- Build output directory: `out`

`wrangler.jsonc` には `pages_build_output_dir` を設定済みです。
