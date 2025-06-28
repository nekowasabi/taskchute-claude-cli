import { ensureDir } from "std/fs/mod.ts";
import { join } from "std/path/mod.ts";

export interface LoginCredentials {
  email: string;
  password: string;
}

export interface SessionData {
  email: string;
  loggedInAt: number;
  sessionValid: boolean;
}

export interface AuthResult {
  success: boolean;
  email?: string;
  error?: string;
}

export class TaskChuteAuth {
  private credentials: LoginCredentials;
  private sessionPath: string;

  constructor(credentials: LoginCredentials) {
    this.validateCredentials(credentials);
    this.credentials = credentials;
    this.sessionPath = join(Deno.env.get("HOME") || ".", ".taskchute", "session.json");
  }

  private validateCredentials(credentials: LoginCredentials): void {
    if (!credentials.email || !credentials.password) {
      throw new Error("Invalid credentials: email and password are required");
    }
    
    if (!this.isValidEmail(credentials.email)) {
      throw new Error("Invalid credentials: valid email address is required");
    }
  }

  private isValidEmail(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  getCredentials(): LoginCredentials {
    return { ...this.credentials };
  }

  async saveSession(sessionData: SessionData): Promise<void> {
    await ensureDir(join(this.sessionPath, ".."));
    
    const sessionJson = JSON.stringify(sessionData, null, 2);
    await Deno.writeTextFile(this.sessionPath, sessionJson);
  }

  async getStoredSession(): Promise<SessionData | null> {
    try {
      const sessionJson = await Deno.readTextFile(this.sessionPath);
      return JSON.parse(sessionJson);
    } catch {
      return null;
    }
  }

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

  async logout(): Promise<void> {
    try {
      await Deno.remove(this.sessionPath);
    } catch {
      // ファイルが存在しない場合は無視
    }
  }

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

  static fromEnvironment(): TaskChuteAuth {
    const email = Deno.env.get("TASKCHUTE_EMAIL");
    const password = Deno.env.get("TASKCHUTE_PASSWORD");

    if (!email || !password) {
      throw new Error("Environment variables TASKCHUTE_EMAIL and TASKCHUTE_PASSWORD are required");
    }

    return new TaskChuteAuth({ email, password });
  }
}