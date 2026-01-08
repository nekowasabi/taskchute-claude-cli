import { chromium, firefox, webkit, Browser, Page, BrowserContext } from "playwright";
import { ensureDir } from "std/fs/mod.ts";
import { join } from "std/path/mod.ts";
import { LoginCredentials } from "./auth.ts";
import { detectPlatform, getBrowserLaunchOptions } from "./platform.ts";
import { TaskChuteCsvParser } from "./csv-parser.ts";

/**
 * Fetcherのオプション
 */
export interface FetcherOptions {
  headless?: boolean;
  browser?: "chromium" | "firefox" | "webkit";
  timeout?: number;
  viewport?: { width: number; height: number };
  userDataDir?: string;
}

/**
 * タスクデータ
 */
export interface TaskData {
  id: string;
  title: string;
  status: string;
  description?: string;
  startTime?: string;
  endTime?: string;
  duration?: number;
  category?: string;
  estimatedTime?: string;
  actualTime?: string;
}

/**
 * フェッチ結果
 */
export interface FetchResult<T = any> {
  success: boolean;
  data?: T;
  html?: string;
  tasks?: TaskData[];
  error?: string;
  downloadPath?: string;
}

/**
 * ナビゲーション結果
 */
export interface NavigationResult {
  success: boolean;
  currentUrl?: string;
  error?: string;
}

/**
 * 認証結果
 */
export interface AuthResult {
  success: boolean;
  token?: string;
  finalUrl?: string;
  error?: string;
}

/**
 * 保存結果
 */
export interface SaveResult {
  success: boolean;
  filePath?: string;
  error?: string;
}

/**
 * TaskChuteのデータを取得するためのクラス
 */
export class TaskChuteDataFetcher {
  private options: Required<FetcherOptions>;
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;

  /**
   * @param options Fetcherのオプション
   */
  constructor(options: FetcherOptions = {}) {
    const defaultUserDataDir = join(Deno.env.get("HOME") || ".", ".taskchute", "playwright");
    this.options = {
      headless: options.headless ?? true,
      browser: options.browser ?? "chromium",
      timeout: options.timeout ?? 30000,
      viewport: options.viewport ?? { width: 1920, height: 1080 },
      userDataDir: options.userDataDir ?? defaultUserDataDir
    };
    
    console.log(`[Fetcher] ユーザーデータディレクトリ: ${this.options.userDataDir}`);
  }

  /**
   * Fetcherのオプションを更新する
   * @param newOptions 新しいオプション
   */
  updateOptions(newOptions: Partial<FetcherOptions>): void {
    this.options = { ...this.options, ...newOptions };
  }

  /**
   * 現在のオプションを取得する
   * @returns 現在のオプション
   */
  getOptions(): Required<FetcherOptions> {
    return { ...this.options };
  }

  /**
   * ブラウザを起動する
   * @param mockOptions モックオプション
   * @returns 起動結果
   */
  async launchBrowser(mockOptions: { mock?: boolean } = {}): Promise<{ success: boolean; error?: string }> {
    if (mockOptions.mock) {
      return { success: true };
    }

    try {
      let browserLauncher;
      
      switch (this.options.browser) {
        case "chromium":
          browserLauncher = chromium;
          break;
        case "firefox":
          browserLauncher = firefox;
          break;
        case "webkit":
          browserLauncher = webkit;
          break;
        default:
          throw new Error(`Unsupported browser: ${this.options.browser}`);
      }

      if (this.options.userDataDir) {
        console.log(`[Fetcher] launchPersistentContextを使用: ${this.options.userDataDir}`);
        
        // プラットフォーム情報を取得
        const platformInfo = detectPlatform();
        const launchOptions = getBrowserLaunchOptions(platformInfo);
        
        // ディレクトリが存在しない場合は作成
        await ensureDir(this.options.userDataDir);
        
        // M2 Macの場合は実際のChromeを使用
        if (platformInfo.isMac) {
          console.log("[Fetcher] Mac環境: 実際のGoogle Chromeを使用します");
          browserLauncher = chromium;
          
          this.context = await browserLauncher.launchPersistentContext(this.options.userDataDir, {
            headless: this.options.headless,
            timeout: this.options.timeout,
            viewport: this.options.viewport,
            channel: 'chrome', // 実際のChromeを使用
            args: ['--no-sandbox', '--disable-setuid-sandbox'],
            acceptDownloads: true,
            downloadsPath: `${Deno.env.get("HOME")}/Downloads`
          });
        } else if (platformInfo.isWindows && this.options.userDataDir.includes("Google/Chrome")) {
          // WindowsでChromeプロファイルを使用する場合
          console.log("[Fetcher] Windows環境: Chromeプロファイルを使用します");
          browserLauncher = chromium;
          
          this.context = await browserLauncher.launchPersistentContext(this.options.userDataDir, {
            headless: this.options.headless,
            timeout: this.options.timeout,
            viewport: this.options.viewport,
            channel: launchOptions.channel,
            args: ['--no-first-run', '--no-default-browser-check']
          });
        } else if (platformInfo.isWSL) {
          // WSL環境: Windows側のChromeを使用
          console.log("[Fetcher] WSL環境: Windows側のChromeを使用します");

          this.context = await browserLauncher.launchPersistentContext(this.options.userDataDir, {
            headless: this.options.headless,
            timeout: this.options.timeout,
            viewport: this.options.viewport,
            executablePath: launchOptions.executablePath,
            args: ['--no-sandbox', '--disable-setuid-sandbox'],
            acceptDownloads: true,
            downloadsPath: `${Deno.env.get("HOME")}/Downloads`
          });
        } else {
          // その他の環境（Linux等）
          this.context = await browserLauncher.launchPersistentContext(this.options.userDataDir, {
            headless: this.options.headless,
            timeout: this.options.timeout,
            viewport: this.options.viewport,
          });
        }
        
        this.browser = this.context.browser();
        this.page = this.context.pages()[0] || await this.context.newPage();
        
        console.log(`[Fetcher] 永続化コンテキスト作成完了。既存ページ数: ${this.context.pages().length}`);
      } else {
        this.browser = await browserLauncher.launch({
          headless: this.options.headless,
          timeout: this.options.timeout,
        });
        this.context = await this.browser.newContext({
          viewport: this.options.viewport,
        });
        this.page = await this.context.newPage();
      }
      
      this.page.setDefaultTimeout(this.options.timeout);

      return { success: true };

    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  }

  /**
   * TaskChute Cloudのページに遷移する
   * @param fromDate 開始日付 (YYYY-MM-DD形式)
   * @param toDate 終了日付 (YYYY-MM-DD形式)
   * @param mockOptions モックオプション
   * @returns ナビゲーション結果
   */
  async navigateToTaskChute(fromDate?: string, toDate?: string, mockOptions: { mock?: boolean; forceTimeout?: boolean; forceNetworkError?: boolean } = {}): Promise<NavigationResult> {
    if (mockOptions.mock) {
      if (mockOptions.forceTimeout) {
        throw new Error("Navigation timeout");
      }
      if (mockOptions.forceNetworkError) {
        throw new Error("Network error");
      }
      return { success: true, currentUrl: "https://taskchute.cloud" };
    }

    if (!this.page) {
      const browserResult = await this.launchBrowser();
      if (!browserResult.success) {
        return { success: false, error: browserResult.error };
      }
    }

    try {
      // 日付パラメータがある場合はURLに追加
      let url = "https://taskchute.cloud/taskchute";
      if (fromDate && toDate) {
        url += `?from=${fromDate}&to=${toDate}`;
        console.log(`[Fetcher] 日付範囲指定のURLへ遷移: ${url}`);
      }

      // React SPAではnetworkidleは到達しないため、domcontentloadedを使用
      await this.page!.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: this.options.timeout
      });

      // Reactコンポーネントのレンダリング完了を待機
      await this.waitForReactReady();

      const currentUrl = this.page!.url();
      return { success: true, currentUrl };

    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  }

  /**
   * Reactコンポーネントのレンダリング完了を待機する
   * React SPAではnetworkidleが到達しないため、個別に待機する
   */
  private async waitForReactReady(): Promise<void> {
    if (!this.page) return;

    // スケルトンローダーの消失を待機
    try {
      await this.page.waitForSelector('.MuiSkeleton-root', {
        state: 'hidden',
        timeout: 10000
      });
    } catch {
      // スケルトンがない場合は無視
    }

    // DOMの安定化を待機
    await this.page.waitForLoadState('load');

    // 追加の安定化待機（Reactの非同期レンダリング完了のため）
    await this.page.waitForTimeout(1000);
  }

  /**
   * ログイン成功を待機する
   * @param timeout タイムアウト時間 (ミリ秒)
   * @returns ログイン成功した場合はtrue
   */
  async waitForLoginSuccess(timeout: number): Promise<boolean> {
    if (!this.page) {
      return false;
    }
    try {
      await this.page.waitForSelector('header', { timeout });
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * ユーザーがログインしているか確認する
   * @returns ログインしている場合はtrue
   */
  async isUserLoggedIn(): Promise<boolean> {
    if (!this.page) {
      console.log(`[Fetcher] ログイン確認: pageがnull`);
      return false;
    }
    try {
      const currentUrl = this.page.url();
      console.log(`[Fetcher] ログイン確認: 現在のURL = ${currentUrl}`);
      
      await this.page.waitForSelector('header', { timeout: 5000 });
      console.log(`[Fetcher] ログイン確認: headerセレクタが見つかりました`);
      return true;
    } catch (error) {
      console.log(`[Fetcher] ログイン確認: headerセレクタが見つかりません: ${error}`);
      return false;
    }
  }

  /**
   * ログイン状態を確認する
   * @returns ログイン状態とエラー情報
   */
  async checkLoginStatus(): Promise<{ isLoggedIn: boolean; error?: string }> {
    if (!this.page) {
      const browserResult = await this.launchBrowser();
      if (!browserResult.success) {
        return { isLoggedIn: false, error: browserResult.error };
      }
    }

    try {
      // React SPAではnetworkidleは到達しないため、domcontentloadedを使用
      await this.page!.goto("https://taskchute.cloud/taskchute", {
        waitUntil: "domcontentloaded",
        timeout: this.options.timeout,
      });

      // Reactコンポーネントのレンダリング完了を待機
      await this.waitForReactReady();

      // ログイン後のダッシュボードに表示される要素を確認
      const loggedInElement = await this.page!.waitForSelector(
        "header",
        { timeout: 10000 },
      );

      return { isLoggedIn: !!loggedInElement };
    } catch (error) {
      return { isLoggedIn: false, error: (error as Error).message };
    }
  }

  /**
   * 認証後のリダイレクトを待機する
   * @param mockOptions モックオプション
   * @returns 認証結果
   */
  async waitForAuthRedirect(mockOptions: { mock?: boolean } = {}): Promise<AuthResult> {
    if (mockOptions.mock) {
      return { success: true, finalUrl: "https://taskchute.cloud/taskchute" };
    }

    if (!this.page) {
      return { success: false, error: "No active browser page" };
    }

    try {
      await this.page.waitForURL(/taskchute\.cloud\/dashboard/, { timeout: this.options.timeout });
      const finalUrl = this.page.url();
      return { success: true, finalUrl };

    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  }

  /**
   * ページのHTMLを取得する
   * @param mockOptions モックオプション
   * @returns フェッチ結果
   */
  async getPageHTML(mockOptions: { mock?: boolean } = {}): Promise<FetchResult<string>> {
    if (mockOptions.mock) {
      return {
        success: true,
        html: '<html><head><title>TaskChute Cloud</title></head><body><div class="task-item">Mock Task</div></body></html>'
      };
    }

    if (!this.page) {
      return { success: false, error: "No active browser page" };
    }

    try {
      const html = await this.page.content();
      return { success: true, html };

    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  }

  /**
   * 指定されたセレクタに一致する要素を取得する
   * @param selector CSSセレクタ
   * @param mockOptions モックオプション
   * @returns 要素のデータ配列
   */
  async getElements(selector: string, mockOptions: { mock?: boolean } = {}): Promise<any[]> {
    if (mockOptions.mock) {
      return [
        { text: "Mock Task 1", id: "task-1" },
        { text: "Mock Task 2", id: "task-2" }
      ];
    }

    if (!this.page) {
      return [];
    }

    try {
      const elements = await this.page.$$(selector);
      const elementsData = await Promise.all(
        elements.map(async (element) => {
          const text = await element.textContent();
          const id = await element.getAttribute("id");
          return { text, id };
        })
      );

      return elementsData;

    } catch (error) {
      console.error(`Error getting elements: ${(error as Error).message}`);
      return [];
    }
  }

  /**
   * CSVエクスポート機能を使用してタスクデータを取得する
   * @param fromDate 開始日付 (YYYYMMDD形式、省略時は今日)
   * @param toDate 終了日付 (YYYYMMDD形式、省略時は今日)
   * @param downloadPath ダウンロードファイルを保存するディレクトリパス（省略時は tmp/claude）
   * @returns フェッチ結果
   */
  async getTaskDataFromCSV(fromDate?: string, toDate?: string, downloadPath?: string): Promise<FetchResult<TaskData[]>> {
    if (!this.page) {
      const browserResult = await this.launchBrowser();
      if (!browserResult.success) {
        return { success: false, error: browserResult.error };
      }
    }

    try {
      // Step 1: TaskChuteページにアクセスしてログイン確認
      console.log("Step 1: TaskChuteページでログイン確認...");
      // React SPAではnetworkidleは到達しないため、domcontentloadedを使用
      await this.page!.goto("https://taskchute.cloud/taskchute", {
        waitUntil: "domcontentloaded",
        timeout: this.options.timeout
      });

      // Reactコンポーネントのレンダリング完了を待機
      await this.waitForReactReady();
      console.log("TaskChuteページのURL:", this.page!.url());
      
      // ログイン状況を確認
      const isLoggedIn = await this.isUserLoggedIn();
      console.log("ログイン状況:", isLoggedIn);
      
      if (!isLoggedIn) {
        return { success: false, error: "ログインが必要です。先に 'taskchute-cli login' を実行してください。" };
      }

      // Step 2: CSVエクスポートページに移動
      console.log("Step 2: CSVエクスポートページに移動中...");
      // React SPAではnetworkidleは到達しないため、domcontentloadedを使用
      await this.page!.goto("https://taskchute.cloud/export/csv-export", {
        waitUntil: "domcontentloaded",
        timeout: this.options.timeout
      });

      // Reactコンポーネントのレンダリング完了を待機
      await this.waitForReactReady();

      const currentUrl = this.page!.url();
      console.log("CSVエクスポートページのURL:", currentUrl);

      // リダイレクトされた場合の確認
      if (currentUrl.includes('/login') || currentUrl.includes('/auth')) {
        return { success: false, error: "ログインページにリダイレクトされました。認証が必要です。" };
      }

      // Step 3: ページ構造の分析とデバッグ情報の保存
      console.log("Step 3: ページ構造を分析中...");
      
      // スクリーンショットを撮影
      await this.page!.screenshot({ path: 'tmp/claude/csv-export-page.png', fullPage: true });
      console.log("✓ スクリーンショットを保存しました");

      // HTMLを保存
      const csvPageHtml = await this.page!.content();
      await this.saveHTMLToFile(csvPageHtml, 'tmp/claude/csv-export-page.html');
      console.log("✓ HTMLファイルを保存しました");

      // ページタイトルを確認
      const title = await this.page!.title();
      console.log(`ページタイトル: "${title}"`);

      // Step 4: エクスポート関連要素の検索
      console.log("Step 4: エクスポート要素を検索中...");
      
      // より幅広い要素を検索
      const allInteractiveElements = await this.page!.locator(
        'button, input[type="submit"], input[type="button"], a, form, [role="button"], [data-testid], [onclick]'
      ).all();
      
      console.log(`見つかった対話的要素数: ${allInteractiveElements.length}`);

      const exportRelatedElements = [];
      
      for (let i = 0; i < allInteractiveElements.length; i++) {
        const element = allInteractiveElements[i];
        const text = (await element.textContent() || '').trim();
        const tagName = await element.evaluate(el => el.tagName);
        const href = await element.getAttribute('href');
        const type = await element.getAttribute('type');
        const dataTestId = await element.getAttribute('data-testid');
        const onClick = await element.getAttribute('onclick');
        const className = await element.getAttribute('class');
        
        // CSVやエクスポートに関連する要素を特定
        const isExportRelated = text.toLowerCase().includes('csv') ||
                               text.toLowerCase().includes('export') ||
                               text.toLowerCase().includes('ダウンロード') ||
                               text.toLowerCase().includes('出力') ||
                               href?.includes('csv') ||
                               href?.includes('export') ||
                               dataTestId?.includes('export') ||
                               dataTestId?.includes('csv');
        
        if (isExportRelated || i < 10) { // 最初の10個は全て表示
          console.log(`要素${i}: ${tagName}`);
          console.log(`  テキスト: "${text}"`);
          console.log(`  href: "${href}"`);
          console.log(`  type: "${type}"`);
          console.log(`  data-testid: "${dataTestId}"`);
          console.log(`  class: "${className}"`);
          console.log(`  onclick: "${onClick}"`);
          console.log('---');
          
          if (isExportRelated) {
            exportRelatedElements.push({ element, text, href, type, dataTestId });
          }
        }
      }

      console.log(`エクスポート関連要素数: ${exportRelatedElements.length}`);

      // Step 5: 日付範囲フォームの確認と入力
      console.log("Step 5: MUI DateRangePickerを使用して日付を入力...");

      // MUI DateRangePickerはspinbutton role要素を使用（input要素ではない）
      // data-range-position="start" / "end" で開始・終了を区別
      // aria-label で「年」「月」「日」を識別

      // 日付が指定されていない場合は今日の日付を使用
      const today = new Date();
      const defaultDate = today.getFullYear().toString() +
                        (today.getMonth() + 1).toString().padStart(2, '0') +
                        today.getDate().toString().padStart(2, '0');

      const startDate = fromDate || defaultDate;
      const endDate = toDate || defaultDate;

      // YYYYMMDD形式を年/月/日に分解
      const startYear = startDate.substring(0, 4);
      const startMonth = startDate.substring(4, 6);
      const startDay = startDate.substring(6, 8);
      const endYear = endDate.substring(0, 4);
      const endMonth = endDate.substring(4, 6);
      const endDay = endDate.substring(6, 8);

      console.log(`設定する日付 - 開始: ${startYear}/${startMonth}/${startDay}, 終了: ${endYear}/${endMonth}/${endDay}`);

      try {
        // 開始日の年/月/日をそれぞれ入力
        console.log("開始日を入力中...");

        // 開始日の年フィールドを取得して入力
        const startYearField = this.page!.locator('[role="spinbutton"][data-range-position="start"][aria-label="年"]');
        await startYearField.click();
        await this.page!.waitForTimeout(100);
        await this.page!.keyboard.type(startYear);
        await this.page!.waitForTimeout(100);

        // 開始日の月フィールドを取得して入力
        const startMonthField = this.page!.locator('[role="spinbutton"][data-range-position="start"][aria-label="月"]');
        await startMonthField.click();
        await this.page!.waitForTimeout(100);
        await this.page!.keyboard.type(startMonth);
        await this.page!.waitForTimeout(100);

        // 開始日の日フィールドを取得して入力
        const startDayField = this.page!.locator('[role="spinbutton"][data-range-position="start"][aria-label="日"]');
        await startDayField.click();
        await this.page!.waitForTimeout(100);
        await this.page!.keyboard.type(startDay);
        await this.page!.waitForTimeout(500);

        console.log("終了日を入力中...");

        // 終了日の年フィールドを取得して入力
        const endYearField = this.page!.locator('[role="spinbutton"][data-range-position="end"][aria-label="年"]');
        await endYearField.click();
        await this.page!.waitForTimeout(100);
        await this.page!.keyboard.type(endYear);
        await this.page!.waitForTimeout(100);

        // 終了日の月フィールドを取得して入力
        const endMonthField = this.page!.locator('[role="spinbutton"][data-range-position="end"][aria-label="月"]');
        await endMonthField.click();
        await this.page!.waitForTimeout(100);
        await this.page!.keyboard.type(endMonth);
        await this.page!.waitForTimeout(100);

        // 終了日の日フィールドを取得して入力
        const endDayField = this.page!.locator('[role="spinbutton"][data-range-position="end"][aria-label="日"]');
        await endDayField.click();
        await this.page!.waitForTimeout(100);
        await this.page!.keyboard.type(endDay);
        await this.page!.waitForTimeout(500);

        // 入力値を確認
        const startYearValue = await startYearField.textContent();
        const startMonthValue = await startMonthField.textContent();
        const startDayValue = await startDayField.textContent();
        const endYearValue = await endYearField.textContent();
        const endMonthValue = await endMonthField.textContent();
        const endDayValue = await endDayField.textContent();

        console.log(`入力確認 - 開始: ${startYearValue}/${startMonthValue}/${startDayValue}, 終了: ${endYearValue}/${endMonthValue}/${endDayValue}`);

        console.log("日付入力処理完了");

        // 日付ピッカーのポップアップを閉じるため、ページの他の場所をクリック
        console.log("日付ピッカーを閉じるため、ページをクリック...");
        await this.page!.click('body', { position: { x: 10, y: 10 } });
        await this.page!.waitForTimeout(1000);

        // ダウンロードボタンが有効になるまで待機
        console.log("ダウンロードボタンが有効になるまで待機中...");
        try {
          await this.page!.waitForSelector('button:has-text("ダウンロード"):not(.Mui-disabled)', { timeout: 10000 });
          console.log("ダウンロードボタンが有効になりました");
        } catch (error) {
          console.log("ダウンロードボタンの有効化待機がタイムアウトしました");
          // デバッグ情報を追加
          const buttonState = await this.page!.locator('button:has-text("ダウンロード")').first().evaluate((el) => {
            return {
              disabled: (el as HTMLButtonElement).disabled,
              classList: Array.from(el.classList),
              ariaDisabled: el.getAttribute('aria-disabled')
            };
          });
          console.log("ダウンロードボタンの状態:", buttonState);

          // スクリーンショットを保存
          const debugPath = `tmp/claude/button-disabled-${Date.now()}.png`;
          await this.page!.screenshot({ path: debugPath, fullPage: true });
          console.log(`デバッグスクリーンショット: ${debugPath}`);
        }

      } catch (error) {
        console.error("日付入力エラー:", error);
        // エラー時のデバッグ情報を保存
        const debugPath = `tmp/claude/date-input-error-${Date.now()}.png`;
        await this.page!.screenshot({ path: debugPath, fullPage: true });
        console.log(`エラー時のスクリーンショット: ${debugPath}`);
      }

      // Step 6: ダウンロードボタンをクリック
      console.log("Step 6: ダウンロードボタンをクリック中...");
      
      // 複数のセレクタでダウンロードボタンを検索
      const downloadButtonSelectors = [
        // FileDownloadIconを含むボタン
        'button:has([data-testid="FileDownloadIcon"])',
        // ダウンロードテキストを含むMUIボタン
        'button.MuiButton-root:has-text("ダウンロード")',
        // 一般的なダウンロードボタン
        'button:has-text("ダウンロード")',
        'button:has-text("Download")',
        // SVGアイコンを含むボタン
        'button:has(svg[data-testid="FileDownloadIcon"])'
      ];
      
      let downloadButton = null;
      for (const selector of downloadButtonSelectors) {
        try {
          const button = this.page!.locator(selector).first();
          if (await button.isVisible({ timeout: 1000 })) {
            downloadButton = button;
            console.log(`ダウンロードボタンを発見: ${selector}`);
            break;
          }
        } catch {
          // 次のセレクタを試す
        }
      }
      
      if (downloadButton) {
        // ボタンの状態を確認
        const buttonInfo = await downloadButton.evaluate((el) => {
          const button = el as HTMLButtonElement;
          return {
            disabled: button.disabled,
            ariaDisabled: button.getAttribute('aria-disabled'),
            classList: Array.from(button.classList).join(' '),
            text: button.textContent?.trim()
          };
        });
        console.log("ダウンロードボタンの情報:", buttonInfo);
        
        try {
          console.log("ダウンロードボタンをクリック中...");
          
          // 日付ピッカーのツールチップが表示されていないか確認
          const tooltips = await this.page!.locator('[role="tooltip"]').all();
          if (tooltips.length > 0) {
            console.log("ツールチップが表示されています。閉じるため、ページをクリック...");
            await this.page!.click('body', { position: { x: 10, y: 10 } });
            await this.page!.waitForTimeout(1000);
          }
          
          // ダウンロードディレクトリの確認用に現在時刻を記録
          const downloadStartTime = Date.now();
          
          // ボタンをクリック（必要に応じて強制的に）
          if (buttonInfo.disabled) {
            console.log("ボタンが無効状態ですが、強制的にクリックを試みます");
            await downloadButton.click({ force: true });
          } else {
            // 通常のクリックが失敗する場合、JavaScript経由でクリック
            try {
              await downloadButton.click();
            } catch (clickError) {
              console.log("通常のクリックが失敗。JavaScript経由でクリックを試みます...");
              await downloadButton.evaluate((el) => (el as HTMLButtonElement).click());
            }
          }
          console.log("ダウンロードボタンをクリックしました");
          
          // クリック後のページ状態を確認
          await this.page!.waitForTimeout(2000);
          
          // エラーメッセージやスナックバーを確認
          const snackbar = await this.page!.locator('.MuiSnackbar-root, [role="alert"]').first();
          if (await snackbar.isVisible({ timeout: 1000 })) {
            const snackbarText = await snackbar.textContent();
            console.log("スナックバーメッセージ:", snackbarText);
          }
          
          // クリック後の処理を待つ
          await this.page!.waitForTimeout(3000);
          
          // ダウンロードディレクトリを確認
          console.log("ダウンロードディレクトリを確認中...");
          const downloadDir = `${Deno.env.get("HOME")}/Downloads`;
          let foundFile = null;
          
          try {
            const files = await Deno.readDir(downloadDir);
            
            // 最近のファイルを探す（CSVファイルは拡張子がない場合がある）
            const recentFiles = [];
            for await (const file of files) {
              // CSVファイルまたはUUID形式のファイル名をチェック
              if (file.name.endsWith(".csv") || 
                  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(file.name)) {
                const filePath = `${downloadDir}/${file.name}`;
                const stat = await Deno.stat(filePath);
                recentFiles.push({ name: file.name, path: filePath, mtime: stat.mtime!.getTime() });
              }
            }
            
            // 最新のファイルを確認
            recentFiles.sort((a, b) => b.mtime - a.mtime);
            
            if (recentFiles.length > 0) {
              console.log(`最近のダウンロード候補:`);
              for (let i = 0; i < Math.min(3, recentFiles.length); i++) {
                const file = recentFiles[i];
                console.log(`  ${i+1}. ${file.name} (${new Date(file.mtime).toLocaleString()})`);
                
                // クリック後に作成されたファイルかチェック
                if (file.mtime >= downloadStartTime - 5000) { // 5秒のマージン
                  // ファイルタイプを確認
                  const fileContent = await Deno.readTextFile(file.path);
                  if (fileContent.includes('","') || fileContent.includes(',')) {
                    console.log(`  → CSVファイルとして検出`);
                    foundFile = file.path;
                    break;
                  }
                }
              }
            }
            
            if (foundFile) {
              // ファイルを指定ディレクトリにコピー（.csv拡張子を付ける）
              const targetDir = downloadPath || 'tmp/claude';

              // ターゲットディレクトリが存在しない場合は作成
              if (downloadPath) {
                await ensureDir(downloadPath);
              }

              const targetPath = `${targetDir}/taskchute-export-${Date.now()}.csv`;
              await Deno.copyFile(foundFile, targetPath);
              console.log(`✅ CSVファイルをコピー: ${targetPath}`);
              
              // ファイルサイズを確認
              const fileInfo = await Deno.stat(targetPath);
              console.log(`ファイルサイズ: ${fileInfo.size.toLocaleString()} bytes`);
              
              // 元ファイルを削除（オプション）
              try {
                await Deno.remove(foundFile);
                console.log(`元ファイルを削除: ${foundFile}`);
              } catch (e) {
                // 削除エラーは無視
              }
              
              // CSVをパース
              try {
                const parser = new TaskChuteCsvParser();
                const tasks = await parser.parseFile(targetPath);
                console.log(`\nCSVパース完了: ${tasks.length}件のタスクを抽出`);
                
                // 統計情報を表示
                const stats = parser.calculateStats(tasks);
                console.log(`完了: ${stats.completedTasks}件, 進行中: ${stats.inProgressTasks}件, 未実施: ${stats.pendingTasks}件`);
                console.log(`合計時間: ${Math.floor(stats.totalDuration / 60)}時間${stats.totalDuration % 60}分`);
                
                return { success: true, tasks, downloadPath: targetPath };
              } catch (parseError) {
                console.error("CSVパースエラー:", parseError);
                // パースエラーでもダウンロードは成功として扱う
                return { success: true, tasks: [], downloadPath: targetPath };
              }
            } else {
              // ダウンロードイベントを待機（フォールバック）
              console.log("ダウンロードファイルが見つからないため、イベントを待機します...");
              
              try {
                const download = await this.page!.waitForEvent('download', { timeout: 10000 });
                console.log(`ダウンロードイベントを検出: ${download.suggestedFilename()}`);
                
                const downloadPath = `tmp/claude/${download.suggestedFilename() || 'taskchute-export.csv'}`;
                await download.saveAs(downloadPath);
                console.log(`CSVファイルを保存: ${downloadPath}`);
                
                return { success: true, tasks: [], downloadPath };
              } catch (downloadError) {
                console.error("ダウンロードイベントの待機でエラー:", downloadError);
                throw new Error("CSVファイルのダウンロードに失敗しました");
              }
            }
          } catch (error) {
            console.error("ダウンロードディレクトリの確認でエラー:", error);
            throw error;
          }
          
        } catch (error) {
          console.error("ダウンロードエラー:", error);
          
          // エラー時のスクリーンショット
          const errorScreenshot = `tmp/claude/download-error-${Date.now()}.png`;
          await this.page!.screenshot({ path: errorScreenshot, fullPage: true });
          console.log(`エラースクリーンショット: ${errorScreenshot}`);
          
          return { success: false, error: `ダウンロードに失敗しました: ${error}` };
        }
      } else {
        console.log("ダウンロードボタンが見つかりません");
        
        // デバッグ用：ページ内のすべてのボタンを確認
        const allButtons = await this.page!.locator('button').all();
        console.log(`ページ内のボタン総数: ${allButtons.length}`);
        for (let i = 0; i < Math.min(allButtons.length, 5); i++) {
          const text = await allButtons[i].textContent();
          console.log(`ボタン${i + 1}: ${text?.trim()}`);
        }
        
        return { success: false, error: "ダウンロードボタンが見つかりません" };
      }

      return { success: true, tasks: [] };

    } catch (error) {
      console.error("CSVエクスポートページでエラー:", error);
      return { success: false, error: (error as Error).message };
    }
  }

  /**
   * タスクデータを取得する
   * @param mockOptions モックオプション
   * @returns フェッチ結果
   */
  async getTaskData(mockOptions: { mock?: boolean } = {}): Promise<FetchResult<TaskData[]>> {
    if (mockOptions.mock) {
      return { success: true, tasks: [] };
    }

    if (!this.page) {
      return { success: false, error: "No active browser page" };
    }

    try {
      // 最初にページが読み込まれるまで待機
      await this.page.waitForLoadState('networkidle');
      
      // ReactアプリのJavaScript初期化を待機
      await this.page.waitForTimeout(5000);
      
      // スケルトンローディングが完了するまで待機
      try {
        await this.page.locator('span.MuiSkeleton-root').first().waitFor({ state: 'hidden', timeout: 30000 });
      } catch {
        // スケルトン待機が失敗してもデータ取得を試行
      }
      
      // 実際のタスクデータがレンダリングされるまで待機
      try {
        await this.page.locator('div[role="rowgroup"] > div.MuiStack-root, div.MuiStack-root.my-csffzd').first().waitFor({ timeout: 20000 });
      } catch {
        // タスクデータ待機が失敗してもデータ取得を試行
      }
      
      // 追加の安全な待機時間
      await this.page.waitForTimeout(3000);

      const tasks: TaskData[] = [];
      
      // Issue #3の方針に基づく堅牢な実装
      
      // より広範囲のセレクタでタスク行要素の検索を試行
      let taskRows: any[] = [];
      const rowSelectors = [
        'div[role="rowgroup"] > div.MuiStack-root',
        'div[role="grid"] > div.MuiStack-root', 
        'div.MuiStack-root.my-csffzd',
        'div.MuiStack-root[class*="my-"]',
        'div[data-testid*="task"]',
        'div[class*="task"]'
      ];
      
      for (const selector of rowSelectors) {
        try {
          const rows = await this.page.locator(selector).all();
          if (rows.length > taskRows.length) {
            taskRows = rows;
            break;
          }
        } catch (error) {
          continue;
        }
      }
      
      // MuiStackベースの抽出をフォールバックとして使用
      if (taskRows.length === 0) {
        taskRows = await this.page.locator('div.MuiStack-root.my-csffzd').all();
      }
      
      for (const row of taskRows) {
        try {
          // 行内のボックス要素を取得
          const columns = await row.locator(':scope > .MuiBox-root').all();
          
          if (columns.length >= 6) {
            // 列インデックスベースでの抽出を試行
            const startTime = (await columns[1].textContent() || '').trim();
            const endTime = (await columns[2].textContent() || '').trim();
            let title = (await columns[3].textContent() || '').trim();
            const estimatedTime = (await columns[4].textContent() || '').trim();
            const actualTime = (await columns[5].textContent() || '').trim();
            
            // デバッグ用：処理前のタスク名を記録
            const originalTitle = title;
            
            // タスク名の精製処理
            title = title
              .replace(/^(枠:|と|:--|--:|・)+/, '') // 不要な接頭辞を削除
              .replace(/(枠:|と|:--|--:|・)+$/, '') // 不要な接尾辞を削除  
              .replace(/\s*:--\s*/g, '') // 「:--」を削除
              .replace(/^\s*・\s*/, '') // 先頭の「・」を削除
              .replace(/^枠$/, '') // 単独の「枠」を削除
              .replace(/^と$/, '') // 単独の「と」を削除
              .trim();
              
            // デバッグ用：問題のあるタスク名を特定
            if (originalTitle === '枠:--' || originalTitle === 'と') {
              console.log(`問題のタスク: "${originalTitle}" -> "${title}"`);
            }
            
            // ステータス判定
            let status = 'unknown';
            try {
              const svgElement = await columns[0].locator('svg').first();
              const testId = await svgElement.getAttribute('data-testid');
              status = testId === 'CheckIcon' ? 'completed' : 
                      testId === 'PlayArrowIcon' ? 'in-progress' : 
                      testId === 'PauseIcon' ? 'paused' : 'unknown';
            } catch {}
            
            // タスクの有効性を判定（より厳密なチェック）
            const isValidTask = title && 
                               title.length > 1 && // 最低2文字以上
                               title.length < 200 &&
                               startTime && 
                               endTime && 
                               !title.includes('終了予定') && 
                               !title.includes('Start期間') &&
                               !title.includes('ヘッダー') &&
                               !title.includes('合計') &&
                               originalTitle !== '枠:--' && // 元の「枠:--」を除外
                               originalTitle !== 'と' && // 元の「と」を除外
                               !/^[:・\-\s]+$/.test(title) && // 記号のみのタイトルを除外
                               !/^(枠|と|・)+$/.test(title); // 不要文字のみを除外
            
            if (isValidTask) {
              tasks.push({
                id: `task-${tasks.length}`,
                title: title,
                status: status,
                startTime: startTime.replace('--:--', ''),
                endTime: endTime.replace('--:--', ''),
                estimatedTime: estimatedTime.replace('--:--', ''),
                actualTime: actualTime.replace('--:--', ''),
                category: '',
                description: '',
              });
            }
          } else {
            // フォールバック：MuiStackテキストベース抽出
            const stackText = await row.textContent();
            const timeMatches = stackText?.match(/\d{1,2}:\d{2}/g);
            
            if (timeMatches && timeMatches.length >= 2) {
              const startTime = timeMatches[0];
              const endTime = timeMatches[1];
              const estimatedTime = timeMatches[2] || '';
              const actualTime = timeMatches[3] || '';
              
              // タスク名抽出（簡略版）
              let taskName = stackText?.replace(/(\d{1,2}:\d{2}|--:--)/g, ' ')
                                      .replace(/\s+/g, ' ')
                                      .replace(/(タグ|プロジェクト|routine|condition|モード)$/, '')
                                      .trim() || '';
              
              if (taskName.length > 0 && taskName.length < 100 &&
                  !taskName.includes('終了予定') && !taskName.includes('Start期間')) {
                tasks.push({
                  id: `task-${tasks.length}`,
                  title: taskName,
                  status: 'unknown',
                  startTime: startTime,
                  endTime: endTime,
                  estimatedTime: estimatedTime,
                  actualTime: actualTime,
                  category: '',
                  description: '',
                });
              }
            }
          }
        } catch (error) {
          continue;
        }
      }
      
      if (tasks.length === 0) {
        return { success: false, error: "No tasks found on the page" };
      }

      return { success: true, tasks };

    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  }

  /**
   * 現在のページのURLを取得する
   * @returns 現在のURL
   */
  getCurrentUrl(): string {
    return this.page?.url() || "No page";
  }

  /**
   * 1日のタスク統計情報を取得する
   * @returns フェッチ結果
   */
  async getDailyTaskStats(): Promise<FetchResult<any>> {
    if (!this.page) {
      return { success: false, error: "No active browser page" };
    }

    try {
      const stats = await this.page.evaluate(() => {
        const rows = Array.from(document.querySelectorAll("tbody > tr")) as Element[];
        return rows.map(row => {
          const columns = row.querySelectorAll("td");
          return {
            startTime: columns[0]?.textContent?.trim(),
            endTime: columns[1]?.textContent?.trim(),
            estimateTime: columns[2]?.textContent?.trim(),
            actualTime: columns[3]?.textContent?.trim(),
          };
        });
      });
      return { success: true, data: stats };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  }

  /**
   * HTMLをファイルに保存する
   * @param html 保存するHTML文字列
   * @param filePath 保存先のファイルパス
   * @returns 保存結果
   */
  async saveHTMLToFile(html: string, filePath: string): Promise<SaveResult> {
    try {
      await ensureDir(filePath.substring(0, filePath.lastIndexOf('/')));
      await Deno.writeTextFile(filePath, html);
      return { success: true, filePath };

    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  }

  /**
   * JSONデータをファイルに保存する
   * @param data 保存するデータ
   * @param filePath 保存先のファイルパス
   * @returns 保存結果
   */
  async saveJSONToFile(data: any, filePath: string): Promise<SaveResult> {
    try {
      await ensureDir(filePath.substring(0, filePath.lastIndexOf('/')));
      const jsonString = JSON.stringify(data, null, 2);
      await Deno.writeTextFile(filePath, jsonString);
      return { success: true, filePath };

    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  }

  /**
   * スクリーンショットを撮る
   * @param filePath 保存先のファイルパス
   * @returns 保存結果
   */
  async takeScreenshot(filePath: string): Promise<SaveResult> {
    if (!this.page) {
      return { success: false, error: "No active browser page" };
    }

    try {
      await ensureDir(filePath.substring(0, filePath.lastIndexOf('/')));
      await this.page.screenshot({ path: filePath, fullPage: true });
      return { success: true, filePath };

    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  }

  /**
   * ブラウザとページをクリーンアップする
   * @returns クリーンアップ結果
   */
  async cleanup(): Promise<{ success: boolean; error?: string }> {
    try {
      if (this.page && !this.page.isClosed()) {
        await this.page.close();
      }
      this.page = null;

      if (this.context) {
        await this.context.close();
      }
      this.context = null;

      // When using launchPersistentContext, browser.close() is not needed
      // as context.close() handles it.
      if (this.browser && !this.options.userDataDir && this.browser.isConnected()) {
        await this.browser.close();
      }
      this.browser = null;

      return { success: true };

    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  }
}