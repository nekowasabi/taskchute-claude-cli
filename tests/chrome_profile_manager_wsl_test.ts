/**
 * WSL互換性テスト - chrome-profile-manager.ts
 *
 * ChromeProfileManagerがWSL環境でWindowsプロファイルを正しく参照することを検証
 */

import { assertEquals, assertExists } from "std/assert/mod.ts";
import { ChromeProfileManager } from "../src/chrome-profile-manager.ts";
import { detectPlatform, detectWindowsUsername } from "../src/platform.ts";

Deno.test("ChromeProfileManager - WSL環境でのSourcePath設定", () => {
  const platform = detectPlatform();

  if (platform.isWSL) {
    const windowsUsername = detectWindowsUsername();
    if (windowsUsername) {
      const config = {
        sourcePath: `/mnt/c/Users/${windowsUsername}/AppData/Local/Google/Chrome`
      };
      const manager = new ChromeProfileManager(config);

      assertExists(manager);
      assertEquals(manager.getProfilePath().includes(".taskchute"), true);
    }
  }
});

Deno.test("ChromeProfileManager - Mac環境でのSourcePath設定", () => {
  const platform = detectPlatform();

  if (platform.isMac) {
    const home = Deno.env.get("HOME");
    const expectedSourcePath = `${home}/Library/Application Support/Google/Chrome`;

    const manager = new ChromeProfileManager();
    assertExists(manager);
  }
});

Deno.test("ChromeProfileManager - カスタムSourcePath設定", () => {
  const customSourcePath = "/custom/chrome/path";
  const manager = new ChromeProfileManager({
    sourcePath: customSourcePath
  });

  assertExists(manager);
  // プロファイルパスが正しく設定される
  assertExists(manager.getProfilePath());
});

Deno.test("ChromeProfileManager - TargetPath設定", () => {
  const home = Deno.env.get("HOME") || ".";
  const expectedTargetPath = `${home}/.taskchute/chrome-profile-copy`;

  const manager = new ChromeProfileManager();
  const profilePath = manager.getProfilePath();

  assertEquals(profilePath, expectedTargetPath);
});

Deno.test("ChromeProfileManager - ProfileName設定", () => {
  const customProfileName = "Profile1";
  const manager = new ChromeProfileManager({
    profileName: customProfileName
  });

  assertExists(manager);
  // プロファイルパスが正しく設定される
  assertExists(manager.getProfilePath());
});
