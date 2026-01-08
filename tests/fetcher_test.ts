import { assertEquals, assertStringIncludes } from "testing/asserts.ts";
import { TaskChuteDataFetcher, FetcherOptions, TaskData } from "../src/fetcher.ts";

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

  await t.step("カスタムオプションが正しく設定されること", () => {
    const fetcher = new TaskChuteDataFetcher({
      headless: false,
      browser: "firefox",
      timeout: 60000
    });
    const options = fetcher.getOptions();
    assertEquals(options.headless, false);
    assertEquals(options.browser, "firefox");
    assertEquals(options.timeout, 60000);
  });

  await t.step("オプションを更新できること", () => {
    const fetcher = new TaskChuteDataFetcher();
    fetcher.updateOptions({ timeout: 45000 });
    const options = fetcher.getOptions();
    assertEquals(options.timeout, 45000);
  });
});

Deno.test("TaskChuteDataFetcher - ブラウザ起動テスト（モック）", async (t) => {
  const fetcher = new TaskChuteDataFetcher({
    headless: true,
    browser: "chromium"
  });

  await t.step("ブラウザが正常に起動すること（モック）", async () => {
    const browserResult = await fetcher.launchBrowser({ mock: true });
    assertEquals(browserResult.success, true);
    assertEquals(browserResult.error, undefined);
  });
});

Deno.test("TaskChuteDataFetcher - ページナビゲーションテスト（モック）", async (t) => {
  const fetcher = new TaskChuteDataFetcher({
    headless: true,
    browser: "chromium"
  });

  await t.step("TaskChute Cloudにナビゲートできること（モック）", async () => {
    const result = await fetcher.navigateToTaskChute(undefined, undefined, { mock: true });
    assertEquals(result.success, true);
    assertEquals(result.currentUrl, "https://taskchute.cloud");
  });

  await t.step("日付範囲を指定してナビゲートできること（モック）", async () => {
    const result = await fetcher.navigateToTaskChute("2025-06-01", "2025-06-30", { mock: true });
    assertEquals(result.success, true);
    assertEquals(result.currentUrl, "https://taskchute.cloud");
  });

  await t.step("タイムアウトが正しく動作すること（モック）", async () => {
    try {
      await fetcher.navigateToTaskChute(undefined, undefined, { mock: true, forceTimeout: true });
      throw new Error("例外が発生するべきです");
    } catch (error) {
      assertStringIncludes((error as Error).message, "timeout");
    }
  });

  await t.step("ネットワークエラーが正しく処理されること（モック）", async () => {
    try {
      await fetcher.navigateToTaskChute(undefined, undefined, { mock: true, forceNetworkError: true });
      throw new Error("例外が発生するべきです");
    } catch (error) {
      assertStringIncludes((error as Error).message, "Network error");
    }
  });
});

Deno.test("TaskChuteDataFetcher - 認証リダイレクトテスト（モック）", async (t) => {
  const fetcher = new TaskChuteDataFetcher({
    headless: true
  });

  await t.step("認証後にTaskChuteページに遷移すること（モック）", async () => {
    const result = await fetcher.waitForAuthRedirect({ mock: true });
    assertEquals(result.success, true);
    assertStringIncludes(result.finalUrl!, "taskchute.cloud");
  });
});

Deno.test("TaskChuteDataFetcher - データ取得テスト（モック）", async (t) => {
  const fetcher = new TaskChuteDataFetcher({
    headless: true
  });

  await t.step("ページのHTMLが取得できること（モック）", async () => {
    const htmlResult = await fetcher.getPageHTML({ mock: true });
    assertEquals(htmlResult.success, true);
    assertEquals(typeof htmlResult.html, "string");
    assertStringIncludes(htmlResult.html!, "<html");
  });

  await t.step("特定の要素が取得できること（モック）", async () => {
    const elements = await fetcher.getElements(".task-item", { mock: true });
    assertEquals(Array.isArray(elements), true);
    assertEquals(elements.length > 0, true);
  });

  await t.step("タスクデータが構造化されて取得できること（モック）", async () => {
    const taskData = await fetcher.getTaskData({ mock: true });
    assertEquals(taskData.success, true);
    assertEquals(Array.isArray(taskData.tasks), true);
  });
});

Deno.test("TaskChuteDataFetcher - ファイル出力テスト", async (t) => {
  const fetcher = new TaskChuteDataFetcher();

  await t.step("HTMLが指定されたファイルに保存されること", async () => {
    const testFilePath = "./tmp/claude/test-output.html";
    const result = await fetcher.saveHTMLToFile("<html><body>Test</body></html>", testFilePath);

    assertEquals(result.success, true);
    assertEquals(result.filePath, testFilePath);

    // 実際にファイルが作成されたか確認
    const stat = await Deno.stat(testFilePath);
    assertEquals(stat.isFile, true);

    // クリーンアップ
    await Deno.remove(testFilePath);
  });

  await t.step("JSONデータが指定されたファイルに保存されること", async () => {
    const testData = { tasks: [{ id: "1", title: "Test Task" }] };
    const testFilePath = "./tmp/claude/test-output.json";

    const result = await fetcher.saveJSONToFile(testData, testFilePath);
    assertEquals(result.success, true);
    assertEquals(result.filePath, testFilePath);

    // 実際にファイルが作成されたか確認
    const content = await Deno.readTextFile(testFilePath);
    const parsed = JSON.parse(content);
    assertEquals(parsed.tasks[0].id, "1");

    // クリーンアップ
    await Deno.remove(testFilePath);
  });
});

Deno.test("TaskChuteDataFetcher - クリーンアップテスト（モック）", async (t) => {
  const fetcher = new TaskChuteDataFetcher();

  await t.step("リソースが正常にクリーンアップされること", async () => {
    // モックモードでブラウザを起動
    await fetcher.launchBrowser({ mock: true });
    const cleanupResult = await fetcher.cleanup();
    assertEquals(cleanupResult.success, true);
  });
});

Deno.test("TaskChuteDataFetcher - オプション取得テスト", async (t) => {
  await t.step("オプションのコピーが返されること", () => {
    const fetcher = new TaskChuteDataFetcher({
      headless: true,
      timeout: 30000
    });

    const options1 = fetcher.getOptions();
    options1.timeout = 99999;

    // 元のオプションは変更されていないこと
    const options2 = fetcher.getOptions();
    assertEquals(options2.timeout, 30000);
  });
});

Deno.test("TaskChuteDataFetcher - 現在のURL取得テスト", async (t) => {
  await t.step("ページがない場合は'No page'が返されること", () => {
    const fetcher = new TaskChuteDataFetcher();
    const url = fetcher.getCurrentUrl();
    assertEquals(url, "No page");
  });
});
