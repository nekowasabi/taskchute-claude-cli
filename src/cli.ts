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
    return ["login", "fetch", "status"];
  }

  getHelpMessage(): string {
    return `
TaskChute CLI - TaskChute Cloudとの連携ツール

使用方法:
  taskchute-cli <command> [options]

利用可能なコマンド:
  login                    TaskChute Cloudにログイン（環境変数のメール・パスワードを使用）
  fetch --output <file>    TaskChuteデータを取得してファイルに保存
  status                   現在のログイン状態を確認

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
      console.log("TaskChute Cloudへのログインを開始します...");
      
      // ブラウザの設定を更新
      if (options.headless !== undefined) {
        this.fetcher.updateOptions({ headless: options.headless });
      }
      if (options.browser) {
        this.fetcher.updateOptions({ browser: options.browser });
      }
      if (options.timeout) {
        this.fetcher.updateOptions({ timeout: options.timeout });
      }

      // 認証情報を取得
      const credentials = this.auth.getCredentials();
      
      // ブラウザを使用してログイン
      const loginResult = await this.fetcher.performGoogleLogin(credentials);

      if (!loginResult.success) {
        return { 
          success: false, 
          command: "login", 
          error: `ログインに失敗しました: ${loginResult.error}` 
        };
      }

      // セッション情報を保存
      const sessionResult = await this.auth.createSession();
      if (!sessionResult.success) {
        return { 
          success: false, 
          command: "login", 
          error: `セッションの作成に失敗しました: ${sessionResult.error}` 
        };
      }

      console.log("ログインが完了しました。");
      return { success: true, command: "login", options };

    } catch (error) {
      return { 
        success: false, 
        command: "login", 
        error: (error as Error).message 
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
          error: "先にログインしてください (taskchute-cli login)" 
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