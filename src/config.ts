import { ensureDir } from "std/fs/mod.ts";
import { join } from "std/path/mod.ts";
import { LoginCredentials } from "./auth.ts";
import { FetcherOptions } from "./fetcher.ts";

/**
 * 設定オブジェクトのインターフェース
 */
export interface Config {
  auth: LoginCredentials;
  fetcher: FetcherOptions;
  general: {
    defaultOutputDir: string;
    maxRetries: number;
    logLevel: "error" | "warn" | "info" | "debug";
  };
}

/**
 * 設定を管理するクラス
 */
export class ConfigManager {
  private configPath: string;
  private defaultConfig: Config;

  constructor() {
    this.configPath = join(Deno.env.get("HOME") || ".", ".taskchute", "config.json");
    this.defaultConfig = {
      auth: {
        // Chrome プロファイルを使用するため、ダミー値を設定
        email: "chrome-profile@example.com",
        password: "not-used"
      },
      fetcher: {
        headless: true,
        browser: "chromium",
        timeout: 30000,
        viewport: { width: 1920, height: 1080 },
        userDataDir: join(Deno.env.get("HOME") || ".", ".taskchute", "browser-profile")
      },
      general: {
        defaultOutputDir: "./tmp/claude",
        maxRetries: 3,
        logLevel: "info"
      }
    };
  }

  /**
   * 設定をファイルから読み込む
   * @returns 読み込んだ設定オブジェクト
   */
  async loadConfig(): Promise<Config> {
    try {
      const configJson = await Deno.readTextFile(this.configPath);
      const userConfig = JSON.parse(configJson);
      
      // デフォルト設定とユーザー設定をマージ
      return this.mergeConfig(this.defaultConfig, userConfig);
    } catch {
      // 設定ファイルが存在しない場合はデフォルト設定を使用
      return this.defaultConfig;
    }
  }

  /**
   * 設定をファイルに保存する
   * @param config 保存する設定オブジェクト
   */
  async saveConfig(config: Partial<Config>): Promise<void> {
    try {
      const currentConfig = await this.loadConfig();
      const newConfig = this.mergeConfig(currentConfig, config);
      
      await ensureDir(join(this.configPath, ".."));
      const configJson = JSON.stringify(newConfig, null, 2);
      await Deno.writeTextFile(this.configPath, configJson);
    } catch (error) {
      throw new Error(`Failed to save config: ${(error as Error).message}`);
    }
  }

  /**
   * 認証設定を取得する
   * @returns 認証設定
   */
  getAuthConfig(): LoginCredentials {
    const config = this.getConfigSync();
    return config.auth;
  }

  /**
   * Fetcherのオプションを取得する
   * @returns Fetcherのオプション
   */
  getFetcherOptions(): FetcherOptions {
    const config = this.getConfigSync();
    return config.fetcher;
  }

  /**
   * 一般設定を取得する
   * @returns 一般設定
   */
  getGeneralConfig(): Config["general"] {
    const config = this.getConfigSync();
    return config.general;
  }

  /**
   * 同期的に設定を取得する（主に環境変数を反映させるため）
   * @returns 設定オブジェクト
   */
  getConfigSync(): Config {
    // 環境変数から設定を取得（実行時に毎回チェック）
    return {
      auth: {
        // Chrome プロファイルを使用するため、環境変数は不要
        email: "chrome-profile@example.com",
        password: "not-used"
      },
      fetcher: {
        headless: Deno.env.get("TASKCHUTE_HEADLESS") === "false" ? false : this.defaultConfig.fetcher.headless,
        browser: (Deno.env.get("TASKCHUTE_BROWSER") as any) || this.defaultConfig.fetcher.browser,
        timeout: parseInt(Deno.env.get("TASKCHUTE_TIMEOUT") || "") || this.defaultConfig.fetcher.timeout,
        viewport: this.defaultConfig.fetcher.viewport,
        // TASKCHUTE_CHROME_PATH環境変数をサポート（WSL対応）
        userDataDir: Deno.env.get("TASKCHUTE_CHROME_PATH") ||
                     Deno.env.get("TASKCHUTE_USER_DATA_DIR") ||
                     this.defaultConfig.fetcher.userDataDir
      },
      general: {
        defaultOutputDir: Deno.env.get("TASKCHUTE_OUTPUT_DIR") || this.defaultConfig.general.defaultOutputDir,
        maxRetries: parseInt(Deno.env.get("TASKCHUTE_MAX_RETRIES") || "") || this.defaultConfig.general.maxRetries,
        logLevel: (Deno.env.get("TASKCHUTE_LOG_LEVEL") as any) || this.defaultConfig.general.logLevel
      }
    };
  }

  /**
   * デフォルト設定とユーザー設定をマージする
   * @param defaultConfig デフォルト設定
   * @param userConfig ユーザー設定
   * @returns マージされた設定オブジェクト
   * @private
   */
  private mergeConfig(defaultConfig: Config, userConfig: Partial<Config>): Config {
    return {
      auth: { ...defaultConfig.auth, ...userConfig.auth },
      fetcher: { ...defaultConfig.fetcher, ...userConfig.fetcher },
      general: { ...defaultConfig.general, ...userConfig.general }
    };
  }

  /**
   * デフォルトの設定ファイルを作成する
   */
  async createDefaultConfig(): Promise<void> {
    await this.saveConfig(this.defaultConfig);
  }

  /**
   * 設定を検証する
   * @returns 検証結果
   */
  async validateConfig(): Promise<{ valid: boolean; errors: string[] }> {
    const config = await this.loadConfig();
    const errors: string[] = [];

    // Chrome プロファイルを使用するため、認証設定の検証はスキップ

    // フェッチャー設定の検証
    if (!["chromium", "firefox", "webkit"].includes(config.fetcher.browser!)) {
      errors.push("Browser must be one of: chromium, firefox, webkit");
    }
    if (config.fetcher.timeout! < 1000) {
      errors.push("Timeout must be at least 1000ms");
    }

    // 一般設定の検証
    if (!["error", "warn", "info", "debug"].includes(config.general.logLevel)) {
      errors.push("Log level must be one of: error, warn, info, debug");
    }
    if (config.general.maxRetries < 0) {
      errors.push("Max retries must be 0 or greater");
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * メールアドレスの形式が有効かチェックする
   * @param email メールアドレス
   * @returns 有効な場合はtrue、そうでない場合はfalse
   * @private
   */
  private isValidEmail(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  /**
   * 設定ファイルのパスを取得する
   * @returns 設定ファイルのパス
   */
  getConfigPath(): string {
    return this.configPath;
  }

  /**
   * 設定ファイルをリセット（削除）する
   */
  async resetConfig(): Promise<void> {
    try {
      await Deno.remove(this.configPath);
    } catch {
      // ファイルが存在しない場合は無視
    }
  }

  /**
   * 現在の設定をエクスポートする
   * @returns 設定のJSON文字列
   */
  async exportConfig(): Promise<string> {
    const config = await this.loadConfig();
    return JSON.stringify(config, null, 2);
  }

  /**
   * 設定をインポートする
   * @param configJson インポートする設定のJSON文字列
   */
  async importConfig(configJson: string): Promise<void> {
    try {
      const config = JSON.parse(configJson);
      await this.saveConfig(config);
    } catch (error) {
      throw new Error(`Invalid config JSON: ${(error as Error).message}`);
    }
  }

  /**
   * 現在の設定内容をコンソールに出力する
   */
  printCurrentConfig(): void {
    const config = this.getConfigSync();
    
    console.log("現在の設定:");
    console.log("=".repeat(50));
    console.log("認証設定:");
    console.log(`  Email: ${config.auth.email ? "***設定済み***" : "未設定"}`);
    console.log(`  Password: ${config.auth.password ? "***設定済み***" : "未設定"}`);
    console.log();
    console.log("フェッチャー設定:");
    console.log(`  Headless: ${config.fetcher.headless}`);
    console.log(`  Browser: ${config.fetcher.browser}`);
    console.log(`  Timeout: ${config.fetcher.timeout}ms`);
    console.log(`  Viewport: ${config.fetcher.viewport?.width}x${config.fetcher.viewport?.height}`);
    console.log();
    console.log("一般設定:");
    console.log(`  Default Output Dir: ${config.general.defaultOutputDir}`);
    console.log(`  Max Retries: ${config.general.maxRetries}`);
    console.log(`  Log Level: ${config.general.logLevel}`);
    console.log();
    console.log(`設定ファイル: ${this.configPath}`);
  }
}