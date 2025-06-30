# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## プロジェクト概要

TaskChute Cloud連携CLIツール - Denoベースのブラウザ自動化でTaskChuteのタスクデータを取得

## 開発コマンド

### 基本的な開発フロー
```bash
# 開発実行（ファイル監視モード）
deno task dev

# テスト実行
deno task test

# 実行可能バイナリのビルド
deno task build

# ビルドした実行ファイルでテスト
./taskchute-cli login
./taskchute-cli csv-download
```

### 主要タスク（deno.json定義）
- `deno task start` - CLIアプリケーション起動
- `deno task login` - TaskChute Cloudにログイン
- `deno task csv-download` - CSVファイルをダウンロード
- `deno task csv-test` - CSVエクスポートページのテスト（ヘッドフルモード）
- `deno task check-login` - ログイン状態確認
- `deno task save-html` - ページHTMLを保存（デバッグ用）

### テスト実行
```bash
# 全テスト実行
deno test --allow-all tests/

# 特定のテストファイル実行
deno test --allow-all tests/fetcher_test.ts

# 統合テストランナー
deno run --allow-all test-runner.ts
```

## アーキテクチャ概要

### コア構造
```
src/
├── main.ts      - エントリーポイント、CLIコマンドの初期化
├── cli.ts       - コマンドルーティング、引数解析
├── auth.ts      - 認証とセッション管理（Playwrightコンテキスト永続化）
├── fetcher.ts   - ブラウザ自動化、データ取得（getTaskDataFromCSV）
└── config.ts    - 設定管理（環境変数、ファイル設定）
```

### 重要な実装パターン

1. **セッション永続化**
   - `launchPersistentContext`を使用してChrome User Dataを永続化
   - セッションディレクトリ: `~/.taskchute/playwright`
   - 24時間の自動期限切れ機能

2. **エラーハンドリング**
   - Result型パターン: `{ success: boolean, error?: string, data?: T }`
   - 複数セレクタ戦略によるフォールバック
   - デバッグ情報の自動保存（スクリーンショット、HTML）

3. **ブラウザ自動化戦略**
   - Googleログイン経由でTaskChute Cloudへアクセス
   - Material-UIコンポーネントへの特殊対応
   - 明示的な待機とページ遷移の確実な処理

### 現在の技術的課題（解決済み）

✅ **CSVエクスポート機能の主要問題はすべて解決**

1. **日付入力問題** - 4つの入力方法を実装して解決
2. **ログイン永続化** - Chromeプロファイルコピー機能で解決  
3. **ダウンロード検出** - UUID形式ファイルの検出に対応
4. **CSVパース** - 完全なパース機能を実装

### 重要な実装詳細

**プラットフォーム対応** (`src/platform.ts`)
- macOS: Google Chromeの実体を使用（channel: 'chrome'）
- WSL: WindowsのChromeプロファイルを参照

**Chromeプロファイル管理** (`src/chrome-profile-manager.ts`)
- SingletonLock問題を回避するためプロファイルをコピー
- 必要なファイルのみ選択的にコピー

**CSVダウンロード処理** (`src/fetcher.ts`)
- 拡張子なしUUID形式ファイルの検出
- ダウンロードディレクトリの監視

## 環境変数と設定

### 必須環境変数
```bash
export TASKCHUTE_EMAIL="your-email@example.com"
export TASKCHUTE_PASSWORD="your-password"
```

### オプション環境変数
- `TASKCHUTE_HEADLESS` - ヘッドレスモード（デフォルト: true）
- `TASKCHUTE_USER_DATA_DIR` - Chrome User Dataディレクトリ（WSL対応）
- `TASKCHUTE_TIMEOUT` - タイムアウト時間（デフォルト: 30000ms）

### 設定ファイル
- `~/.taskchute/config.json` - 認証情報と各種設定
- `~/.taskchute/session.json` - セッション状態

## Material-UI対応の注意点

TaskChute CloudはMaterial-UIを使用しており、以下の特殊対応が必要:

1. **DatePicker**
   - 通常のinput操作が効かない可能性
   - Material-UI特有のイベント発火が必要
   - aria-labelやdata-testidでの要素特定

2. **ボタン状態**
   - Mui-disabledクラスの監視
   - フォームバリデーション完了の待機
   - 状態変更後の適切な遅延

3. **動的コンテンツ**
   - React/Next.jsのレンダリング完了待機
   - ネットワーク要求の完了確認
   - DOM更新の明示的な待機

## デバッグ手法

### ヘッドフルモードでの確認
```bash
# UIを表示して動作確認
deno task csv-test

# 環境変数でヘッドレス無効化
TASKCHUTE_HEADLESS=false deno task csv-download
```

### デバッグファイル
- スクリーンショット: `tmp/claude/debug-*.png`
- ページHTML: `tmp/claude/page-*.html`
- エラーログ: コンソール出力に詳細情報

### トラブルシューティング
1. ログイン失敗 → セッションクリア: `rm -rf ~/.taskchute/playwright`
2. セレクタエラー → `save-html`タスクでDOM構造確認
3. タイムアウト → `--timeout`オプションで延長

## 開発上の制約

1. **Deno特有の制約**
   - npm依存はnpm:プレフィックスで指定
   - 権限は明示的に付与（--allow-all）
   - TypeScript設定はdeno.jsonで管理

2. **Playwright制約**
   - ブラウザは事前インストール必要
   - User Data競合に注意（同時起動不可）
   - WSL環境では特殊設定が必要

3. **TaskChute Cloud制約**
   - ページ構造が変更される可能性
   - レート制限への配慮
   - Material-UIコンポーネントの特殊性