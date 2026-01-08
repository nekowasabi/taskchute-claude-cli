/**
 * SessionManager TDDテスト
 *
 * storageStateを使用した認証状態の保存・復元を管理するクラスのテスト
 */
import { assertEquals, assertRejects, assertStringIncludes } from "testing/asserts.ts";
import { ensureDir } from "std/fs/mod.ts";

// テスト用の一時ディレクトリ
const TEST_DIR = "./tmp/claude/session-manager-test";

// テスト前にディレクトリを作成
async function setupTestDir(): Promise<void> {
  await ensureDir(TEST_DIR);
}

// テスト後にクリーンアップ
async function cleanupTestDir(): Promise<void> {
  try {
    await Deno.remove(TEST_DIR, { recursive: true });
  } catch {
    // ディレクトリが存在しない場合は無視
  }
}

// ========================================
// SessionManager クラスのテスト
// ========================================

Deno.test("SessionManager - 初期化テスト", async (t) => {
  await setupTestDir();

  // テスト後はSessionManagerをインポートしてテストを実行
  // 現在はインターフェース設計のためのテストを先に記述

  await t.step("デフォルトパスで初期化できること", async () => {
    const { SessionManager } = await import("../src/session-manager.ts");
    const manager = new SessionManager();
    const path = manager.getStoragePath();

    assertStringIncludes(path, ".taskchute");
    assertStringIncludes(path, "storage-state.json");
  });

  await t.step("カスタムパスで初期化できること", async () => {
    const { SessionManager } = await import("../src/session-manager.ts");
    const customPath = `${TEST_DIR}/custom-storage.json`;
    const manager = new SessionManager(customPath);

    assertEquals(manager.getStoragePath(), customPath);
  });

  await cleanupTestDir();
});

Deno.test("SessionManager - セッション有効性チェック", async (t) => {
  await setupTestDir();

  await t.step("storageStateファイルが存在しない場合はfalseを返すこと", async () => {
    const { SessionManager } = await import("../src/session-manager.ts");
    const manager = new SessionManager(`${TEST_DIR}/non-existent.json`);

    const isValid = await manager.isSessionValid();
    assertEquals(isValid, false);
  });

  await t.step("storageStateファイルが24時間以内に作成された場合はtrueを返すこと", async () => {
    const { SessionManager } = await import("../src/session-manager.ts");
    const testPath = `${TEST_DIR}/valid-session.json`;

    // テスト用のstorageStateファイルを作成
    const mockStorageState = {
      cookies: [],
      origins: []
    };
    await Deno.writeTextFile(testPath, JSON.stringify(mockStorageState));

    const manager = new SessionManager(testPath);
    const isValid = await manager.isSessionValid();

    assertEquals(isValid, true);
  });

  await t.step("storageStateファイルが24時間以上前の場合はfalseを返すこと", async () => {
    const { SessionManager } = await import("../src/session-manager.ts");
    const testPath = `${TEST_DIR}/expired-session.json`;

    // テスト用のstorageStateファイルを作成
    const mockStorageState = {
      cookies: [],
      origins: []
    };
    await Deno.writeTextFile(testPath, JSON.stringify(mockStorageState));

    // ファイルの更新時刻を25時間前に設定（Denoではutime APIを使用）
    const pastTime = Date.now() - (25 * 60 * 60 * 1000);
    await Deno.utime(testPath, pastTime / 1000, pastTime / 1000);

    const manager = new SessionManager(testPath);
    const isValid = await manager.isSessionValid();

    assertEquals(isValid, false);
  });

  await cleanupTestDir();
});

Deno.test("SessionManager - セッションクリア", async (t) => {
  await setupTestDir();

  await t.step("存在するセッションファイルを削除できること", async () => {
    const { SessionManager } = await import("../src/session-manager.ts");
    const testPath = `${TEST_DIR}/to-clear.json`;

    // ファイルを作成
    await Deno.writeTextFile(testPath, "{}");

    const manager = new SessionManager(testPath);
    await manager.clearSession();

    // ファイルが削除されたことを確認
    let fileExists = true;
    try {
      await Deno.stat(testPath);
    } catch {
      fileExists = false;
    }
    assertEquals(fileExists, false);
  });

  await t.step("存在しないファイルをクリアしてもエラーにならないこと", async () => {
    const { SessionManager } = await import("../src/session-manager.ts");
    const manager = new SessionManager(`${TEST_DIR}/non-existent.json`);

    // エラーが発生しないことを確認
    await manager.clearSession();
  });

  await cleanupTestDir();
});

Deno.test("SessionManager - セッション情報取得", async (t) => {
  await setupTestDir();

  await t.step("セッション情報を取得できること", async () => {
    const { SessionManager } = await import("../src/session-manager.ts");
    const testPath = `${TEST_DIR}/info-session.json`;

    // テスト用のstorageStateを作成
    const mockStorageState = {
      cookies: [
        { name: "session", value: "test-value", domain: "taskchute.cloud" }
      ],
      origins: [
        { origin: "https://taskchute.cloud", localStorage: [] }
      ]
    };
    await Deno.writeTextFile(testPath, JSON.stringify(mockStorageState));

    const manager = new SessionManager(testPath);
    const info = await manager.getSessionInfo();

    assertEquals(info.exists, true);
    assertEquals(typeof info.lastModified, "object");
    assertEquals(info.isValid, true);
  });

  await t.step("存在しないセッションの情報を取得できること", async () => {
    const { SessionManager } = await import("../src/session-manager.ts");
    const manager = new SessionManager(`${TEST_DIR}/non-existent.json`);

    const info = await manager.getSessionInfo();

    assertEquals(info.exists, false);
    assertEquals(info.lastModified, null);
    assertEquals(info.isValid, false);
  });

  await cleanupTestDir();
});

Deno.test("SessionManager - セッション有効期限設定", async (t) => {
  await setupTestDir();

  await t.step("カスタム有効期限を設定できること", async () => {
    const { SessionManager } = await import("../src/session-manager.ts");
    const testPath = `${TEST_DIR}/custom-expiry.json`;

    // 12時間の有効期限を設定
    const manager = new SessionManager(testPath, { expiryHours: 12 });

    // ファイルを作成
    const mockStorageState = { cookies: [], origins: [] };
    await Deno.writeTextFile(testPath, JSON.stringify(mockStorageState));

    // 10時間前のファイルは有効
    const tenHoursAgo = Date.now() - (10 * 60 * 60 * 1000);
    await Deno.utime(testPath, tenHoursAgo / 1000, tenHoursAgo / 1000);

    let isValid = await manager.isSessionValid();
    assertEquals(isValid, true);

    // 13時間前のファイルは無効
    const thirteenHoursAgo = Date.now() - (13 * 60 * 60 * 1000);
    await Deno.utime(testPath, thirteenHoursAgo / 1000, thirteenHoursAgo / 1000);

    isValid = await manager.isSessionValid();
    assertEquals(isValid, false);
  });

  await cleanupTestDir();
});

// ========================================
// BrowserContext統合テスト（モック）
// ========================================

Deno.test("SessionManager - BrowserContext統合（モック）", async (t) => {
  await setupTestDir();

  await t.step("storageStateからコンテキストオプションを生成できること", async () => {
    const { SessionManager } = await import("../src/session-manager.ts");
    const testPath = `${TEST_DIR}/context-options.json`;

    // ファイルを作成
    const mockStorageState = { cookies: [], origins: [] };
    await Deno.writeTextFile(testPath, JSON.stringify(mockStorageState));

    const manager = new SessionManager(testPath);
    const options = await manager.getContextOptions();

    assertEquals(options.storageState, testPath);
  });

  await t.step("セッションが無効な場合は空のオプションを返すこと", async () => {
    const { SessionManager } = await import("../src/session-manager.ts");
    const manager = new SessionManager(`${TEST_DIR}/non-existent.json`);

    const options = await manager.getContextOptions();

    assertEquals(options.storageState, undefined);
  });

  await cleanupTestDir();
});
