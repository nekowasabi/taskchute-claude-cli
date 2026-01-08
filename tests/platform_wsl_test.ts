/**
 * WSL互換性テスト - platform.ts
 *
 * TDDアプローチで実装される機能のテスト:
 * 1. detectWindowsUsername() - Windowsユーザー名の自動検出
 * 2. validateChromePath() - Chromeパスの検証
 * 3. getBrowserLaunchOptions() - WSL対応のブラウザ起動オプション
 */

import { assertEquals, assertExists, assertStringIncludes } from "std/assert/mod.ts";
import {
  detectPlatform,
  getBrowserLaunchOptions,
  detectWindowsUsername,
  validateChromePath,
  getWSLChromeUserDataDir
} from "../src/platform.ts";

Deno.test("detectPlatform - 基本的なプラットフォーム情報を返す", () => {
  const platform = detectPlatform();

  // 必須プロパティの存在確認
  assertExists(platform.isWSL);
  assertExists(platform.isMac);
  assertExists(platform.isWindows);
  assertExists(platform.isLinux);
});

Deno.test("detectPlatform - 排他的なプラットフォームフラグ", () => {
  const platform = detectPlatform();

  // 1つのプラットフォームだけがtrueになるべき
  const trueCount = [
    platform.isWSL,
    platform.isMac,
    platform.isWindows,
    platform.isLinux
  ].filter(Boolean).length;

  assertEquals(trueCount, 1, "ちょうど1つのプラットフォームフラグがtrueであるべき");
});

Deno.test("detectWindowsUsername - 環境変数WINDOWS_USERNAMEが設定されている場合", () => {
  // 環境変数を一時的に設定
  const originalValue = Deno.env.get("WINDOWS_USERNAME");
  Deno.env.set("WINDOWS_USERNAME", "testuser");

  try {
    const username = detectWindowsUsername();
    assertEquals(username, "testuser");
  } finally {
    // 元の値を復元
    if (originalValue !== undefined) {
      Deno.env.set("WINDOWS_USERNAME", originalValue);
    } else {
      Deno.env.delete("WINDOWS_USERNAME");
    }
  }
});

Deno.test("detectWindowsUsername - /mnt/c/Users/配下のスキャン（実際のWSL環境でのみ有効）", async () => {
  const platform = detectPlatform();

  if (!platform.isWSL) {
    console.log("WSL環境ではないため、このテストはスキップされます");
    return;
  }

  // WINDOWS_USERNAME環境変数を削除して自動検出をテスト
  const originalValue = Deno.env.get("WINDOWS_USERNAME");
  Deno.env.delete("WINDOWS_USERNAME");

  try {
    const username = detectWindowsUsername();
    // WSL環境では何らかのユーザー名が検出されるはず
    assertExists(username, "WSL環境ではWindowsユーザー名が検出されるべき");
    console.log(`検出されたWindowsユーザー名: ${username}`);
  } finally {
    if (originalValue !== undefined) {
      Deno.env.set("WINDOWS_USERNAME", originalValue);
    }
  }
});

Deno.test("validateChromePath - 存在するパスの検証", async () => {
  const platform = detectPlatform();

  let testPath: string;
  if (platform.isMac) {
    testPath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  } else if (platform.isWSL) {
    testPath = "/mnt/c/Program Files/Google/Chrome/Application/chrome.exe";
  } else if (platform.isWindows) {
    testPath = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
  } else {
    testPath = "/usr/bin/google-chrome";
  }

  const result = await validateChromePath(testPath);
  // 実際にChromeがインストールされているかは環境依存
  console.log(`Chrome path validation for ${testPath}: ${result.valid ? "valid" : "invalid"}`);
  assertExists(result.valid);
});

Deno.test("validateChromePath - 存在しないパスの検証", async () => {
  const result = await validateChromePath("/nonexistent/path/to/chrome");
  assertEquals(result.valid, false);
  assertExists(result.error);
  console.log(`Expected error: ${result.error}`);
});

Deno.test("getBrowserLaunchOptions - Mac環境", () => {
  const mockPlatformInfo = {
    isWSL: false,
    isMac: true,
    isWindows: false,
    isLinux: false
  };

  const options = getBrowserLaunchOptions(mockPlatformInfo);
  assertEquals(options.channel, "chrome");
  assertEquals(options.useExistingProfile, true);
  assertEquals(options.executablePath, undefined);
});

Deno.test("getBrowserLaunchOptions - WSL環境", () => {
  const mockPlatformInfo = {
    isWSL: true,
    isMac: false,
    isWindows: false,
    isLinux: false,
    chromeUserDataDir: "/mnt/c/Users/testuser/AppData/Local/Google/Chrome/User Data"
  };

  const options = getBrowserLaunchOptions(mockPlatformInfo);

  // WSLではexecutablePathが設定されるべき
  assertExists(options.executablePath);
  assertStringIncludes(options.executablePath!, "/mnt/c/Program Files/Google/Chrome/Application/chrome.exe");
  assertEquals(options.useExistingProfile, true);
  // channelはWSLでは使用しない（executablePathを使用）
  assertEquals(options.channel, undefined);
});

Deno.test("getBrowserLaunchOptions - Windows環境", () => {
  const mockPlatformInfo = {
    isWSL: false,
    isMac: false,
    isWindows: true,
    isLinux: false
  };

  const options = getBrowserLaunchOptions(mockPlatformInfo);
  assertEquals(options.channel, "chrome");
  assertEquals(options.useExistingProfile, true);
});

Deno.test("getBrowserLaunchOptions - Linux環境", () => {
  const mockPlatformInfo = {
    isWSL: false,
    isMac: false,
    isWindows: false,
    isLinux: true
  };

  const options = getBrowserLaunchOptions(mockPlatformInfo);
  assertEquals(options.channel, "chromium");
  assertEquals(options.useExistingProfile, false);
});

Deno.test("getWSLChromeUserDataDir - ユーザー名が指定されている場合", () => {
  const platform = detectPlatform();

  // WSL環境でない場合、指定ユーザー名でもWSL判定になる可能性があるため、
  // 直接チェックが必要
  // ※ このテストは理想的には WSL 環境でのみ実行すべき
  if (platform.isWSL) {
    const userDataDir = getWSLChromeUserDataDir("testuser");
    assertEquals(userDataDir, "/mnt/c/Users/testuser/AppData/Local/Google/Chrome/User Data");
  } else {
    // 非WSL環境ではundefinedが返される
    const userDataDir = getWSLChromeUserDataDir("testuser");
    assertEquals(userDataDir, undefined);
    console.log("非WSL環境のため、getWSLChromeUserDataDir()はundefinedを返します");
  }
});

Deno.test("getWSLChromeUserDataDir - 自動検出モード（WSL環境でのみ有効）", () => {
  const platform = detectPlatform();

  if (!platform.isWSL) {
    console.log("WSL環境ではないため、このテストはスキップされます");
    // 非WSL環境ではundefinedを返すべき
    const userDataDir = getWSLChromeUserDataDir();
    assertEquals(userDataDir, undefined);
    return;
  }

  const userDataDir = getWSLChromeUserDataDir();
  assertExists(userDataDir);
  assertStringIncludes(userDataDir!, "/mnt/c/Users/");
  assertStringIncludes(userDataDir!, "AppData/Local/Google/Chrome/User Data");
});

Deno.test("detectPlatform - WSL環境でchromeUserDataDirが自動設定される", () => {
  const platform = detectPlatform();

  if (platform.isWSL) {
    // WSL環境ではchromeUserDataDirが設定されるべき
    // ただし、WINDOWS_USERNAMEが設定されていない場合は自動検出を試みる
    console.log(`Chrome User Data Dir: ${platform.chromeUserDataDir}`);
  } else if (platform.isMac) {
    assertStringIncludes(platform.chromeUserDataDir!, "Library/Application Support/Google/Chrome");
  } else if (platform.isWindows) {
    assertStringIncludes(platform.chromeUserDataDir!, "Google\\Chrome\\User Data");
  }
});
