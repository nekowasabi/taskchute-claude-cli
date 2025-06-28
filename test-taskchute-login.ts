#!/usr/bin/env deno run --allow-all

// TaskChute Cloud実際のログイン処理テスト
console.log("=== TaskChute Cloud 実際のログイン処理テスト ===");
console.log("注意: このテストには実際のTaskChute CloudのGoogleアカウント認証情報が必要です。");

try {
  const { TaskChuteDataFetcher } = await import("./src/fetcher.ts");
  const { TaskChuteAuth } = await import("./src/auth.ts");

  // テスト用認証情報（実際の認証情報に置き換えてください）
  const credentials = {
    email: Deno.env.get("TASKCHUTE_EMAIL") || "test@example.com",
    password: Deno.env.get("TASKCHUTE_PASSWORD") || "testpass"
  };

  console.log(`使用するメールアドレス: ${credentials.email}`);
  console.log("パスワード: ****** (マスクされています)");

  if (credentials.email === "test@example.com") {
    console.log("\n⚠️  テスト用のダミー認証情報が設定されています。");
    console.log("実際のログインテストを行うには、以下の環境変数を設定してください:");
    console.log("export TASKCHUTE_EMAIL=\"your-actual-email@example.com\"");
    console.log("export TASKCHUTE_PASSWORD=\"your-actual-password\"");
    console.log("\n現在はモックテストのみ実行します。");
    
    // モックテストのみ実行
    const fetcher = new TaskChuteDataFetcher({ headless: true });
    const mockResult = await fetcher.performGoogleLogin(credentials, { mock: true });
    console.log(`✓ モックログインテスト: ${mockResult.success ? "成功" : "失敗"}`);
    
  } else {
    console.log("\n🚀 実際の認証情報が設定されています。実際のログインテストを開始します...");
    console.log("注意: このテストは実際のブラウザを起動してTaskChute Cloudにアクセスします。");
    
    const confirm = prompt("実際のログインテストを実行しますか？ (y/N): ");
    if (confirm?.toLowerCase() === 'y') {
      
      // 非ヘッドレスモードでテスト（デバッグしやすい）
      const fetcher = new TaskChuteDataFetcher({ 
        headless: false,  // ブラウザを表示
        timeout: 60000    // 60秒タイムアウト
      });
      
      console.log("実際のログインテストを開始します...");
      console.log("ブラウザが起動して、TaskChute Cloudのログインページに移動します。");
      
      const loginResult = await fetcher.performGoogleLogin(credentials);
      
      if (loginResult.success) {
        console.log(`✅ ログイン成功！最終URL: ${loginResult.finalUrl}`);
        
        // セッション情報を保存してテスト
        const auth = new TaskChuteAuth(credentials);
        const sessionResult = await auth.createSession();
        console.log(`✓ セッション作成: ${sessionResult.success ? "成功" : "失敗"}`);
        
      } else {
        console.log(`❌ ログイン失敗: ${loginResult.error}`);
      }
      
      // クリーンアップ
      await fetcher.cleanup();
      
    } else {
      console.log("実際のログインテストをキャンセルしました。");
    }
  }

  console.log("\n=== テスト完了 ===");
  console.log("\n実装された機能:");
  console.log("✓ 正しいログインURL: https://taskchute.cloud/auth/login/");
  console.log("✓ 複数のGoogleログインボタンセレクタ対応");
  console.log("✓ 詳細なログイン進行状況表示");
  console.log("✓ 正確なリダイレクト先URL対応（/taskchute）");
  console.log("✓ デバッグ用スクリーンショット機能");
  console.log("✓ エラーハンドリングの強化");

} catch (error) {
  console.error("❌ テスト中にエラーが発生しました:", (error as Error).message);
  console.error("詳細:", error);
}