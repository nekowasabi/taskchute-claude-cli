// import { Command } from "gunshi"; // 削除 - シンプルなパーサーを使用
import { TaskChuteAuth } from "./auth.ts";
import { TaskChuteDataFetcher } from "./fetcher.ts";
import { ConfigManager } from "./config.ts";

/**
 * CLIの実行結果
 */
export interface CLIResult {
  success: boolean;
  command?: string;
  options?: Record<string, any>;
  error?: string;
  data?: any;
}

/**
 * CLIアプリケーションのメインクラス
 */
export class CLI {
  private auth: TaskChuteAuth;
  public fetcher: TaskChuteDataFetcher;
  private config: ConfigManager;
  private loginMethod?: any;

  constructor() {
    this.config = new ConfigManager();
    
    const authConfig = this.config.getAuthConfig();
    this.auth = new TaskChuteAuth(authConfig);
    
    const fetcherOptions = this.config.getFetcherOptions();
    this.fetcher = new TaskChuteDataFetcher(fetcherOptions);
  }

  /**
   * プラットフォームに応じたCLIの初期化
   * @static
   */
  static async createForPlatform(): Promise<CLI> {
    // プラットフォーム検出とログイン方法の決定
    const loginMethod = await TaskChuteAuth.detectLoginMethod();
    
    // ConfigManagerを作成して設定を更新
    const config = new ConfigManager();
    
    if (!loginMethod.needsCredentials && loginMethod.chromeProfilePath) {
      // Chromeプロファイルを使用する場合は、ダミーの認証情報を設定
      await config.saveConfig({
        auth: {
          email: "chrome-profile@example.com",
          password: "chrome-profile"
        },
        fetcher: {
          userDataDir: loginMethod.chromeProfilePath
        }
      });
    }
    
    // CLIインスタンスを作成
    const cli = new CLI();
    cli.loginMethod = loginMethod;
    
    // Chromeプロファイルが使用可能な場合は、fetcherのuserDataDirを更新
    if (!loginMethod.needsCredentials && loginMethod.chromeProfilePath) {
      cli.fetcher.updateOptions({
        userDataDir: loginMethod.chromeProfilePath
      });
    }
    
    return cli;
  }

  /**
   * 利用可能なコマンドのリストを取得する
   * @returns コマンド名の配列
   */
  getAvailableCommands(): string[] {
    return ["login", "fetch", "status", "check-login", "stats", "save-html", "csv-test", "csv-download"];
  }

  /**
   * ヘルプメッセージを取得する
   * @returns ヘルプメッセージ文字列
   */
  getHelpMessage(): string {
    return `
TaskChute CLI - TaskChute Cloudとの連携ツール

使用方法:
  taskchute-cli <command> [options]

利用可能なコマンド:
  login                    ブラウザを起動し、手動でログインします
  fetch --output <file>    TaskChuteデータを取得してファイルに保存
  status                   現在のログイン状態を確認
  check-login              TaskChute Cloudへのログイン状態を確認します
  stats                    今日のタスクの統計情報を取得します
  save-html <file>         現在のページのHTMLを保存します
  csv-test                 CSVエクスポート機能をテストします (--from, --toオプション対応)
  csv-download             CSVファイルをダウンロードします (--from, --to, --outputオプション対応)

オプション:
  --headless              ヘッドレスモードでブラウザを起動
  --browser <type>        使用するブラウザ (chromium, firefox, webkit)
  --timeout <ms>          タイムアウト時間（ミリ秒）
  --output <file>         出力ファイルパス
  --from <date>           開始日付 (YYYY-MM-DD形式、fetch/csv系コマンドで使用)
  --to <date>             終了日付 (YYYY-MM-DD形式、fetch/csv系コマンドで使用)
  --help                  このヘルプメッセージを表示

例:
  taskchute-cli login
  taskchute-cli login --headless
  taskchute-cli fetch --output ./tasks.html
  taskchute-cli fetch --output ./tasks.json --from 2025-06-01 --to 2025-06-30
  taskchute-cli fetch --output ./tasks.json --browser firefox
  taskchute-cli status
  taskchute-cli check-login
  taskchute-cli stats
  taskchute-cli save-html ./page.html
  taskchute-cli csv-test
  taskchute-cli csv-test --from 2025-06-01 --to 2025-06-30
  taskchute-cli csv-download
  taskchute-cli csv-download --from 2025-06-01 --to 2025-06-30
  taskchute-cli csv-download --output ./data/exports
  taskchute-cli csv-download --from 2026-01-01 --to 2026-01-08 --output ./backup
`;
  }

  /**
   * CLIを実行する
   * @param args コマンドライン引数
   * @returns CLIの実行結果
   */
  async run(args: string[]): Promise<CLIResult> {
    if (args.includes("--help") || args.includes("-h")) {
      console.log(this.getHelpMessage());
      return { success: true };
    }

    const command = args[0];
    const options = this.parseOptions(args.slice(1));

    if (options.dryRun) {
      return { success: true, command, options };
    }

    switch (command) {
      case "login":
        return await this.handleLogin(options);
      case "fetch":
        return await this.handleFetch(options);
      case "status":
        return await this.handleStatus(options);
      case "check-login":
        return await this.handleCheckLogin(options);
      case "stats":
        return await this.handleStats(options);
      case "save-html":
        return await this.handleSaveHtml(options);
      case "csv-test":
        return await this.handleCSVTest(options);
      case "csv-download":
        return await this.handleCSVDownload(options);
      default:
        throw new Error(`Unknown command: ${command}`);
    }
  }

  /**
   * コマンドライン引数をパースしてオプションオブジェクトを生成する
   * @param args コマンドライン引数の配列
   * @returns パースされたオプションオブジェクト
   * @private
   */
  private parseOptions(args: string[]): Record<string, any> {
    const options: Record<string, any> = {};
    
    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      
      if (arg === "--headless") {
        options.headless = true;
      } else if (arg === "--browser") {
        options.browser = args[++i];
      } else if (arg === "--timeout") {
        options.timeout = parseInt(args[++i]);
      } else if (arg === "--output") {
        options.output = args[++i];
      } else if (arg === "--from") {
        options.from = args[++i];
      } else if (arg === "--to") {
        options.to = args[++i];
      } else if (arg === "--dry-run") {
        options.dryRun = true;
      }
    }
    
    return options;
  }

  /**
   * ログイン処理をハンドルする
   * @param options コマンドラインオプション
   * @returns CLIの実行結果
   * @private
   */
  private async handleLogin(options: Record<string, any>): Promise<CLIResult> {
    try {
      console.log("ブラウザを起動します。TaskChute Cloudにログインしてください...");
      this.fetcher.updateOptions({ headless: false });

      await this.fetcher.launchBrowser();
      await this.fetcher.navigateToTaskChute();

      console.log("ログイン成功を待っています...（最大5分）");
      const loginSuccess = await this.fetcher.waitForLoginSuccess(300000); // 5分待機

      if (loginSuccess) {
        console.log("ログイン成功を検知しました。認証情報を保存しています...");
        await this.auth.createSession();
        await this.fetcher.cleanup(); // ブラウザを閉じてセッションを保存
        console.log("ログインに成功しました。`fetch`コマンドなどが利用できます。");
        return { success: true, command: "login" };
      } else {
        console.error("ログインが確認できませんでした。タイムアウトしました。");
        await this.fetcher.cleanup();
        return { success: false, command: "login", error: "Login timeout" };
      }
    } catch (error) {
      return {
        success: false,
        command: "login",
        error: (error as Error).message,
      };
    }
  }

  /**
   * ログイン状態の確認処理をハンドルする
   * @param options コマンドラインオプション
   * @returns CLIの実行結果
   * @private
   */
  private async handleCheckLogin(options: Record<string, any>): Promise<CLIResult> {
    try {
      console.log("TaskChute Cloudへのログイン状態を確認しています...");

      // ブラウザの設定を更新
      if (options.headless !== undefined) {
        this.fetcher.updateOptions({ headless: options.headless });
      }
      if (options.browser) {
        this.fetcher.updateOptions({ browser: options.browser });
      }

      const { isLoggedIn, error } = await this.fetcher.checkLoginStatus();

      if (error) {
        console.log("ログイン状態の確認に失敗しました。");
        console.log("`taskchute-cli login` を実行して、手動でログインしてください。");
        return { success: false, command: "check-login", error };
      }

      if (isLoggedIn) {
        console.log("ログイン済みです。");
        // ログイン成功時にセッションを更新
        await this.auth.createSession();
      } else {
        console.log("未ログインです。`taskchute-cli login` を実行して、手��でログインしてください。");
      }

      return { success: isLoggedIn, command: "check-login" };
    } catch (error) {
      return {
        success: false,
        command: "check-login",
        error: (error as Error).message,
      };
    }
  }

  /**
   * タスク統計情報の取得処理をハンドルする
   * @param options コマンドラインオプション
   * @returns CLIの実行結果
   * @private
   */
  private async handleStats(options: Record<string, any>): Promise<CLIResult> {
    try {
      await this.fetcher.navigateToTaskChute();
      if (!await this.fetcher.isUserLoggedIn()) {
        return { success: false, command: "stats", error: "ログインしていません。`taskchute-cli login` を実行してください。" };
      }

      console.log("今日のタスクの統計情報を取得中...");

      const statsResult = await this.fetcher.getDailyTaskStats();

      if (!statsResult.success) {
        return {
          success: false,
          command: "stats",
          error: "統計情報の取得に失敗しました",
        };
      }

      console.log(JSON.stringify(statsResult.data, null, 2));

      return { success: true, command: "stats", options };
    } catch (error) {
      return {
        success: false,
        command: "stats",
        error: (error as Error).message,
      };
    }
  }

  /**
   * HTML保存処理をハンドルする
   * @param options コマンドラインオプション
   * @returns CLIの実行結果
   * @private
   */
  private async handleSaveHtml(options: Record<string, any>): Promise<CLIResult> {
    try {
      if (!options.output) {
        throw new Error("--output オプションは必須です");
      }

      await this.fetcher.navigateToTaskChute();
      if (!await this.fetcher.isUserLoggedIn()) {
        return { success: false, command: "save-html", error: "ログインしていません。`taskchute-cli login` を実行してください。" };
      }

      console.log(`現在のページのHTMLを ${options.output} に保存中...`);

      const htmlResult = await this.fetcher.getPageHTML();
      if (!htmlResult.success) {
        return {
          success: false,
          command: "save-html",
          error: "HTMLの取得に失敗しました",
        };
      }

      await this.fetcher.saveHTMLToFile(htmlResult.html!, options.output);

      console.log("HTMLの保存が完了しました。");

      return { success: true, command: "save-html", options };
    } catch (error) {
      return {
        success: false,
        command: "save-html",
        error: (error as Error).message,
      };
    }
  }

  /**
   * CSVエクスポート機能をテストする
   * @param options コマンドラインオプション
   * @returns CLIの実行結果
   * @private
   */
  private async handleCSVTest(options: Record<string, any>): Promise<CLIResult> {
    try {
      // 日付オプションの処理 (YYYY-MM-DD形式をYYYYMMDD形式に変換)
      let fromDate: string | undefined;
      let toDate: string | undefined;
      
      if (options.from || options.to) {
        const convertDate = (dateStr: string): string => {
          return dateStr.replace(/-/g, '');
        };
        
        fromDate = options.from ? convertDate(options.from) : undefined;
        toDate = options.to ? convertDate(options.to) : undefined;
      }
      
      // デバッグ用にheadlessモードを無効化
      this.fetcher.updateOptions({ headless: false });
      
      // ブラウザを起動
      const browserResult = await this.fetcher.launchBrowser();
      if (!browserResult.success) {
        return { success: false, command: "csv-test", error: browserResult.error };
      }
      
      console.log("CSVエクスポートページをテスト中...");

      const result = await this.fetcher.getTaskDataFromCSV(fromDate, toDate);
      if (!result.success) {
        return {
          success: false,
          command: "csv-test",
          error: result.error,
        };
      }

      console.log("CSVエクスポートページの確認が完了しました。");
      console.log("ブラウザを10秒間開いたままにします。確認後に手動で閉じてください。");
      
      // デバッグ用に少し待機
      await new Promise(resolve => setTimeout(resolve, 10000));

      return { success: true, command: "csv-test", options };
    } catch (error) {
      return {
        success: false,
        command: "csv-test",
        error: (error as Error).message,
      };
    } finally {
      // クリーンアップ
      await this.fetcher.cleanup();
    }
  }

  /**
   * CSVダウンロードを実行する
   * @param options コマンドラインオプション
   * @returns CLIの実行結果
   * @private
   */
  private async handleCSVDownload(options: Record<string, any>): Promise<CLIResult> {
    try {
      // 日付オプションの処理 (YYYY-MM-DD形式をYYYYMMDD形式に変換)
      let fromDate: string | undefined;
      let toDate: string | undefined;

      if (options.from || options.to) {
        const convertDate = (dateStr: string): string => {
          return dateStr.replace(/-/g, '');
        };

        fromDate = options.from ? convertDate(options.from) : undefined;
        toDate = options.to ? convertDate(options.to) : undefined;
      }

      // ブラウザを起動
      const browserResult = await this.fetcher.launchBrowser();
      if (!browserResult.success) {
        return { success: false, command: "csv-download", error: browserResult.error };
      }

      console.log("TaskChuteからCSVファイルをダウンロード中...");

      const result = await this.fetcher.getTaskDataFromCSV(fromDate, toDate, options.output);
      if (!result.success) {
        return {
          success: false,
          command: "csv-download",
          error: result.error,
        };
      }

      if (result.downloadPath) {
        console.log(`CSVファイルのダウンロードが完了しました: ${result.downloadPath}`);
      } else {
        console.log("CSVダウンロード処理が完了しました。");
      }

      return { success: true, command: "csv-download", options, data: { downloadPath: result.downloadPath } };
    } catch (error) {
      return {
        success: false,
        command: "csv-download",
        error: (error as Error).message,
      };
    } finally {
      // クリーンアップ
      await this.fetcher.cleanup();
    }
  }

  /**
   * 日付形式の検証を行う
   * @param date 検証する日付文字列
   * @returns 有効な日付形式かどうか
   * @private
   */
  private isValidDateFormat(date: string): boolean {
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(date)) {
      return false;
    }
    
    // 実際の日付として有効かチェック
    const dateObj = new Date(date);
    return !isNaN(dateObj.getTime());
  }

  /**
   * 現在の日付をYYYY-MM-DD形式で取得する
   * @returns 現在の日付文字列
   * @private
   */
  private getCurrentDateString(): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  /**
   * データ取得処理をハンドルする
   * @param options コマンドラインオプション
   * @returns CLIの実行結果
   * @private
   */
  private async handleFetch(options: Record<string, any>): Promise<CLIResult> {
    console.log("[CLI] handleFetch: 開始");
    try {
      if (!options.output) {
        throw new Error("--output オプションは必須です");
      }

      // 日付オプションの処理
      let fromDate = options.from || this.getCurrentDateString();
      let toDate = options.to || this.getCurrentDateString();

      // 日付形式のバリデーション
      if (options.from && !this.isValidDateFormat(options.from)) {
        throw new Error(`--from の日付形式が不正です: ${options.from} (YYYY-MM-DD形式で指定してください)`);
      }
      if (options.to && !this.isValidDateFormat(options.to)) {
        throw new Error(`--to の日付形式が不正です: ${options.to} (YYYY-MM-DD形式で指定してください)`);
      }

      console.log(`[CLI] handleFetch: 日付範囲: ${fromDate} から ${toDate}`);

      console.log("[CLI] handleFetch: ページ遷移を開始");
      await this.fetcher.navigateToTaskChute(fromDate, toDate);
      console.log(`[CLI] handleFetch: ページ遷移完了。現在のURL: ${this.fetcher.getCurrentUrl()}`);

      console.log("[CLI] handleFetch: ログイン状態を確認");
      if (!await this.fetcher.isUserLoggedIn()) {
        console.error("[CLI] handleFetch: ログイ���していません");
        return { success: false, command: "fetch", error: "ログインしていません。`taskchute-cli login` を実行してください。" };
      }
      console.log("[CLI] handleFetch: ログイン済みです");

      console.log("[CLI] handleFetch: TaskChuteデータ取得開始");
      const taskData = await this.fetcher.getTaskData();
      
      if (!taskData.success) {
        console.error(`[CLI] handleFetch: データの取得に失敗しました: ${taskData.error}`);
        return { 
          success: false, 
          command: "fetch", 
          error: `データの取得に失敗しました: ${taskData.error}`
        };
      }
      console.log("[CLI] handleFetch: TaskChuteデータ取得完了");

      console.log("[CLI] handleFetch: ファイルへの保存を開始");
      let saveResult;
      if (options.output.endsWith('.json')) {
        saveResult = await this.fetcher.saveJSONToFile(taskData, options.output);
      } else {
        const htmlResult = await this.fetcher.getPageHTML();
        if (!htmlResult.success) {
          return {
            success: false,
            command: "fetch",
            error: "HTMLの取得に失敗しました",
          };
        }
        saveResult = await this.fetcher.saveHTMLToFile(htmlResult.html!, options.output);
      }

      if (!saveResult.success) {
        console.error("[CLI] handleFetch: ファイルの保存に失敗しました");
        return { 
          success: false, 
          command: "fetch", 
          error: `ファイルの保存に失敗しました: ${options.output}` 
        };
      }

      console.log(`[CLI] handleFetch: データを ${options.output} に保存しました。`);
      return { success: true, command: "fetch", options };

    } catch (error) {
      console.error(`[CLI] handleFetch: エラー発生 - ${(error as Error).message}`);
      return { 
        success: false, 
        command: "fetch", 
        error: (error as Error).message 
      };
    } finally {
      console.log("[CLI] handleFetch: 終了");
      await this.fetcher.cleanup();
    }
  }

  /**
   * ステータス確認処理をハンドルする
   * @param options コマンドラインオプション
   * @returns CLIの実行結果
   * @private
   */
  private async handleStatus(options: Record<string, any>): Promise<CLIResult> {
    try {
      const sessionStatus = await this.auth.getSessionStatus();
      
      if (sessionStatus.isLoggedIn) {
        console.log("ログイン状態: ログイン済み");
        console.log(`Email: ${sessionStatus.email}`);
        console.log(`ログイン時刻: ${sessionStatus.loginTime?.toLocaleString()}`);
        console.log(`セッション有効期限: ${sessionStatus.expiresAt?.toLocaleString()}`);
        
        if (sessionStatus.expiresAt && sessionStatus.expiresAt < new Date()) {
          console.log("⚠️  セッションの有効期限が切れています。再ログインが必要です。");
        }
      } else {
        console.log("ログイン状態: 未ログイン");
        console.log("taskchute-cli login でログインしてください。");
      }

      return { success: true, command: "status", options };

    } catch (error) {
      return { 
        success: false, 
        command: "status", 
        error: (error as Error).message 
      };
    }
  }
}