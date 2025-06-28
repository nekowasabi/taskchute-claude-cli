import { ensureDir } from "std/fs/mod.ts";
import { join } from "std/path/mod.ts";
import { LoginCredentials } from "./auth.ts";
import { FetcherOptions } from "./fetcher.ts";

export interface Config {
  auth: LoginCredentials;
  fetcher: FetcherOptions;
  general: {
    defaultOutputDir: string;
    maxRetries: number;
    logLevel: "error" | "warn" | "info" | "debug";
  };
}

export class ConfigManager {
  private configPath: string;
  private defaultConfig: Config;

  constructor() {
    this.configPath = join(Deno.env.get("HOME") || ".", ".taskchute", "config.json");
    this.defaultConfig = {
      auth: {
        email: Deno.env.get("TASKCHUTE_EMAIL") || "",
        password: Deno.env.get("TASKCHUTE_PASSWORD") || ""
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

  getAuthConfig(): LoginCredentials {
    const config = this.getConfigSync();
    return config.auth;
  }

  getFetcherOptions(): FetcherOptions {
    const config = this.getConfigSync();
    return config.fetcher;
  }

  getGeneralConfig(): Config["general"] {
    const config = this.getConfigSync();
    return config.general;
  }

  private getConfigSync(): Config {
    // 環境変数から設定を取得（実行時に毎回チェック）
    return {
      auth: {
        email: Deno.env.get("TASKCHUTE_EMAIL") || this.defaultConfig.auth.email,
        password: Deno.env.get("TASKCHUTE_PASSWORD") || this.defaultConfig.auth.password
      },
      fetcher: {
        headless: Deno.env.get("TASKCHUTE_HEADLESS") === "false" ? false : this.defaultConfig.fetcher.headless,
        browser: (Deno.env.get("TASKCHUTE_BROWSER") as any) || this.defaultConfig.fetcher.browser,
        timeout: parseInt(Deno.env.get("TASKCHUTE_TIMEOUT") || "") || this.defaultConfig.fetcher.timeout,
        viewport: this.defaultConfig.fetcher.viewport,
        userDataDir: Deno.env.get("TASKCHUTE_USER_DATA_DIR") || this.defaultConfig.fetcher.userDataDir
      },
      general: {
        defaultOutputDir: Deno.env.get("TASKCHUTE_OUTPUT_DIR") || this.defaultConfig.general.defaultOutputDir,
        maxRetries: parseInt(Deno.env.get("TASKCHUTE_MAX_RETRIES") || "") || this.defaultConfig.general.maxRetries,
        logLevel: (Deno.env.get("TASKCHUTE_LOG_LEVEL") as any) || this.defaultConfig.general.logLevel
      }
    };
  }

  private mergeConfig(defaultConfig: Config, userConfig: Partial<Config>): Config {
    return {
      auth: { ...defaultConfig.auth, ...userConfig.auth },
      fetcher: { ...defaultConfig.fetcher, ...userConfig.fetcher },
      general: { ...defaultConfig.general, ...userConfig.general }
    };
  }

  async createDefaultConfig(): Promise<void> {
    await this.saveConfig(this.defaultConfig);
  }

  async validateConfig(): Promise<{ valid: boolean; errors: string[] }> {
    const config = await this.loadConfig();
    const errors: string[] = [];

    // 認証設定の検証
    if (!config.auth.email) {
      errors.push("Email is required (TASKCHUTE_EMAIL environment variable or config file)");
    }
    if (!config.auth.password) {
      errors.push("Password is required (TASKCHUTE_PASSWORD environment variable or config file)");
    }
    if (config.auth.email && !this.isValidEmail(config.auth.email)) {
      errors.push("Valid email address is required");
    }

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

  private isValidEmail(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  getConfigPath(): string {
    return this.configPath;
  }

  async resetConfig(): Promise<void> {
    try {
      await Deno.remove(this.configPath);
    } catch {
      // ファイルが存在しない場合は無視
    }
  }

  async exportConfig(): Promise<string> {
    const config = await this.loadConfig();
    return JSON.stringify(config, null, 2);
  }

  async importConfig(configJson: string): Promise<void> {
    try {
      const config = JSON.parse(configJson);
      await this.saveConfig(config);
    } catch (error) {
      throw new Error(`Invalid config JSON: ${(error as Error).message}`);
    }
  }

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