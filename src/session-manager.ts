/**
 * SessionManager - Playwrightのセッション状態管理
 *
 * storageState機能を使用して認証済みセッションを保存・再利用する。
 * これにより、Google OAuthログインの不安定性を回避できる。
 */
import { ensureDir } from "std/fs/mod.ts";
import { dirname } from "std/path/mod.ts";

/**
 * SessionManagerのオプション
 */
export interface SessionManagerOptions {
  /** セッションの有効期限（時間単位、デフォルト: 24時間） */
  expiryHours?: number;
}

/**
 * セッション情報
 */
export interface SessionInfo {
  /** セッションファイルが存在するか */
  exists: boolean;
  /** 最終更新日時 */
  lastModified: Date | null;
  /** セッションが有効か */
  isValid: boolean;
  /** 残り有効時間（分） */
  remainingMinutes?: number;
}

/**
 * BrowserContextオプション
 */
export interface ContextOptions {
  /** storageStateファイルパス */
  storageState?: string;
}

/**
 * セッション状態の保存・復元を管理するクラス
 *
 * @example
 * ```typescript
 * const manager = new SessionManager();
 *
 * // セッションの有効性をチェック
 * if (await manager.isSessionValid()) {
 *   // 有効なセッションを使用
 *   const options = await manager.getContextOptions();
 *   const context = await browser.newContext(options);
 * } else {
 *   // 新規ログインが必要
 * }
 * ```
 */
export class SessionManager {
  private storagePath: string;
  private expiryMs: number;

  /**
   * SessionManagerを初期化
   *
   * @param storagePath storageStateファイルのパス（省略時はデフォルトパス）
   * @param options オプション設定
   */
  constructor(storagePath?: string, options: SessionManagerOptions = {}) {
    const home = Deno.env.get("HOME") || ".";
    this.storagePath = storagePath ||
      `${home}/.taskchute/storage-state.json`;

    // 有効期限をミリ秒に変換（デフォルト: 24時間）
    const expiryHours = options.expiryHours ?? 24;
    this.expiryMs = expiryHours * 60 * 60 * 1000;
  }

  /**
   * storageStateファイルのパスを取得
   */
  getStoragePath(): string {
    return this.storagePath;
  }

  /**
   * storageStateファイルが存在し有効かチェック
   *
   * @returns セッションが有効な場合はtrue
   */
  async isSessionValid(): Promise<boolean> {
    try {
      const stat = await Deno.stat(this.storagePath);

      if (!stat.mtime) {
        return false;
      }

      // ファイルの更新時刻からの経過時間を計算
      const age = Date.now() - stat.mtime.getTime();
      return age < this.expiryMs;
    } catch {
      // ファイルが存在しない場合
      return false;
    }
  }

  /**
   * セッション情報を取得
   *
   * @returns セッション情報
   */
  async getSessionInfo(): Promise<SessionInfo> {
    try {
      const stat = await Deno.stat(this.storagePath);

      if (!stat.mtime) {
        return {
          exists: true,
          lastModified: null,
          isValid: false,
        };
      }

      const age = Date.now() - stat.mtime.getTime();
      const isValid = age < this.expiryMs;
      const remainingMs = this.expiryMs - age;
      const remainingMinutes = isValid ? Math.floor(remainingMs / 60000) : 0;

      return {
        exists: true,
        lastModified: stat.mtime,
        isValid,
        remainingMinutes,
      };
    } catch {
      return {
        exists: false,
        lastModified: null,
        isValid: false,
      };
    }
  }

  /**
   * BrowserContext作成用のオプションを取得
   *
   * セッションが有効な場合はstorageStateを含むオプションを返す。
   * 無効な場合は空のオプションを返す。
   *
   * @returns BrowserContextオプション
   */
  async getContextOptions(): Promise<ContextOptions> {
    const isValid = await this.isSessionValid();

    if (isValid) {
      return {
        storageState: this.storagePath,
      };
    }

    return {};
  }

  /**
   * セッションをクリア（ファイルを削除）
   */
  async clearSession(): Promise<void> {
    try {
      await Deno.remove(this.storagePath);
    } catch {
      // ファイルが存在しない場合は無視
    }
  }

  /**
   * BrowserContextからstorageStateを保存
   *
   * @param context Playwright BrowserContext
   */
  async saveSession(context: { storageState: (options: { path: string }) => Promise<unknown> }): Promise<void> {
    // ディレクトリが存在しない場合は作成
    await ensureDir(dirname(this.storagePath));

    // storageStateを保存
    await context.storageState({ path: this.storagePath });
  }

  /**
   * storageStateファイルを直接作成（テスト用）
   *
   * @param data storageStateデータ
   */
  async writeStorageState(data: { cookies: unknown[]; origins: unknown[] }): Promise<void> {
    await ensureDir(dirname(this.storagePath));
    await Deno.writeTextFile(this.storagePath, JSON.stringify(data, null, 2));
  }
}
