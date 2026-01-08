# Chromeプロファイルを使用したログイン機能の改善計画

## 現状分析

### 既存の実装状況

#### 1. プラットフォーム検出機能（src/platform.ts）
- **実装済み機能**:
  - macOS、Windows、WSL、Linuxの検出
  - 各プラットフォームのChrome User Dataディレクトリパスの設定
  - WSLではTASKCHUTE_USER_DATA_DIR環境変数でWindows側のパス指定が可能

- **課題**:
  - WSL環境でWindows側のユーザー名を自動検出できない
  - 環境変数が設定されていない場合のフォールバック処理が不十分

#### 2. Chromeプロファイル管理（src/chrome-profile-manager.ts）
- **実装済み機能**:
  - Chromeプロファイルのコピー機能
  - SingletonLock問題の回避（ファイル削除）
  - 必要最小限のファイルのみコピー（Cookies、Login Data等）

- **コピー対象ファイル**:
  ```
  - Default/Cookies
  - Default/Login Data
  - Default/Web Data
  - Default/Preferences
  - Default/Local Storage
  - Default/Session Storage
  - Default/IndexedDB
  - Local State
  ```

#### 3. 認証フロー（src/auth.ts）
- **実装済み機能**:
  - detectLoginMethod()でChromeプロファイルの自動検出
  - プロファイルが見つかれば環境変数による認証をスキップ
  - セッション管理機能

#### 4. ブラウザ起動処理（src/fetcher.ts）
- **実装済み機能**:
  - launchPersistentContextによるプロファイル永続化
  - macOSでは実際のGoogle Chrome使用（channel: 'chrome'）
  - プラットフォーム別の起動オプション設定

## 問題点と課題

### 1. ソーシャルログインの制限
- **問題**: PlaywrightではGoogleのソーシャルログインが正常に動作しない
- **原因**: Googleが自動化ツールを検出してブロック
- **影響**: 環境変数でメール・パスワードを設定しても、2段階認証等で失敗

### 2. WSL環境での課題
- **問題**: Windows側のChromeプロファイルパスが自動検出できない
- **現状**: TASKCHUTE_USER_DATA_DIR環境変数の手動設定が必要
- **必要なパス例**: `/mnt/c/Users/<username>/AppData/Local/Google/Chrome/User Data`

### 3. プロファイルコピーのタイミング
- **問題**: 毎回プロファイルをコピーすると時間がかかる
- **課題**: キャッシュ管理やインクリメンタルコピーの実装が必要

## 改善計画

### フェーズ1: WSL環境の自動検出強化

#### 1.1 Windows側ユーザー名の自動検出
```typescript
// src/platform.ts に追加
function detectWindowsUsername(): string | undefined {
  // 方法1: /mnt/c/Users/ ディレクトリをスキャン
  // 方法2: whoami.exe コマンドの実行
  // 方法3: $USER環境変数から推測
}
```

#### 1.2 複数の検出方法の実装
- TASKCHUTE_USER_DATA_DIR環境変数（最優先）
- WINDOWS_USERNAME環境変数
- /mnt/c/Users/ディレクトリの自動スキャン
- whoami.exeコマンドの実行

### フェーズ2: プロファイル管理の最適化

#### 2.1 プロファイルキャッシュ機能
```typescript
// ~/.taskchute/chrome-profile-cache/ にキャッシュ
interface ProfileCache {
  sourcePath: string;
  targetPath: string;
  lastCopied: Date;
  checksum: string;
}
```

#### 2.2 差分コピー機能
- ファイルのタイムスタンプ比較
- 変更されたファイルのみコピー
- コピー時間の大幅短縮

### フェーズ3: ログインフローの完全自動化

#### 3.1 優先順位の明確化
1. Chromeプロファイル（自動検出）
2. Chromeプロファイル（環境変数指定）
3. 環境変数による認証（フォールバック）

#### 3.2 エラーハンドリングの改善
- プロファイルが壊れている場合の検出
- 自動的な再コピー機能
- 詳細なエラーメッセージ

### フェーズ4: ユーザーインターフェースの改善

#### 4.1 新しいCLIオプション
```bash
# Chromeプロファイルを使用（デフォルト）
deno task login

# プロファイルを使用しない
deno task login --no-chrome-profile

# カスタムプロファイルパスを指定
deno task login --profile-path "/path/to/profile"

# プロファイルをリフレッシュ
deno task login --refresh-profile
```

#### 4.2 状態表示の改善
```
✅ Chromeプロファイルを検出しました
📁 プロファイルパス: /mnt/c/Users/username/AppData/Local/Google/Chrome/User Data
📋 コピー先: ~/.taskchute/chrome-profile-copy
🔄 プロファイルをコピー中...
✅ ログイン準備完了
```

## 実装優先順位

### 高優先度（即座に実装）
1. WSL環境でのWindows側ユーザー名自動検出
2. プロファイル検出ロジックの改善
3. エラーメッセージの改善

### 中優先度（次のフェーズ）
1. プロファイルキャッシュ機能
2. 差分コピー機能
3. CLIオプションの追加

### 低優先度（将来的に検討）
1. 複数プロファイルの管理
2. プロファイルのバックアップ・リストア機能
3. GUIによるプロファイル選択

## テスト計画

### 単体テスト
- platform.tsの各検出関数
- chrome-profile-manager.tsのコピー機能
- auth.tsのログインメソッド選択

### 統合テスト
- 各プラットフォームでの動作確認
  - macOS（M1/M2）
  - Windows 10/11
  - WSL2（Ubuntu）
  - Linux（Ubuntu/Debian）

### E2Eテスト
- 実際のTaskChute Cloudへのログイン
- CSVダウンロードの実行
- セッション永続化の確認

## リスクと対策

### リスク1: Chromeのアップデートによるプロファイル構造の変更
- **対策**: バージョン検出とフォールバック処理

### リスク2: プロファイルの破損
- **対策**: バックアップと自動リカバリー機能

### リスク3: 複数Chromeインスタンスの競合
- **対策**: ロックファイルの適切な管理

## まとめ

この改善計画により、以下の効果が期待できます：

1. **ユーザビリティの向上**
   - 環境変数の設定が不要
   - 既存のブラウザログインを活用

2. **信頼性の向上**
   - ソーシャルログインの問題を完全回避
   - プラットフォーム別の最適化

3. **パフォーマンスの向上**
   - プロファイルキャッシュによる高速化
   - 差分コピーによる効率化

4. **保守性の向上**
   - コードの整理と責務の明確化
   - テストカバレッジの向上