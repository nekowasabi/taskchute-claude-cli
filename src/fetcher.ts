import { chromium, firefox, webkit, Browser, Page, BrowserContext } from "playwright";
import { ensureDir } from "std/fs/mod.ts";
import { join } from "std/path/mod.ts";
import { LoginCredentials } from "./auth.ts";

export interface FetcherOptions {
  headless?: boolean;
  browser?: "chromium" | "firefox" | "webkit";
  timeout?: number;
  viewport?: { width: number; height: number };
  userDataDir?: string;
}

export interface TaskData {
  id: string;
  title: string;
  status: string;
  description?: string;
  startTime?: string;
  endTime?: string;
  duration?: number;
  category?: string;
}

export interface FetchResult<T = any> {
  success: boolean;
  data?: T;
  html?: string;
  tasks?: TaskData[];
  error?: string;
}

export interface NavigationResult {
  success: boolean;
  currentUrl?: string;
  error?: string;
}

export interface AuthResult {
  success: boolean;
  token?: string;
  finalUrl?: string;
  error?: string;
}

export interface SaveResult {
  success: boolean;
  filePath?: string;
  error?: string;
}

export class TaskChuteDataFetcher {
  private options: Required<FetcherOptions>;
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;

  constructor(options: FetcherOptions = {}) {
    this.options = {
      headless: options.headless ?? true,
      browser: options.browser ?? "chromium",
      timeout: options.timeout ?? 30000,
      viewport: options.viewport ?? { width: 1920, height: 1080 },
      userDataDir: options.userDataDir ?? join(Deno.env.get("HOME") || ".", ".taskchute", "playwright")
    };
  }

  updateOptions(newOptions: Partial<FetcherOptions>): void {
    this.options = { ...this.options, ...newOptions };
  }

  getOptions(): Required<FetcherOptions> {
    return { ...this.options };
  }

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
        this.context = await browserLauncher.launchPersistentContext(this.options.userDataDir, {
          headless: this.options.headless,
          timeout: this.options.timeout,
          viewport: this.options.viewport,
        });
        this.browser = this.context.browser();
        this.page = this.context.pages()[0] || await this.context.newPage();
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

  async navigateToTaskChute(mockOptions: { mock?: boolean; forceTimeout?: boolean; forceNetworkError?: boolean } = {}): Promise<NavigationResult> {
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

  async isUserLoggedIn(): Promise<boolean> {
    if (!this.page) {
      return false;
    }
    try {
      await this.page.waitForSelector('header', { timeout: 5000 });
      return true;
    } catch (error) {
      return false;
    }
  }

  async checkLoginStatus(): Promise<{ isLoggedIn: boolean; error?: string }> {
    if (!this.page) {
      const browserResult = await this.launchBrowser();
      if (!browserResult.success) {
        return { isLoggedIn: false, error: browserResult.error };
      }
    }

    try {
      await this.page!.goto("https://taskchute.cloud/taskchute", {
        waitUntil: "networkidle",
        timeout: this.options.timeout,
      });

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

  async getTaskData(mockOptions: { mock?: boolean } = {}): Promise<FetchResult<TaskData[]>> {
    console.log("[Fetcher] getTaskData: 開始");
    if (mockOptions.mock) {
      // Mock implementation...
      return { success: true, tasks: [] };
    }

    if (!this.page) {
      console.error("[Fetcher] getTaskData: pageオブジェクトがありません");
      return { success: false, error: "No active browser page" };
    }

    try {
      console.log("[Fetcher] getTaskData: 1. rowgroupの待機を開始");
      
      // デバッグ用：現在のページの情報を確認
      const currentUrl = this.page.url();
      console.log("[Fetcher] getTaskData: 現在のURL:", currentUrl);
      
      // スクリーンショットを撮る
      await this.page.screenshot({ path: "debug-before-rowgroup.png", fullPage: true });
      console.log("[Fetcher] getTaskData: スクリーンショット保存: debug-before-rowgroup.png");
      
      // 現在のDOM構造を確認
      const bodyHtml = await this.page.locator('body').innerHTML();
      console.log("[Fetcher] getTaskData: body要素の最初の1000文字:", bodyHtml.substring(0, 1000));
      
      // より柔軟な待機戦略を使用
      console.log("[Fetcher] getTaskData: テーブル要素の待機を開始");
      
      // 複数のセレクタを試す
      const selectors = [
        'div[role="rowgroup"]',
        'div[role="grid"]',
        'table',
        '[data-testid="task-table"]',
        '.task-list',
        'div[class*="table"]',
        'div[class*="grid"]'
      ];
      
      let foundElement = null;
      for (const selector of selectors) {
        try {
          console.log(`[Fetcher] getTaskData: ${selector} を試行中`);
          await this.page.waitForSelector(selector, { timeout: 5000 });
          foundElement = selector;
          console.log(`[Fetcher] getTaskData: ${selector} が見つかりました`);
          break;
        } catch (error) {
          console.log(`[Fetcher] getTaskData: ${selector} が見つかりませんでした`);
        }
      }
      
      if (!foundElement) {
        // 最後の手段として長時間待機
        console.log("[Fetcher] getTaskData: 最後の手段でrowgroupを60秒間待機");
        await this.page.waitForSelector('div[role="rowgroup"]', { timeout: 60000 });
      }
      console.log("[Fetcher] getTaskData: 1. rowgroupの待機が完了");

      console.log("[Fetcher] getTaskData: 2. スケルトンが消えるのを待機開始");
      try {
        // 最初のスケルトン要素だけを待機
        await this.page.locator('span.MuiSkeleton-root').first().waitFor({ state: 'hidden', timeout: this.options.timeout });
        console.log("[Fetcher] getTaskData: 2. スケルトンが消えるのを待機完了");
      } catch (error) {
        console.log("[Fetcher] getTaskData: スケルトン待機をスキップして続行");
        // スケルトン待機が失敗してもデータ取得を試行
      }
      
      console.log("[Fetcher] getTaskData: 3. 最終待機を開始");
      await this.page.waitForTimeout(2000);
      console.log("[Fetcher] getTaskData: 3. 最終待機が完了");

      console.log("[Fetcher] getTaskData: 4. データ抽出を開始");
      
      // DOM構造を詳しく調べる
      const pageContent = await this.page.content();
      console.log("[Fetcher] getTaskData: ページのHTMLを確認中");
      
      // HTMLを一時ファイルに保存してデバッグ
      await Deno.writeTextFile("debug-page-content.html", pageContent);
      console.log("[Fetcher] getTaskData: HTMLをdebug-page-content.htmlに保存しました");
      
      // 複数のセレクタでタスク行を検索
      const possibleSelectors = [
        'div[role="row"]',
        'tr',
        '[data-testid*="task"]', 
        'li[class*="task"]',
        'div[class*="task"]',
        'div[class*="item"]',
        'div[class*="row"]'
      ];
      
      let rows: any[] = [];
      let usedSelector = '';
      
      for (const selector of possibleSelectors) {
        try {
          const foundRows = await this.page.locator(selector).all();
          if (foundRows.length > 0) {
            rows = foundRows;
            usedSelector = selector;
            console.log(`[Fetcher] getTaskData: ${selector} で ${foundRows.length}行見つかりました`);
            break;
          }
        } catch (error) {
          console.log(`[Fetcher] getTaskData: ${selector} の検索に失敗`);
        }
      }
      
      console.log(`[Fetcher] getTaskData: 最終的に${usedSelector}で${rows.length}行見つかりました`);
      
      // 新しいアプローチ：ページから全てのテキストを抽出してタスクを探す
      console.log("[Fetcher] getTaskData: テキストベースの抽出を開始");
      
      const tasks: TaskData[] = [];
      
      // ページから全体のテキストを取得
      const allText = await this.page.locator('body').textContent();
      console.log("[Fetcher] getTaskData: ページテキストを取得、長さ:", allText?.length);
      
      // 時間のパターン（09:48-10:00のような形式）を探す
      const timePattern = /(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})/g;
      let match;
      let taskIndex = 0;
      
      // より具体的な方法：visible elementsから直接タスクを抽出
      const taskElements = await this.page.locator('text=/\\d{1,2}:\\d{2}\\s*-\\s*\\d{1,2}:\\d{2}/').all();
      console.log(`[Fetcher] getTaskData: 時間パターンで${taskElements.length}個の要素が見つかりました`);
      
      for (const timeElement of taskElements) {
        try {
          const timeText = await timeElement.textContent();
          console.log(`[Fetcher] getTaskData: 時間要素: ${timeText}`);
          
          // 基本的なタスク情報を抽出（タイトルは時間のまま）
          const timeParts = timeText?.match(/(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})/);
          if (timeParts) {
            tasks.push({
              id: `task-${taskIndex++}`,
              title: `タスク ${timeParts[1]}-${timeParts[2]}`,
              status: 'unknown',
              startTime: timeParts[1],
              endTime: timeParts[2],
              category: '',
              description: '',
            });
          }
        } catch (error) {
          console.log(`[Fetcher] getTaskData: 要素処理エラー: ${error}`);
        }
      }
      console.log(`[Fetcher] getTaskData: 4. データ抽出が完了。${tasks.length}件のタスクを抽出しました。`);

      if (tasks.length === 0) {
          console.log("[Fetcher] getTaskData: タスクが見つからなかったため、スクリーンショットを保存します。");
          await this.takeScreenshot('no-tasks-found.png');
          return { success: false, error: "Data extraction failed: No tasks found on the page. Saved screenshot to no-tasks-found.png" };
      }

      return { success: true, tasks };

    } catch (error) {
      console.error(`[Fetcher] getTaskData: エラー発生 - ${(error as Error).stack}`);
      await this.takeScreenshot('error-screenshot.png');
      return { success: false, error: (error as Error).message };
    } finally {
      console.log("[Fetcher] getTaskData: 終了");
    }
  }

  getCurrentUrl(): string {
    return this.page?.url() || "No page";
  }

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

  async saveHTMLToFile(html: string, filePath: string): Promise<SaveResult> {
    try {
      await ensureDir(filePath.substring(0, filePath.lastIndexOf('/')));
      await Deno.writeTextFile(filePath, html);
      return { success: true, filePath };

    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  }

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