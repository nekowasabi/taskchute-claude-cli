#!/usr/bin/env deno run --allow-all

import { CLI } from "./cli.ts";

async function main() {
  try {
    const cli = new CLI();
    const args = Deno.args;
    
    if (args.length === 0) {
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
    console.error(`予期しないエラーが発生しました: ${error.message}`);
    Deno.exit(1);
  }
}

if (import.meta.main) {
  await main();
}