/**
 * AuthenticatedFetcher - storageStateを使用した認証済みフェッチャー
 *
 * SessionManagerと連携して、認証状態を管理しながらブラウザ操作を行う。
 */
import { chromium, Browser, Page, BrowserContext } from "playwright";
import { ensureDir } from "std/fs/mod.ts";
import { join } from "std/path/mod.ts";
import { SessionManager } from "./session-manager.ts";
import { FetcherOptions, TaskData, FetchResult, NavigationResult } from "./fetcher.ts";
import { detectPlatform, getBrowserLaunchOptions } from "./platform.ts";

/**
 * ブラウザ起動オプション
 */
export interface LaunchOptions {
  /** storageStateファイルパス */
  storageState?: string;
  /** ヘッドレスモード */
  headless?: boolean;
  /** タイムアウト（ミリ秒） */
  timeout?: number;
  /** ビューポートサイズ */
  viewport?: { width: number; height: number };
}

/**
 * BrowserContextインターフェース（モック用）
 */
export interface BrowserContextLike {
  storageState: (options: { path: string }) => Promise<unknown>;
}

/**
 * storageStateを使用した認証済みデータフェッチャー
 *
 * @example
 * ```typescript
 * const sessionManager = new SessionManager();
 * const fetcher = new AuthenticatedFetcher(sessionManager);
 *
 * if (await fetcher.requiresLogin()) {
 *   // ログインフローを実行
 *   await fetcher.performLogin();
 * }
 *
 * // 認証済みの状態でデータ取得
 * const tasks = await fetcher.getTaskData();
 * ```
 */
export class AuthenticatedFetcher {
  private sessionManager: SessionManager;
  private options: Required<FetcherOptions>;
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;

  /**
   * AuthenticatedFetcherを初期化
   *
   * @param sessionManager セッションマネージャー
   * @param options フェッチャーオプション
   */
  constructor(sessionManager: SessionManager, options: FetcherOptions = {}) {
    this.sessionManager = sessionManager;

    const defaultUserDataDir = join(Deno.env.get("HOME") || ".", ".taskchute", "playwright");
    this.options = {
      headless: options.headless ?? true,
      browser: options.browser ?? "chromium",
      timeout: options.timeout ?? 30000,
      viewport: options.viewport ?? { width: 1920, height: 1080 },
      userDataDir: options.userDataDir ?? defaultUserDataDir
    };
  }

  /**
   * 有効なセッションがあるかチェック
   *
   * @returns セッションが有効な場合はtrue
   */
  async hasValidSession(): Promise<boolean> {
    return await this.sessionManager.isSessionValid();
  }

  /**
   * 認証済みかどうかをチェック
   *
   * @returns 認証済みの場合はtrue
   */
  async isAuthenticated(): Promise<boolean> {
    return await this.sessionManager.isSessionValid();
  }

  /**
   * ログインが必要かどうかをチェック
   *
   * @returns ログインが必要な場合はtrue
   */
  async requiresLogin(): Promise<boolean> {
    return !(await this.sessionManager.isSessionValid());
  }

  /**
   * ブラウザ起動オプションを取得
   *
   * @param options オプション
   * @returns 起動オプション
   */
  async getLaunchOptions(options: { useMock?: boolean } = {}): Promise<LaunchOptions> {
    const contextOptions = await this.sessionManager.getContextOptions();

    return {
      storageState: contextOptions.storageState,
      headless: this.options.headless,
      timeout: this.options.timeout,
      viewport: this.options.viewport
    };
  }

  /**
   * BrowserContextからセッションを保存
   *
   * @param context BrowserContext（またはモック）
   */
  async saveSessionFromContext(context: BrowserContextLike): Promise<void> {
    await this.sessionManager.saveSession(context);
  }

  /**
   * ブラウザを起動（storageState対応）
   *
   * @returns 起動結果
   */
  async launchBrowser(): Promise<{ success: boolean; error?: string }> {
    try {
      const platformInfo = detectPlatform();
      const launchOptions = getBrowserLaunchOptions(platformInfo);

      // storageStateの有効性をチェック
      const contextOptions = await this.sessionManager.getContextOptions();
      const hasValidSession = contextOptions.storageState !== undefined;

      console.log(`[AuthenticatedFetcher] セッション状態: ${hasValidSession ? "有効" : "無効"}`);

      if (hasValidSession) {
        // storageStateを使用してコンテキストを作成
        console.log(`[AuthenticatedFetcher] storageStateを使用: ${contextOptions.storageState}`);

        this.browser = await chromium.launch({
          headless: this.options.headless,
          ...(platformInfo.isMac ? { channel: 'chrome' } : {}),
          args: ['--no-sandbox', '--disable-setuid-sandbox']
        });

        this.context = await this.browser.newContext({
          storageState: contextOptions.storageState,
          viewport: this.options.viewport,
          acceptDownloads: true
        });

        this.page = await this.context.newPage();
        this.page.setDefaultTimeout(this.options.timeout);

        console.log("[AuthenticatedFetcher] storageStateを使用してコンテキスト作成完了");
      } else {
        // 新規セッションで起動
        console.log("[AuthenticatedFetcher] 新規セッションで起動");

        // userDataDirを使用して永続化コンテキストを作成
        await ensureDir(this.options.userDataDir);

        if (platformInfo.isMac) {
          this.context = await chromium.launchPersistentContext(this.options.userDataDir, {
            headless: this.options.headless,
            timeout: this.options.timeout,
            viewport: this.options.viewport,
            channel: 'chrome',
            args: ['--no-sandbox', '--disable-setuid-sandbox'],
            acceptDownloads: true
          });
        } else {
          this.context = await chromium.launchPersistentContext(this.options.userDataDir, {
            headless: this.options.headless,
            timeout: this.options.timeout,
            viewport: this.options.viewport,
            acceptDownloads: true
          });
        }

        this.browser = this.context.browser();
        this.page = this.context.pages()[0] || await this.context.newPage();
        this.page.setDefaultTimeout(this.options.timeout);
      }

      return { success: true };

    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  }

  /**
   * TaskChute Cloudにナビゲート
   *
   * @returns ナビゲーション結果
   */
  async navigateToTaskChute(): Promise<NavigationResult> {
    if (!this.page) {
      const browserResult = await this.launchBrowser();
      if (!browserResult.success) {
        return { success: false, error: browserResult.error };
      }
    }

    try {
      await this.page!.goto("https://taskchute.cloud/taskchute", {
        waitUntil: "networkidle",
        timeout: this.options.timeout
      });

      const currentUrl = this.page!.url();
      return { success: true, currentUrl };

    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  }

  /**
   * ログインページに遷移してユーザーの手動ログインを待機
   *
   * @param timeout タイムアウト（ミリ秒）
   * @returns ログイン成功時はtrue
   */
  async waitForManualLogin(timeout: number = 300000): Promise<boolean> {
    if (!this.page) {
      return false;
    }

    try {
      // TaskChuteページに遷移
      await this.page.goto("https://taskchute.cloud/taskchute", {
        waitUntil: "networkidle",
        timeout: this.options.timeout
      });

      console.log("[AuthenticatedFetcher] ブラウザでログインしてください...");

      // ログイン完了（headerが表示される）を待機
      await this.page.waitForSelector('header', { timeout });

      console.log("[AuthenticatedFetcher] ログイン成功を検知しました");

      // セッションを保存
      if (this.context) {
        await this.sessionManager.saveSession(this.context);
        console.log("[AuthenticatedFetcher] セッションを保存しました");
      }

      return true;

    } catch (error) {
      console.error(`[AuthenticatedFetcher] ログイン待機エラー: ${error}`);
      return false;
    }
  }

  /**
   * ユーザーがログイン済みかをチェック
   *
   * @returns ログイン済みの場合はtrue
   */
  async isUserLoggedIn(): Promise<boolean> {
    if (!this.page) {
      return false;
    }

    try {
      await this.page.waitForSelector('header', { timeout: 5000 });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 現在のコンテキストを取得
   *
   * @returns BrowserContext
   */
  getContext(): BrowserContext | null {
    return this.context;
  }

  /**
   * 現在のページを取得
   *
   * @returns Page
   */
  getPage(): Page | null {
    return this.page;
  }

  /**
   * リソースをクリーンアップ
   *
   * @returns クリーンアップ結果
   */
  async cleanup(): Promise<{ success: boolean; error?: string }> {
    try {
      // 終了前にセッションを保存（コンテキストが存在する場合）
      if (this.context) {
        try {
          await this.sessionManager.saveSession(this.context);
          console.log("[AuthenticatedFetcher] セッションを保存しました");
        } catch (error) {
          console.warn(`[AuthenticatedFetcher] セッション保存エラー: ${error}`);
        }
      }

      if (this.page && !this.page.isClosed()) {
        await this.page.close();
      }
      this.page = null;

      if (this.context) {
        await this.context.close();
      }
      this.context = null;

      if (this.browser && this.browser.isConnected()) {
        await this.browser.close();
      }
      this.browser = null;

      return { success: true };

    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  }

  /**
   * オプションを更新
   *
   * @param newOptions 新しいオプション
   */
  updateOptions(newOptions: Partial<FetcherOptions>): void {
    this.options = { ...this.options, ...newOptions };
  }
}
