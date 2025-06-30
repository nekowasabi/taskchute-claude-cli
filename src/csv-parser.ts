/**
 * TaskChute CSVパーサー
 * CSVファイルを解析してタスクデータを抽出
 */

import { parse } from "std/csv/mod.ts";
import { TaskData } from "./fetcher.ts";

/**
 * CSVレコードの型定義
 */
export interface TaskChuteCsvRecord {
  "タイムライン日付": string;
  "タスクID": string;
  "タスク名": string;
  "プロジェクトID": string;
  "プロジェクト名": string;
  "モードID": string;
  "モード名": string;
  "タグID": string;
  "タグ名": string;
  "ルーチンID": string;
  "ルーチン名": string;
  "見積時間": string;
  "実績時間": string;
  "開始日時": string;
  "終了日時": string;
  "リンク": string;
  "アイコン": string;
  "カラー": string;
  "お気に入り": string;
}

/**
 * CSVパーサークラス
 */
export class TaskChuteCsvParser {
  /**
   * CSVファイルを解析してタスクデータを抽出
   * @param csvPath CSVファイルのパス
   * @returns タスクデータの配列
   */
  async parseFile(csvPath: string): Promise<TaskData[]> {
    try {
      // CSVファイルを読み込む
      const csvContent = await Deno.readTextFile(csvPath);
      
      // BOMを除去（存在する場合）
      const cleanContent = csvContent.replace(/^\uFEFF/, '');
      
      // CSVをパース
      const records = parse(cleanContent, {
        skipFirstRow: true,
        columns: [
          "タイムライン日付",
          "タスクID", 
          "タスク名",
          "プロジェクトID",
          "プロジェクト名",
          "モードID",
          "モード名",
          "タグID",
          "タグ名",
          "ルーチンID",
          "ルーチン名",
          "見積時間",
          "実績時間",
          "開始日時",
          "終了日時",
          "リンク",
          "アイコン",
          "カラー",
          "お気に入り"
        ]
      }) as TaskChuteCsvRecord[];
      
      // タスクデータに変換
      const tasks: TaskData[] = records.map(record => ({
        id: record.タスクID,
        title: record.タスク名,
        status: this.determineStatus(record),
        description: this.buildDescription(record),
        startTime: record.開始日時,
        endTime: record.終了日時,
        duration: this.parseDuration(record.実績時間),
        category: record.プロジェクト名 || undefined,
        estimatedTime: record.見積時間,
        actualTime: record.実績時間
      }));
      
      return tasks;
      
    } catch (error) {
      console.error("CSVパースエラー:", error);
      throw new Error(`CSVファイルの解析に失敗しました: ${(error as Error).message}`);
    }
  }
  
  /**
   * タスクのステータスを判定
   * @param record CSVレコード
   * @returns ステータス文字列
   */
  private determineStatus(record: TaskChuteCsvRecord): string {
    if (record.終了日時) {
      return "completed";
    } else if (record.開始日時) {
      return "in_progress";
    } else {
      return "pending";
    }
  }
  
  /**
   * タスクの説明を構築
   * @param record CSVレコード
   * @returns 説明文字列
   */
  private buildDescription(record: TaskChuteCsvRecord): string {
    const parts: string[] = [];
    
    if (record.プロジェクト名) {
      parts.push(`プロジェクト: ${record.プロジェクト名}`);
    }
    
    if (record.モード名) {
      parts.push(`モード: ${record.モード名}`);
    }
    
    if (record.タグ名) {
      parts.push(`タグ: ${record.タグ名}`);
    }
    
    if (record.ルーチン名) {
      parts.push(`ルーチン: ${record.ルーチン名}`);
    }
    
    return parts.join(" | ");
  }
  
  /**
   * 時間文字列を分単位の数値に変換
   * @param timeStr 時間文字列 (HH:MM:SS形式)
   * @returns 分単位の時間
   */
  private parseDuration(timeStr: string): number | undefined {
    if (!timeStr) return undefined;
    
    const parts = timeStr.split(':');
    if (parts.length !== 3) return undefined;
    
    const hours = parseInt(parts[0], 10);
    const minutes = parseInt(parts[1], 10);
    const seconds = parseInt(parts[2], 10);
    
    return hours * 60 + minutes + Math.round(seconds / 60);
  }
  
  /**
   * 特定の日付のタスクをフィルタリング
   * @param tasks タスクデータの配列
   * @param date 対象日付 (YYYY-MM-DD形式)
   * @returns フィルタリングされたタスク
   */
  filterByDate(tasks: TaskData[], date: string): TaskData[] {
    return tasks.filter(task => {
      if (task.startTime) {
        return task.startTime.startsWith(date);
      }
      return false;
    });
  }
  
  /**
   * タスクの統計情報を計算
   * @param tasks タスクデータの配列
   * @returns 統計情報
   */
  calculateStats(tasks: TaskData[]): {
    totalTasks: number;
    completedTasks: number;
    inProgressTasks: number;
    pendingTasks: number;
    totalDuration: number;
  } {
    const stats = {
      totalTasks: tasks.length,
      completedTasks: 0,
      inProgressTasks: 0,
      pendingTasks: 0,
      totalDuration: 0
    };
    
    for (const task of tasks) {
      switch (task.status) {
        case "completed":
          stats.completedTasks++;
          break;
        case "in_progress":
          stats.inProgressTasks++;
          break;
        case "pending":
          stats.pendingTasks++;
          break;
      }
      
      if (task.duration) {
        stats.totalDuration += task.duration;
      }
    }
    
    return stats;
  }
}