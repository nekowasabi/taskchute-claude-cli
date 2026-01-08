/**
 * Cookie Manager
 * Windows ChromeからエクスポートしたCookieをPlaywrightに注入する機能を提供
 *
 * 使用方法:
 * 1. Windows Chromeで「EditThisCookie」拡張機能をインストール
 * 2. taskchute.cloud と accounts.google.com にログイン
 * 3. EditThisCookieでCookieをJSONエクスポート
 * 4. taskchute-cli import-cookies <cookies.json> でインポート
 */

import { ensureDir } from "std/fs/mod.ts";
import { join } from "std/path/mod.ts";
import type { BrowserContext } from "playwright";

/**
 * EditThisCookie形式のCookie
 */
export interface EditThisCookieFormat {
  domain: string;
  expirationDate?: number;
  hostOnly?: boolean;
  httpOnly?: boolean;
  name: string;
  path: string;
  sameSite?: string;
  secure?: boolean;
  session?: boolean;
  storeId?: string;
  value: string;
  id?: number;
}

/**
 * Playwright形式のCookie
 */
export interface PlaywrightCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: "Strict" | "Lax" | "None";
}

/**
 * Cookie Manager Result
 */
export interface CookieManagerResult {
  success: boolean;
  error?: string;
  cookieCount?: number;
  domains?: string[];
}

/**
 * Cookie Manager クラス
 */
export class CookieManager {
  private cookieStorePath: string;

  constructor() {
    const home = Deno.env.get("HOME") || ".";
    this.cookieStorePath = join(home, ".taskchute", "cookies.json");
  }

  /**
   * EditThisCookie形式のJSONファイルからCookieを読み込む
   * @param filePath JSONファイルのパス
   * @returns Cookieの配列
   */
  async loadCookiesFromFile(filePath: string): Promise<EditThisCookieFormat[]> {
    try {
      const content = await Deno.readTextFile(filePath);
      const cookies = JSON.parse(content);

      if (!Array.isArray(cookies)) {
        throw new Error("JSONファイルはCookieの配列である必要があります");
      }

      return cookies;
    } catch (error) {
      throw new Error(`Cookieファイルの読み込みに失敗しました: ${(error as Error).message}`);
    }
  }

  /**
   * EditThisCookie形式をPlaywright形式に変換
   * @param cookies EditThisCookie形式のCookie配列
   * @returns Playwright形式のCookie配列
   */
  convertToPlaywrightFormat(cookies: EditThisCookieFormat[]): PlaywrightCookie[] {
    return cookies.map(cookie => {
      // sameSite値の変換
      let sameSite: "Strict" | "Lax" | "None" | undefined;
      if (cookie.sameSite) {
        const sameSiteLower = cookie.sameSite.toLowerCase();
        if (sameSiteLower === "strict") sameSite = "Strict";
        else if (sameSiteLower === "lax") sameSite = "Lax";
        else if (sameSiteLower === "none" || sameSiteLower === "no_restriction") sameSite = "None";
      }

      // domainの正規化（先頭のドットを保持）
      let domain = cookie.domain;
      if (cookie.hostOnly === false && !domain.startsWith(".")) {
        domain = "." + domain;
      }

      const playwrightCookie: PlaywrightCookie = {
        name: cookie.name,
        value: cookie.value,
        domain: domain,
        path: cookie.path || "/",
        httpOnly: cookie.httpOnly ?? false,
        secure: cookie.secure ?? false,
      };

      // expiresは-1の場合セッションCookie
      if (cookie.expirationDate && cookie.expirationDate > 0) {
        playwrightCookie.expires = cookie.expirationDate;
      }

      if (sameSite) {
        playwrightCookie.sameSite = sameSite;
      }

      return playwrightCookie;
    });
  }

  /**
   * TaskChute Cloud関連のCookieをフィルタリング
   * @param cookies Cookie配列
   * @returns フィルタリングされたCookie配列
   */
  filterTaskChuteCookies(cookies: PlaywrightCookie[]): PlaywrightCookie[] {
    const relevantDomains = [
      "taskchute.cloud",
      ".taskchute.cloud",
      "google.com",
      ".google.com",
      "accounts.google.com",
      ".accounts.google.com",
      "googleapis.com",
      ".googleapis.com",
    ];

    return cookies.filter(cookie => {
      const domain = cookie.domain.toLowerCase();
      return relevantDomains.some(d =>
        domain === d ||
        domain.endsWith(d) ||
        (d.startsWith(".") && domain.endsWith(d.substring(1)))
      );
    });
  }

  /**
   * CookieをPlaywrightのBrowserContextに注入
   * @param context Playwright BrowserContext
   * @param cookies Cookie配列
   */
  async injectCookies(context: BrowserContext, cookies: PlaywrightCookie[]): Promise<void> {
    // Playwrightが期待する形式に変換
    const cookiesToAdd = cookies.map(cookie => ({
      name: cookie.name,
      value: cookie.value,
      domain: cookie.domain,
      path: cookie.path,
      expires: cookie.expires,
      httpOnly: cookie.httpOnly,
      secure: cookie.secure,
      sameSite: cookie.sameSite,
    }));

    await context.addCookies(cookiesToAdd);
  }

  /**
   * Cookieをファイルに保存（次回使用のため）
   * @param cookies Cookie配列
   */
  async saveCookies(cookies: PlaywrightCookie[]): Promise<void> {
    await ensureDir(join(this.cookieStorePath, ".."));
    await Deno.writeTextFile(this.cookieStorePath, JSON.stringify(cookies, null, 2));
    console.log(`Cookieを保存しました: ${this.cookieStorePath}`);
  }

  /**
   * 保存されたCookieを読み込む
   * @returns Cookie配列またはnull
   */
  async loadSavedCookies(): Promise<PlaywrightCookie[] | null> {
    try {
      const content = await Deno.readTextFile(this.cookieStorePath);
      return JSON.parse(content);
    } catch {
      return null;
    }
  }

  /**
   * 保存されたCookieが存在するか確認
   */
  async hasSavedCookies(): Promise<boolean> {
    try {
      await Deno.stat(this.cookieStorePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * JSONファイルからCookieをインポートし、保存する
   * @param filePath JSONファイルのパス
   * @returns 処理結果
   */
  async importCookiesFromFile(filePath: string): Promise<CookieManagerResult> {
    try {
      // ファイルからCookieを読み込む
      const rawCookies = await this.loadCookiesFromFile(filePath);
      console.log(`読み込んだCookie数: ${rawCookies.length}`);

      // Playwright形式に変換
      const playwrightCookies = this.convertToPlaywrightFormat(rawCookies);

      // TaskChute関連のCookieをフィルタリング
      const filteredCookies = this.filterTaskChuteCookies(playwrightCookies);
      console.log(`TaskChute関連Cookie数: ${filteredCookies.length}`);

      // ドメイン一覧を取得
      const domains = [...new Set(filteredCookies.map(c => c.domain))];
      console.log(`関連ドメイン: ${domains.join(", ")}`);

      // Cookieを保存
      await this.saveCookies(filteredCookies);

      return {
        success: true,
        cookieCount: filteredCookies.length,
        domains,
      };
    } catch (error) {
      return {
        success: false,
        error: (error as Error).message,
      };
    }
  }

  /**
   * Cookieの有効期限を確認
   * @param cookies Cookie配列
   * @returns 有効期限切れのCookie名の配列
   */
  checkCookieExpiration(cookies: PlaywrightCookie[]): string[] {
    const now = Date.now() / 1000; // Unix timestamp in seconds
    const expired: string[] = [];

    for (const cookie of cookies) {
      if (cookie.expires && cookie.expires < now) {
        expired.push(cookie.name);
      }
    }

    return expired;
  }

  /**
   * Cookie保存ファイルのパスを取得
   */
  getCookieStorePath(): string {
    return this.cookieStorePath;
  }
}

/**
 * Cookie情報を表示するヘルパー関数
 */
export function displayCookieInfo(cookies: PlaywrightCookie[]): void {
  console.log("\n=== Cookie情報 ===");

  // ドメイン別にグループ化
  const byDomain = new Map<string, PlaywrightCookie[]>();
  for (const cookie of cookies) {
    const existing = byDomain.get(cookie.domain) || [];
    existing.push(cookie);
    byDomain.set(cookie.domain, existing);
  }

  for (const [domain, domainCookies] of byDomain) {
    console.log(`\n[${domain}] (${domainCookies.length}個)`);
    for (const cookie of domainCookies) {
      const expiry = cookie.expires
        ? new Date(cookie.expires * 1000).toLocaleString()
        : "セッション";
      console.log(`  - ${cookie.name}: ${cookie.value.substring(0, 20)}... (期限: ${expiry})`);
    }
  }
}
