import { assertEquals, assertStringIncludes, assertRejects } from "testing/asserts.ts";
import { TaskChuteAuth, LoginCredentials, SessionData } from "../src/auth.ts";

Deno.test("TaskChuteAuth - 初期化テスト", async (t) => {
  await t.step("TaskChuteAuthインスタンスが正常に作成されること", () => {
    const auth = new TaskChuteAuth({
      email: "test@example.com",
      password: "test-password"
    });
    assertEquals(typeof auth, "object");
  });

  await t.step("認証情報が不正な場合はエラーが発生すること", () => {
    try {
      new TaskChuteAuth({
        email: "",
        password: "test-password"
      });
      throw new Error("例外が発生するべきです");
    } catch (error) {
      assertStringIncludes((error as Error).message, "Invalid credentials");
    }
  });

  await t.step("無効なメールアドレスでエラーが発生すること", () => {
    try {
      new TaskChuteAuth({
        email: "invalid-email",
        password: "test-password"
      });
      throw new Error("例外が発生するべきです");
    } catch (error) {
      assertStringIncludes((error as Error).message, "valid email");
    }
  });

  await t.step("Chromeプロファイルモードではバリデーションがスキップされること", () => {
    // Chromeプロファイル使用時のダミー認証情報
    const auth = new TaskChuteAuth({
      email: "chrome-profile@example.com",
      password: "chrome-profile"
    });
    assertEquals(typeof auth, "object");
  });
});

Deno.test("TaskChuteAuth - 認証情報取得テスト", async (t) => {
  const credentials: LoginCredentials = {
    email: "test@example.com",
    password: "test-password"
  };
  const auth = new TaskChuteAuth(credentials);

  await t.step("認証情報が正しく取得できること", () => {
    const retrieved = auth.getCredentials();
    assertEquals(retrieved.email, credentials.email);
    assertEquals(retrieved.password, credentials.password);
  });

  await t.step("取得した認証情報は元の認証情報のコピーであること", () => {
    const retrieved = auth.getCredentials();
    retrieved.email = "modified@example.com";

    // 元の認証情報は変更されていないこと
    const again = auth.getCredentials();
    assertEquals(again.email, credentials.email);
  });
});

Deno.test("TaskChuteAuth - セッション管理テスト", async (t) => {
  const auth = new TaskChuteAuth({
    email: "session-test@example.com",
    password: "test-password"
  });

  // テスト前にセッションをクリア
  await auth.logout();

  await t.step("セッションが作成されること", async () => {
    const result = await auth.createSession();
    assertEquals(result.success, true);
    assertEquals(result.email, "session-test@example.com");
  });

  await t.step("ログイン状態が正しく判定されること", async () => {
    const isLoggedIn = await auth.isLoggedIn();
    assertEquals(isLoggedIn, true);
  });

  await t.step("セッションデータが取得できること", async () => {
    const session = await auth.getStoredSession();
    assertEquals(session?.email, "session-test@example.com");
    assertEquals(session?.sessionValid, true);
  });

  await t.step("セッション状態が正しく取得できること", async () => {
    const status = await auth.getSessionStatus();
    assertEquals(status.isLoggedIn, true);
    assertEquals(status.email, "session-test@example.com");
    assertEquals(status.loginTime instanceof Date, true);
    assertEquals(status.expiresAt instanceof Date, true);
  });

  await t.step("ログアウトが正常に実行されること", async () => {
    await auth.logout();
    const isLoggedIn = await auth.isLoggedIn();
    assertEquals(isLoggedIn, false);
  });

  await t.step("ログアウト後はセッションが取得できないこと", async () => {
    const session = await auth.getStoredSession();
    assertEquals(session, null);
  });
});

Deno.test("TaskChuteAuth - セッション更新テスト", async (t) => {
  const auth = new TaskChuteAuth({
    email: "refresh-test@example.com",
    password: "test-password"
  });

  // テスト前にセッションをクリア
  await auth.logout();

  await t.step("セッションがない場合は更新が失敗すること", async () => {
    const result = await auth.refreshSession();
    assertEquals(result.success, false);
    assertStringIncludes(result.error || "", "No session found");
  });

  await t.step("セッションがある場合は更新が成功すること", async () => {
    await auth.createSession();
    const result = await auth.refreshSession();
    assertEquals(result.success, true);
    assertEquals(result.email, "refresh-test@example.com");
  });

  // クリーンアップ
  await auth.logout();
});

Deno.test("TaskChuteAuth - 静的メソッドテスト", async (t) => {
  await t.step("環境変数が設定されていない場合はエラーが発生すること", () => {
    // 環境変数をクリア
    const originalEmail = Deno.env.get("TASKCHUTE_EMAIL");
    const originalPassword = Deno.env.get("TASKCHUTE_PASSWORD");

    Deno.env.delete("TASKCHUTE_EMAIL");
    Deno.env.delete("TASKCHUTE_PASSWORD");

    try {
      TaskChuteAuth.fromEnvironment();
      throw new Error("例外が発生するべきです");
    } catch (error) {
      assertStringIncludes((error as Error).message, "Environment variables");
    } finally {
      // 環境変数を復元
      if (originalEmail) Deno.env.set("TASKCHUTE_EMAIL", originalEmail);
      if (originalPassword) Deno.env.set("TASKCHUTE_PASSWORD", originalPassword);
    }
  });

  await t.step("detectLoginMethodがオブジェクトを返すこと", async () => {
    const result = await TaskChuteAuth.detectLoginMethod();
    assertEquals(typeof result, "object");
    assertEquals(typeof result.needsCredentials, "boolean");
    assertEquals(typeof result.platformInfo, "object");
  });
});
