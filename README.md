# taskchute-claude-cli

TaskChute Cloud連携CLIツール - 環境変数ベースの直接ログインでPlaywright自動化を実現

## 概要

このCLIツールは、環境変数に設定したメールアドレス・パスワードを使用してTaskChute CloudへのPlaywrightブラウザ操作によるログインとHTMLデータ取得を自動化します。

## 特徴

- **TDD開発**: テスト駆動開発でコード品質を担保
- **Deno**: モダンなTypeScript/JavaScriptランタイム
- **Playwright**: 信頼性の高いブラウザ自動化
- **直接ログイン**: 環境変数のメール・パスワードによるブラウザ操作ログイン
- **複数ブラウザ対応**: Chromium, Firefox, WebKit
- **セッション管理**: ファイルベースのセッション状態管理

## インストール

```bash
# リポジトリをクローン
git clone https://github.com/nekowasabi/taskchute-claude-cli.git
cd taskchute-claude-cli

# Playwrightブラウザをインストール（初回のみ）
deno run -A npm:playwright@1.40.0 install chromium

# 依存関係の確認（自動ダウンロード）
deno task test
```

## 使用方法

### 環境変数の設定

```bash
export TASKCHUTE_EMAIL="your-email@example.com"
export TASKCHUTE_PASSWORD="your-password"
```

### 基本コマンド

```bash
# ヘルプ表示
deno task start

# TaskChute Cloudにログイン（ブラウザ操作）
deno task start login

# ヘッドレスモードでログイン
deno task start login --headless

# TaskChuteデータをHTMLファイルに取得
deno task start fetch --output ./tasks.html

# TaskChuteデータをJSONファイルに取得
deno task start fetch --output ./tasks.json

# ログイン状態確認
deno task start status
```

### 高度な使用例

```bash
# Firefoxを使用してログイン
deno task start login --browser firefox

# タイムアウトを60秒に設定
deno task start login --timeout 60000

# 非ヘッドレスモードで実行（デバッグ用・ブラウザ画面が見える）
TASKCHUTE_HEADLESS=false deno task start login

# 実際のTaskChute Cloud環境でのテスト
export TASKCHUTE_EMAIL="your-google-email@gmail.com"
export TASKCHUTE_PASSWORD="your-google-password"
deno run --allow-all src/main.ts login

# ログイン後のデータ取得
deno run --allow-all src/main.ts fetch --output ./taskchute-data.html
```

## 開発

### テスト実行

```bash
# 全テスト実行
deno task test

# テスト型チェックなしで実行
deno test --allow-all --no-check

# 基本動作テスト
deno run --allow-all test-runner.ts
```

### プロジェクト構造

```
taskchute-claude-cli/
├── src/
│   ├── main.ts          # メインエントリーポイント
│   ├── cli.ts           # CLIコマンド処理
│   ├── auth.ts          # 認証・セッション管理
│   ├── fetcher.ts       # データ取得・ブラウザ制御
│   └── config.ts        # 設定管理
├── tests/
│   ├── cli_test.ts      # CLIテスト
│   ├── auth_test.ts     # 認証テスト
│   └── fetcher_test.ts  # データ取得テスト
├── deno.json           # Deno設定
└── test-runner.ts      # 統合テスト
```

## 設定

### 環境変数

| 変数名 | 説明 | デフォルト値 |
|--------|------|-------------|
| `TASKCHUTE_EMAIL` | TaskChute Cloudログイン用メールアドレス | 必須 |
| `TASKCHUTE_PASSWORD` | TaskChute Cloudログイン用パスワード | 必須 |
| `TASKCHUTE_HEADLESS` | ヘッドレスモード | `true` |
| `TASKCHUTE_BROWSER` | 使用ブラウザ | `chromium` |
| `TASKCHUTE_TIMEOUT` | タイムアウト(ms) | `30000` |
| `TASKCHUTE_OUTPUT_DIR` | デフォルト出力ディレクトリ | `./tmp/claude` |

### 設定ファイル

設定は `~/.taskchute/config.json` に保存されます：

```json
{
  "auth": {
    "email": "your-email@example.com",
    "password": "your-password"
  },
  "fetcher": {
    "headless": true,
    "browser": "chromium",
    "timeout": 30000,
    "viewport": { "width": 1920, "height": 1080 }
  },
  "general": {
    "defaultOutputDir": "./tmp/claude",
    "maxRetries": 3,
    "logLevel": "info"
  }
}
```

## セキュリティ

- **認証情報の保護**: メール・パスワードは環境変数で管理
- **セッション管理**: セッション情報は `~/.taskchute/session.json` に保存
- **自動セッション期限**: 24時間でセッション自動無効化
- **安全な設定管理**: 環境変数とファイルベースの設定分離

## ログイン動作

CLIは以下の手順でTaskChute Cloudにログインします：

1. **TaskChute Cloudログインページ**（`https://taskchute.cloud/auth/login/`）に移動
2. **GOOGLEでログインボタン**を複数のセレクタで検索・クリック
3. **Google認証ページ**で環境変数のメール・パスワードを自動入力
4. **TaskChute Cloud**（`https://taskchute.cloud/taskchute`）へのリダイレクト完了まで待機
5. **セッション情報**をローカルファイル（`~/.taskchute/session.json`）に保存

### 詳細なログイン処理

- **高精度セレクタ**: XPath `/html/body/div[4]/div/div[2]/div/button[1]` 由来の正確なセレクタ優先
- **多段階検索戦略**: 
  1. CSSセレクタ（XPath由来）
  2. SVGアイコンベースセレクタ 
  3. テキストベースセレクタ
  4. 直接XPathセレクタ（フォールバック）
- **リダイレクト対応**: `/taskchute`（メイン）、`/dashboard`、`/app`、`/home`など複数のリダイレクト先に対応
- **デバッグ機能**: ログイン失敗時はスクリーンショットとページ詳細情報を保存
- **タイムアウト制御**: 各段階で適切なタイムアウト設定

## トラブルシューティング

### WSL環境でのGoogle 2段階認証の問題

WSL (Windows Subsystem for Linux) 環境からヘッドレスモードでログインを実行すると、Googleの2段階認証が正常に完了しない場合があります。これは、WSL環境のブラウザが通常のデスクトップ環境と異なるセッションとして扱われるためです。

この問題を解決するには、`TASKCHUTE_USER_DATA_DIR` 環境変数を使用して、Windows側にすでに存在するChromeのユーザープロファイルをPlaywrightに読み込ませます。これにより、普段使用しているブラウザのログイン状態やCookieを引き継ぐことができます。

#### 設定手順

1.  **WindowsのChromeユーザーデータディレクトリを確認する**
    通常、以下のパスにあります。
    `C:\Users\<Your-Username>\AppData\Local\Google\Chrome\User Data`

2.  **WSLからアクセス可能なパスに変換する**
    WSLからWindowsのファイルシステムにアクセスするには、`/mnt/c/` のようなパスを使用します。
    `/mnt/c/Users/<Your-Username>/AppData/Local/Google/Chrome/User Data`

3.  **環境変数を設定してCLIを実行する**
    以下のコマンドで、指定したユーザープロファイルを使用してログインを実行します。

    ```bash
    export TASKCHUTE_USER_DATA_DIR="/mnt/c/Users/<Your-Username>/AppData/Local/Google/Chrome/User Data"
    deno task start login
    ```

    **注意:**
    - `<Your-Username>` はご自身のWindowsユーザー名に置き換えてください。
    - この方法を使用する場合、Playwrightが起動するブラウザと、普段お使いのChromeブラウザを同時に起動しないでください。プロファイルがロックされ、エラーが発生する可能性があります。

### よくある問題

1. **認証エラー**: `TASKCHUTE_EMAIL`と`TASKCHUTE_PASSWORD`の設定を確認
2. **ブラウザ起動失敗**: Playwrightの依存関係をインストール
3. **タイムアウトエラー**: `--timeout` オプションで時間を延長
4. **ログインボタンが見つからない**: TaskChute Cloudのページ構造変更の可能性

### ログとデバッグ

```bash
# 詳細ログ出力
TASKCHUTE_LOG_LEVEL=debug deno task start login

# 非ヘッドレスモードでブラウザ動作確認
TASKCHUTE_HEADLESS=false deno task start login

# 実際のブラウザ操作を確認
deno task start login --browser chromium
```

### セッション管理

```bash
# セッション状態確認
deno task start status

# セッション手動削除
rm ~/.taskchute/session.json

# 強制再ログイン
deno task start login
```

## 技術仕様

### ブラウザ自動化詳細

- **Playwright**: クロスブラウザ対応の自動化ライブラリ
- **セレクタ戦略**: 複数セレクタでの要素検索
- **待機戦略**: 明示的待機でページ遷移を確実に処理
- **エラーハンドリング**: タイムアウト・ネットワークエラーに対応

### セッション管理仕様

- **セッション期限**: 24時間自動無効化
- **状態確認**: ログイン状態の自動検証
- **自動更新**: 有効なセッションの延長
- **ファイル保存**: JSON形式でセッション永続化

## ライセンス

MIT License

## 開発履歴

- **v2.0.0**: 環境変数ベースの直接ログインに変更
  - OAuth2.0からブラウザ操作ログインに変更
  - セッション管理機能を追加
  - Playwright操作の詳細ログ追加
  - エラーハンドリングを強化

- **v1.0.0**: TDD方式での初期実装完了
  - OAuth2.0認証（廃止）
  - TaskChute Cloudデータ取得
  - Playwright自動化
  - 設定管理機能
  - 包括的テストスイート