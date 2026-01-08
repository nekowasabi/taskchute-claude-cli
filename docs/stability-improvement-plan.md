# TaskChute CLI 安定化実装計画書

## 1. 概要

### 1.1 現状の課題

| 課題 | 詳細 | 影響度 |
|-----|------|-------|
| ソーシャルログインの不安定性 | Google OAuthはPlaywrightで完全自動化が困難。ポップアップ、2FA、CAPTCHA等が障壁 | 高 |
| Chromeプロファイルコピーの限界 | SingletonLock問題は解消済みだが、セッションが継承されない場合がある | 中 |
| Material-UI DatePickerの不安定性 | 4段階フォールバック実装済みだが、React状態管理との競合が発生 | 中 |
| CSVダウンロードファイル検出 | UUID形式ファイル名で検出困難な場合がある | 低 |

### 1.2 提案するソリューション

1. **ログイン安定化**: Cookie/セッション状態の直接インポート
2. **CSVダウンロード安定化**: APIインターセプト方式への移行

---

## 2. ログイン安定化計画

### 2.1 アプローチ比較

| アプローチ | 実装難易度 | 安定性 | セキュリティ | 推奨度 |
|-----------|----------|-------|------------|-------|
| A. storageState利用（推奨） | 低 | 高 | 中 | ★★★★★ |
| B. Cookie直接インポート | 中 | 高 | 中 | ★★★★☆ |
| C. Chrome Cookieデータベース復号 | 高 | 中 | 低 | ★★☆☆☆ |
| D. 現行プロファイルコピー方式 | 済 | 低 | 高 | ★★★☆☆ |

### 2.2 推奨アプローチ: storageState利用

#### 概要
Playwrightの`storageState`機能を使用し、認証済みセッションを保存・再利用する。

#### 実装手順

**Phase 1: 初回認証（手動ログイン）**
```typescript
// 1. ヘッドフルモードでブラウザ起動
const browser = await chromium.launch({ headless: false });
const context = await browser.newContext();
const page = await context.newPage();

// 2. ログインページに遷移
await page.goto('https://taskchute.cloud/taskchute');

// 3. ユーザーが手動でログイン完了を待機
console.log('ブラウザでログインしてください...');
await page.waitForURL('**/taskchute**', { timeout: 300000 });

// 4. storageStateを保存
await context.storageState({ path: '~/.taskchute/storage-state.json' });
console.log('セッション情報を保存しました');

await browser.close();
```

**Phase 2: セッション再利用**
```typescript
// 保存されたstorageStateを使用してコンテキスト作成
const context = await browser.newContext({
  storageState: '~/.taskchute/storage-state.json'
});
const page = await context.newPage();

// 認証済み状態でページにアクセス
await page.goto('https://taskchute.cloud/export/csv-export');
```

#### 新規ファイル: `src/session-manager.ts`

```typescript
/**
 * セッション状態の保存・復元を管理
 */
export class SessionManager {
  private storagePath: string;

  constructor(storagePath?: string) {
    this.storagePath = storagePath ||
      `${Deno.env.get("HOME")}/.taskchute/storage-state.json`;
  }

  /**
   * storageStateファイルが存在し有効かチェック
   */
  async isSessionValid(): Promise<boolean> {
    try {
      const stat = await Deno.stat(this.storagePath);
      // 24時間以内のセッションのみ有効
      const age = Date.now() - stat.mtime!.getTime();
      return age < 24 * 60 * 60 * 1000;
    } catch {
      return false;
    }
  }

  /**
   * 現在のコンテキストからstorageStateを保存
   */
  async saveSession(context: BrowserContext): Promise<void> {
    await context.storageState({ path: this.storagePath });
  }

  /**
   * storageStateを使用してコンテキストを作成
   */
  async createAuthenticatedContext(browser: Browser): Promise<BrowserContext> {
    return await browser.newContext({
      storageState: this.storagePath
    });
  }

  /**
   * セッションをクリア
   */
  async clearSession(): Promise<void> {
    try {
      await Deno.remove(this.storagePath);
    } catch {
      // ファイルが存在しない場合は無視
    }
  }

  getStoragePath(): string {
    return this.storagePath;
  }
}
```

### 2.3 代替アプローチ: Cookie直接インポート

storageStateが機能しない場合のフォールバック。

```typescript
/**
 * Cookieを手動でエクスポート・インポート
 */
export class CookieManager {
  private cookiePath: string;

  constructor(cookiePath?: string) {
    this.cookiePath = cookiePath ||
      `${Deno.env.get("HOME")}/.taskchute/cookies.json`;
  }

  /**
   * コンテキストからCookieをエクスポート
   */
  async exportCookies(context: BrowserContext): Promise<void> {
    const cookies = await context.cookies();
    const cookieJson = JSON.stringify(cookies, null, 2);
    await Deno.writeTextFile(this.cookiePath, cookieJson);
  }

  /**
   * Cookieをコンテキストにインポート
   */
  async importCookies(context: BrowserContext): Promise<void> {
    const cookieJson = await Deno.readTextFile(this.cookiePath);
    const cookies = JSON.parse(cookieJson);
    await context.addCookies(cookies);
  }

  /**
   * TaskChute関連のCookieのみをフィルタリング
   */
  filterTaskChuteCookies(cookies: any[]): any[] {
    return cookies.filter(c =>
      c.domain.includes('taskchute.cloud') ||
      c.domain.includes('.google.com') ||
      c.domain.includes('accounts.google.com')
    );
  }
}
```

### 2.4 実装タスク

| # | タスク | 工数(h) | 優先度 |
|---|-------|--------|-------|
| 1 | SessionManagerクラス作成 | 2 | 高 |
| 2 | `login`コマンドの改修（storageState保存） | 2 | 高 |
| 3 | TaskChuteDataFetcherの改修（storageState利用） | 3 | 高 |
| 4 | セッション有効期限チェック追加 | 1 | 中 |
| 5 | CookieManagerクラス作成（フォールバック用） | 2 | 低 |
| 6 | テストの追加 | 2 | 中 |

**合計工数**: 約12時間

---

## 3. CSVダウンロード安定化計画

### 3.1 アプローチ比較

| アプローチ | 実装難易度 | 安定性 | 推奨度 |
|-----------|----------|-------|-------|
| A. APIインターセプト方式（推奨） | 中 | 高 | ★★★★★ |
| B. waitForResponse利用 | 低 | 高 | ★★★★☆ |
| C. 現行UI操作方式の改善 | 低 | 中 | ★★★☆☆ |
| D. 直接APIコール | 高 | 最高 | ★★★★☆ |

### 3.2 推奨アプローチ: APIインターセプト + waitForResponse

#### 概要
ダウンロードボタンクリック後のAPIレスポンスを直接インターセプトし、UIの不安定性を回避。

#### 実装コード

```typescript
/**
 * APIインターセプト方式でCSVダウンロード
 */
async getTaskDataFromCSVIntercepted(
  fromDate?: string,
  toDate?: string
): Promise<FetchResult<TaskData[]>> {
  if (!this.page) {
    return { success: false, error: "No active browser page" };
  }

  try {
    // Step 1: CSVエクスポートページに移動
    await this.page.goto('https://taskchute.cloud/export/csv-export', {
      waitUntil: 'networkidle'
    });

    // Step 2: ページの初期化を待機（Reactレンダリング完了）
    await this.waitForReactReady();

    // Step 3: 日付入力（改善版）
    await this.setDateRangeStable(fromDate, toDate);

    // Step 4: APIレスポンスのインターセプト準備
    const downloadPromise = this.page.waitForResponse(
      response =>
        response.url().includes('/api/') &&
        response.url().includes('csv') ||
        response.url().includes('export') ||
        response.headers()['content-type']?.includes('text/csv'),
      { timeout: 30000 }
    );

    // Step 5: ダウンロードボタンクリック（安定版）
    await this.clickDownloadButtonStable();

    // Step 6: レスポンス待機とデータ取得
    try {
      const response = await downloadPromise;
      const csvContent = await response.text();

      // CSVを保存
      const savePath = `tmp/claude/taskchute-export-${Date.now()}.csv`;
      await Deno.writeTextFile(savePath, csvContent);

      // CSVをパース
      const parser = new TaskChuteCsvParser();
      const tasks = parser.parseContent(csvContent);

      return { success: true, tasks, downloadPath: savePath };
    } catch (timeoutError) {
      // フォールバック: ダウンロードイベント監視
      return await this.fallbackDownloadHandler();
    }

  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}

/**
 * Reactレンダリング完了を待機
 */
private async waitForReactReady(): Promise<void> {
  // スケルトンローダーの消失を待機
  try {
    await this.page!.waitForSelector('.MuiSkeleton-root', {
      state: 'hidden',
      timeout: 10000
    });
  } catch {
    // スケルトンがない場合は無視
  }

  // ネットワークアイドル状態を待機
  await this.page!.waitForLoadState('networkidle');

  // 追加の安定化待機
  await this.page!.waitForTimeout(1000);
}

/**
 * 安定した日付範囲設定
 */
private async setDateRangeStable(fromDate?: string, toDate?: string): Promise<void> {
  const today = new Date();
  const defaultDate = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`;

  const startDate = fromDate || defaultDate;
  const endDate = toDate || defaultDate;

  // 日付入力フィールドを取得
  const dateInputs = await this.page!.locator('input').filter({
    has: this.page!.locator('[placeholder*="YYYY"]')
  }).all();

  if (dateInputs.length < 2) {
    // セレクタが見つからない場合、より広範な検索
    const allInputs = await this.page!.locator('input[type="text"], input[type="date"]').all();
    // 日付っぽい入力フィールドを特定
    for (const input of allInputs) {
      const placeholder = await input.getAttribute('placeholder');
      const value = await input.inputValue();
      if (placeholder?.includes('/') || value?.includes('/')) {
        dateInputs.push(input);
      }
    }
  }

  if (dateInputs.length >= 2) {
    // 開始日を設定
    await this.setDateInputStable(dateInputs[0], startDate);
    await this.page!.waitForTimeout(500);

    // 終了日を設定
    await this.setDateInputStable(dateInputs[1], endDate);
    await this.page!.waitForTimeout(500);

    // 日付ピッカーを閉じる
    await this.page!.keyboard.press('Escape');
    await this.page!.click('body', { position: { x: 10, y: 10 } });
    await this.page!.waitForTimeout(500);
  }
}

/**
 * 単一の日付入力フィールドに安定して値を設定
 */
private async setDateInputStable(input: Locator, date: string): Promise<void> {
  // 試行1: Reactの状態更新をトリガーする方法
  await input.click();
  await input.fill('');
  await input.fill(date);

  // 値が設定されたか確認
  const value = await input.inputValue();
  if (value === date || value.replace(/\//g, '') === date) {
    return;
  }

  // 試行2: キーボード入力
  await input.click();
  await this.page!.keyboard.press('Control+a');
  await this.page!.keyboard.type(date, { delay: 50 });

  // 再確認
  const value2 = await input.inputValue();
  if (value2 === date || value2.replace(/\//g, '') === date) {
    return;
  }

  // 試行3: JavaScript直接操作
  await input.evaluate((el: HTMLInputElement, val: string) => {
    el.value = val;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('blur', { bubbles: true }));
  }, date);
}

/**
 * 安定したダウンロードボタンクリック
 */
private async clickDownloadButtonStable(): Promise<void> {
  // ボタンが有効になるまで待機
  const downloadButton = this.page!.locator('button:has-text("ダウンロード")').first();

  // ボタンが有効になるまで最大10秒待機
  await expect(downloadButton).toBeEnabled({ timeout: 10000 });

  // クリック前に少し待機（React状態の安定化）
  await this.page!.waitForTimeout(300);

  // クリック実行
  await downloadButton.click();
}

/**
 * ダウンロードイベントによるフォールバック処理
 */
private async fallbackDownloadHandler(): Promise<FetchResult<TaskData[]>> {
  try {
    const download = await this.page!.waitForEvent('download', { timeout: 15000 });
    const savePath = `tmp/claude/taskchute-export-${Date.now()}.csv`;
    await download.saveAs(savePath);

    const content = await Deno.readTextFile(savePath);
    const parser = new TaskChuteCsvParser();
    const tasks = parser.parseContent(content);

    return { success: true, tasks, downloadPath: savePath };
  } catch (error) {
    return { success: false, error: `ダウンロードに失敗: ${error}` };
  }
}
```

### 3.3 代替アプローチ: 直接APIコール

UIを完全にバイパスしてAPIを直接呼び出す方法。

```typescript
/**
 * 直接API呼び出しでCSVを取得
 * 注意: APIエンドポイントの調査が必要
 */
async getTaskDataFromAPI(fromDate: string, toDate: string): Promise<FetchResult<TaskData[]>> {
  // ブラウザコンテキストからCookieを取得
  const cookies = await this.context!.cookies();

  // APIリクエスト用にCookieを整形
  const cookieHeader = cookies
    .filter(c => c.domain.includes('taskchute.cloud'))
    .map(c => `${c.name}=${c.value}`)
    .join('; ');

  // CSRFトークンを取得（必要な場合）
  const csrfToken = await this.page!.evaluate(() => {
    // 通常はmetaタグやlocalStorageに格納されている
    const meta = document.querySelector('meta[name="csrf-token"]');
    return meta?.getAttribute('content') || '';
  });

  // APIを直接呼び出し
  const response = await fetch('https://taskchute.cloud/api/export/csv', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cookie': cookieHeader,
      'X-CSRF-Token': csrfToken,
    },
    body: JSON.stringify({
      from: fromDate,
      to: toDate,
    }),
  });

  if (!response.ok) {
    return { success: false, error: `API error: ${response.status}` };
  }

  const csvContent = await response.text();
  const savePath = `tmp/claude/taskchute-export-${Date.now()}.csv`;
  await Deno.writeTextFile(savePath, csvContent);

  const parser = new TaskChuteCsvParser();
  const tasks = parser.parseContent(csvContent);

  return { success: true, tasks, downloadPath: savePath };
}
```

### 3.4 実装タスク

| # | タスク | 工数(h) | 優先度 |
|---|-------|--------|-------|
| 1 | waitForReactReady関数の実装 | 1 | 高 |
| 2 | setDateRangeStable関数の実装 | 2 | 高 |
| 3 | APIインターセプト処理の実装 | 3 | 高 |
| 4 | フォールバック処理の改善 | 2 | 中 |
| 5 | 直接APIコール機能の調査・実装 | 4 | 低 |
| 6 | テストの追加 | 2 | 中 |

**合計工数**: 約14時間

---

## 4. 実装ロードマップ

### Phase 1: 基盤整備（週1）
- [ ] SessionManagerクラス作成
- [ ] storageState保存・復元機能
- [ ] 既存ログイン処理との統合

### Phase 2: ログイン安定化（週1-2）
- [ ] `login`コマンドの改修
- [ ] セッション有効期限管理
- [ ] CookieManagerフォールバック実装

### Phase 3: CSVダウンロード安定化（週2-3）
- [ ] React待機処理の改善
- [ ] 日付入力の安定化
- [ ] APIインターセプト実装

### Phase 4: テスト・検証（週3-4）
- [ ] 単体テスト追加
- [ ] 統合テスト実行
- [ ] ドキュメント更新

---

## 5. リスクと対策

| リスク | 対策 |
|-------|------|
| storageStateがTaskChuteで機能しない | Cookie直接インポート方式にフォールバック |
| APIエンドポイントの変更 | UIベースの処理をフォールバックとして維持 |
| Material-UI DatePickerの仕様変更 | 複数のセレクタ戦略を維持 |
| セッションの短い有効期限 | 有効期限チェックと自動更新の実装 |

---

## 6. 参考資料

### Playwright公式ドキュメント
- [Authentication](https://playwright.dev/docs/auth) - セッション管理
- [Network](https://playwright.dev/docs/network) - APIインターセプト
- [Auto-waiting](https://playwright.dev/docs/actionability) - 要素待機

### Cookie管理ツール
- [chrome-cookiejar](https://pypi.org/project/chrome-cookiejar/) - Chrome Cookie抽出
- [chromeDekrpt](https://github.com/Krptyk/chromeDekrpt) - Cookie復号ユーティリティ

### Material-UI関連
- [MUI-X E2E Testing Issue](https://github.com/mui/mui-x/issues/9165) - DatePickerテスト課題

---

**作成日**: 2026-01-08
**バージョン**: 1.0
