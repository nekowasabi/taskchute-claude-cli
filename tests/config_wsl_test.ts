/**
 * WSL互換性テスト - config.ts
 *
 * ConfigManagerがTASKCHUTE_CHROME_PATH環境変数をサポートすることを検証
 */

import { assertEquals, assertExists } from "std/assert/mod.ts";
import { ConfigManager } from "../src/config.ts";

Deno.test("ConfigManager - TASKCHUTE_CHROME_PATH環境変数が設定されている場合", () => {
  // 環境変数を設定
  const originalChromePath = Deno.env.get("TASKCHUTE_CHROME_PATH");
  const testChromePath = "/mnt/c/Program Files/Google/Chrome/Application/chrome.exe";

  Deno.env.set("TASKCHUTE_CHROME_PATH", testChromePath);

  try {
    const configManager = new ConfigManager();
    const config = configManager.getConfigSync();

    // 環境変数から取得されたパスが設定されているか確認
    assertExists(config);
    assertEquals(config.fetcher.userDataDir, testChromePath);
  } finally {
    // 元の値を復元
    if (originalChromePath !== undefined) {
      Deno.env.set("TASKCHUTE_CHROME_PATH", originalChromePath);
    } else {
      Deno.env.delete("TASKCHUTE_CHROME_PATH");
    }
  }
});

Deno.test("ConfigManager - 基本的な設定取得", () => {
  const configManager = new ConfigManager();
  const config = configManager.getConfigSync();

  assertExists(config);
  assertExists(config.fetcher);
  assertExists(config.general);
  assertExists(config.auth);
});

Deno.test("ConfigManager - ヘッドレスモード設定", () => {
  const originalHeadless = Deno.env.get("TASKCHUTE_HEADLESS");

  Deno.env.set("TASKCHUTE_HEADLESS", "false");

  try {
    const configManager = new ConfigManager();
    const config = configManager.getConfigSync();

    assertEquals(config.fetcher.headless, false);
  } finally {
    if (originalHeadless !== undefined) {
      Deno.env.set("TASKCHUTE_HEADLESS", originalHeadless);
    } else {
      Deno.env.delete("TASKCHUTE_HEADLESS");
    }
  }
});

Deno.test("ConfigManager - タイムアウト設定", () => {
  const originalTimeout = Deno.env.get("TASKCHUTE_TIMEOUT");

  Deno.env.set("TASKCHUTE_TIMEOUT", "60000");

  try {
    const configManager = new ConfigManager();
    const config = configManager.getConfigSync();

    assertEquals(config.fetcher.timeout, 60000);
  } finally {
    if (originalTimeout !== undefined) {
      Deno.env.set("TASKCHUTE_TIMEOUT", originalTimeout);
    } else {
      Deno.env.delete("TASKCHUTE_TIMEOUT");
    }
  }
});
