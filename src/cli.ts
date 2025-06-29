// import { Command } from "gunshi"; // 削除 - シンプルなパーサーを使用
import { TaskChuteAuth } from "./auth.ts";
import { TaskChuteDataFetcher } from "./fetcher.ts";
import { ConfigManager } from "./config.ts";

export interface CLIResult {
  success: boolean;
  command?: string;
  options?: Record<string, any>;
  error?: string;
}

export class CLI {
  private auth: TaskChuteAuth;
  private fetcher: TaskChuteDataFetcher;
  private config: ConfigManager;

  constructor() {
    this.config = new ConfigManager();
    
    const authConfig = this.config.getAuthConfig();
    this.auth = new TaskChuteAuth(authConfig);
    
    const fetcherOptions = this.config.getFetcherOptions();
    this.fetcher = new TaskChuteDataFetcher(fetcherOptions);
  }

  getAvailableCommands(): string[] {
    return ["login", "fetch", "status", "check-login", "stats", "save-html"];
  }

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

オプション:
  --headless              ヘッドレスモードでブラウザを起動
  --browser <type>        使用するブラウザ (chromium, firefox, webkit)
  --timeout <ms>          タイムアウト時間（ミリ秒）
  --output <file>         出力ファイルパス
  --help                  このヘルプメッセージを表示

例:
  taskchute-cli login
  taskchute-cli login --headless
  taskchute-cli fetch --output ./tasks.html
  taskchute-cli fetch --output ./tasks.json --browser firefox
  taskchute-cli status
  taskchute-cli check-login
  taskchute-cli stats
  taskchute-cli save-html ./page.html
`;
  }

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
      default:
        throw new Error(`Unknown command: ${command}`);
    }
  }

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
      } else if (arg === "--dry-run") {
        options.dryRun = true;
      }
    }
    
    return options;
  }

  private async handleLogin(options: Record<string, any>): Promise<CLIResult> {
    try {
      console.log("ブラウザを起動してTaskChute Cloudに手動でログインしてください...");

      // ブラウザの設定を更新
      this.fetcher.updateOptions({
        headless: false, // 必ず表示モードで起動
        ...(options.browser && { browser: options.browser }),
        ...(options.timeout && { timeout: options.timeout }),
      });

      // ブラウザを起動してログインページを開く
      await this.fetcher.launchBrowser();
      await this.fetcher.navigateToTaskChute();

      console.log("ログイン後、このウィンドウを閉じてください。");
      console.log("ログイン状態を確認するには、`taskchute-cli check-login` を実行してください。");

      // ユーザーが手動で操作するため、ここでは待機しない
      // 必要であれば、特定のURLに到達するまで待機するなどの処理を追加可能

      return { success: true, command: "login", options };
    } catch (error) {
      return {
        success: false,
        command: "login",
        error: (error as Error).message,
      };
    }
  }

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

  private async handleStats(options: Record<string, any>): Promise<CLIResult> {
    try {
      let isLoggedIn = await this.auth.isLoggedIn();

      if (!isLoggedIn) {
        console.log("ログインしていません。ブラウザを起動してログインしてください...");
        await this.handleLogin(options);
        
        // ログインが成功したか再度確認
        const checkResult = await this.handleCheckLogin(options);
        if (!checkResult.success) {
          return {
            success: false,
            command: "stats",
            error: "ログインに失敗したため、統計情報を取得できませんでした。",
          };
        }
        isLoggedIn = true;
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

  private async handleSaveHtml(options: Record<string, any>): Promise<CLIResult> {
    try {
      if (!options.output) {
        throw new Error("--output オプションは必須です");
      }

      let isLoggedIn = await this.auth.isLoggedIn();
      if (!isLoggedIn) {
        console.log("ログインしていません。ブラウザを起動してログインしてください...");
        await this.handleLogin(options);
        
        const checkResult = await this.handleCheckLogin(options);
        if (!checkResult.success) {
          return {
            success: false,
            command: "save-html",
            error: "ログインに失敗したため、HTMLを保存できませんでした。",
          };
        }
        isLoggedIn = true;
      }

      console.log(`現在のページのHTMLを ${options.output} に保存中...`);

      await this.fetcher.navigateToTaskChute();
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

  private async handleFetch(options: Record<string, any>): Promise<CLIResult> {
    try {
      if (!options.output) {
        throw new Error("--output オプションは必須です");
      }

      // 認証状態を確認
      const isLoggedIn = await this.auth.isLoggedIn();
      if (!isLoggedIn) {
        return { 
          success: false, 
          command: "fetch", 
          error: "先に `taskchute-cli check-login` を実行してログイン状態を確認してください" 
        };
      }

      console.log("TaskChuteデータを取得中...");
      
      // データを取得
      const taskData = await this.fetcher.getTaskData();
      
      if (!taskData.success) {
        return { 
          success: false, 
          command: "fetch", 
          error: "データの取得に失敗しました" 
        };
      }

      // ファイルに保存
      let saveResult;
      if (options.output.endsWith('.json')) {
        saveResult = await this.fetcher.saveJSONToFile(taskData, options.output);
      } else {
        const htmlResult = await this.fetcher.getPageHTML();
        saveResult = await this.fetcher.saveHTMLToFile(htmlResult.html!, options.output);
      }

      if (!saveResult.success) {
        return { 
          success: false, 
          command: "fetch", 
          error: `ファイルの保存に失敗しました: ${options.output}` 
        };
      }

      console.log(`データを ${options.output} に保存しました。`);
      return { success: true, command: "fetch", options };

    } catch (error) {
      return { 
        success: false, 
        command: "fetch", 
        error: (error as Error).message 
      };
    }
  }

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