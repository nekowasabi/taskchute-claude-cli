# fetcher.ts リファクタリング計画

ミッションID: mission-20260314-impl-plan
作成日: 2026-03-14
ステータス: 承認済み・実装待ち

---

## 概要

現在 1352 行に膨張した `src/fetcher.ts` を段階的にリファクタリングし、保守性・可読性・テスト安全性を改善する。CSVダウンロード機能の正しい Playwright パターンへの移行も含む。

---

## Victory Conditions（完了判定基準）

| # | 条件 | 計測方法 |
|---|------|---------|
| 1 | `csv-download` が macOS で正常完了し CSV 出力される | 実機テスト |
| 2 | `fetcher.ts` が 600 行以下（現在 1352 行） | `wc -l src/fetcher.ts` |
| 3 | 既存テスト 11 ファイル全 pass | `deno task test` |
| 4 | デバッグ用 `console.log` の本番コードからの除去 | `grep -c console.log src/fetcher.ts` = 0 |
| 5 | `csv-downloader.ts` の正しい Playwright パターンを実使用 | コードレビュー |
| 6 | platform 分岐が `platform.ts` に集約 | `grep -c isMac src/fetcher.ts` = 0 |

---

## スコープ外（変更禁止）

- WSL 対応の変更
- `authenticated-fetcher.ts` / `session-manager.ts` の削除
- 新機能追加
- `auth.ts` の外部インターフェース変更（シグネチャ維持）

---

## DAG タスク構造

```
T1 (types.ts分離)
  ├── T2 (デバッグコード除去)  ──────────────────┐
  └── T3 (platform分岐集約)  ──────────────────── T4 (CSVDownloader組み込み) ── T5 (レガシー整理)
```

**Critical Path**: T1 → T3 → T4 → T5
T2 と T3 は T1 完了後に並列実行可能。

---

## タスク詳細

### T1: types.ts 分離と re-export 設定

| 項目 | 内容 |
|------|------|
| 依存タスク | なし（最初に実施） |
| リスク | medium |
| 推定変更行 | 80 行 |
| 担当 | executor:heavy |

**Why（なぜ最初か）**

後続の全タスクがインターフェース定義の場所に依存するため、型の集約を先行させる。ここで基盤を整えないと、T2〜T4 で同じインターフェースを複数ファイルが重複参照し続ける。

**実施内容**

1. `src/types.ts` を新規作成し、以下の 6 インターフェースを移動する:
   - `TaskData`
   - `FetcherOptions`
   - `FetchResult`
   - `NavigationResult`
   - `AuthResult`（fetcher.ts 側のもの）
   - `SaveResult`

2. `src/fetcher.ts` に re-export を追加して既存テストの import パスを変更不要にする:
   ```typescript
   export type { TaskData, FetcherOptions, FetchResult } from './types.ts';
   ```

3. `src/auth.ts` の `AuthResult`（`{success, email, error}` 形式）を `AuthSessionResult` に rename して衝突を回避する。

**対象ファイル**

- `src/types.ts`（新規作成）
- `src/fetcher.ts`
- `src/auth.ts`
- `src/config.ts`
- `src/csv-downloader.ts`
- `src/csv-parser.ts`
- `src/authenticated-fetcher.ts`

**完了条件**

- `src/types.ts` に 6 インターフェースが定義されている
- `fetcher.ts` の re-export が動作している
- `auth.ts` の `AuthResult` → `AuthSessionResult` rename 完了
- `deno task test` 全 pass

---

### T2: デバッグコード除去

| 項目 | 内容 |
|------|------|
| 依存タスク | T1 |
| リスク | low |
| 推定変更行 | 55 行 |
| 担当 | executor:heavy |

**Why（なぜ T1 の後か）**

T1 でファイル構造が確定してから行うことで、除去対象のスコープが明確になる。T1 と同時に行うと編集競合が発生しやすい。

**実施内容**

- `src/fetcher.ts` 内の `console.log` 約 50 件を全削除する
- `console.error` は維持する（エラー情報は本番でも必要）
- デバッグ専用変数・未使用変数も同時に除去する

**対象ファイル**

- `src/fetcher.ts`

**完了条件**

- `grep -c 'console\.log' src/fetcher.ts` = 0
- `deno task test` 全 pass
- 行数が 50 行以上削減されている

---

### T3: platform 分岐の platform.ts 集約

| 項目 | 内容 |
|------|------|
| 依存タスク | T1 |
| リスク | medium |
| 推定変更行 | 120 行 |
| 担当 | executor:heavy |

**Why（なぜ T1 の後、T4 の前か）**

`launchBrowser` の platform 分岐は `getTaskDataFromCSV`（T4 の対象）からも間接的に呼ばれる。T4 でブラウザ起動処理を整理する前に platform ロジックを外部化しておかないと、T4 の変更量が増大する。

**実施内容**

1. `src/fetcher.ts` の `launchBrowser` 内にある Mac / WSL / WSLg / Linux 分岐を `src/platform.ts` の新関数 `getBrowserLaunchOptions` に移動する
2. `fetcher.ts` の `launchBrowser` は `platform.getBrowserLaunchOptions()` の戻り値を使うだけにする
3. `fetcher.ts` から `isMac` / `isWSL` / `isWSLg` の直接参照をなくす

**対象ファイル**

- `src/platform.ts`
- `src/fetcher.ts`

**完了条件**

- `grep -c 'isMac\|isWSL\|isWSLg' src/fetcher.ts` = 0
- `deno task test` 全 pass（`fetcher_wsl_test.ts` 含む）

---

### T4: CSVDownloader を getTaskDataFromCSV に組み込み

| 項目 | 内容 |
|------|------|
| 依存タスク | T2, T3 |
| リスク | high |
| 推定変更行 | 450 行 |
| 担当 | executor:heavy |

**Why（なぜ T2・T3 の後か）**

`getTaskDataFromCSV`（約 450 行）は fetcher.ts 最大の関数であり、デバッグコード（T2）と platform 分岐（T3）を先に取り除いた後に着手しないと、除去対象と移植対象が混在して判断が困難になる。

**Why（CSVDownloader を使うか）**

`csv-downloader.ts` には `waitForEvent('download')` をクリック前に登録する正しい Playwright パターンが実装されている。現在の `getTaskDataFromCSV` は独自実装でダウンロード検出に不安定さがある。

**実施内容**

1. `src/fetcher.ts` の `getTaskDataFromCSV` を `CSVDownloader.downloadCSV()` に委譲する形に書き換える
2. 独自の日付入力処理（MUI DatePicker 対応の 4 手法）を削除する
3. 独自のダウンロード検出処理を削除する
4. 独自のパース呼び出しを削除し、`csv-downloader.ts` の処理に任せる
5. `waitForEvent('download')` をクリック前に登録するパターンを `csv-downloader.ts` で確実に使用する

**正しい Playwright パターン（必須）**

```typescript
// クリック前にdownloadイベントを登録する
const downloadPromise = page.waitForEvent('download');
await button.click();
const download = await downloadPromise;
```

**対象ファイル**

- `src/fetcher.ts`
- `src/csv-downloader.ts`

**完了条件**

- `getTaskDataFromCSV` が `CSVDownloader.downloadCSV()` を呼び出している
- MUI DatePicker 操作の独自コードが除去されている
- `fetcher.ts` が 800 行以下
- `deno task test` 全 pass
- `TASKCHUTE_HEADLESS=false deno task csv-download` で実機動作確認 pass

---

### T5: レガシーメソッド整理と行数最終確認

| 項目 | 内容 |
|------|------|
| 依存タスク | T4 |
| リスク | low |
| 推定変更行 | 200 行 |
| 担当 | executor:light |

**Why（なぜ最後か）**

T4 で大規模な処理委譲が完了してから、実際に不要になったメソッドを特定できる。T4 より前に削除すると、移行途中のコードが依存して壊れる恐れがある。

**実施内容**

1. `cli.ts` からの呼び出し状況を確認して、未使用メソッドを特定する:
   - `getTaskData`
   - `getPageHTML`
   - `getElements`
   - その他 T4 完了後に不要になったメソッド

2. 未使用メソッドを削除する（`cli.ts` から参照されているものは private 化または維持）

3. `fetcher.ts` の最終行数を確認する

**対象ファイル**

- `src/fetcher.ts`
- `src/cli.ts`

**完了条件**

- `wc -l src/fetcher.ts` が 600 以下
- `cli.ts` が正常コンパイル
- `deno task test` 全 11 ファイル pass

---

## 技術的注意事項

### re-export パターン

既存テストの import パスを変更せずに済むよう、`fetcher.ts` に re-export を残す。

```typescript
// src/fetcher.ts
export type { TaskData, FetchResult, FetcherOptions } from './types.ts';
```

これにより `tests/*.ts` の `import { TaskData } from '../src/fetcher.ts'` は変更不要。

### AuthResult 二重定義の解消

| ファイル | 現在の型名 | 変更後 | 内容 |
|----------|-----------|--------|------|
| `auth.ts` | `AuthResult` | `AuthSessionResult` | `{success, email, error}` |
| `fetcher.ts` / `types.ts` | `AuthResult` | `AuthResult`（維持） | `{success, token, finalUrl, error}` |

### dynamic import を使うテストファイルへの注意

以下のテストは dynamic import を使用している。T1 でファイルパスが変わる場合は文字列を更新すること。

- `tests/csv_download_improved_test.ts`
- `tests/session_manager_test.ts`
- `tests/login_with_storage_state_test.ts`

### 並列実行時の注意

T2 と T3 は並列実行可能だが、どちらも `src/fetcher.ts` を編集する。並列実行する場合は編集対象の行範囲が重複しないよう事前に確認すること。重複が懸念される場合は逐次実行（T1 → T2 → T3 → T4 → T5）に切り替える。

---

## 検証手順

### 各タスク完了時

```bash
deno task test
```

全テストファイル pass を確認する。

### T4 完了時（実機確認）

```bash
TASKCHUTE_HEADLESS=false deno task csv-download
```

CSV ファイルが出力されることを確認する。

### 最終確認（T5 完了後）

```bash
# テスト全 pass
deno task test

# 行数確認
wc -l src/fetcher.ts

# console.log 残存確認
grep -c 'console\.log' src/fetcher.ts

# platform 分岐残存確認
grep -c 'isMac\|isWSL\|isWSLg' src/fetcher.ts

# 実機動作確認
TASKCHUTE_HEADLESS=false deno task csv-download
```

---

## 推定工数サマリー

| タスク | 推定変更行 | リスク | 実行順 |
|--------|-----------|--------|--------|
| T1 | 80 行 | medium | 1 |
| T2 | 55 行 | low | 2（T3 と並列可） |
| T3 | 120 行 | medium | 2（T2 と並列可） |
| T4 | 450 行 | high | 3 |
| T5 | 200 行 | low | 4 |
| **合計** | **905 行** | - | - |

---

## 変更対象ファイル一覧

| ファイル | 関連タスク | 変更種別 |
|---------|-----------|---------|
| `src/types.ts` | T1 | 新規作成 |
| `src/fetcher.ts` | T1〜T5 | 大規模削減 |
| `src/auth.ts` | T1 | AuthResult → AuthSessionResult rename |
| `src/config.ts` | T1 | import パス更新 |
| `src/csv-downloader.ts` | T1, T4 | import パス更新・Playwright パターン確認 |
| `src/csv-parser.ts` | T1 | import パス更新 |
| `src/authenticated-fetcher.ts` | T1 | import パス更新 |
| `src/platform.ts` | T3 | getBrowserLaunchOptions 追加 |
| `src/cli.ts` | T5 | 呼び出し確認・不要参照削除 |
