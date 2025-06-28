import { chromium, firefox, webkit, Browser, Page, BrowserContext } from "playwright";
import { ensureDir } from "std/fs/mod.ts";
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
      userDataDir: options.userDataDir ?? ""
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
      await this.page!.goto("https://taskchute.cloud", {
        waitUntil: "networkidle",
        timeout: this.options.timeout
      });

      const currentUrl = this.page!.url();
      return { success: true, currentUrl };

    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  }

  async performGoogleLogin(credentials: LoginCredentials, mockOptions: { mock?: boolean } = {}): Promise<AuthResult> {
    if (mockOptions.mock) {
      return { success: true, finalUrl: "https://taskchute.cloud/taskchute" };
    }

    if (!this.page) {
      const browserResult = await this.launchBrowser();
      if (!browserResult.success) {
        return { success: false, error: browserResult.error };
      }
    }

    try {
      console.log("TaskChute Cloudのログインページに移動中...");
      await this.page!.goto("https://taskchute.cloud/auth/login/", {
        waitUntil: "networkidle",
        timeout: this.options.timeout
      });

      // ページが完全に読み込まれるまで少し待機
      await this.page!.waitForTimeout(2000);

      // Googleログインボタンを探してクリック
      console.log("Googleログインボタンを探しています...");
      
      // TaskChute CloudのGoogleログインボタンのより具体的なセレクタ
      // XPath: /html/body/div[4]/div/div[2]/div/button[1]/span[1]/svg を基にした正確なセレクタ
      const googleSelectors = [
        // 最も正確なセレクタ（XPath由来）
        'body > div:nth-child(4) > div > div:nth-child(2) > div > button:first-child',
        'div:nth-child(4) > div > div:nth-child(2) > div > button:first-child',
        'button:first-child:has(span svg)',
        'button:has(span:first-child svg)',
        
        // SVGアイコンを含むボタン
        'button:has(svg)',
        'button span svg',
        
        // テキストベースのセレクタ
        'button:has-text("GOOGLEでログイン")',
        'a:has-text("GOOGLEでログイン")', 
        'button:has-text("Googleでログイン")',
        'a:has-text("Googleでログイン")',
        'button:has-text("Google")',
        'a:has-text("Google")',
        
        // 属性ベースのセレクタ
        'button[aria-label*="Google"]',
        'a[href*="google"]',
        '[data-provider="google"]',
        '.google-login',
        '.auth-google',
        '.btn-google'
      ];

      let googleButton = null;
      for (const selector of googleSelectors) {
        try {
          googleButton = await this.page!.waitForSelector(selector, { timeout: 5000 });
          if (googleButton) {
            console.log(`Googleログインボタンが見つかりました (セレクタ: ${selector})`);
            break;
          }
        } catch {
          // 次のセレクタを試す
          continue;
        }
      }

      if (!googleButton) {
        console.log("CSSセレクタで見つからなかったため、XPathで検索を試行します...");
        
        // XPathで直接検索を試行
        const xpathSelectors = [
          '/html/body/div[4]/div/div[2]/div/button[1]',  // ボタン要素
          '//button[span/svg]',                         // SVGを含むボタン
          '//button[contains(., "Google")]',            // Googleを含むボタン
          '//button[contains(., "GOOGLE")]',            // GOOGLEを含むボタン
          '//div[4]/div/div[2]/div/button[1]'           // 相対XPath
        ];
        
        for (const xpath of xpathSelectors) {
          try {
            const elements = await this.page!.$x(xpath);
            if (elements.length > 0) {
              googleButton = elements[0];
              console.log(`Googleログインボタンが見つかりました (XPath: ${xpath})`);
              break;
            }
          } catch {
            continue;
          }
        }
      }

      if (!googleButton) {
        // ページのスクリーンショットを撮ってデバッグ情報を取得
        await this.page!.screenshot({ path: './tmp/claude/login-page-debug.png', fullPage: true });
        
        // ページ上のすべてのボタンとリンクを取得してログに出力
        const buttons = await this.page!.$$eval('button, a', elements => 
          elements.map(el => ({
            tagName: el.tagName,
            textContent: el.textContent?.trim(),
            className: el.className,
            href: el.getAttribute('href'),
            id: el.id
          }))
        );
        
        console.log("ページ上のボタン・リンク一覧:", JSON.stringify(buttons, null, 2));
        
        // さらに詳細なXPath情報を出力
        const xpathInfo = await this.page!.evaluate(() => {
          const buttons = document.querySelectorAll('button');
          return Array.from(buttons).map((btn, index) => {
            const xpath = `//button[${index + 1}]`;
            return {
              index,
              xpath,
              textContent: btn.textContent?.trim(),
              outerHTML: btn.outerHTML.substring(0, 200)
            };
          });
        });
        
        console.log("XPath詳細情報:", JSON.stringify(xpathInfo, null, 2));
        throw new Error("Googleログインボタンが見つかりませんでした。ページ構造を確認してください。");
      }
      
      // ポップアップウィンドウの待機を先に開始
      const popupPromise = this.page!.waitForEvent('popup');
      console.log("Googleログインボタンをクリックします");
      await googleButton.click();

      console.log("Google認証用のポップアップウィンドウを待機中...");
      const popupPage = await popupPromise;
      console.log("ポップアップウィンドウを検出しました。");

      // ポップアップ内のページが完全に読み込まれるのを待つ
      await popupPage.waitForLoadState();

      // これ以降の操作はポップアップページ(popupPage)に対して行う
      console.log("Google認証ページへの遷移を待機中...");
      await popupPage.waitForURL(/accounts\.google\.com/, { timeout: this.options.timeout });

      // メールアドレス入力
      console.log("メールアドレスを入力中...");
      await popupPage.waitForSelector('input[type="email"], input[name="identifier"]', { timeout: this.options.timeout });
      await popupPage.fill('input[type="email"], input[name="identifier"]', credentials.email);
      
      // 次へボタンをクリック
      const nextButton = await popupPage.waitForSelector('#identifierNext, button[type="submit"]:has-text("次へ"), button[type="submit"]:has-text("Next")', { timeout: this.options.timeout });
      await nextButton.click();
      console.log("メールアドレスを送信しました");

      // パスワード入力画面まで待機
      console.log("パスワード入力画面を待機中...");
      try {
        const passwordInput = await popupPage.waitForSelector('input[type="password"], input[name="password"]', { timeout: this.options.timeout });
        await passwordInput.fill(credentials.password);
        
        // ログインボタンをクリック
        const loginButton = await popupPage.waitForSelector('#passwordNext, button[type="submit"]:has-text("次へ"), button[type="submit"]:has-text("ログイン"), button[type="submit"]:has-text("Sign in")', { timeout: this.options.timeout });
        await loginButton.click();
        console.log("パスワードを送信しました");
      } catch (error) {
        console.error("パスワード入力または送信でエラーが発生しました。");
        await popupPage.screenshot({ path: './tmp/claude/password-page-timeout.png', fullPage: true });
        console.log("デバッグ用のスクリーンショットを ./tmp/claude/password-page-timeout.png に保存しました。");
        throw error;
      }

      // TaskChute Cloudにリダイレクトされるまで待機
      console.log("TaskChute Cloudへのリダイレクトを待機中...");
      
      // リダイレクトの可能性のあるURL待機（正確なリダイレクト先を最優先）
      const successUrls = [
        /taskchute\.cloud\/taskchute$/,     // 実際のリダイレクト先
        /taskchute\.cloud\/taskchute\//,    // 末尾スラッシュ付き
        /taskchute\.cloud\/dashboard/,
        /taskchute\.cloud\/app/,
        /taskchute\.cloud\/home/,
        /taskchute\.cloud\/$/,
        /taskchute\.cloud\/[^\/]*$/
      ];
      
      let finalUrl = "";
      let loginSuccess = false;
      
      // 複数のリダイレクト先URLを試す
      for (const urlPattern of successUrls) {
        try {
          await this.page!.waitForURL(urlPattern, { timeout: 10000 });
          finalUrl = this.page!.url();
          loginSuccess = true;
          console.log(`TaskChute Cloudへのリダイレクト成功: ${finalUrl}`);
          break;
        } catch {
          // 次のURLパターンを試す
          continue;
        }
      }
      
      // 明示的なURL待機が失敗した場合、一般的なTaskChute Cloudドメインで再試行
      if (!loginSuccess) {
        try {
          await this.page!.waitForURL(/taskchute\.cloud/, { timeout: this.options.timeout });
          finalUrl = this.page!.url();
          loginSuccess = true;
          console.log(`TaskChute Cloudドメインにリダイレクト: ${finalUrl}`);
        } catch {
          // 最終的な確認として現在のURLをチェック
          finalUrl = this.page!.url();
          if (finalUrl.includes('taskchute.cloud')) {
            loginSuccess = true;
            console.log(`TaskChute Cloudドメインを確認: ${finalUrl}`);
          }
        }
      }
      
      if (!loginSuccess) {
        console.error("TaskChute Cloudへのリダイレクトが確認できませんでした");
        console.log(`現在のURL: ${this.page!.url()}`);
        
        // デバッグ用にスクリーンショットを保存
        await this.page!.screenshot({ path: './tmp/claude/after-login-debug.png', fullPage: true });
        
        return { 
          success: false, 
          error: `ログイン後のリダイレクトが失敗しました。現在のURL: ${this.page!.url()}` 
        };
      }
      
      // ログイン成功後、ページが完全に読み込まれるまで待機
      await this.page!.waitForLoadState('networkidle', { timeout: 10000 });
      
      console.log(`ログイン完了: ${finalUrl}`);
      return { success: true, finalUrl };

    } catch (error) {
      const errorMessage = (error as Error).message;
      console.error("Google認証エラー:", errorMessage);
      
      if (errorMessage.includes("timeout")) {
        return { success: false, error: "認証がタイムアウトしました。ネットワーク接続とサイトの状態を確認してください。" };
      }
      
      return { success: false, error: `認証に失敗しました: ${errorMessage}` };
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
    if (mockOptions.mock) {
      const mockTasks: TaskData[] = [
        {
          id: "task-1",
          title: "Mock Task 1",
          status: "completed",
          description: "This is a mock task",
          startTime: "09:00",
          endTime: "10:00",
          duration: 60,
          category: "Work"
        },
        {
          id: "task-2",
          title: "Mock Task 2",
          status: "in-progress",
          description: "Another mock task",
          startTime: "10:00",
          endTime: "",
          duration: 0,
          category: "Personal"
        }
      ];

      return { success: true, tasks: mockTasks };
    }

    if (!this.page) {
      return { success: false, error: "No active browser page" };
    }

    try {
      // TaskChuteの実際のDOM構造に基づいてデータを取得
      const tasks = await this.page.evaluate(() => {
        const taskElements = (globalThis as any).document.querySelectorAll('.task-row, .task-item, [data-task-id]');
        const tasks: any[] = [];

        taskElements.forEach((element: any, index: number) => {
          const titleElement = element.querySelector('.task-title, .title, h3, h4');
          const statusElement = element.querySelector('.task-status, .status, [data-status]');
          const timeElement = element.querySelector('.task-time, .time, .duration');
          const categoryElement = element.querySelector('.task-category, .category, .tag');

          const task: any = {
            id: element.getAttribute('data-task-id') || `task-${index + 1}`,
            title: titleElement?.textContent?.trim() || `Task ${index + 1}`,
            status: statusElement?.textContent?.trim() || 'unknown',
            description: element.getAttribute('data-description') || '',
            startTime: timeElement?.textContent?.trim() || '',
            category: categoryElement?.textContent?.trim() || ''
          };

          tasks.push(task);
        });

        return tasks;
      });

      return { success: true, tasks };

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
      if (this.page) {
        await this.page.close();
        this.page = null;
      }

      if (this.browser) {
        await this.browser.close();
        this.browser = null;
      }

      return { success: true };

    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  }
}