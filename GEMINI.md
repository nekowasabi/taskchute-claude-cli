# GEMINI.md: taskchute-claude-cli プロジェクト解析

## 1. プロジェクト概要

このプロジェクトは、Denoで開発されたTaskChute Cloudと連携するためのコマンドラインインターフェース（CLI）ツールです。Playwrightを利用してブラウザを自動操作し、TaskChute Cloudへのログイン、タスクデータの取得、統計情報の表示などを行います。

主な目的は、手動でのブラウザ操作を自動化し、TaskChute Cloudのデータをプログラムから利用しやすくすることです。

## 2. 主な機能

このCLIツールは、以下のコマンドを提供します。

-   `login`: ブラウザを起動し、ユーザーが手動でTaskChute Cloudにログインします。
-   `check-login`: ログインが成功しているかを確認し、成功していればローカルにセッション情報を作成します。
-   `fetch`: ログイン済みのセッションを使用してタスクデータを取得し、指定されたファイルにHTMLまたはJSON形式で保存します。
-   `stats`: その日のタスクの統計情報（開始/終了時刻、見積/実績時間など）を取得して表示します。
-   `save-html`: 現在表示されているページの完全なHTMLをファイルに保存します。
-   `status`: ローカルに保存されているセッションの有効状態（ログイン済みか、有効期限など）を表示します。

## 3. アーキテクチャと主要モジュール

本プロジェクトはDenoランタイム上で動作し、主要な依存関係としてブラウザ自動化ライブラリのPlaywrightを使用しています。

### 主要なファイル構成

-   `deno.json`: プロジェクトの依存関係（Playwright, Deno Standard Libraryなど）と、`deno task`で実行可能なスクリプト（`login`, `fetch`など）を定義しています。
-   `src/main.ts`: CLIアプリケーションのエントリーポイントです。コマンドライン引数を解釈し、`CLI`クラスの処理を呼び出します。
-   `src/cli.ts`: コマンドのルーティングと実行ロジックを管理する中心的なモジュールです。引数に応じて各機能を呼び分けます。
-   `src/fetcher.ts`: Playwrightのラッパークラスです。ブラウザ（Chromium, Firefox, WebKit）の起動、ページ遷移、DOM要素からのデータ抽出、スクリーンショット撮影といった、ブラウザ操作全般を担当します。
-   `src/auth.ts`: 認証とセッション管理を担当します。ログイン情報を検証し、成功したセッションを`~/.taskchute/session.json`に保存・管理します。セッションには有効期限（24時間）が設定されています。
-   `src/config.ts`: 設定管理モジュールです。環境変数（`TASKCHUTE_EMAIL`など）や設定ファイル（`~/.taskchute/config.json`）から設定を読み込み、アプリケーション全体に提供します。

## 4. セットアップと使用方法

### 前提条件

-   Denoがインストールされていること。
-   TaskChute Cloudのアカウントを持っていること。

### 設定

このツールは、主に環境変数によって設定されます。

-   `TASKCHUTE_EMAIL` (必須): TaskChute Cloudのログイン用メールアドレス。
-   `TASKCHUTE_PASSWORD` (必須): TaskChute Cloudのログイン用パスワード。
-   `TASKCHUTE_HEADLESS`: `false`に設定すると、ブラウザをGUIモードで起動します（デフォルトは`true`）。
-   `TASKCHUTE_BROWSER`: 使用するブラウザを`chromium`, `firefox`, `webkit`から選択します（デフォルトは`chromium`）。
-   `TASKCHUTE_USER_DATA_DIR`: Playwrightが使用するユーザーデータディレクトリのパスを指定します。これにより、ログインセッションを永続化でき��す。

### 基本的なワークフロー

1.  **ログイン**:
    まず、ブラウザを起動して手動でログインします。
    ```sh
    deno task login
    ```
    ログインが完了したら、その状態を確認してローカルにセッションを作成します。
    ```sh
    deno task check-login
    ```

2.  **データ取得**:
    ログイン後、タスクデータを取得してファイルに保存します。
    ```sh
    # JSON形式で保存
    deno task fetch --output ./tasks.json

    # HTML形式で保存
    deno task fetch --output ./tasks.html
    ```

3.  **状態確認**:
    現在のログイン状態やセッションの有効期限を確認します。
    ```sh
    deno task status
    ```

## 5. テスト

`deno.json`にテストコマンドが定義されており、以下のコマンドで実行できます。

```sh
deno task test
```

テストコードは`tests/`ディレクトリ内に配置されています。
