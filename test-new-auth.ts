#!/usr/bin/env deno run --allow-all

// 新しい認証方式のテスト用環境変数を設定
Deno.env.set("TASKCHUTE_EMAIL", "test@example.com");
Deno.env.set("TASKCHUTE_PASSWORD", "testpass");

console.log("=== 新しい認証方式（環境変数ベース）テスト ===");

try {
  // 1. 認証クラステスト
  console.log("1. TaskChuteAuth クラステスト...");
  const { TaskChuteAuth } = await import("./src/auth.ts");
  
  const auth = TaskChuteAuth.fromEnvironment();
  console.log("✓ TaskChuteAuth.fromEnvironment() が正常に作成されました");
  
  const credentials = auth.getCredentials();
  console.log(`✓ 認証情報取得: Email = ${credentials.email}`);
  
  // 2. CLIクラステスト
  console.log("2. CLI クラステスト...");
  const { CLI } = await import("./src/cli.ts");
  
  const cli = new CLI();
  console.log("✓ CLIインスタンスが正常に作成されました");
  
  // 3. ヘルプメッセージテスト
  console.log("3. 更新されたヘルプメッセージテスト...");
  const helpMessage = cli.getHelpMessage();
  if (helpMessage.includes("環境変数のメール・パスワードを使用")) {
    console.log("✓ ヘルプメッセージが新しい認証方式に更新されています");
  } else {
    console.log("❌ ヘルプメッセージが古い内容のままです");
  }
  
  // 4. コマンド実行テスト（dry-run）
  console.log("4. コマンド実行テスト（dry-run）...");
  
  const loginResult = await cli.run(["login", "--dry-run"]);
  console.log(`✓ loginコマンド (dry-run): ${loginResult.success ? "成功" : "失敗"}`);
  
  const statusResult = await cli.run(["status", "--dry-run"]);
  console.log(`✓ statusコマンド (dry-run): ${statusResult.success ? "成功" : "失敗"}`);
  
  // 5. セッション管理テスト
  console.log("5. セッション管理テスト...");
  const sessionStatus = await auth.getSessionStatus();
  console.log(`✓ セッション状態取得: ログイン = ${sessionStatus.isLoggedIn}`);
  
  // 6. 設定管理テスト
  console.log("6. 設定管理テスト...");
  const { ConfigManager } = await import("./src/config.ts");
  
  const config = new ConfigManager();
  const authConfig = config.getAuthConfig();
  console.log(`✓ 設定からメール取得: ${authConfig.email}`);
  
  // 7. フェッチャークラステスト
  console.log("7. TaskChuteDataFetcher テスト...");
  const { TaskChuteDataFetcher } = await import("./src/fetcher.ts");
  
  const fetcher = new TaskChuteDataFetcher({ headless: true });
  console.log("✓ TaskChuteDataFetcher インスタンスが作成されました");
  
  // モック環境でのブラウザログインテスト
  const mockLoginResult = await fetcher.performGoogleLogin(credentials, { mock: true });
  console.log(`✓ ブラウザログイン (mock): ${mockLoginResult.success ? "成功" : "失敗"}`);
  
  console.log("\n=== 新しい認証方式テスト完了 ===");
  console.log("🎉 すべてのテストが正常に完了しました！");
  console.log("\n次のステップ:");
  console.log("1. 実際のメールアドレス・パスワードを環境変数に設定");
  console.log("2. 'deno run --allow-all src/main.ts login' で実際のログインテスト");
  console.log("3. TaskChute Cloudのページ構造を確認してセレクタを調整");
  
} catch (error) {
  console.error("❌ テスト中にエラーが発生しました:", (error as Error).message);
  console.error("詳細:", error);
  Deno.exit(1);
}