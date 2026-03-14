/**
 * 共通型定義
 * fetcher.ts から分離した共有インターフェース群
 */

/**
 * Fetcherのオプション
 */
export interface FetcherOptions {
  headless?: boolean;
  browser?: "chromium" | "firefox" | "webkit";
  timeout?: number;
  viewport?: { width: number; height: number };
  userDataDir?: string;
}

/**
 * タスクデータ
 */
export interface TaskData {
  id: string;
  title: string;
  status: string;
  description?: string;
  startTime?: string;
  endTime?: string;
  duration?: number;
  category?: string;
  estimatedTime?: string;
  actualTime?: string;
}

/**
 * フェッチ結果
 */
export interface FetchResult<T = any> {
  success: boolean;
  data?: T;
  html?: string;
  tasks?: TaskData[];
  error?: string;
  downloadPath?: string;
}

/**
 * ナビゲーション結果
 */
export interface NavigationResult {
  success: boolean;
  currentUrl?: string;
  error?: string;
}

/**
 * 認証結果（ブラウザフェッチャー用）
 */
export interface AuthResult {
  success: boolean;
  token?: string;
  finalUrl?: string;
  error?: string;
}

/**
 * 保存結果
 */
export interface SaveResult {
  success: boolean;
  filePath?: string;
  error?: string;
}
