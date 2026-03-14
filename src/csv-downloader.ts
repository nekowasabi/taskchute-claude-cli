/**
 * CSVDownloader - APIインターセプト方式によるCSVダウンロード
 *
 * waitForResponseを使用してダウンロードの安定性を向上させる。
 */
import { Page, Locator, Response } from "playwright";
import { ensureDir } from "std/fs/mod.ts";
import { TaskData } from "./types.ts";
import { TaskChuteCsvParser } from "./csv-parser.ts";

/**
 * CSVダウンローダーの設定
 */
export interface CSVDownloaderConfig {
  /** ダウンロードタイムアウト（ミリ秒） */
  downloadTimeout: number;
  /** React待機時間（ミリ秒） */
  reactWaitTime: number;
  /** スケルトン待機時間（ミリ秒） */
  skeletonWaitTime: number;
  /** 日付入力後の待機時間（ミリ秒） */
  dateInputWaitTime: number;
}

/**
 * CSVダウンロード結果
 */
export interface CSVDownloadResult {
  success: boolean;
  csvContent?: string;
  downloadPath?: string;
  taskCount?: number;
  tasks?: TaskData[];
  error?: string;
}

/**
 * レスポンスライクオブジェクト（テスト用）
 */
export interface ResponseLike {
  url: () => string;
  headers: () => Record<string, string>;
}

/**
 * 日付入力戦略
 */
export interface DateInputStrategy {
  name: string;
  execute: (input: Locator, date: string, page: Page) => Promise<boolean>;
}

/**
 * 成功結果を生成
 */
export function createSuccessResult(options: {
  csvContent?: string;
  downloadPath?: string;
  taskCount?: number;
  tasks?: TaskData[];
}): CSVDownloadResult {
  return {
    success: true,
    csvContent: options.csvContent,
    downloadPath: options.downloadPath,
    taskCount: options.taskCount,
    tasks: options.tasks
  };
}

/**
 * 失敗結果を生成
 */
export function createFailureResult(error: string): CSVDownloadResult {
  return {
    success: false,
    error
  };
}

/**
 * APIインターセプト方式によるCSVダウンローダー
 *
 * @example
 * ```typescript
 * const downloader = new CSVDownloader();
 * const result = await downloader.downloadCSV(page, {
 *   fromDate: "2025-06-01",
 *   toDate: "2025-06-30"
 * });
 * ```
 */
export class CSVDownloader {
  private config: CSVDownloaderConfig;
  private parser: TaskChuteCsvParser;

  constructor(config: Partial<CSVDownloaderConfig> = {}) {
    this.config = {
      downloadTimeout: config.downloadTimeout ?? 30000,
      reactWaitTime: config.reactWaitTime ?? 1000,
      skeletonWaitTime: config.skeletonWaitTime ?? 10000,
      dateInputWaitTime: config.dateInputWaitTime ?? 500
    };
    this.parser = new TaskChuteCsvParser();
  }

  /**
   * 設定を取得
   */
  getConfig(): CSVDownloaderConfig {
    return { ...this.config };
  }

  /**
   * 日付をYYYYMMDD形式にフォーマット
   */
  formatDate(date: string): string {
    // 既にYYYYMMDD形式の場合
    if (/^\d{8}$/.test(date)) {
      return date;
    }
    // YYYY-MM-DD形式の場合
    return date.replace(/-/g, "");
  }

  /**
   * 今日の日付をYYYYMMDD形式で取得
   */
  getDefaultDate(): string {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, "0");
    const day = String(today.getDate()).padStart(2, "0");
    return `${year}${month}${day}`;
  }

  /**
   * Reactのレンダリング完了を待機
   */
  async waitForReactReady(page: Page): Promise<void> {
    // スケルトンローダーの消失を待機
    try {
      await page.waitForSelector(".MuiSkeleton-root", {
        state: "hidden",
        timeout: this.config.skeletonWaitTime
      });
    } catch {
      // スケルトンがない場合は無視
    }

    // DOMの読み込み完了を待機（loadはSPAで無限待機になるためdomcontentloadedを使用）
    await page.waitForLoadState("domcontentloaded", { timeout: 10000 }).catch(() => {
      // タイムアウトしても処理を継続
    });

    // 追加の安定化待機（Reactの非同期レンダリング完了のため）
    await page.waitForTimeout(this.config.reactWaitTime);
  }

  /**
   * レスポンスがCSVかどうかを判定
   */
  isCSVResponse(response: ResponseLike): boolean {
    const url = response.url();
    const headers = response.headers();
    const contentType = headers["content-type"] || "";

    // URLにcsvまたはexportが含まれる場合
    const isCSVUrl = url.includes("csv") || url.includes("export");

    // Content-Typeがtext/csvの場合
    const isCSVContentType = contentType.includes("text/csv");

    return isCSVUrl || isCSVContentType;
  }

  /**
   * 日付入力戦略のリストを取得
   */
  getDateInputStrategies(): DateInputStrategy[] {
    return [
      {
        name: "fill",
        execute: async (input, date, page) => {
          await input.click();
          await input.fill(date);
          await page.waitForTimeout(this.config.dateInputWaitTime);
          const value = await input.inputValue();
          return value === date || value.replace(/\//g, "") === date;
        }
      },
      {
        name: "keyboard",
        execute: async (input, date, page) => {
          await input.click();
          await page.keyboard.press("Control+a");
          await page.keyboard.type(date, { delay: 50 });
          await page.waitForTimeout(this.config.dateInputWaitTime);
          const value = await input.inputValue();
          return value === date || value.replace(/\//g, "") === date;
        }
      },
      {
        name: "clear-and-type",
        execute: async (input, date, page) => {
          await input.click();
          await input.fill("");
          await input.type(date);
          await page.waitForTimeout(this.config.dateInputWaitTime);
          const value = await input.inputValue();
          return value === date || value.replace(/\//g, "") === date;
        }
      },
      {
        name: "evaluate",
        execute: async (input, date, page) => {
          await input.evaluate((el: HTMLInputElement, val: string) => {
            el.value = val;
            el.dispatchEvent(new Event("input", { bubbles: true }));
            el.dispatchEvent(new Event("change", { bubbles: true }));
            el.dispatchEvent(new Event("blur", { bubbles: true }));
          }, date);
          await page.waitForTimeout(this.config.dateInputWaitTime);
          const value = await input.inputValue();
          return value === date || value.replace(/\//g, "") === date;
        }
      }
    ];
  }

  /**
   * 安定した日付入力を実行
   */
  async setDateStable(input: Locator, date: string, page: Page): Promise<boolean> {
    const strategies = this.getDateInputStrategies();

    for (const strategy of strategies) {
      console.log(`[CSVDownloader] 日付入力戦略を試行: ${strategy.name}`);
      try {
        const success = await strategy.execute(input, date, page);
        if (success) {
          console.log(`[CSVDownloader] 日付入力成功: ${strategy.name}`);
          return true;
        }
      } catch (error) {
        console.log(`[CSVDownloader] 日付入力失敗: ${strategy.name} - ${error}`);
      }
    }

    return false;
  }

  /**
   * CSVコンテンツをパース
   */
  parseCSVContent(content: string): TaskData[] {
    try {
      // BOMを除去
      const cleanContent = content.replace(/^\uFEFF/, "");

      // 簡易CSVパース（ヘッダー行をスキップ）
      const lines = cleanContent.split("\n");
      if (lines.length < 2) {
        return [];
      }

      const tasks: TaskData[] = [];
      // ヘッダー行をスキップして処理
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        // CSV行をパース（ダブルクォートを考慮）
        const fields = this.parseCSVLine(line);
        if (fields.length >= 5) {
          // 基本的なフィールド抽出
          // フォーマット: タイムライン日付,タスクID,タスク名,プロジェクトID,プロジェクト名,...
          const task: TaskData = {
            id: fields[1] || `task-${i}`,
            title: fields[2] || "",
            status: fields[14] ? "completed" : (fields[13] ? "in_progress" : "pending"),
            description: fields[4] || "",
            startTime: fields[13] || undefined,
            endTime: fields[14] || undefined,
            estimatedTime: fields[11] || undefined,
            actualTime: fields[12] || undefined,
            category: fields[4] || undefined
          };

          if (task.title) {
            tasks.push(task);
          }
        }
      }

      return tasks;
    } catch (error) {
      console.error("[CSVDownloader] CSVパースエラー:", error);
      return [];
    }
  }

  /**
   * CSV行をパース（ダブルクォートを考慮）
   */
  private parseCSVLine(line: string): string[] {
    const result: string[] = [];
    let current = "";
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];

      if (char === '"') {
        if (inQuotes && line[i + 1] === '"') {
          // エスケープされたダブルクォート
          current += '"';
          i++;
        } else {
          // クォートの開始/終了
          inQuotes = !inQuotes;
        }
      } else if (char === "," && !inQuotes) {
        result.push(current);
        current = "";
      } else {
        current += char;
      }
    }

    result.push(current);
    return result;
  }

  /**
   * APIインターセプト方式でCSVをダウンロード
   */
  async downloadCSV(
    page: Page,
    options: {
      fromDate?: string;
      toDate?: string;
      outputDir?: string;
    } = {}
  ): Promise<CSVDownloadResult> {
    const startDate = this.formatDate(options.fromDate || this.getDefaultDate());
    const endDate = this.formatDate(options.toDate || this.getDefaultDate());
    const outputDir = options.outputDir || "tmp/claude";

    try {
      // Step 1: CSVエクスポートページに移動
      console.log("[CSVDownloader] CSVエクスポートページに移動中...");
      // React SPAではnetworkidleは到達しないため、domcontentloadedを使用
      await page.goto("https://taskchute.cloud/export/csv-export", {
        waitUntil: "domcontentloaded",
        timeout: this.config.downloadTimeout
      });

      // Step 2: Reactの初期化を待機
      console.log("[CSVDownloader] React初期化を待機中...");
      await this.waitForReactReady(page);

      // Step 3: デバッグ: ページHTMLを保存してDOM構造を確認
      const debugHtmlPath = `${options.outputDir || "tmp/claude"}/debug-csv-export-page.html`;
      try {
        await ensureDir(options.outputDir || "tmp/claude");
        const html = await page.content();
        await Deno.writeTextFile(debugHtmlPath, html);
        console.log(`[CSVDownloader][DEBUG] ページHTML保存: ${debugHtmlPath} (${html.length}文字)`);
      } catch (e) {
        console.log(`[CSVDownloader][DEBUG] ページHTML保存失敗: ${e}`);
      }

      // Step 4: MUI DateRangePicker v6 に日付を入力
      console.log(`[CSVDownloader] 日付を入力中: ${startDate} - ${endDate}`);
      const dateRangeResult = await this.setDateRange(page, startDate, endDate);
      console.log(`[CSVDownloader][DEBUG] setDateRange 結果: ${dateRangeResult}`);

      if (!dateRangeResult) {
        // フォールバック: 従来の input 要素ベースの入力を試みる
        console.log(`[CSVDownloader][DEBUG] setDateRange 失敗。従来方式にフォールバック`);
        const dateInputs = await this.findDateInputs(page);
        console.log(`[CSVDownloader][DEBUG] 日付入力フィールド数: ${dateInputs.length}`);
        if (dateInputs.length >= 2) {
          const fromResult = await this.setDateStable(dateInputs[0], startDate, page);
          const toResult = await this.setDateStable(dateInputs[1], endDate, page);
          console.log(`[CSVDownloader][DEBUG] 従来方式 日付入力結果: from=${fromResult}, to=${toResult}`);
        } else {
          console.log(`[CSVDownloader][DEBUG] 日付入力フィールドが2つ未満のため日付入力をスキップ`);
        }
      }

      // 日付ピッカーを閉じる
      await page.keyboard.press("Escape");
      await page.click("body", { position: { x: 10, y: 10 } });
      await page.waitForTimeout(500);

      // ダウンロードボタンの状態を事前確認
      const preButton = await this.findDownloadButton(page);
      if (preButton) {
        const preDisabled = await preButton.isDisabled().catch(() => false);
        console.log(`[CSVDownloader][DEBUG] 日付入力後のダウンロードボタン: disabled=${preDisabled}`);
      }

      // Step 5: APIレスポンスのインターセプト準備 + ダウンロードボタンクリック
      console.log("[CSVDownloader] ダウンロードを開始中...");

      // ダウンロードボタンを検索
      const downloadButton = await this.findDownloadButton(page);
      if (!downloadButton) {
        return createFailureResult("ダウンロードボタンが見つかりません");
      }

      // APIレスポンス監視とダウンロードイベント監視を並行
      const downloadResult = await this.executeDownload(
        page,
        downloadButton,
        outputDir
      );

      return downloadResult;

    } catch (error) {
      console.error(`[CSVDownloader] エラー: ${error}`);
      return createFailureResult((error as Error).message);
    }
  }

  /**
   * MUI DateRangePicker v6 の contenteditable span に日付範囲を入力
   *
   * DOM構造:
   *   <span contenteditable="true" role="spinbutton" data-range-position="start" aria-label="年">YYYY</span>
   *   <span ... data-range-position="start" aria-label="月">MM</span>
   *   <span ... data-range-position="start" aria-label="日">DD</span>
   *   <span ... data-range-position="end" aria-label="年">YYYY</span>
   *   <span ... data-range-position="end" aria-label="月">MM</span>
   *   <span ... data-range-position="end" aria-label="日">DD</span>
   */
  async setDateRange(
    page: Page,
    startDateYYYYMMDD: string,
    endDateYYYYMMDD: string
  ): Promise<boolean> {
    const startYear = startDateYYYYMMDD.substring(0, 4);
    const startMonth = startDateYYYYMMDD.substring(4, 6);
    const startDay = startDateYYYYMMDD.substring(6, 8);
    const endYear = endDateYYYYMMDD.substring(0, 4);
    const endMonth = endDateYYYYMMDD.substring(4, 6);
    const endDay = endDateYYYYMMDD.substring(6, 8);

    console.log(`[CSVDownloader][DEBUG] setDateRange: start=${startYear}/${startMonth}/${startDay}, end=${endYear}/${endMonth}/${endDay}`);

    const selector = '.MuiPickersSectionList-sectionContent[data-range-position]';

    // セクション数を確認
    const sectionCount = await page.locator(selector).count().catch(() => 0);
    console.log(`[CSVDownloader][DEBUG] MUI DateRangePicker セクション数: ${sectionCount}`);

    if (sectionCount === 0) {
      console.log(`[CSVDownloader][DEBUG] MUI DateRangePicker のセクションが見つかりません`);
      return false;
    }

    // 各セクションの情報をデバッグ出力
    const allSections = await page.locator(selector).all();
    for (let i = 0; i < allSections.length; i++) {
      const pos = await allSections[i].getAttribute("data-range-position").catch(() => null);
      const label = await allSections[i].getAttribute("aria-label").catch(() => null);
      const text = await allSections[i].textContent().catch(() => null);
      console.log(`[CSVDownloader][DEBUG]   section[${i}]: position=${pos}, aria-label=${label}, text="${text}"`);
    }

    try {
      // MUI DateRangePicker v6 は値を入力すると自動的に次のセクションにフォーカスが移動する
      // そのため、最初のセクションだけクリックし、以降はそのまま連続入力する

      // 開始日の年セクションをクリックしてフォーカスを取得
      const startYearSection = page.locator('.MuiPickersSectionList-sectionContent[data-range-position="start"][aria-label="年"]').first();
      console.log(`[CSVDownloader][DEBUG] 開始日の年セクションをクリック`);
      await startYearSection.click();
      await page.waitForTimeout(200);

      // 年→月→日→(end)年→月→日 の順に連続入力（フォーカスは自動移動）
      const values = [
        { value: startYear, label: "start-year" },
        { value: startMonth, label: "start-month" },
        { value: startDay, label: "start-day" },
        { value: endYear, label: "end-year" },
        { value: endMonth, label: "end-month" },
        { value: endDay, label: "end-day" },
      ];

      for (const { value, label } of values) {
        console.log(`[CSVDownloader][DEBUG] 入力: ${label}="${value}"`);
        await page.keyboard.type(value, { delay: 30 });
        await page.waitForTimeout(200);
      }

      // 入力後の状態を確認
      const allSectionsAfter = await page.locator('.MuiPickersSectionList-sectionContent[data-range-position]').all();
      for (let i = 0; i < allSectionsAfter.length; i++) {
        const pos = await allSectionsAfter[i].getAttribute("data-range-position").catch(() => null);
        const label = await allSectionsAfter[i].getAttribute("aria-label").catch(() => null);
        const text = await allSectionsAfter[i].textContent().catch(() => null);
        console.log(`[CSVDownloader][DEBUG] 入力後 section[${i}]: position=${pos}, label=${label}, text="${text}"`);
      }

      console.log(`[CSVDownloader][DEBUG] setDateRange 完了`);
      return true;
    } catch (error) {
      console.log(`[CSVDownloader][DEBUG] setDateRange エラー: ${error}`);
      return false;
    }
  }

  /**
   * 日付入力フィールドを検索
   */
  private async findDateInputs(page: Page): Promise<Locator[]> {
    const allInputs = await page.locator("input").all();
    const dateInputs: Locator[] = [];

    for (const input of allInputs) {
      const placeholder = await input.getAttribute("placeholder");
      const type = await input.getAttribute("type");
      const value = await input.getAttribute("value");

      if (
        placeholder?.includes("YYYY") ||
        placeholder?.includes("MM") ||
        placeholder?.includes("DD") ||
        type === "date" ||
        placeholder?.includes("/") ||
        value?.includes("/")
      ) {
        dateInputs.push(input);
      }
    }

    return dateInputs;
  }

  /**
   * ダウンロードボタンを検索
   */
  private async findDownloadButton(page: Page): Promise<Locator | null> {
    const selectors = [
      'button:has([data-testid="FileDownloadIcon"])',
      'button.MuiButton-root:has-text("ダウンロード")',
      'button:has-text("ダウンロード")',
      'button:has-text("Download")',
      'button:has(svg[data-testid="FileDownloadIcon"])'
    ];

    for (const selector of selectors) {
      try {
        const button = page.locator(selector).first();
        if (await button.isVisible({ timeout: 1000 })) {
          return button;
        }
      } catch {
        // 次のセレクタを試す
      }
    }

    return null;
  }

  /**
   * ダウンロードを実行
   */
  private async executeDownload(
    page: Page,
    downloadButton: Locator,
    outputDir: string
  ): Promise<CSVDownloadResult> {
    // 出力ディレクトリを確保
    await ensureDir(outputDir);

    // 個別タイムアウトを短縮（全体のdownloadTimeoutより短く設定）
    const individualTimeout = Math.min(this.config.downloadTimeout, 10000);
    console.log(`[CSVDownloader][DEBUG] individualTimeout=${individualTimeout}ms, outputDir=${outputDir}`);

    // ネットワークリクエストを監視（デバッグ用）
    page.on("response", (response: Response) => {
      const url = response.url();
      const status = response.status();
      const contentType = response.headers()["content-type"] || "";
      // csv/export/download関連のURLのみログ出力
      if (url.includes("csv") || url.includes("export") || url.includes("download") || contentType.includes("csv")) {
        console.log(`[CSVDownloader][DEBUG] Response: ${status} ${url} (content-type: ${contentType})`);
      }
    });

    // ダウンロードボタンの状態を確認
    const buttonText = await downloadButton.textContent().catch(() => "(取得失敗)");
    const buttonDisabled = await downloadButton.isDisabled().catch(() => false);
    const buttonVisible = await downloadButton.isVisible().catch(() => false);
    console.log(`[CSVDownloader][DEBUG] ダウンロードボタン: text="${buttonText}", disabled=${buttonDisabled}, visible=${buttonVisible}`);

    // 方法1: waitForResponseでAPIレスポンスをキャッチ
    console.log(`[CSVDownloader][DEBUG] waitForResponse + waitForEvent("download") を開始...`);
    const responsePromise = page.waitForResponse(
      (response: Response) => {
        const matched = this.isCSVResponse(response);
        if (matched) {
          console.log(`[CSVDownloader][DEBUG] isCSVResponse=true: ${response.url()}`);
        }
        return matched;
      },
      { timeout: individualTimeout }
    ).then((r) => ({ type: "response" as const, value: r })).catch((e) => {
      console.log(`[CSVDownloader][DEBUG] waitForResponse タイムアウト/エラー: ${e}`);
      return null;
    });

    // 方法2: downloadイベントを監視
    const downloadPromise = page.waitForEvent("download", {
      timeout: individualTimeout
    }).then((d) => {
      console.log(`[CSVDownloader][DEBUG] downloadイベント発火: ${d.suggestedFilename()}`);
      return { type: "download" as const, value: d };
    }).catch((e) => {
      console.log(`[CSVDownloader][DEBUG] waitForEvent("download") タイムアウト/エラー: ${e}`);
      return null;
    });

    // ダウンロードボタンをクリック
    try {
      console.log("[CSVDownloader][DEBUG] ボタンクリック実行中...");
      await downloadButton.click();
      console.log("[CSVDownloader][DEBUG] ボタンクリック成功");
    } catch (clickError) {
      console.log(`[CSVDownloader][DEBUG] 通常クリック失敗: ${clickError}, JS経由でクリック`);
      // 通常のクリックが失敗した場合、JavaScript経由でクリック
      await downloadButton.evaluate((el) => (el as HTMLButtonElement).click());
      console.log("[CSVDownloader][DEBUG] JSクリック成功");
    }

    // いずれか早い方のレスポンスを取得
    console.log("[CSVDownloader][DEBUG] Promise.race 待機中...");
    const firstResult = await Promise.race([responsePromise, downloadPromise]);
    console.log(`[CSVDownloader][DEBUG] Promise.race 結果: type=${firstResult?.type ?? "null"}`);

    // 型の安全な分解
    const apiResponse = firstResult?.type === "response" ? firstResult.value : null;
    const downloadEvent = firstResult?.type === "download" ? firstResult.value : null;

    // APIレスポンスが取得できた場合
    if (apiResponse) {
      console.log(`[CSVDownloader][DEBUG] APIレスポンス取得: url=${apiResponse.url()}, status=${apiResponse.status()}`);
      const csvContent = await apiResponse.text();
      console.log(`[CSVDownloader][DEBUG] レスポンスボディ: ${csvContent.length}文字, 先頭100文字: ${csvContent.substring(0, 100)}`);
      const savePath = `${outputDir}/taskchute-export-${Date.now()}.csv`;
      await Deno.writeTextFile(savePath, csvContent);

      const tasks = this.parseCSVContent(csvContent);
      return createSuccessResult({
        csvContent,
        downloadPath: savePath,
        taskCount: tasks.length,
        tasks
      });
    }

    // downloadイベントが取得できた場合
    if (downloadEvent) {
      console.log("[CSVDownloader] ダウンロードイベントをキャッチしました");
      const suggestedFilename = downloadEvent.suggestedFilename() || "taskchute-export.csv";
      const savePath = `${outputDir}/${suggestedFilename}`;
      await downloadEvent.saveAs(savePath);

      const csvContent = await Deno.readTextFile(savePath);
      const tasks = this.parseCSVContent(csvContent);
      return createSuccessResult({
        csvContent,
        downloadPath: savePath,
        taskCount: tasks.length,
        tasks
      });
    }

    // フォールバック: ダウンロードディレクトリを確認
    console.log("[CSVDownloader] フォールバック: ダウンロードディレクトリを確認中...");
    // デバッグ: ページのURLと現在のDOM状態を確認
    console.log(`[CSVDownloader][DEBUG] 現在のページURL: ${page.url()}`);
    const downloadDir = `${Deno.env.get("HOME")}/Downloads`;
    try {
      const dirFiles: string[] = [];
      for await (const entry of Deno.readDir(downloadDir)) {
        const stat = await Deno.stat(`${downloadDir}/${entry.name}`).catch(() => null);
        const mtime = stat?.mtime ? stat.mtime.toISOString() : "unknown";
        dirFiles.push(`${entry.name} (mtime: ${mtime})`);
      }
      console.log(`[CSVDownloader][DEBUG] ~/Downloads内ファイル数: ${dirFiles.length}`);
      // 最新5件を表示
      dirFiles.slice(0, 5).forEach(f => console.log(`[CSVDownloader][DEBUG]   ${f}`));
    } catch (e) {
      console.log(`[CSVDownloader][DEBUG] ~/Downloadsの読み取りエラー: ${e}`);
    }
    return await this.checkDownloadDirectory(outputDir);
  }

  /**
   * ダウンロードディレクトリをチェック
   */
  private async checkDownloadDirectory(outputDir: string): Promise<CSVDownloadResult> {
    const downloadDir = `${Deno.env.get("HOME")}/Downloads`;
    const checkStartTime = Date.now();

    try {
      const files = Deno.readDir(downloadDir);
      const recentFiles: Array<{ name: string; path: string; mtime: number }> = [];

      for await (const file of files) {
        if (
          file.name.endsWith(".csv") ||
          /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(file.name)
        ) {
          const filePath = `${downloadDir}/${file.name}`;
          const stat = await Deno.stat(filePath);
          if (stat.mtime) {
            recentFiles.push({
              name: file.name,
              path: filePath,
              mtime: stat.mtime.getTime()
            });
          }
        }
      }

      // 最新のファイルを確認
      recentFiles.sort((a, b) => b.mtime - a.mtime);

      for (const file of recentFiles) {
        // 最近5秒以内に作成されたファイル
        if (file.mtime >= checkStartTime - 5000) {
          const content = await Deno.readTextFile(file.path);
          if (content.includes(",") || content.includes('","')) {
            // CSVファイルとして処理
            const savePath = `${outputDir}/taskchute-export-${Date.now()}.csv`;
            await Deno.copyFile(file.path, savePath);

            const tasks = this.parseCSVContent(content);
            return createSuccessResult({
              csvContent: content,
              downloadPath: savePath,
              taskCount: tasks.length,
              tasks
            });
          }
        }
      }
    } catch (error) {
      console.error(`[CSVDownloader] ディレクトリチェックエラー: ${error}`);
    }

    return createFailureResult("CSVファイルのダウンロードに失敗しました");
  }
}
