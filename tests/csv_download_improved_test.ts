/**
 * CSVダウンロード改善 TDDテスト
 *
 * APIインターセプト + waitForResponse方式のテスト
 */
import { assertEquals, assertStringIncludes } from "testing/asserts.ts";
import { ensureDir } from "std/fs/mod.ts";

// テスト用の一時ディレクトリ
const TEST_DIR = "./tmp/claude/csv-download-test";

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
// CSVDownloader クラスのテスト
// ========================================

Deno.test("CSVDownloader - 初期化テスト", async (t) => {
  await setupTestDir();

  await t.step("デフォルト設定で初期化できること", async () => {
    const { CSVDownloader } = await import("../src/csv-downloader.ts");
    const downloader = new CSVDownloader();

    assertEquals(typeof downloader, "object");
  });

  await t.step("カスタム設定で初期化できること", async () => {
    const { CSVDownloader } = await import("../src/csv-downloader.ts");
    const downloader = new CSVDownloader({
      downloadTimeout: 60000,
      reactWaitTime: 2000
    });

    const config = downloader.getConfig();
    assertEquals(config.downloadTimeout, 60000);
    assertEquals(config.reactWaitTime, 2000);
  });

  await cleanupTestDir();
});

Deno.test("CSVDownloader - 日付フォーマット", async (t) => {
  await setupTestDir();

  await t.step("YYYY-MM-DD形式をYYYYMMDD形式に変換できること", async () => {
    const { CSVDownloader } = await import("../src/csv-downloader.ts");
    const downloader = new CSVDownloader();

    assertEquals(downloader.formatDate("2025-06-15"), "20250615");
    assertEquals(downloader.formatDate("2025-01-01"), "20250101");
    assertEquals(downloader.formatDate("2025-12-31"), "20251231");
  });

  await t.step("既にYYYYMMDD形式の日付はそのまま返すこと", async () => {
    const { CSVDownloader } = await import("../src/csv-downloader.ts");
    const downloader = new CSVDownloader();

    assertEquals(downloader.formatDate("20250615"), "20250615");
  });

  await t.step("今日の日付をデフォルトとして取得できること", async () => {
    const { CSVDownloader } = await import("../src/csv-downloader.ts");
    const downloader = new CSVDownloader();

    const today = downloader.getDefaultDate();
    // YYYYMMDD形式であることを確認
    assertEquals(today.length, 8);
    assertEquals(/^\d{8}$/.test(today), true);
  });

  await cleanupTestDir();
});

Deno.test("CSVDownloader - React待機ロジック", async (t) => {
  await setupTestDir();

  await t.step("waitForReactReady関数が定義されていること", async () => {
    const { CSVDownloader } = await import("../src/csv-downloader.ts");
    const downloader = new CSVDownloader();

    assertEquals(typeof downloader.waitForReactReady, "function");
  });

  await cleanupTestDir();
});

Deno.test("CSVDownloader - APIレスポンス判定", async (t) => {
  await setupTestDir();

  await t.step("CSVレスポンスを正しく判定できること", async () => {
    const { CSVDownloader } = await import("../src/csv-downloader.ts");
    const downloader = new CSVDownloader();

    // CSVレスポンスの判定
    assertEquals(
      downloader.isCSVResponse({
        url: () => "https://taskchute.cloud/api/export/csv",
        headers: () => ({ "content-type": "text/csv" })
      }),
      true
    );

    assertEquals(
      downloader.isCSVResponse({
        url: () => "https://taskchute.cloud/export",
        headers: () => ({ "content-type": "text/csv; charset=utf-8" })
      }),
      true
    );
  });

  await t.step("非CSVレスポンスを正しく判定できること", async () => {
    const { CSVDownloader } = await import("../src/csv-downloader.ts");
    const downloader = new CSVDownloader();

    assertEquals(
      downloader.isCSVResponse({
        url: () => "https://taskchute.cloud/api/tasks",
        headers: () => ({ "content-type": "application/json" })
      }),
      false
    );
  });

  await cleanupTestDir();
});

Deno.test("CSVDownloader - 日付入力戦略", async (t) => {
  await setupTestDir();

  await t.step("日付入力戦略のリストが定義されていること", async () => {
    const { CSVDownloader } = await import("../src/csv-downloader.ts");
    const downloader = new CSVDownloader();

    const strategies = downloader.getDateInputStrategies();
    assertEquals(Array.isArray(strategies), true);
    assertEquals(strategies.length >= 3, true); // 少なくとも3つの戦略
  });

  await t.step("各戦略に名前と実行関数があること", async () => {
    const { CSVDownloader } = await import("../src/csv-downloader.ts");
    const downloader = new CSVDownloader();

    const strategies = downloader.getDateInputStrategies();
    for (const strategy of strategies) {
      assertEquals(typeof strategy.name, "string");
      assertEquals(typeof strategy.execute, "function");
    }
  });

  await cleanupTestDir();
});

Deno.test("CSVDownloader - ダウンロード結果", async (t) => {
  await setupTestDir();

  await t.step("成功結果の構造が正しいこと", async () => {
    const { CSVDownloader, createSuccessResult } = await import("../src/csv-downloader.ts");

    const result = createSuccessResult({
      csvContent: "header1,header2\nvalue1,value2",
      downloadPath: `${TEST_DIR}/test.csv`,
      taskCount: 1
    });

    assertEquals(result.success, true);
    assertEquals(result.downloadPath, `${TEST_DIR}/test.csv`);
    assertEquals(result.taskCount, 1);
    assertEquals(result.error, undefined);
  });

  await t.step("失敗結果の構造が正しいこと", async () => {
    const { createFailureResult } = await import("../src/csv-downloader.ts");

    const result = createFailureResult("Download failed");

    assertEquals(result.success, false);
    assertEquals(result.error, "Download failed");
    assertEquals(result.downloadPath, undefined);
  });

  await cleanupTestDir();
});

// ========================================
// CSVParser統合テスト
// ========================================

Deno.test("CSVDownloader - パーサー統合", async (t) => {
  await setupTestDir();

  await t.step("CSVコンテンツをパースできること", async () => {
    const { CSVDownloader } = await import("../src/csv-downloader.ts");
    const downloader = new CSVDownloader();

    // モックCSVコンテンツ（TaskChute Cloud形式）
    // フォーマット: タイムライン日付,タスクID,タスク名,プロジェクトID,プロジェクト名,...
    const csvContent = `"タイムライン日付","タスクID","タスク名","プロジェクトID","プロジェクト名","モードID","モード名","タグID","タグ名","ルーチンID","ルーチン名","見積時間","実績時間","開始日時","終了日時","リンク","アイコン","カラー","お気に入り"
"2025/06/15","task-001","テストタスク1","proj-1","仕事","mode-1","通常","","","","","01:00:00","01:00:00","2025-06-15 09:00:00","2025-06-15 10:00:00","","","",""
"2025/06/15","task-002","テストタスク2","proj-1","仕事","mode-1","通常","","","","","01:30:00","01:30:00","2025-06-15 10:00:00","2025-06-15 11:30:00","","","",""`;

    const tasks = downloader.parseCSVContent(csvContent);
    assertEquals(Array.isArray(tasks), true);
    assertEquals(tasks.length, 2);
    assertEquals(tasks[0].title, "テストタスク1");
    assertEquals(tasks[1].title, "テストタスク2");
  });

  await cleanupTestDir();
});
