/**
 * Chromeプロファイルマネージャー
 * MacのChromeプロファイルからセッション情報をコピーして使用
 */

import { ensureDir, copy } from "std/fs/mod.ts";
import { join } from "std/path/mod.ts";

export interface ChromeProfileConfig {
  sourcePath: string;  // 元のChromeプロファイルパス
  targetPath: string;  // コピー先のパス
  profileName?: string; // 使用するプロファイル名（デフォルト: Default）
}

export class ChromeProfileManager {
  private config: ChromeProfileConfig;
  
  constructor(config?: Partial<ChromeProfileConfig>) {
    const home = Deno.env.get("HOME") || ".";
    this.config = {
      sourcePath: config?.sourcePath || `${home}/Library/Application Support/Google/Chrome`,
      targetPath: config?.targetPath || `${home}/.taskchute/chrome-profile-copy`,
      profileName: config?.profileName || "Default"
    };
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