/**
 * Login with StorageState TDDテスト
 *
 * storageStateを使用したログインフローのテスト
 */
import { assertEquals, assertStringIncludes } from "testing/asserts.ts";
import { ensureDir } from "std/fs/mod.ts";

// テスト用の一時ディレクトリ
const TEST_DIR = "./tmp/claude/login-storage-test";

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
// AuthenticatedFetcher クラスのテスト
// ========================================

Deno.test("AuthenticatedFetcher - 初期化テスト", async (t) => {
  await setupTestDir();

  await t.step("SessionManagerと共に初期化できること", async () => {
    const { SessionManager } = await import("../src/session-manager.ts");
    const { AuthenticatedFetcher } = await import("../src/authenticated-fetcher.ts");

    const sessionManager = new SessionManager(`${TEST_DIR}/storage-state.json`);
    const fetcher = new AuthenticatedFetcher(sessionManager);

    assertEquals(typeof fetcher, "object");
    assertEquals(await fetcher.hasValidSession(), false);
  });

  await t.step("有効なセッションがある場合はtrueを返すこと", async () => {
    const { SessionManager } = await import("../src/session-manager.ts");
    const { AuthenticatedFetcher } = await import("../src/authenticated-fetcher.ts");

    const sessionPath = `${TEST_DIR}/valid-session.json`;
    const mockStorageState = { cookies: [], origins: [] };
    await Deno.writeTextFile(sessionPath, JSON.stringify(mockStorageState));

    const sessionManager = new SessionManager(sessionPath);
    const fetcher = new AuthenticatedFetcher(sessionManager);

    assertEquals(await fetcher.hasValidSession(), true);
  });

  await cleanupTestDir();
});

Deno.test("AuthenticatedFetcher - ブラウザ起動", async (t) => {
  await setupTestDir();

  await t.step("storageStateを使用してコンテキストを作成できること（モック）", async () => {
    const { SessionManager } = await import("../src/session-manager.ts");
    const { AuthenticatedFetcher } = await import("../src/authenticated-fetcher.ts");

    const sessionPath = `${TEST_DIR}/context-session.json`;
    const mockStorageState = {
      cookies: [
        { name: "session", value: "test", domain: "taskchute.cloud" }
      ],
      origins: []
    };
    await Deno.writeTextFile(sessionPath, JSON.stringify(mockStorageState));

    const sessionManager = new SessionManager(sessionPath);
    const fetcher = new AuthenticatedFetcher(sessionManager);

    // モックモードで起動オプションを取得
    const launchOptions = await fetcher.getLaunchOptions({ useMock: true });

    assertEquals(launchOptions.storageState, sessionPath);
  });

  await t.step("セッションが無効な場合はstorageStateなしで起動すること", async () => {
    const { SessionManager } = await import("../src/session-manager.ts");
    const { AuthenticatedFetcher } = await import("../src/authenticated-fetcher.ts");

    const sessionManager = new SessionManager(`${TEST_DIR}/non-existent.json`);
    const fetcher = new AuthenticatedFetcher(sessionManager);

    const launchOptions = await fetcher.getLaunchOptions({ useMock: true });

    assertEquals(launchOptions.storageState, undefined);
  });

  await cleanupTestDir();
});

Deno.test("AuthenticatedFetcher - ログイン後のセッション保存", async (t) => {
  await setupTestDir();

  await t.step("ログイン成功後にstorageStateが保存されること（モック）", async () => {
    const { SessionManager } = await import("../src/session-manager.ts");
    const { AuthenticatedFetcher } = await import("../src/authenticated-fetcher.ts");

    const sessionPath = `${TEST_DIR}/save-session.json`;
    const sessionManager = new SessionManager(sessionPath);
    const fetcher = new AuthenticatedFetcher(sessionManager);

    // モックコンテキストを作成
    const mockContext = {
      storageState: async (options: { path: string }) => {
        await Deno.writeTextFile(options.path, JSON.stringify({
          cookies: [{ name: "session", value: "saved", domain: "taskchute.cloud" }],
          origins: []
        }));
      }
    };

    // セッションを保存
    await fetcher.saveSessionFromContext(mockContext);

    // ファイルが作成されたことを確認
    const content = await Deno.readTextFile(sessionPath);
    const parsed = JSON.parse(content);
    assertEquals(parsed.cookies[0].name, "session");
    assertEquals(parsed.cookies[0].value, "saved");
  });

  await cleanupTestDir();
});

Deno.test("AuthenticatedFetcher - 認証フロー統合", async (t) => {
  await setupTestDir();

  await t.step("isAuthenticated()がセッションの有効性を返すこと", async () => {
    const { SessionManager } = await import("../src/session-manager.ts");
    const { AuthenticatedFetcher } = await import("../src/authenticated-fetcher.ts");

    // 無効なセッション
    const invalidManager = new SessionManager(`${TEST_DIR}/invalid.json`);
    const invalidFetcher = new AuthenticatedFetcher(invalidManager);
    assertEquals(await invalidFetcher.isAuthenticated(), false);

    // 有効なセッション
    const validPath = `${TEST_DIR}/valid.json`;
    await Deno.writeTextFile(validPath, JSON.stringify({ cookies: [], origins: [] }));

    const validManager = new SessionManager(validPath);
    const validFetcher = new AuthenticatedFetcher(validManager);
    assertEquals(await validFetcher.isAuthenticated(), true);
  });

  await t.step("requiresLogin()が正しく判定すること", async () => {
    const { SessionManager } = await import("../src/session-manager.ts");
    const { AuthenticatedFetcher } = await import("../src/authenticated-fetcher.ts");

    // セッションがない場合はログインが必要
    const noSessionManager = new SessionManager(`${TEST_DIR}/no-session.json`);
    const noSessionFetcher = new AuthenticatedFetcher(noSessionManager);
    assertEquals(await noSessionFetcher.requiresLogin(), true);

    // セッションがある場合はログイン不要
    const withSessionPath = `${TEST_DIR}/with-session.json`;
    await Deno.writeTextFile(withSessionPath, JSON.stringify({ cookies: [], origins: [] }));

    const withSessionManager = new SessionManager(withSessionPath);
    const withSessionFetcher = new AuthenticatedFetcher(withSessionManager);
    assertEquals(await withSessionFetcher.requiresLogin(), false);
  });

  await cleanupTestDir();
});

// ========================================
// CLI login コマンド統合テスト
// ========================================

Deno.test("CLI login - storageState統合", async (t) => {
  await setupTestDir();

  await t.step("loginコマンドがstorageStateを保存すること（モック）", async () => {
    // このテストはモックを使用して、実際のブラウザ起動をスキップ
    const { SessionManager } = await import("../src/session-manager.ts");

    const sessionPath = `${TEST_DIR}/cli-login-session.json`;
    const sessionManager = new SessionManager(sessionPath);

    // モックでセッション保存をシミュレート
    await sessionManager.writeStorageState({
      cookies: [{ name: "auth", value: "mock-token", domain: "taskchute.cloud" }],
      origins: []
    });

    // セッションが有効になったことを確認
    const isValid = await sessionManager.isSessionValid();
    assertEquals(isValid, true);

    const info = await sessionManager.getSessionInfo();
    assertEquals(info.exists, true);
    assertEquals(info.isValid, true);
  });

  await t.step("セッションクリア後は再ログインが必要になること", async () => {
    const { SessionManager } = await import("../src/session-manager.ts");

    const sessionPath = `${TEST_DIR}/clear-session.json`;
    const sessionManager = new SessionManager(sessionPath);

    // セッションを作成
    await sessionManager.writeStorageState({ cookies: [], origins: [] });
    assertEquals(await sessionManager.isSessionValid(), true);

    // セッションをクリア
    await sessionManager.clearSession();
    assertEquals(await sessionManager.isSessionValid(), false);
  });

  await cleanupTestDir();
});
