# Dada Survivor Event Info / ダダサバイバー イベント情報ツール

「ダダサバイバー」のゲーム内イベントスケジュールを表示するためのWebツールです。

## 機能
- **イベントカレンダー**: 直近のイベントスケジュールをカレンダー形式(2ヶ月分)で表示。
- **イベントリスト**: 開催中・開催予定のイベント一覧を見やすく表示。
- **残り日数計算**: イベント終了や開催までの日数を自動計算。
- **日本語/英語/中国語対応**: 設定から言語切り替えが可能。
- **JSONエクスポート機能**: `export-events.js` を使用して、その日のイベント情報をJSONとして出力可能。

## 使い方 (Web版)
GitHub Pagesなどで公開されたURLにアクセスするだけで利用可能です。

## 使い方 (ローカル)
ブラウザのセキュリティ制限(CORS)のため、htmlファイルを直接開いても動作しません。以下のいずれかの方法で簡易サーバーを立ち上げて閲覧してください。

### VSCode Live Server (推奨)
1. VSCodeでこのフォルダを開く。
2. 拡張機能「Live Server」をインストール。
3. 右下の「Go Live」ボタンをクリック。

### Python
```bash
python -m http.server
# ブラウザで http://localhost:8000 にアクセス
```

### Node.js
```bash
npx http-server
# ブラウザで http://localhost:8080 にアクセス
```

## 自動化 (JSONエクスポート)
Node.js環境があれば、以下のコマンドでイベント情報をJSONファイルに出力できます。
```bash
node export-events.js
```
出力先: `daily_events.json`
