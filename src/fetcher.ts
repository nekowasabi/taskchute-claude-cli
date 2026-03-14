import {
  Browser,
  BrowserContext,
  chromium,
  firefox,
  Page,
  webkit,
} from "playwright";
import { ensureDir } from "std/fs/mod.ts";
import { join } from "std/path/mod.ts";
import { LoginCredentials } from "./auth.ts";
import {
  convertToWindowsPath,
  detectPlatform,
  getBrowserLaunchOptions,
  getFullLaunchConfig,
} from "./platform.ts";
import { TaskChuteCsvParser } from "./csv-parser.ts";
import { ChromeProfileManager } from "./chrome-profile-manager.ts";
import { CookieManager, type PlaywrightCookie } from "./cookie-manager.ts";
import type {
  AuthResult,
  FetcherOptions,
  FetchResult,
  NavigationResult,
  SaveResult,
  TaskData,
} from "./types.ts";
import { CSVDownloader } from "./csv-downloader.ts";
import {
  getDailyTaskStats as _getDailyTaskStats,
  saveHTMLToFile as _saveHTMLToFile,
  saveJSONToFile as _saveJSONToFile,
  scrapeTaskData,
} from "./fetcher-helpers.ts";

/**
 * TaskChuteのデータを取得するためのクラス
 */
export class TaskChuteDataFetcher {
  private options: Required<FetcherOptions>;
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private cookieManager: CookieManager = new CookieManager();

  /**
   * @param options Fetcherのオプション
   */
  constructor(options: FetcherOptions = {}) {
    const defaultUserDataDir = join(
      Deno.env.get("HOME") || ".",
      ".taskchute",
      "playwright",
    );
    this.options = {
      headless: options.headless ?? true,
      browser: options.browser ?? "chromium",
      timeout: options.timeout ?? 30000,
      viewport: options.viewport ?? { width: 1920, height: 1080 },
      userDataDir: options.userDataDir ?? defaultUserDataDir,
    };
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
   * 保存されたCookieをContextに注入する
   * @returns 注入結果
   */
  async injectSavedCookies(): Promise<
    { success: boolean; error?: string; count?: number }
  > {
    if (!this.context) {
      return { success: false, error: "Browser context is not initialized" };
    }

    try {
      const cookies = await this.cookieManager.loadSavedCookies();
      if (!cookies || cookies.length === 0) {
        return {
          success: false,
          error:
            "保存されたCookieがありません。import-cookiesコマンドでCookieをインポートしてください。",
        };
      }

      const expired = this.cookieManager.checkCookieExpiration(cookies);
      if (expired.length > 0) {
      }

      await this.cookieManager.injectCookies(this.context, cookies);

      return { success: true, count: cookies.length };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  }

  /**
   * BrowserContextを取得（外部からのCookie操作用）
   */
  getContext(): BrowserContext | null {
    return this.context;
  }

  /**
   * ブラウザを起動する
   * @param mockOptions モックオプション
   * @returns 起動結果
   */
  async launchBrowser(
    mockOptions: { mock?: boolean } = {},
  ): Promise<{ success: boolean; error?: string }> {
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
        // プラットフォーム情報を取得し、全起動設定を一括取得
        // Why: isMac/isWSL/isWSLg の直接分岐を fetcher.ts から排除し platform.ts に集約する
        const platformInfo = detectPlatform();
        const launchConfig = getFullLaunchConfig(platformInfo, {
          headless: this.options.headless,
        });

        // プロファイルパスの決定
        // Why: usePlatformProfilePath=true の場合はプラットフォーム固有パスを使用し、
        //      false の場合は this.options.userDataDir をそのまま使用する
        const home = Deno.env.get("HOME") || ".";
        const profilePath = launchConfig.usePlatformProfilePath &&
            launchConfig.platformProfileSubPath
          ? `${home}/${launchConfig.platformProfileSubPath}`
          : this.options.userDataDir;

        // ディレクトリが存在しない場合は作成
        await ensureDir(profilePath);

        // CDP ポートが指定されている場合、起動前にポート解放を待機
        // Why: 連続実行時に前回の Chrome が使用した TCP ポートが TIME_WAIT 状態（約60秒）で残り、
        //      同じポートで Chrome を再起動するとバインドに失敗してタイムアウトする。
        //      WSLg では固定 cdpPort のみ動作するため、ポート解放を待つ必要がある。
        if (launchConfig.cdpPort && launchConfig.cdpPort > 0) {
          const port = launchConfig.cdpPort;
          const maxWaitMs = 65000; // TIME_WAIT は通常60秒
          const intervalMs = 2000;
          const startTime = Date.now();
          let portAvailable = false;
          while (Date.now() - startTime < maxWaitMs) {
            try {
              const listener = Deno.listen({ port, hostname: "127.0.0.1" });
              listener.close();
              portAvailable = true;
              break;
            } catch {
              const elapsed = Math.round((Date.now() - startTime) / 1000);
              console.log(`[DEBUG] Port ${port} is busy (TIME_WAIT), waiting... (${elapsed}s)`);
              await new Promise((r) => setTimeout(r, intervalMs));
            }
          }
          if (!portAvailable) {
            console.log(`[DEBUG] WARNING: Port ${port} still busy after ${maxWaitMs / 1000}s, attempting launch anyway`);
          }
        }

        // ブラウザ起動前にロック関連ファイルをクリーンアップ
        // Why: 前回の起動が異常終了した場合、SingletonLock や DevToolsActivePort が残留し
        //      launchPersistentContext が古い情報で接続を試みてタイムアウトする。
        //      特に WSLg 環境では cdpPort:9222 固定のため、残留ファイルが2回目以降の起動を妨げる。
        const lockFilesToClean = [
          `${profilePath}/SingletonLock`,
          `${profilePath}/SingletonCookie`,
          `${profilePath}/SingletonSocket`,
          `${profilePath}/DevToolsActivePort`,
          `${profilePath}/Default/LOCK`,
        ];
        // プロファイルの非認証データを全削除
        // Why: Chrome がヘッドレスモードでセッション復元・Service Worker・キャッシュ等を
        //      処理しようとすると Playwright の launchPersistentContext がハングする。
        //      認証情報（Cookies, Local Storage）のみ保持し、それ以外を毎回クリーンアップする。
        const defaultDir = `${profilePath}/Default`;
        const preserveFiles = new Set([
          "Cookies",
          "Cookies-journal",
          "Local Storage",
          "Session Storage",
          "IndexedDB",
          "Login Data",
          "Login Data-journal",
          "Preferences",
          "Secure Preferences",
          "Web Data",
          "Web Data-journal",
        ]);
        try {
          for await (const entry of Deno.readDir(defaultDir)) {
            if (!preserveFiles.has(entry.name)) {
              const fullPath = `${defaultDir}/${entry.name}`;
              try {
                await Deno.remove(fullPath, { recursive: true });
              } catch {
                // 一部のファイルは削除できない場合がある（使用中等）
              }
            }
          }
          console.log(`[DEBUG] Profile cleaned (preserved: ${[...preserveFiles].join(", ")})`);
        } catch {
          // Default ディレクトリが存在しない場合は無視
        }
        for (const f of lockFilesToClean) {
          try {
            await Deno.remove(f);
            console.log(`[DEBUG] Removed lock file: ${f}`);
          } catch {
            // ファイルが存在しない場合は無視
          }
        }

        // launchPersistentContext オプションを組み立て
        const contextOptions: Record<string, unknown> = {
          headless: this.options.headless,
          timeout: this.options.timeout,
          viewport: this.options.viewport,
          args: launchConfig.args,
        };
        if (launchConfig.channel !== undefined) {
          contextOptions.channel = launchConfig.channel;
        }
        if (launchConfig.executablePath !== undefined) {
          contextOptions.executablePath = launchConfig.executablePath;
        }
        if (launchConfig.ignoreDefaultArgs !== undefined) {
          contextOptions.ignoreDefaultArgs = launchConfig.ignoreDefaultArgs;
        }
        if (launchConfig.acceptDownloads) {
          contextOptions.acceptDownloads = true;
          contextOptions.downloadsPath = `${home}/Downloads`;
        }
        if (launchConfig.cdpPort !== undefined) {
          // Why: cdpPort 設定時は --remote-debugging-pipe の代わりに TCP ポートを使用
          //      WSLg/WSL2 では FD 継承失敗（Failed global descriptor lookup: 7）を回避するため
          contextOptions.cdpPort = launchConfig.cdpPort;
        }

        browserLauncher = chromium;

        // リトライ付き launchPersistentContext
        // Why: WSLg 環境では launchPersistentContext が非決定的にタイムアウトする。
        //      Chrome は起動し WS 接続も成功するが、Playwright の内部初期化が完了しない。
        //      リトライすることで2回目以降に成功するパターンが確認されている。
        const maxRetries = 3;
        const retryTimeout = 30000; // 各試行は30秒でタイムアウト（フル待ちを避ける）
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
          try {
            const attemptOptions = {
              ...contextOptions,
              timeout: attempt < maxRetries ? retryTimeout : this.options.timeout,
            };
            this.context = await browserLauncher.launchPersistentContext(
              profilePath,
              attemptOptions as Parameters<
                typeof browserLauncher.launchPersistentContext
              >[1],
            );
            console.log(`[DEBUG] launchPersistentContext succeeded (attempt ${attempt}/${maxRetries})`);
            break;
          } catch (e) {
            console.log(`[DEBUG] launchPersistentContext failed (attempt ${attempt}/${maxRetries}): ${e instanceof Error ? e.message.split("\n")[0] : e}`);
            if (attempt >= maxRetries) throw e;
            // Chrome プロセスを強制終了してからリトライ
            try {
              const cmd = new Deno.Command("pkill", { args: ["-9", "-f", "chrome.*user-data-dir.*taskchute"] });
              await cmd.output();
            } catch { /* ignore */ }
            await new Promise((r) => setTimeout(r, 2000));
          }
        }

        this.browser = this.context!.browser();
        this.page = this.context!.pages()[0] || await this.context!.newPage();

        // WSLg 固有: navigator.webdriver 偽装スクリプトを注入
        // Why: Google の自動化検出バイパスに必要。platform.ts のフラグで制御することで
        //      fetcher.ts からの isWSLg 直接参照を排除する
        if (launchConfig.injectWebdriverSpoof) {
          await this.page.addInitScript(() => {
            Object.defineProperty(navigator, "webdriver", {
              get: () => undefined,
            });
            // @ts-ignore
            delete navigator.__proto__.webdriver;
          });
        }

        // Cookie 注入（WSL/WSLg 環境で保存済み Cookie を使用する場合）
        if (launchConfig.injectSavedCookies) {
          await this.injectSavedCookies();
        }
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
  async navigateToTaskChute(
    fromDate?: string,
    toDate?: string,
    mockOptions: {
      mock?: boolean;
      forceTimeout?: boolean;
      forceNetworkError?: boolean;
    } = {},
  ): Promise<NavigationResult> {
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
      }

      // React SPAではnetworkidleは到達しないため、domcontentloadedを使用
      await this.page!.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: this.options.timeout,
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
      await this.page.waitForSelector(".MuiSkeleton-root", {
        state: "hidden",
        timeout: 10000,
      });
    } catch {
      // スケルトンがない場合は無視
    }

    // DOMの安定化を待機
    // Why: 'load' は外部リソース完全読み込みを待つため headless:false+disable-gpu 環境で
    //      無限待機になる。domcontentloaded でHTMLパース完了のみ確認する。
    try {
      await this.page.waitForLoadState("domcontentloaded", { timeout: 10000 });
    } catch { /* タイムアウトでも続行 */ }

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
      // Why: /signin ページにも <header> が存在するため、header だけでは誤判定になる。
      //      URL が signin/login を含まない状態で header が表示されるまで待つ。
      const deadline = Date.now() + timeout;
      while (Date.now() < deadline) {
        await this.page.waitForTimeout(1000);
        const url = this.page.url();
        // ログイン後のページにいるか確認（signin/login ページではないこと）
        if (
          !url.includes("/signin") && !url.includes("/login") &&
          url.includes("taskchute.cloud")
        ) {
          // ダッシュボードのヘッダーが表示されているか確認
          const header = await this.page.$("header");
          if (header) {
            return true;
          }
        }
      }
      return false;
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
      return false;
    }
    try {
      const currentUrl = this.page.url();

      await this.page.waitForSelector("header", { timeout: 5000 });
      return true;
    } catch (error) {
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
  async waitForAuthRedirect(
    mockOptions: { mock?: boolean } = {},
  ): Promise<AuthResult> {
    if (mockOptions.mock) {
      return { success: true, finalUrl: "https://taskchute.cloud/taskchute" };
    }

    if (!this.page) {
      return { success: false, error: "No active browser page" };
    }

    try {
      await this.page.waitForURL(/taskchute\.cloud\/dashboard/, {
        timeout: this.options.timeout,
      });
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
  async getPageHTML(
    mockOptions: { mock?: boolean } = {},
  ): Promise<FetchResult<string>> {
    if (mockOptions.mock) {
      return {
        success: true,
        html:
          '<html><head><title>TaskChute Cloud</title></head><body><div class="task-item">Mock Task</div></body></html>',
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
  async getElements(
    selector: string,
    mockOptions: { mock?: boolean } = {},
  ): Promise<any[]> {
    if (mockOptions.mock) {
      return [
        { text: "Mock Task 1", id: "task-1" },
        { text: "Mock Task 2", id: "task-2" },
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
        }),
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
  async getTaskDataFromCSV(
    fromDate?: string,
    toDate?: string,
    downloadPath?: string,
  ): Promise<FetchResult<TaskData[]>> {
    if (!this.page) {
      const browserResult = await this.launchBrowser();
      if (!browserResult.success) {
        return { success: false, error: browserResult.error };
      }
    }

    // Step 1: Login check — must be done before delegating to CSVDownloader
    await this.page!.goto("https://taskchute.cloud/taskchute", {
      waitUntil: "domcontentloaded",
      timeout: this.options.timeout,
    });
    await this.waitForReactReady();
    const isLoggedIn = await this.isUserLoggedIn();
    if (!isLoggedIn) {
      return {
        success: false,
        error:
          "ログインが必要です。先に 'taskchute-cli login' を実行してください。",
      };
    }

    // Why: CSV download logic delegated to CSVDownloader — fetcher.ts is orchestration only
    const downloader = new CSVDownloader();
    const result = await downloader.downloadCSV(this.page!, {
      fromDate,
      toDate,
      outputDir: downloadPath,
    });
    // Why: Adapter — CSVDownloadResult to FetchResult<TaskData[]> conversion
    return { success: result.success, data: result.tasks, error: result.error };
  }

  /**
   * タスクデータを取得する
   * @param mockOptions モックオプション
   * @returns フェッチ結果
   */
  async getTaskData(
    mockOptions: { mock?: boolean } = {},
  ): Promise<FetchResult<TaskData[]>> {
    if (mockOptions.mock) {
      return { success: true, tasks: [] };
    }

    if (!this.page) {
      return { success: false, error: "No active browser page" };
    }

    try {
      // Why: スクレイピングロジックを fetcher-helpers.ts に委譲し、fetcher.ts の行数を削減
      return await scrapeTaskData(this.page);
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
    // Why: ロジックを fetcher-helpers.ts に委譲
    return _getDailyTaskStats(this.page);
  }

  /**
   * HTMLをファイルに保存する
   * @param html 保存するHTML文字列
   * @param filePath 保存先のファイルパス
   * @returns 保存結果
   */
  async saveHTMLToFile(html: string, filePath: string): Promise<SaveResult> {
    // Why: ロジックを fetcher-helpers.ts に委譲
    return _saveHTMLToFile(html, filePath);
  }

  /**
   * JSONデータをファイルに保存する
   * @param data 保存するデータ
   * @param filePath 保存先のファイルパス
   * @returns 保存結果
   */
  async saveJSONToFile(data: any, filePath: string): Promise<SaveResult> {
    // Why: ロジックを fetcher-helpers.ts に委譲
    return _saveJSONToFile(data, filePath);
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
      if (
        this.browser && !this.options.userDataDir && this.browser.isConnected()
      ) {
        await this.browser.close();
      }
      this.browser = null;

      return { success: true };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  }
}

// Why: re-export instead of keeping definitions here — backward compatibility for tests importing from fetcher.ts
export type {
  AuthResult,
  FetcherOptions,
  FetchResult,
  NavigationResult,
  SaveResult,
  TaskData,
} from "./types.ts";
