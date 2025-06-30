import { ensureDir } from "std/fs/mod.ts";
import { join } from "std/path/mod.ts";
import { detectPlatform, getBrowserLaunchOptions, checkChromeUserDataDir, logPlatformInfo } from "./platform.ts";

/**
 * ログイン認証情報
 */
export interface LoginCredentials {
  email: string;
  password: string;
}

/**
 * セッションデータ
 */
export interface SessionData {
  email: string;
  loggedInAt: number;
  sessionValid: boolean;
}

/**
 * 認証結果
 */
export interface AuthResult {
  success: boolean;
  email?: string;
  error?: string;
}

/**
 * TaskChuteの認証とセッション管理を扱うクラス
 */
export class TaskChuteAuth {
  private credentials: LoginCredentials;
  private sessionPath: string;

  /**
   * @param credentials ログイン認証情報
   */
  constructor(credentials: LoginCredentials) {
    // Chromeプロファイルを使用する場合はバリデーションをスキップ
    if (credentials.email !== "chrome-profile@example.com") {
      this.validateCredentials(credentials);
    }
    this.credentials = credentials;
    this.sessionPath = join(Deno.env.get("HOME") || ".", ".taskchute", "session.json");
  }

  /**
   * 認証情報のバリデーションを行う
   * @param credentials ログイン認証情報
   * @private
   */
  private validateCredentials(credentials: LoginCredentials): void {
    if (!credentials.email || !credentials.password) {
      throw new Error("Invalid credentials: email and password are required");
    }
    
    if (!this.isValidEmail(credentials.email)) {
      throw new Error("Invalid credentials: valid email address is required");
    }
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
   * ログイン認証情報を取得する
   * @returns ログイン認証情報
   */
  getCredentials(): LoginCredentials {
    return { ...this.credentials };
  }

  /**
   * セッションデータをファイルに保存する
   * @param sessionData 保存するセッションデータ
   */
  async saveSession(sessionData: SessionData): Promise<void> {
    await ensureDir(join(this.sessionPath, ".."));
    
    const sessionJson = JSON.stringify(sessionData, null, 2);
    await Deno.writeTextFile(this.sessionPath, sessionJson);
  }

  /**
   * 保存されたセッションデータを取得する
   * @returns セッションデータ、存在しない場合はnull
   */
  async getStoredSession(): Promise<SessionData | null> {
    try {
      const sessionJson = await Deno.readTextFile(this.sessionPath);
      return JSON.parse(sessionJson);
    } catch {
      return null;
    }
  }

  /**
   * ログイン状態かチェックする
   * セッションの有効期限は24時間
   * @returns ログイン状態の場合はtrue、そうでない場合はfalse
   */
  async isLoggedIn(): Promise<boolean> {
    const session = await this.getStoredSession();
    if (!session) return false;

    // セッションの有効期限を24時間とする
    const sessionExpiryTime = 24 * 60 * 60 * 1000; // 24時間
    const now = Date.now();
    const sessionAge = now - session.loggedInAt;

    if (sessionAge > sessionExpiryTime) {
      // セッション期限切れの場合はファイルを削除
      await this.logout();
      return false;
    }

    return session.sessionValid && session.email === this.credentials.email;
  }

  /**
   * 新しいセッションを作成する
   * @returns 認証結果
   */
  async createSession(): Promise<AuthResult> {
    try {
      const sessionData: SessionData = {
        email: this.credentials.email,
        loggedInAt: Date.now(),
        sessionValid: true
      };

      await this.saveSession(sessionData);

      return {
        success: true,
        email: this.credentials.email
      };

    } catch (error) {
      return {
        success: false,
        error: (error as Error).message
      };
    }
  }

  /**
   * ログアウトし、セッションファイルを削除する
   */
  async logout(): Promise<void> {
    try {
      await Deno.remove(this.sessionPath);
    } catch {
      // ファイルが存在しない場合は無視
    }
  }

  /**
   * セッションを更新する
   * @returns 認証結果
   */
  async refreshSession(): Promise<AuthResult> {
    const session = await this.getStoredSession();
    if (!session) {
      return {
        success: false,
        error: "No session found"
      };
    }

    // セッションを更新
    session.loggedInAt = Date.now();
    await this.saveSession(session);

    return {
      success: true,
      email: session.email
    };
  }

  /**
   * 現在のセッション状態を取得する
   * @returns セッション状態
   */
  async getSessionStatus(): Promise<{
    isLoggedIn: boolean;
    email?: string;
    loginTime?: Date;
    expiresAt?: Date;
  }> {
    const session = await this.getStoredSession();
    
    if (!session) {
      return { isLoggedIn: false };
    }

    const sessionExpiryTime = 24 * 60 * 60 * 1000; // 24時間
    const loginTime = new Date(session.loggedInAt);
    const expiresAt = new Date(session.loggedInAt + sessionExpiryTime);
    const isLoggedIn = await this.isLoggedIn();

    return {
      isLoggedIn,
      email: session.email,
      loginTime,
      expiresAt
    };
  }

  /**
   * 環境変数からTaskChuteAuthインスタンスを生成する
   * @returns TaskChuteAuthインスタンス
   * @static
   */
  static fromEnvironment(): TaskChuteAuth {
    const email = Deno.env.get("TASKCHUTE_EMAIL");
    const password = Deno.env.get("TASKCHUTE_PASSWORD");

    if (!email || !password) {
      throw new Error("Environment variables TASKCHUTE_EMAIL and TASKCHUTE_PASSWORD are required");
    }

    return new TaskChuteAuth({ email, password });
  }

  /**
   * プラットフォームを検出してログイン方法を決定する
   * @returns プラットフォーム固有のログイン設定
   * @static
   */
  static async detectLoginMethod(): Promise<{
    needsCredentials: boolean;
    platformInfo: any;
    chromeProfilePath?: string;
  }> {
    const platformInfo = detectPlatform();
    logPlatformInfo(platformInfo);

    // MacまたはWindowsで、Chromeプロファイルが存在する場合
    if ((platformInfo.isMac || platformInfo.isWindows) && platformInfo.chromeUserDataDir) {
      const profileExists = await checkChromeUserDataDir(platformInfo.chromeUserDataDir);
      if (profileExists) {
        console.log("\n✅ Chromeプロファイルを検出しました");
        console.log("既存のChromeプロファイルを使用してログインします");
        return {
          needsCredentials: false,
          platformInfo,
          chromeProfilePath: platformInfo.chromeUserDataDir
        };
      }
    }

    // WSLで環境変数が設定されている場合
    if (platformInfo.isWSL && platformInfo.chromeUserDataDir) {
      const profileExists = await checkChromeUserDataDir(platformInfo.chromeUserDataDir);
      if (profileExists) {
        console.log("\n✅ Windows側のChromeプロファイルを検出しました");
        return {
          needsCredentials: false,
          platformInfo,
          chromeProfilePath: platformInfo.chromeUserDataDir
        };
      }
    }

    // Chromeプロファイルが使用できない場合は認証情報が必要
    console.log("\n⚠️ Chromeプロファイルが見つかりません");
    console.log("環境変数による認証が必要です");
    return {
      needsCredentials: true,
      platformInfo
    };
  }

  /**
   * プラットフォームに応じて適切なAuthインスタンスを作成
   * @static
   */
  static async createForPlatform(): Promise<TaskChuteAuth> {
    const loginMethod = await this.detectLoginMethod();
    
    if (loginMethod.needsCredentials) {
      // 認証情報が必要な場合
      return this.fromEnvironment();
    } else {
      // Chromeプロファイルを使用する場合（ダミーの認証情報）
      return new TaskChuteAuth({ 
        email: "chrome-profile@example.com", 
        password: "chrome-profile" 
      });
    }
  }
}