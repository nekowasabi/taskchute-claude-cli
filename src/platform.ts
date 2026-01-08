/**
 * プラットフォーム判定とChrome設定のユーティリティ
 *
 * WSL互換性対応:
 * - Windowsユーザー名の自動検出
 * - Chromeパスの検証
 * - WSL専用のブラウザ起動オプション
 */

export interface PlatformInfo {
  isWSL: boolean;
  isWSLg: boolean;
  isMac: boolean;
  isWindows: boolean;
  isLinux: boolean;
  chromeUserDataDir?: string;
}

/**
 * Chrome実行パスの検証結果
 */
export interface ChromePathValidation {
  valid: boolean;
  error?: string;
  path?: string;
}

/**
 * 現在のプラットフォームを判定する
 */
export function detectPlatform(): PlatformInfo {
  const os = Deno.build.os;
  const isWSL = checkIfWSL();
  const isWSLg = isWSL && checkIfWSLg();

  const platformInfo: PlatformInfo = {
    isWSL,
    isWSLg,
    isMac: os === "darwin",
    isWindows: os === "windows" && !isWSL,
    isLinux: os === "linux" && !isWSL,
  };
  
  // プラットフォームごとのChromeユーザーデータディレクトリを設定
  if (platformInfo.isMac) {
    platformInfo.chromeUserDataDir = `${Deno.env.get("HOME")}/Library/Application Support/Google/Chrome`;
  } else if (platformInfo.isWindows) {
    const appData = Deno.env.get("LOCALAPPDATA") || Deno.env.get("APPDATA");
    if (appData) {
      platformInfo.chromeUserDataDir = `${appData}\\Google\\Chrome\\User Data`;
    }
  } else if (platformInfo.isWSL) {
    // WSLの場合、Windows側のChromeプロファイルを使用可能
    const userDataDir = getWSLChromeUserDataDir();
    if (userDataDir) {
      platformInfo.chromeUserDataDir = userDataDir;
    }
  } else if (platformInfo.isLinux) {
    platformInfo.chromeUserDataDir = `${Deno.env.get("HOME")}/.config/google-chrome`;
  }
  
  return platformInfo;
}

/**
 * WSL環境かどうかを判定する
 */
function checkIfWSL(): boolean {
  try {
    // /proc/versionファイルの内容でWSLを判定
    const procVersion = Deno.readTextFileSync("/proc/version");
    return procVersion.toLowerCase().includes("microsoft") ||
           procVersion.toLowerCase().includes("wsl");
  } catch {
    // ファイルが読めない場合はWSLではない
    return false;
  }
}

/**
 * WSLg環境かどうかを判定する
 * WSLgが有効な場合、/mnt/wslgディレクトリが存在する
 * 参考: https://learn.microsoft.com/ja-jp/windows/wsl/tutorials/gui-apps
 */
function checkIfWSLg(): boolean {
  try {
    // /mnt/wslgディレクトリの存在確認
    const stat = Deno.statSync("/mnt/wslg");
    if (stat.isDirectory) {
      return true;
    }
  } catch {
    // ディレクトリが存在しない場合
  }

  // 環境変数でも確認（WAYLAND_DISPLAYまたはDISPLAY）
  const waylandDisplay = Deno.env.get("WAYLAND_DISPLAY");
  const display = Deno.env.get("DISPLAY");

  return !!(waylandDisplay || display);
}

/**
 * Windowsユーザー名を検出する
 * 優先順位:
 * 1. 環境変数WINDOWS_USERNAME
 * 2. /mnt/c/Users/配下のスキャン（最初のユーザーディレクトリ）
 * @returns ユーザー名またはundefined
 */
export function detectWindowsUsername(): string | undefined {
  // 環境変数を優先
  const envUsername = Deno.env.get("WINDOWS_USERNAME");
  if (envUsername) {
    return envUsername;
  }

  // WSL環境でない場合はundefinedを返す
  if (!checkIfWSL()) {
    return undefined;
  }

  // /mnt/c/Users配下をスキャン
  try {
    const usersPath = "/mnt/c/Users";
    const entries = Deno.readDirSync(usersPath);

    // 除外対象のディレクトリ名
    const excludedNames = new Set([
      "Public",
      "Default",
      "Default User",
      "All Users",
      "Administrator"
    ]);

    for (const entry of entries) {
      if (entry.isDirectory && !excludedNames.has(entry.name)) {
        // 見つかった最初のユーザーディレクトリを返す
        return entry.name;
      }
    }

    return undefined;
  } catch {
    return undefined;
  }
}

/**
 * Chrome実行パスを検証する
 * @param path 検証するパス
 * @returns 検証結果
 */
export async function validateChromePath(
  path: string
): Promise<ChromePathValidation> {
  try {
    const stat = await Deno.stat(path);
    if (stat.isFile) {
      return { valid: true, path };
    } else {
      return { valid: false, error: `パスはファイルではなくディレクトリです: ${path}` };
    }
  } catch (error) {
    return {
      valid: false,
      error: `Chromeパスの検証に失敗しました: ${(error as Error).message}`
    };
  }
}

/**
 * WSLでのChrome User Dataディレクトリを取得
 * @param username Windowsユーザー名（省略可）
 * @returns Chrome User Dataディレクトリパスまたはundefined
 */
export function getWSLChromeUserDataDir(
  username?: string
): string | undefined {
  // 注意: detectPlatform()を呼び出すと相互再帰でスタックオーバーフローが発生する
  // 直接checkIfWSL()を使用する
  const isWSL = checkIfWSL();

  // WSL環境でない場合はundefinedを返す
  if (!isWSL) {
    return undefined;
  }

  // ユーザー名が指定されていない場合は自動検出
  let targetUsername = username;
  if (!targetUsername) {
    targetUsername = detectWindowsUsername();
  }

  if (!targetUsername) {
    return undefined;
  }

  return `/mnt/c/Users/${targetUsername}/AppData/Local/Google/Chrome/User Data`;
}

/**
 * Chromeユーザーデータディレクトリが存在するか確認
 */
export async function checkChromeUserDataDir(path: string): Promise<boolean> {
  try {
    const stat = await Deno.stat(path);
    return stat.isDirectory;
  } catch {
    return false;
  }
}

/**
 * プラットフォームに応じたブラウザ起動オプションを取得
 */
export function getBrowserLaunchOptions(platformInfo: PlatformInfo): {
  channel?: string;
  executablePath?: string;
  useExistingProfile: boolean;
} {
  if (platformInfo.isMac) {
    return {
      channel: 'chrome',
      useExistingProfile: true
    };
  } else if (platformInfo.isWindows) {
    return {
      channel: 'chrome',
      useExistingProfile: true
    };
  } else if (platformInfo.isWSLg) {
    // WSLg環境: Linux版Google Chromeを使用
    // WSLgによりGUIアプリケーションが動作可能
    // 参考: https://learn.microsoft.com/ja-jp/windows/wsl/tutorials/gui-apps#install-google-chrome-for-linux
    return {
      channel: 'chrome',
      useExistingProfile: true
    };
  } else if (platformInfo.isWSL) {
    // WSL（非WSLg）: Playwright組み込みChromiumを使用
    // Windows側のChromeはWSL-Windows間の通信問題があるため使用しない
    return {
      channel: 'chromium',
      useExistingProfile: false
    };
  } else {
    // Linuxの場合
    return {
      channel: 'chromium',
      useExistingProfile: false
    };
  }
}

/**
 * プラットフォーム情報をログ出力
 */
export function logPlatformInfo(info: PlatformInfo): void {
  console.log("プラットフォーム情報:");
  console.log(`  OS: ${Deno.build.os}`);
  console.log(`  Mac: ${info.isMac ? "✓" : "✗"}`);
  console.log(`  Windows: ${info.isWindows ? "✓" : "✗"}`);
  console.log(`  WSL: ${info.isWSL ? "✓" : "✗"}`);
  console.log(`  WSLg: ${info.isWSLg ? "✓" : "✗"}`);
  console.log(`  Linux: ${info.isLinux ? "✓" : "✗"}`);
  if (info.chromeUserDataDir) {
    console.log(`  Chrome User Data: ${info.chromeUserDataDir}`);
  }
}

/**
 * WSL環境でLinuxパスをWindowsパスに変換する
 * Windows Chrome.exeはLinuxパスを認識できないため、UNCパス形式に変換が必要
 *
 * @param linuxPath Linux形式のパス (例: /home/user/.taskchute/profile)
 * @returns Windowsパス (例: \\wsl.localhost\Ubuntu\home\user\.taskchute\profile)
 *          非WSL環境では元のパスをそのまま返す
 */
export async function convertToWindowsPath(linuxPath: string): Promise<string> {
  // WSL環境でない場合は元のパスを返す
  if (!checkIfWSL()) {
    return linuxPath;
  }

  try {
    // wslpath -w コマンドでLinuxパスをWindowsパスに変換
    const command = new Deno.Command("wslpath", {
      args: ["-w", linuxPath],
      stdout: "piped",
      stderr: "piped",
    });

    const { code, stdout, stderr } = await command.output();

    if (code !== 0) {
      const errorText = new TextDecoder().decode(stderr);
      console.error(`wslpath変換エラー: ${errorText}`);
      return linuxPath; // 変換失敗時は元のパスを返す
    }

    const windowsPath = new TextDecoder().decode(stdout).trim();
    console.log(`[Platform] パス変換: ${linuxPath} -> ${windowsPath}`);
    return windowsPath;

  } catch (error) {
    console.error(`wslpathコマンド実行エラー: ${(error as Error).message}`);
    return linuxPath; // エラー時は元のパスを返す
  }
}