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
  
  const platformInfo: PlatformInfo = {
    isWSL,
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
  const platform = detectPlatform();

  // WSL環境でない場合はundefinedを返す
  if (!platform.isWSL) {
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
  } else if (platformInfo.isWSL) {
    // WSLではWindows側のChromeを使用
    return {
      executablePath: '/mnt/c/Program Files/Google/Chrome/Application/chrome.exe',
      useExistingProfile: true
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
  console.log(`  Linux: ${info.isLinux ? "✓" : "✗"}`);
  if (info.chromeUserDataDir) {
    console.log(`  Chrome User Data: ${info.chromeUserDataDir}`);
  }
}