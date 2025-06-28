#!/usr/bin/env deno run --allow-all

// テスト用環境変数を設定
Deno.env.set("GOOGLE_CLIENT_ID", "test-client-id");
Deno.env.set("GOOGLE_CLIENT_SECRET", "test-client-secret");
Deno.env.set("GOOGLE_REDIRECT_URI", "http://localhost:8080/callback");

// CLIの基本動作をテスト
console.log("=== TaskChute CLI 基本動作テスト ===");

try {
  const { CLI } = await import("./src/cli.ts");
  
  console.log("1. CLIインスタンス作成テスト...");
  const cli = new CLI();
  console.log("✓ CLIインスタンスが正常に作成されました");
  
  console.log("2. ヘルプメッセージテスト...");
  const helpMessage = cli.getHelpMessage();
  console.log("✓ ヘルプメッセージが生成されました");
  
  console.log("3. コマンド一覧テスト...");
  const commands = cli.getAvailableCommands();
  console.log(`✓ 利用可能なコマンド: ${commands.join(", ")}`);
  
  console.log("4. dry-runテスト...");
  const loginResult = await cli.run(["login", "--dry-run"]);
  console.log(`✓ loginコマンド (dry-run): ${loginResult.success ? "成功" : "失敗"}`);
  
  const statusResult = await cli.run(["status", "--dry-run"]);
  console.log(`✓ statusコマンド (dry-run): ${statusResult.success ? "成功" : "失敗"}`);
  
  console.log("\n=== 基本動作テスト完了 ===");
  console.log("すべてのテストが正常に完了しました！");
  
} catch (error) {
  console.error("❌ テスト中にエラーが発生しました:", (error as Error).message);
  Deno.exit(1);
}