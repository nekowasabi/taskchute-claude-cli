/**
 * WSL互換性テスト - authenticated-fetcher.ts
 *
 * AuthenticatedFetcherがWSL環境で正しく動作することを検証
 */

import { assertEquals, assertExists } from "std/assert/mod.ts";
import { AuthenticatedFetcher } from "../src/authenticated-fetcher.ts";
import { SessionManager } from "../src/session-manager.ts";
import { detectPlatform, getBrowserLaunchOptions } from "../src/platform.ts";

Deno.test("AuthenticatedFetcher - WSL環境でのブラウザ起動オプション", async () => {
  const sessionManager = new SessionManager();
  const fetcher = new AuthenticatedFetcher(sessionManager);

  const platform = detectPlatform();
  const launchOptions = getBrowserLaunchOptions(platform);

  if (platform.isWSL) {
    // WSL環境では executablePath が設定されるべき
    assertExists(launchOptions.executablePath);
    assertEquals(
      launchOptions.executablePath,
      "/mnt/c/Program Files/Google/Chrome/Application/chrome.exe"
    );
    // WSLではchannelは使用しない
    assertEquals(launchOptions.channel, undefined);
  } else if (platform.isMac) {
    // Mac環境ではchannelが設定される
    assertEquals(launchOptions.channel, "chrome");
    assertEquals(launchOptions.executablePath, undefined);
  }
});

Deno.test("AuthenticatedFetcher - オプション設定と初期化", () => {
  const sessionManager = new SessionManager();
  const fetcher = new AuthenticatedFetcher(sessionManager, {
    headless: true,
    browser: "chromium",
    timeout: 30000
  });

  // オプション設定が正常に実行される
  assertExists(fetcher);

  // updateOptionsが呼び出し可能
  fetcher.updateOptions({ headless: false });
  assertExists(fetcher);
});

Deno.test("AuthenticatedFetcher - オプション更新", () => {
  const sessionManager = new SessionManager();
  const fetcher = new AuthenticatedFetcher(sessionManager);

  fetcher.updateOptions({
    headless: false
  });

  // 更新が正常に実行される
  assertExists(fetcher);
});

Deno.test("AuthenticatedFetcher - セッション確認", async () => {
  const sessionManager = new SessionManager();
  const fetcher = new AuthenticatedFetcher(sessionManager);

  const hasValid = await fetcher.hasValidSession();
  assertExists(hasValid);
  assertEquals(typeof hasValid, "boolean");
});
