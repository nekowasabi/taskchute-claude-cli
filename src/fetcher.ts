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
  estimatedTime?: string;
  actualTime?: string;
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
      
      let taskIndex = 0;
      
      // より具体的な方法：指定されたMuiStackクラス以下のタスクを抽出
      const taskStackElements = await this.page.locator('div.MuiStack-root.my-csffzd').all();
      console.log(`[Fetcher] getTaskData: MuiStack-root my-csffzd で${taskStackElements.length}個の要素が見つかりました`);
      
      // 各MuiStackコンテナの内容を確認
      for (let i = 0; i < Math.min(taskStackElements.length, 3); i++) {
        try {
          const stackText = await taskStackElements[i].textContent();
          console.log(`[Fetcher] getTaskData: MuiStack[${i}] 内容: ${stackText?.substring(0, 200)}...`);
        } catch (error) {
          console.log(`[Fetcher] getTaskData: MuiStack[${i}] 内容取得エラー: ${error}`);
        }
      }
      
      // より具体的な方法：新しいタスク形式でvisible elementsから直接タスクを抽出
      // 実際の形式: "23:59 07:59 瞑想しておやすみなさい（ ；´ワ ｀；） 00:00 07:10"
      const taskElements = await this.page.locator('text=/\\d{1,2}:\\d{2}\\s+\\d{1,2}:\\d{2}\\s+\\S+/').all();
      console.log(`[Fetcher] getTaskData: 新タスクパターンで${taskElements.length}個の要素が見つかりました`);
      
      // 古いハイフン形式のフォールバック対応も追加
      const oldFormatElements = await this.page.locator('text=/\\d{1,2}:\\d{2}\\s*-\\s*\\d{1,2}:\\d{2}/').all();
      console.log(`[Fetcher] getTaskData: 旧形式パターンで${oldFormatElements.length}個の要素が見つかりました`);
      
      // MuiStack内の新形式タスクを優先的に探す（セレクタ構文を修正）
      const stackTaskElements = await this.page.locator('div.MuiStack-root.my-csffzd').locator('text=/\\d{1,2}:\\d{2}\\s+\\d{1,2}:\\d{2}\\s+\\S+/').all();
      console.log(`[Fetcher] getTaskData: MuiStack内新形式で${stackTaskElements.length}個の要素が見つかりました`);
      
      // MuiStack内にタスクがある場合はそれを優先処理
      const targetElements = stackTaskElements.length > 0 ? stackTaskElements : taskElements;
      console.log(`[Fetcher] getTaskData: 処理対象要素数: ${targetElements.length} (MuiStack優先: ${stackTaskElements.length > 0})`);
      
      for (const timeElement of targetElements) {
        try {
          const timeText = await timeElement.textContent();
          console.log(`[Fetcher] getTaskData: 時間要素: ${timeText}`);
          
          // 新しいタスク形式を解析: "HH:MM HH:MM タスク名 HH:MM HH:MM"
          const taskPattern = /(\d{1,2}:\d{2})\s+(\d{1,2}:\d{2})\s+(.+?)\s+(\d{1,2}:\d{2})\s+(\d{1,2}:\d{2})/;
          const taskMatch = timeText?.match(taskPattern);
          if (taskMatch) {
            const [, startTime, endTime, taskName, estimatedTime, actualTime] = taskMatch;
            console.log(`[Fetcher] getTaskData: タスク${taskIndex}の詳細解析を開始: ${startTime} ${endTime} "${taskName}" ${estimatedTime} ${actualTime}`);
            
            // 新形式では既にタスク名と時間情報が抽出済み
            let detailedTitle = taskName.trim();
            let taskStatus = 'unknown';
            let category = '';
            
            // タスク名のクリーンアップ
            if (detailedTitle) {
              // 前後の余分な文字を削除
              detailedTitle = detailedTitle.replace(/^[\d\s\-\/]+|[\d\s\-\/]+$/g, '').trim();
              
              // 特殊文字や絵文字を含む場合はそのまま保持
              if (detailedTitle.length === 0) {
                detailedTitle = `タスク ${startTime}-${endTime}`;
              }
            }
            
            // タスクステータスの推定
            if (detailedTitle.includes('完了') || detailedTitle.includes('終了')) {
              taskStatus = 'completed';
            } else if (detailedTitle.includes('進行中') || detailedTitle.includes('実行中')) {
              taskStatus = 'in-progress';
            } else if (detailedTitle.includes('予定') || detailedTitle.includes('未開始')) {
              taskStatus = 'pending';
            } else {
              // 現在時刻と比較してステータスを推定（簡易版）
              taskStatus = 'completed'; // デフォルト
            }
            
            tasks.push({
              id: `task-${taskIndex++}`,
              title: detailedTitle,
              status: taskStatus,
              startTime: startTime,
              endTime: endTime,
              category: category,
              estimatedTime: estimatedTime,
              actualTime: actualTime,
              description: '',
            });
            
            console.log(`[Fetcher] getTaskData: タスク${taskIndex-1}の詳細データを保存しました: "${detailedTitle}" (${startTime}-${endTime})`);
          }
        } catch (error) {
          console.log(`[Fetcher] getTaskData: 要素処理エラー: ${error}`);
        }
      }
      
      // MuiStackから直接タスクを抽出する処理を追加
      if (tasks.length === 0 && taskStackElements.length > 0) {
        console.log(`[Fetcher] getTaskData: 通常パターンでタスクが見つからないため、MuiStackから直接抽出を開始`);
        
        for (const stackElement of taskStackElements) {
          try {
            const stackText = await stackElement.textContent();
            console.log(`[Fetcher] getTaskData: MuiStack要素: ${stackText?.substring(0, 300)}...`);
            
            // MuiStack内の全ての時間パターンを探す
            const timeMatches = stackText?.match(/\d{1,2}:\d{2}/g);
            if (timeMatches && timeMatches.length >= 2) {
              // 基本パターン: 開始時間 終了時間 タスク名 見積時間 実時間
              if (timeMatches.length >= 4) {
                const [startTime, endTime, estimatedTime, actualTime] = timeMatches;
                
                // タスク名を抽出（時間以外のテキスト部分）
                let taskName = stackText || '';
                // 時間情報を除去してタスク名を抽出
                taskName = taskName.replace(/\d{1,2}:\d{2}/g, '').replace(/\s+/g, ' ').trim();
                // 数字のみの部分を除去
                taskName = taskName.replace(/^\d+|\d+$/g, '').trim();
                // --:-- を除去
                taskName = taskName.replace(/--:--/g, '').trim();
                
                // ダッシュボード情報や無効なタスクを除外
                const isValidTask = taskName.length > 0 && taskName.length < 100 && 
                                  !taskName.includes('終了予定') && 
                                  !taskName.includes('現在：') && 
                                  !taskName.includes('開始遅延見込') && 
                                  !taskName.includes('タスク数') &&
                                  !taskName.includes('ABDEFGHI');
                
                if (isValidTask) {
                  tasks.push({
                    id: `muistack-task-${tasks.length}`,
                    title: taskName,
                    status: 'unknown',
                    startTime: startTime,
                    endTime: endTime,
                    category: '',
                    estimatedTime: estimatedTime,
                    actualTime: actualTime,
                    description: '',
                  });
                  
                  console.log(`[Fetcher] getTaskData: MuiStackタスクを追加: "${taskName}" (${startTime}-${endTime})`);
                } else {
                  console.log(`[Fetcher] getTaskData: 無効なタスクをスキップ: "${taskName}"`);
                }
              }
            }
          } catch (error) {
            console.log(`[Fetcher] getTaskData: MuiStack要素処理エラー: ${error}`);
          }
        }
      }
      
      // 新形式で見つからない場合の旧形式フォールバック処理（詳細情報抽出付き）
      if (tasks.length === 0 && oldFormatElements.length > 0) {
        console.log(`[Fetcher] getTaskData: 新形式でタスクが見つからないため、旧形式でフォールバック処理を開始`);
        
        for (const oldElement of oldFormatElements) {
          try {
            const oldTimeText = await oldElement.textContent();
            console.log(`[Fetcher] getTaskData: 旧形式要素: ${oldTimeText}`);
            
            // 基本的なタスク情報を抽出（旧形式）
            const timeParts = oldTimeText?.match(/(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})/);
            if (timeParts) {
              let detailedTitle = `タスク ${timeParts[1]}-${timeParts[2]}`;
              let estimatedTime = '';
              let actualTime = '';
              let taskStatus = 'unknown';
              
              // 周辺のDOM構造から詳細情報を抽出
              for (let level = 1; level <= 4; level++) {
                try {
                  const containerElement = oldElement.locator(`xpath=ancestor::*[contains(@class, "MuiStack") or contains(@class, "MuiBox") or contains(@class, "MuiGrid") or contains(@class, "MuiContainer")][${level}]`);
                  const containerText = await containerElement.textContent({ timeout: 3000 });
                  console.log(`[Fetcher] getTaskData: 旧形式 レベル${level} コンテナテキスト: ${containerText?.substring(0, 200)}...`);
                  
                  if (!containerText) continue;
                  
                  // 1. タスク名を抽出（日本語文字を含むテキスト）
                  if (detailedTitle.includes('タスク')) {
                    // 時間の後にある日本語テキストを探す
                    const afterTimePattern = new RegExp(`${timeParts[1].replace(':', '\\\\:')}\\\\s*-\\\\s*${timeParts[2].replace(':', '\\\\:')}\\\\s*([^\\\\d\\\\n]+?)(?:\\\\s*\\\\d{1,2}:\\\\d{2}|$|\\\\n)`, 'i');
                    const afterTimeMatch = containerText.match(afterTimePattern);
                    
                    if (afterTimeMatch && afterTimeMatch[1]) {
                      const candidateTitle = afterTimeMatch[1].trim()
                        .replace(/^[\\/\\d\\s-]+|[\\/\\d\\s-]+$/g, '')
                        .replace(/\\s+/g, ' ')
                        .trim();
                      
                      if (candidateTitle.length > 0 && candidateTitle.length < 100 && !/^\\d+$/.test(candidateTitle)) {
                        detailedTitle = candidateTitle;
                        console.log(`[Fetcher] getTaskData: 旧形式 レベル${level} タイトル抽出成功: ${detailedTitle}`);
                      }
                    }
                    
                    // 日本語パターンでの抽出
                    const japanesePattern = /([ひ-ろァ-ヶー一-龯\\（\\）\\；\\´\\`\\ワ\\s]+)/g;
                    const japaneseMatches = containerText.match(japanesePattern);
                    
                    if (japaneseMatches && detailedTitle.includes('タスク')) {
                      for (const match of japaneseMatches) {
                        const cleanMatch = match.trim().replace(/^[\\/\\d\\s-]+|[\\/\\d\\s-]+$/g, '');
                        if (cleanMatch.length > 2 && cleanMatch.length < 80 && 
                            !cleanMatch.includes('見積') && !cleanMatch.includes('実時間') &&
                            !cleanMatch.includes('タスク')) {
                          detailedTitle = cleanMatch;
                          console.log(`[Fetcher] getTaskData: 旧形式 レベル${level} 日本語タイトル抽出: ${detailedTitle}`);
                          break;
                        }
                      }
                    }
                  }
                  
                  // 2. 詳細時間情報を抽出
                  const allTimeMatches = containerText.match(/\\d{1,2}:\\d{2}/g);
                  if (allTimeMatches && allTimeMatches.length >= 4) {
                    const startIndex = allTimeMatches.findIndex(time => time === timeParts[1]);
                    const endIndex = allTimeMatches.findIndex(time => time === timeParts[2]);
                    
                    if (startIndex !== -1 && endIndex !== -1) {
                      // 見積時間と実時間を推定（時間の順序で判定）
                      const remainingTimes = allTimeMatches.filter((time, idx) => idx !== startIndex && idx !== endIndex);
                      if (remainingTimes.length >= 2) {
                        estimatedTime = remainingTimes[0];
                        actualTime = remainingTimes[1];
                        console.log(`[Fetcher] getTaskData: 旧形式 レベル${level} 時間情報抽出: 見積=${estimatedTime}, 実時間=${actualTime}`);
                      }
                    }
                  }
                  
                  // 十分な情報が得られた場合は停止
                  if (!detailedTitle.includes('タスク') && (estimatedTime || actualTime)) {
                    console.log(`[Fetcher] getTaskData: 旧形式 レベル${level}で十分な情報取得、探索終了`);
                    break;
                  }
                  
                } catch (levelError) {
                  console.log(`[Fetcher] getTaskData: 旧形式 レベル${level} 解析エラー: ${levelError}`);
                }
              }
              
              tasks.push({
                id: `fallback-task-${tasks.length}`,
                title: detailedTitle,
                status: taskStatus,
                startTime: timeParts[1],
                endTime: timeParts[2],
                category: '',
                estimatedTime: estimatedTime,
                actualTime: actualTime,
                description: '',
              });
              
              console.log(`[Fetcher] getTaskData: 旧形式フォールバックタスクを追加: "${detailedTitle}" (${timeParts[1]}-${timeParts[2]})`);
            }
          } catch (error) {
            console.log(`[Fetcher] getTaskData: 旧形式要素処理エラー: ${error}`);
          }
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