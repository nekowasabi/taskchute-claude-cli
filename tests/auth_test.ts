import { assertEquals, assertStringIncludes } from "testing/asserts.ts";
import { GoogleAuth } from "../src/auth.ts";

Deno.test("GoogleAuth - 初期化テスト", async (t) => {
  await t.step("GoogleAuthインスタンスが正常に作成されること", () => {
    const auth = new GoogleAuth({
      clientId: "test-client-id",
      clientSecret: "test-client-secret",
      redirectUri: "http://localhost:8080/callback"
    });
    assertEquals(typeof auth, "object");
  });

  await t.step("設定が不正な場合はエラーが発生すること", () => {
    try {
      new GoogleAuth({
        clientId: "",
        clientSecret: "test-secret",
        redirectUri: "invalid-uri"
      });
      throw new Error("例外が発生するべきです");
    } catch (error) {
      assertStringIncludes((error as Error).message, "Invalid configuration");
    }
  });
});

Deno.test("GoogleAuth - 認証URL生成テスト", async (t) => {
  const auth = new GoogleAuth({
    clientId: "test-client-id",
    clientSecret: "test-client-secret",
    redirectUri: "http://localhost:8080/callback"
  });

  await t.step("認証URLが正常に生成されること", () => {
    const authUrl = auth.getAuthUrl();
    assertEquals(typeof authUrl, "string");
    assertStringIncludes(authUrl, "accounts.google.com");
    assertStringIncludes(authUrl, "test-client-id");
    assertStringIncludes(authUrl, "callback");
  });

  await t.step("認証URLにスコープが含まれること", () => {
    const authUrl = auth.getAuthUrl(["openid", "profile", "email"]);
    assertStringIncludes(authUrl, "scope=");
    assertStringIncludes(authUrl, "openid");
    assertStringIncludes(authUrl, "profile");
    assertStringIncludes(authUrl, "email");
  });
});

Deno.test("GoogleAuth - トークン交換テスト", async (t) => {
  const auth = new GoogleAuth({
    clientId: "test-client-id",
    clientSecret: "test-client-secret",
    redirectUri: "http://localhost:8080/callback"
  });

  await t.step("認証コードがトークンに交換されること", async () => {
    const mockCode = "test-auth-code";
    
    // モックレスポンスのセットアップが必要
    const tokenResponse = await auth.exchangeCodeForToken(mockCode, { mock: true });
    assertEquals(tokenResponse.success, true);
    assertEquals(typeof tokenResponse.accessToken, "string");
  });

  await t.step("不正な認証コードでエラーが発生すること", async () => {
    try {
      await auth.exchangeCodeForToken("", { mock: true });
      throw new Error("例外が発生するべきです");
    } catch (error) {
      assertStringIncludes((error as Error).message, "Invalid authorization code");
    }
  });
});

Deno.test("GoogleAuth - セッション管理テスト", async (t) => {
  const auth = new GoogleAuth({
    clientId: "test-client-id",
    clientSecret: "test-client-secret",
    redirectUri: "http://localhost:8080/callback"
  });

  await t.step("トークンが保存されること", async () => {
    const mockToken = {
      access_token: "test-access-token",
      refresh_token: "test-refresh-token",
      expires_in: 3600,
      token_type: "Bearer"
    };

    await auth.saveToken(mockToken);
    const savedToken = await auth.getStoredToken();
    assertEquals(savedToken?.access_token, mockToken.access_token);
  });

  await t.step("ログイン状態が正しく判定されること", async () => {
    const isLoggedIn = await auth.isLoggedIn();
    assertEquals(typeof isLoggedIn, "boolean");
  });

  await t.step("ログアウトが正常に実行されること", async () => {
    await auth.logout();
    const isLoggedIn = await auth.isLoggedIn();
    assertEquals(isLoggedIn, false);
  });
});

Deno.test("GoogleAuth - トークン更新テスト", async (t) => {
  const auth = new GoogleAuth({
    clientId: "test-client-id",
    clientSecret: "test-client-secret",
    redirectUri: "http://localhost:8080/callback"
  });

  await t.step("リフレッシュトークンでアクセストークンが更新されること", async () => {
    const mockRefreshToken = "test-refresh-token";
    
    const newToken = await auth.refreshAccessToken(mockRefreshToken, { mock: true });
    assertEquals(newToken.success, true);
    assertEquals(typeof newToken.accessToken, "string");
  });

  await t.step("有効期限切れのトークンが自動更新されること", async () => {
    const expiredToken = {
      access_token: "expired-token",
      refresh_token: "valid-refresh-token",
      expires_in: -1,
      token_type: "Bearer",
      created_at: Date.now() - 7200000 // 2時間前
    };

    await auth.saveToken(expiredToken);
    const validToken = await auth.getValidToken({ mock: true });
    assertEquals(validToken.success, true);
  });
});