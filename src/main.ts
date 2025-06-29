#!/usr/bin/env deno run --allow-all

import { CLI } from "./cli.ts";

async function main() {
  const cli = new CLI();
  const args = Deno.args;

  try {
    if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
      console.log(cli.getHelpMessage());
      Deno.exit(0);
    }
    
    const result = await cli.run(args);
    
    if (!result.success) {
      console.error(`エラー: ${result.error}`);
      Deno.exit(1);
    }
    
    console.log("コマンドが正常に実行されました。");
    
  } catch (error) {
    if (error instanceof Error) {
      console.error(`予期しないエラーが発生しました: ${error.message}`);
    } else {
      console.error(`予期しないエラーが発生しました: ${error}`);
    }
    Deno.exit(1);
  }
}

if (import.meta.main) {
  await main();
}