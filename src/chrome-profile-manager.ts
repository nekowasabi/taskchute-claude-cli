/**
 * Chromeプロファイルマネージャー
 * Mac/WSLのChromeプロファイルからセッション情報をコピーして使用
 *
 * WSL対応:
 * - Windows側のChromeプロファイルをWSLローカルにコピー
 * - lockfile/SingletonLock問題を回避
 */

import { ensureDir, copy } from "std/fs/mod.ts";
import { join } from "std/path/mod.ts";

export interface ChromeProfileConfig {
  sourcePath: string;  // 元のChromeプロファイルパス
  targetPath: string;  // コピー先のパス
  profileName?: string; // 使用するプロファイル名（デフォルト: Default）
  isWSL?: boolean;      // WSL環境かどうか
}

export class ChromeProfileManager {
  private config: ChromeProfileConfig;
  
  constructor(config?: Partial<ChromeProfileConfig>) {
    const home = Deno.env.get("HOME") || ".";
    const isWSL = config?.isWSL || false;

    let defaultSourcePath: string;
    let defaultTargetPath: string;

    if (isWSL) {
      // WSL環境: Windows側のChromeプロファイルを使用
      const windowsUsername = this.detectWindowsUsername();
      defaultSourcePath = windowsUsername
        ? `/mnt/c/Users/${windowsUsername}/AppData/Local/Google/Chrome/User Data`
        : `${home}/Library/Application Support/Google/Chrome`;
      // WSL環境: コピー先もWindows側に配置（UNCパスでのファイルロック問題を回避）
      defaultTargetPath = windowsUsername
        ? `/mnt/c/Users/${windowsUsername}/AppData/Local/TaskChuteCLI/chrome-profile`
        : `${home}/.taskchute/chrome-profile-copy`;
    } else {
      defaultSourcePath = `${home}/Library/Application Support/Google/Chrome`;
      defaultTargetPath = `${home}/.taskchute/chrome-profile-copy`;
    }

    this.config = {
      sourcePath: config?.sourcePath || defaultSourcePath,
      targetPath: config?.targetPath || defaultTargetPath,
      profileName: config?.profileName || "Default",
      isWSL: isWSL
    };
  }

  /**
   * Windowsユーザー名を検出する（WSL環境用）
   */
  private detectWindowsUsername(): string | undefined {
    try {
      const usersPath = "/mnt/c/Users";
      const entries = Deno.readDirSync(usersPath);
      const excludedNames = new Set(["Public", "Default", "Default User", "All Users", "Administrator"]);
      for (const entry of entries) {
        if (entry.isDirectory && !excludedNames.has(entry.name)) {
          return entry.name;
        }
      }
      return undefined;
    } catch {
      return undefined;
    }
  }
  
  /**
   * Chromeプロファイルから必要なファイルをコピー
   */
  async copyProfileData(): Promise<{ success: boolean; error?: string; path?: string }> {
    try {
      console.log("Chromeプロファイルのコピーを開始...");
      
      // ターゲットディレクトリを作成
      await ensureDir(this.config.targetPath);
      
      // コピーするファイル/ディレクトリのリスト
      const itemsToCopy = [
        "Default/Cookies",
        "Default/Cookies-journal",
        "Default/Login Data",
        "Default/Login Data-journal",
        "Default/Web Data",
        "Default/Web Data-journal",
        "Default/Preferences",
        "Default/Local Storage",
        "Default/Session Storage",
        "Default/IndexedDB",
        "Local State"
      ];
      
      // 選択的にコピー
      for (const item of itemsToCopy) {
        const sourcePath = join(this.config.sourcePath, item);
        const targetPath = join(this.config.targetPath, item);
        
        try {
          const stat = await Deno.stat(sourcePath);
          if (stat.isDirectory) {
            await copy(sourcePath, targetPath, { overwrite: true });
            console.log(`✅ ディレクトリをコピー: ${item}`);
          } else {
            // ファイルの場合、親ディレクトリを作成
            const parentDir = join(targetPath, "..");
            await ensureDir(parentDir);
            await Deno.copyFile(sourcePath, targetPath);
            console.log(`✅ ファイルをコピー: ${item}`);
          }
        } catch (e) {
          // ファイルが存在しない場合はスキップ
          console.log(`⚠️ スキップ: ${item}`);
        }
      }
      
      // SingletonLockファイルは削除
      try {
        await Deno.remove(join(this.config.targetPath, "SingletonLock"));
      } catch {
        // ファイルが存在しない場合は無視
      }

      // lockfileも削除（WSL環境で重要）
      try {
        await Deno.remove(join(this.config.targetPath, "lockfile"));
      } catch {
        // ファイルが存在しない場合は無視
      }

      console.log("✅ プロファイルのコピーが完了しました");
      return { success: true, path: this.config.targetPath };
      
    } catch (error) {
      console.error("プロファイルコピーエラー:", error);
      return { 
        success: false, 
        error: `プロファイルのコピーに失敗しました: ${(error as Error).message}` 
      };
    }
  }
  
  /**
   * コピーしたプロファイルをクリーンアップ
   */
  async cleanup(): Promise<void> {
    try {
      await Deno.remove(this.config.targetPath, { recursive: true });
      console.log("プロファイルのクリーンアップが完了しました");
    } catch (error) {
      console.error("クリーンアップエラー:", error);
    }
  }
  
  /**
   * プロファイルパスを取得
   */
  getProfilePath(): string {
    return this.config.targetPath;
  }
  
  /**
   * Chromeプロファイルが存在するかチェック
   */
  async checkSourceProfile(): Promise<boolean> {
    try {
      const stat = await Deno.stat(this.config.sourcePath);
      return stat.isDirectory;
    } catch {
      return false;
    }
  }
}