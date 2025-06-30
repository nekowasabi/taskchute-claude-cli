import { assertEquals, assertStringIncludes } from "testing/asserts.ts";
import { CLI } from "../src/cli.ts";

Deno.test("CLI - コマンド構造のテスト", async (t) => {
  await t.step("CLIインスタンスが正常に作成されること", () => {
    const cli = new CLI();
    assertEquals(typeof cli, "object");
  });

  await t.step("利用可能なコマンドを取得できること", () => {
    const cli = new CLI();
    const commands = cli.getAvailableCommands();
    assertEquals(Array.isArray(commands), true);
    assertEquals(commands.includes("login"), true);
    assertEquals(commands.includes("fetch"), true);
    assertEquals(commands.includes("status"), true);
  });

  await t.step("ヘルプメッセージが表示されること", () => {
    const cli = new CLI();
    const helpMessage = cli.getHelpMessage();
    assertStringIncludes(helpMessage, "taskchute-cli");
    assertStringIncludes(helpMessage, "login");
    assertStringIncludes(helpMessage, "fetch");
    assertStringIncludes(helpMessage, "status");
  });

  await t.step("不正なコマンドでエラーが返されること", async () => {
    const cli = new CLI();
    try {
      await cli.run(["invalid-command"]);
      throw new Error("例外が発生するべきです");
    } catch (error) {
      assertStringIncludes((error as Error).message, "Unknown command");
    }
  });
});

Deno.test("CLI - loginコマンドのテスト", async (t) => {
  await t.step("loginコマンドが認識されること", async () => {
    const cli = new CLI();
    const result = await cli.run(["login", "--dry-run"]);
    assertEquals(result.command, "login");
    assertEquals(result.success, true);
  });

  await t.step("loginコマンドでヘッドレスオプションが動作すること", async () => {
    const cli = new CLI();
    const result = await cli.run(["login", "--headless", "--dry-run"]);
    assertEquals(result.options?.headless, true);
  });
});

Deno.test("CLI - fetchコマンドのテスト", async (t) => {
  await t.step("fetchコマンドが認識されること", async () => {
    const cli = new CLI();
    const result = await cli.run(["fetch", "--output", "test.html", "--dry-run"]);
    assertEquals(result.command, "fetch");
    assertEquals(result.options?.output, "test.html");
  });

  await t.step("fetchコマンドで出力ファイルが必須であること", async () => {
    const cli = new CLI();
    const result = await cli.run(["fetch"]);
    assertEquals(result.success, false);
    assertStringIncludes(result.error!, "output");
  });

  await t.step("fetchコマンドで--fromと--toオプションが認識されること", async () => {
    const cli = new CLI();
    const result = await cli.run(["fetch", "--output", "test.json", "--from", "2025-06-01", "--to", "2025-06-30", "--dry-run"]);
    assertEquals(result.command, "fetch");
    assertEquals(result.options?.from, "2025-06-01");
    assertEquals(result.options?.to, "2025-06-30");
  });

  await t.step("fetchコマンドで不正な日付形式でエラーが発生すること", async () => {
    const cli = new CLI();
    const result = await cli.run(["fetch", "--output", "test.json", "--from", "2025/06/01"]);
    assertEquals(result.success, false);
    assertStringIncludes(result.error!, "日付形式が不正");
    assertStringIncludes(result.error!, "YYYY-MM-DD");
  });

  await t.step("fetchコマンドで--fromのみ指定した場合もエラーにならないこと", async () => {
    const cli = new CLI();
    const result = await cli.run(["fetch", "--output", "test.json", "--from", "2025-06-01", "--dry-run"]);
    assertEquals(result.command, "fetch");
    assertEquals(result.options?.from, "2025-06-01");
    assertEquals(result.options?.to, undefined);
  });
});

Deno.test("CLI - statusコマンドのテスト", async (t) => {
  await t.step("statusコマンドが認識されること", async () => {
    const cli = new CLI();
    const result = await cli.run(["status", "--dry-run"]);
    assertEquals(result.command, "status");
    assertEquals(result.success, true);
  });
});