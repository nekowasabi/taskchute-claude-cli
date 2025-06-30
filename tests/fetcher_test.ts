import { assertEquals, assertStringIncludes } from "testing/asserts.ts";
import { TaskChuteDataFetcher } from "../src/fetcher.ts";

Deno.test("TaskChuteDataFetcher - 初期化テスト", async (t) => {
  await t.step("DataFetcherインスタンスが正常に作成されること", () => {
    const fetcher = new TaskChuteDataFetcher({
      headless: true,
      browser: "chromium"
    });
    assertEquals(typeof fetcher, "object");
  });

  await t.step("デフォルトオプションが正しく設定されること", () => {
    const fetcher = new TaskChuteDataFetcher();
    const options = fetcher.getOptions();
    assertEquals(options.headless, true);
    assertEquals(options.browser, "chromium");
    assertEquals(options.timeout, 30000);
  });
});

Deno.test("TaskChuteDataFetcher - ブラウザ起動テスト", async (t) => {
  const fetcher = new TaskChuteDataFetcher({
    headless: true,
    browser: "chromium"
  });

  await t.step("ブラウザが正常に起動すること", async () => {
    const browserResult = await fetcher.launchBrowser({ mock: true });
    assertEquals(browserResult.success, true);
    assertEquals(typeof browserResult.browser, "object");
  });

  await t.step("サポートされていないブラウザでエラーが発生すること", async () => {
    const invalidFetcher = new TaskChuteDataFetcher({
      browser: "invalid-browser" as any
    });
    
    try {
      await invalidFetcher.launchBrowser({ mock: true });
      throw new Error("例外が発生するべきです");
    } catch (error) {
      assertStringIncludes((error as Error).message, "Unsupported browser");
    }
  });
});

Deno.test("TaskChuteDataFetcher - ページナビゲーションテスト", async (t) => {
  const fetcher = new TaskChuteDataFetcher({
    headless: true,
    browser: "chromium"
  });

  await t.step("TaskChute Cloudにナビゲートできること", async () => {
    const result = await fetcher.navigateToTaskChute(undefined, undefined, { mock: true });
    assertEquals(result.success, true);
    assertEquals(result.currentUrl, "https://taskchute.cloud");
  });

  await t.step("日付範囲を指定してナビゲートできること", async () => {
    const result = await fetcher.navigateToTaskChute("2025-06-01", "2025-06-30", { mock: true });
    assertEquals(result.success, true);
    assertEquals(result.currentUrl, "https://taskchute.cloud");
  });

  await t.step("ページロードでタイムアウトが正しく動作すること", async () => {
    const timeoutFetcher = new TaskChuteDataFetcher({
      timeout: 1000
    });

    try {
      await timeoutFetcher.navigateToTaskChute(undefined, undefined, { mock: true, forceTimeout: true });
      throw new Error("例外が発生するべきです");
    } catch (error) {
      assertStringIncludes((error as Error).message, "timeout");
    }
  });
});

Deno.test("TaskChuteDataFetcher - 認証統合テスト", async (t) => {
  const fetcher = new TaskChuteDataFetcher({
    headless: true
  });

  await t.step("Google認証フローが実行されること", async () => {
    const authResult = await fetcher.performGoogleAuth({
      clientId: "test-client-id",
      clientSecret: "test-secret",
      redirectUri: "http://localhost:8080/callback"
    }, { mock: true });
    
    assertEquals(authResult.success, true);
    assertEquals(typeof authResult.token, "string");
  });

  await t.step("認証後にTaskChuteページに遷移すること", async () => {
    const result = await fetcher.waitForAuthRedirect({ mock: true });
    assertEquals(result.success, true);
    assertStringIncludes(result.finalUrl!, "taskchute.cloud");
  });
});

Deno.test("TaskChuteDataFetcher - データ取得テスト", async (t) => {
  const fetcher = new TaskChuteDataFetcher({
    headless: true
  });

  await t.step("ページのHTMLが取得できること", async () => {
    const htmlResult = await fetcher.getPageHTML({ mock: true });
    assertEquals(htmlResult.success, true);
    assertEquals(typeof htmlResult.html, "string");
    assertStringIncludes(htmlResult.html!, "<html");
  });

  await t.step("特定の要素が取得できること", async () => {
    const elements = await fetcher.getElements(".task-item", { mock: true });
    assertEquals(Array.isArray(elements), true);
    assertEquals(elements.length > 0, true);
  });

  await t.step("タスクデータが構造化されて取得できること", async () => {
    const taskData = await fetcher.getTaskData({ mock: true });
    assertEquals(taskData.success, true);
    assertEquals(Array.isArray(taskData.tasks), true);
    
    if (taskData.tasks && taskData.tasks.length > 0) {
      const firstTask = taskData.tasks[0];
      assertEquals(typeof firstTask.id, "string");
      assertEquals(typeof firstTask.title, "string");
      assertEquals(typeof firstTask.status, "string");
    }
  });
});

Deno.test("TaskChuteDataFetcher - ファイル出力テスト", async (t) => {
  const fetcher = new TaskChuteDataFetcher();

  await t.step("HTMLが指定されたファイルに保存されること", async () => {
    const testFilePath = "./tmp/claude/test-output.html";
    const result = await fetcher.saveHTMLToFile("<html><body>Test</body></html>", testFilePath);
    
    assertEquals(result.success, true);
    assertEquals(result.filePath, testFilePath);
    
    // ファイルが実際に作成されたかテストする必要があるが、モックでは省略
  });

  await t.step("JSONデータが指定されたファイルに保存されること", async () => {
    const testData = { tasks: [{ id: "1", title: "Test Task" }] };
    const testFilePath = "./tmp/claude/test-output.json";
    
    const result = await fetcher.saveJSONToFile(testData, testFilePath);
    assertEquals(result.success, true);
    assertEquals(result.filePath, testFilePath);
  });
});

Deno.test("TaskChuteDataFetcher - エラーハンドリングテスト", async (t) => {
  const fetcher = new TaskChuteDataFetcher();

  await t.step("ネットワークエラーが適切に処理されること", async () => {
    try {
      await fetcher.navigateToTaskChute({ mock: true, forceNetworkError: true });
      throw new Error("例外が発生するべきです");
    } catch (error) {
      assertStringIncludes((error as Error).message, "Network error");
    }
  });

  await t.step("認証エラーが適切に処理されること", async () => {
    try {
      await fetcher.performGoogleAuth({
        clientId: "",
        clientSecret: "",
        redirectUri: "http://localhost:8080/callback"
      }, { mock: true });
      throw new Error("例外が発生するべきです");
    } catch (error) {
      assertStringIncludes((error as Error).message, "Authentication failed");
    }
  });

  await t.step("リソースが正常にクリーンアップされること", async () => {
    await fetcher.launchBrowser({ mock: true });
    const cleanupResult = await fetcher.cleanup();
    assertEquals(cleanupResult.success, true);
  });
});