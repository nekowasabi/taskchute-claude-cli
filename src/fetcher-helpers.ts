/**
 * fetcher.ts の大きなメソッドから抽出したヘルパー関数群。
 * Why: getTaskData 等の内部ロジックをここに集約し、fetcher.ts の行数を削減する。
 *      クラスメソッドのシグネチャ（公開API）は fetcher.ts 側で維持する。
 */
import { ensureDir } from "std/fs/mod.ts";
import type { Page, Locator } from "playwright";
import type { TaskData, FetchResult, SaveResult } from "./types.ts";

// ---------------------------------------------------------------------------
// getTaskData ヘルパー
// ---------------------------------------------------------------------------

/** 指定セレクタ群から最もヒット数の多い要素リストを返す */
async function findTaskRowsBySelectors(page: Page): Promise<Locator[]> {
  const rowSelectors = [
    'div[role="rowgroup"] > div.MuiStack-root',
    'div[role="grid"] > div.MuiStack-root',
    'div.MuiStack-root.my-csffzd',
    'div.MuiStack-root[class*="my-"]',
    'div[data-testid*="task"]',
    'div[class*="task"]',
  ];

  let taskRows: Locator[] = [];
  for (const selector of rowSelectors) {
    try {
      const rows = await page.locator(selector).all();
      if (rows.length > taskRows.length) {
        taskRows = rows;
        break;
      }
    } catch {
      continue;
    }
  }

  // フォールバック
  if (taskRows.length === 0) {
    taskRows = await page.locator("div.MuiStack-root.my-csffzd").all();
  }
  return taskRows;
}

/** タスク名から不要な記号・接頭辞を除去する */
function cleanTitle(raw: string): string {
  return raw
    .replace(/^(枠:|と|:--|--:|・)+/, "")
    .replace(/(枠:|と|:--|--:|・)+$/, "")
    .replace(/\s*:--\s*/g, "")
    .replace(/^\s*・\s*/, "")
    .replace(/^枠$/, "")
    .replace(/^と$/, "")
    .trim();
}

/** タスク行が有効かどうかを判定する */
function isValidTask(title: string, originalTitle: string, startTime: string, endTime: string): boolean {
  return (
    !!title &&
    title.length > 1 &&
    title.length < 200 &&
    !!startTime &&
    !!endTime &&
    !title.includes("終了予定") &&
    !title.includes("Start期間") &&
    !title.includes("ヘッダー") &&
    !title.includes("合計") &&
    originalTitle !== "枠:--" &&
    originalTitle !== "と" &&
    !/^[:・\-\s]+$/.test(title) &&
    !/^(枠|と|・)+$/.test(title)
  );
}

/** 列数が6以上の行からタスクデータを抽出する */
async function extractTaskFromColumns(
  row: Locator,
  taskIndex: number,
): Promise<TaskData | null> {
  const columns = await row.locator(":scope > .MuiBox-root").all();
  if (columns.length < 6) return null;

  const startTime = (await columns[1].textContent() || "").trim();
  const endTime = (await columns[2].textContent() || "").trim();
  const originalTitle = (await columns[3].textContent() || "").trim();
  const estimatedTime = (await columns[4].textContent() || "").trim();
  const actualTime = (await columns[5].textContent() || "").trim();
  const title = cleanTitle(originalTitle);

  let status = "unknown";
  try {
    const svgElement = await columns[0].locator("svg").first();
    const testId = await svgElement.getAttribute("data-testid");
    status =
      testId === "CheckIcon" ? "completed" :
      testId === "PlayArrowIcon" ? "in-progress" :
      testId === "PauseIcon" ? "paused" : "unknown";
  } catch { /* status remains unknown */ }

  if (!isValidTask(title, originalTitle, startTime, endTime)) return null;

  return {
    id: `task-${taskIndex}`,
    title,
    status,
    startTime: startTime.replace("--:--", ""),
    endTime: endTime.replace("--:--", ""),
    estimatedTime: estimatedTime.replace("--:--", ""),
    actualTime: actualTime.replace("--:--", ""),
    category: "",
    description: "",
  };
}

/** 列数が少ない行からテキストベースでタスクデータを抽出する（フォールバック） */
async function extractTaskFromText(
  row: Locator,
  taskIndex: number,
): Promise<TaskData | null> {
  const stackText = await row.textContent();
  const timeMatches = stackText?.match(/\d{1,2}:\d{2}/g);
  if (!timeMatches || timeMatches.length < 2) return null;

  const startTime = timeMatches[0];
  const endTime = timeMatches[1];
  const estimatedTime = timeMatches[2] || "";
  const actualTime = timeMatches[3] || "";

  const taskName =
    stackText
      ?.replace(/(\d{1,2}:\d{2}|--:--)/g, " ")
      .replace(/\s+/g, " ")
      .replace(/(タグ|プロジェクト|routine|condition|モード)$/, "")
      .trim() || "";

  if (
    taskName.length === 0 ||
    taskName.length >= 100 ||
    taskName.includes("終了予定") ||
    taskName.includes("Start期間")
  ) {
    return null;
  }

  return {
    id: `task-${taskIndex}`,
    title: taskName,
    status: "unknown",
    startTime,
    endTime,
    estimatedTime,
    actualTime,
    category: "",
    description: "",
  };
}

/**
 * ページからタスクデータをスクレイピングして返す。
 * Why: TaskChuteDataFetcher.getTaskData の内部ロジックをここに集約することで、
 *      fetcher.ts の行数を大幅に削減する。
 */
export async function scrapeTaskData(page: Page): Promise<FetchResult<TaskData[]>> {
  // ページ読み込み完了を待機
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(5000);

  try {
    await page.locator("span.MuiSkeleton-root").first().waitFor({ state: "hidden", timeout: 30000 });
  } catch { /* スケルトンがない場合は無視 */ }

  try {
    await page
      .locator('div[role="rowgroup"] > div.MuiStack-root, div.MuiStack-root.my-csffzd')
      .first()
      .waitFor({ timeout: 20000 });
  } catch { /* タスクデータ待機が失敗してもデータ取得を試行 */ }

  await page.waitForTimeout(3000);

  const taskRows = await findTaskRowsBySelectors(page);
  const tasks: TaskData[] = [];

  for (const row of taskRows) {
    try {
      const columns = await row.locator(":scope > .MuiBox-root").all();
      const task =
        columns.length >= 6
          ? await extractTaskFromColumns(row, tasks.length)
          : await extractTaskFromText(row, tasks.length);
      if (task) tasks.push(task);
    } catch {
      continue;
    }
  }

  if (tasks.length === 0) {
    return { success: false, error: "No tasks found on the page" };
  }
  return { success: true, tasks };
}

// ---------------------------------------------------------------------------
// ファイル保存ヘルパー
// ---------------------------------------------------------------------------

/**
 * HTML文字列をファイルに保存する。
 * Why: TaskChuteDataFetcher.saveHTMLToFile の内部ロジックを分離。
 */
export async function saveHTMLToFile(html: string, filePath: string): Promise<SaveResult> {
  try {
    await ensureDir(filePath.substring(0, filePath.lastIndexOf("/")));
    await Deno.writeTextFile(filePath, html);
    return { success: true, filePath };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}

/**
 * JSONデータをファイルに保存する。
 * Why: TaskChuteDataFetcher.saveJSONToFile の内部ロジックを分離。
 */
export async function saveJSONToFile(data: unknown, filePath: string): Promise<SaveResult> {
  try {
    await ensureDir(filePath.substring(0, filePath.lastIndexOf("/")));
    await Deno.writeTextFile(filePath, JSON.stringify(data, null, 2));
    return { success: true, filePath };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}

/**
 * ページから1日のタスク統計情報を取得する。
 * Why: TaskChuteDataFetcher.getDailyTaskStats の内部ロジックを分離。
 */
export async function getDailyTaskStats(page: Page): Promise<FetchResult<unknown>> {
  try {
    const stats = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll("tbody > tr")) as Element[];
      return rows.map((row) => {
        const columns = row.querySelectorAll("td");
        return {
          startTime: columns[0]?.textContent?.trim(),
          endTime: columns[1]?.textContent?.trim(),
          estimateTime: columns[2]?.textContent?.trim(),
          actualTime: columns[3]?.textContent?.trim(),
        };
      });
    });
    return { success: true, data: stats };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}
