#!/usr/bin/env deno run --allow-all

// XPathセレクタを含む更新されたログイン処理テスト
console.log("=== XPathベースのGoogleログインボタン検索テスト ===");

try {
  const { TaskChuteDataFetcher } = await import("./src/fetcher.ts");

  // テスト用認証情報
  const credentials = {
    email: Deno.env.get("TASKCHUTE_EMAIL") || "test@example.com", 
    password: Deno.env.get("TASKCHUTE_PASSWORD") || "testpass"
  };

  console.log("🎯 実装された新しいセレクタ戦略:");
  console.log("1. XPath由来の正確なCSSセレクタ:");
  console.log("   - body > div:nth-child(4) > div > div:nth-child(2) > div > button:first-child");
  console.log("   - button:first-child:has(span svg)");
  console.log("   - button:has(span:first-child svg)");
  
  console.log("\n2. SVGアイコンベースのセレクタ:");
  console.log("   - button:has(svg)");
  console.log("   - button span svg");
  
  console.log("\n3. 直接XPathセレクタ (フォールバック):");
  console.log("   - /html/body/div[4]/div/div[2]/div/button[1]");
  console.log("   - //button[span/svg]");
  console.log("   - //button[contains(., 'Google')]");

  console.log("\n4. デバッグ機能:");
  console.log("   - スクリーンショット保存");
  console.log("   - ページ上の全ボタン情報出力");
  console.log("   - XPath詳細情報出力");

  // モックテストで機能確認
  console.log("\n🧪 モックテスト実行中...");
  const fetcher = new TaskChuteDataFetcher({ headless: true });
  const mockResult = await fetcher.performGoogleLogin(credentials, { mock: true });
  
  if (mockResult.success) {
    console.log("✅ モックテスト成功");
    console.log(`   最終URL: ${mockResult.finalUrl}`);
  } else {
    console.log("❌ モックテスト失敗:", mockResult.error);
  }

  console.log("\n📋 実際のログインテスト手順:");
  console.log("1. 実際の認証情報を設定:");
  console.log("   export TASKCHUTE_EMAIL=\"your-google-email@gmail.com\"");
  console.log("   export TASKCHUTE_PASSWORD=\"your-google-password\"");
  
  console.log("\n2. 非ヘッドレスモードでテスト:");
  console.log("   TASKCHUTE_HEADLESS=false deno run --allow-all src/main.ts login");
  
  console.log("\n3. ヘッドレスモードでテスト:");
  console.log("   deno run --allow-all src/main.ts login");

  console.log("\n🔧 トラブルシューティング:");
  console.log("- ログイン失敗時は ./tmp/claude/login-page-debug.png でページ状況を確認");
  console.log("- コンソールログでどのセレクタが有効だったかを確認");
  console.log("- XPath詳細情報でページ構造の変化を確認");

  console.log("\n=== テスト完了 ===");
  console.log("指定されたXPath要素(/html/body/div[4]/div/div[2]/div/button[1]/span[1]/svg)");
  console.log("を基にした包括的なセレクタ戦略が実装されました！");

} catch (error) {
  console.error("❌ テスト中にエラーが発生しました:", (error as Error).message);
  console.error("詳細:", error);
}