/**
 * WSL互換性テスト - fetcher.ts
 *
 * fetcher.tsがWSL環境でexecutablePathを正しく使用することを検証
 */

import { assertEquals, assertExists } from "std/assert/mod.ts";
import { TaskChuteDataFetcher } from "../src/fetcher.ts";
import { detectPlatform, getBrowserLaunchOptions } from "../src/platform.ts";

Deno.test("TaskChuteDataFetcher - WSL環境でのブラウザ起動オプション", async () => {
  const platform = detectPlatform();
  const launchOptions = getBrowserLaunchOptions(platform);

  if (platform.isWSL) {
    // WSL環境では executablePath が設定されるべき
    assertExists(launchOptions.executablePath);
    assertEquals(launchOptions.executablePath, "/mnt/c/Program Files/Google/Chrome/Application/chrome.exe");
    // WSLではchannelは使用しない
    assertEquals(launchOptions.channel, undefined);
  } else if (platform.isMac) {
    // Mac環境ではchannelが設定される
    assertEquals(launchOptions.channel, "chrome");
    assertEquals(launchOptions.executablePath, undefined);
  } else if (platform.isWindows) {
    // Windows環境ではchannelが設定される
    assertEquals(launchOptions.channel, "chrome");
    assertEquals(launchOptions.executablePath, undefined);
  } else {
    // Linux環境ではchromiumが設定される
    assertEquals(launchOptions.channel, "chromium");
    assertEquals(launchOptions.executablePath, undefined);
  }
});

Deno.test("TaskChuteDataFetcher - オプション取得", () => {
  const fetcher = new TaskChuteDataFetcher({
    headless: true,
    browser: "chromium"
  });

  const options = fetcher.getOptions();
  assertEquals(options.headless, true);
  assertEquals(options.browser, "chromium");
  assertExists(options.userDataDir);
});

Deno.test("TaskChuteDataFetcher - オプション更新", () => {
  const fetcher = new TaskChuteDataFetcher();
  const originalOptions = fetcher.getOptions();

  fetcher.updateOptions({
    headless: false
  });

  const updatedOptions = fetcher.getOptions();
  assertEquals(updatedOptions.headless, false);
  // 他のオプションは変わらない
  assertEquals(updatedOptions.browser, originalOptions.browser);
});
