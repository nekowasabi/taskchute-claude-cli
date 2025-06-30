/**
 * プラットフォーム判定とChrome設定のユーティリティ
 */

export interface PlatformInfo {
  isWSL: boolean;
  isMac: boolean;
  isWindows: boolean;
  isLinux: boolean;
  chromeUserDataDir?: string;
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
    const windowsUsername = Deno.env.get("WINDOWS_USERNAME");
    if (windowsUsername) {
      platformInfo.chromeUserDataDir = `/mnt/c/Users/${windowsUsername}/AppData/Local/Google/Chrome/User Data`;
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