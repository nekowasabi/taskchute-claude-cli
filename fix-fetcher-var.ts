#!/usr/bin/env -S deno run --allow-all

// test-improved-flow.ts の fetcher 変数の問題を修正

import { MultiEdit } from "./src/fetcher.ts";

const filePath = "/Users/ttakeda/repos/taskchute-claude-cli/test-improved-flow.ts";

// ファイルを読む
const content = await Deno.readTextFile(filePath);

// fetcher の定義をfinally ブロック内でも使えるように修正
const newContent = content.replace(
  /const fetcher = new TaskChuteDataFetcher\(options\);/,
  "let fetcher: TaskChuteDataFetcher | null = null;\n    fetcher = new TaskChuteDataFetcher(options);"
);

// ファイルを書き戻す
await Deno.writeTextFile(filePath, newContent);

console.log("✅ test-improved-flow.ts の fetcher 変数の問題を修正しました");