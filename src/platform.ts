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
    platformInfo.chromeUserDataDir = `${
      Deno.env.get("HOME")
    }/Library/Application Support/Google/Chrome`;
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
    platformInfo.chromeUserDataDir = `${
      Deno.env.get("HOME")
    }/.config/google-chrome`;
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
      "Administrator",
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
  path: string,
): Promise<ChromePathValidation> {
  try {
    const stat = await Deno.stat(path);
    if (stat.isFile) {
      return { valid: true, path };
    } else {
      return {
        valid: false,
        error: `パスはファイルではなくディレクトリです: ${path}`,
      };
    }
  } catch (error) {
    return {
      valid: false,
      error: `Chromeパスの検証に失敗しました: ${(error as Error).message}`,
    };
  }
}

/**
 * WSLでのChrome User Dataディレクトリを取得
 * @param username Windowsユーザー名（省略可）
 * @returns Chrome User Dataディレクトリパスまたはundefined
 */
export function getWSLChromeUserDataDir(
  username?: string,
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
      channel: "chrome",
      useExistingProfile: true,
    };
  } else if (platformInfo.isWindows) {
    return {
      channel: "chrome",
      useExistingProfile: true,
    };
  } else if (platformInfo.isWSLg) {
    // WSLg環境: Linux版Google Chromeを使用
    // WSLgによりGUIアプリケーションが動作可能
    // 参考: https://learn.microsoft.com/ja-jp/windows/wsl/tutorials/gui-apps#install-google-chrome-for-linux
    return {
      channel: "chrome",
      useExistingProfile: true,
    };
  } else if (platformInfo.isWSL) {
    // WSL（非WSLg）: Playwright組み込みChromiumを使用
    // Windows側のChromeはWSL-Windows間の通信問題があるため使用しない
    return {
      channel: "chromium",
      useExistingProfile: false,
    };
  } else {
    // Linuxの場合
    return {
      channel: "chromium",
      useExistingProfile: false,
    };
  }
}

/**
 * launchPersistentContext に渡すプラットフォーム固有の起動設定
 *
 * profilePath は Deno.env 依存のため fetcher.ts 側で組み立てるが、
 * profilePath の種別（mac/wslg/wsl/default）を useDefaultUserDataDir フラグで区別する。
 *
 * Why: getBrowserLaunchOptions の戻り値は channel/useExistingProfile のみで
 *      args/ignoreDefaultArgs/acceptDownloads 等が不足していたため、
 *      fetcher.ts の launchBrowser 内に isMac/isWSL/isWSLg の直接分岐が残っていた。
 *      それらを platform.ts に集約し、fetcher.ts から各フラグの直接参照をゼロにする。
 */
export interface PlatformLaunchConfig {
  /** Playwright channel ('chrome' | 'chromium' | undefined) */
  channel?: string;
  /** 直接実行パス（executablePath で Chrome/Chromium を直接指定） */
  executablePath?: string;
  /** launchPersistentContext に渡す args */
  args: string[];
  /** デフォルト引数から除外するフラグ */
  ignoreDefaultArgs?: string[];
  /** ダウンロードを受け入れるか */
  acceptDownloads: boolean;
  /** Playwright 既存プロファイルを使用するか（true = this.options.userDataDir を使用） */
  useExistingProfile: boolean;
  /**
   * プラットフォーム固有のプロファイルパスを使用するか
   * true の場合 fetcher.ts 側で HOME 配下のプロファイルパスを構築する
   * false の場合 this.options.userDataDir をそのまま使用する
   */
  usePlatformProfilePath: boolean;
  /** usePlatformProfilePath=true の場合のプロファイルサブパス（HOME からの相対） */
  platformProfileSubPath?: string;
  /**
   * WSLg 固有: navigator.webdriver 偽装スクリプトを注入するか
   * Google の自動化検出バイパスに必要
   */
  injectWebdriverSpoof: boolean;
  /**
   * Cookie 注入が必要か（WSL/WSLg 環境で保存済み Cookie を使用する場合）
   */
  injectSavedCookies: boolean;
  /**
   * CDP ポート番号（設定時は --remote-debugging-port を使用、未設定時は --remote-debugging-pipe）
   * Why: WSLg/WSL2 では --remote-debugging-pipe の FD 継承が失敗する（Failed global descriptor lookup: 7）
   *      cdpPort を設定することで TCP ポート経由に切り替えて問題を回避する
   */
  cdpPort?: number;
}

/**
 * プラットフォームに応じた完全な launchPersistentContext 設定を返す
 *
 * fetcher.ts の launchBrowser 内の isMac/isWSL/isWSLg 直接分岐を
 * この関数に集約することで、fetcher.ts からプラットフォームフラグの直接参照を排除する。
 */
export function getFullLaunchConfig(
  platformInfo: PlatformInfo,
  options: { headless?: boolean } = {},
): PlatformLaunchConfig {
  if (platformInfo.isMac) {
    return {
      // Why: channel:'chrome' (システムChrome) ではなくPlaywrightバンドルChromiumを使用する
      // x86_64のDeno (Rosetta) からシステムChromeを起動すると
      // remote-debugging-pipe接続がタイムアウトする。
      // PlaywrightバンドルChromiumはarm64-nativeなため正常起動できる。
      // Why: --no-sandbox を ignoreDefaultArgs で除外する
      // macOS では --no-sandbox がサンドボックス機構と競合し
      // remote-debugging-pipe接続が確立できなくなる。
      args: [],
      ignoreDefaultArgs: ["--no-sandbox"],
      acceptDownloads: true,
      useExistingProfile: true,
      usePlatformProfilePath: false,
      injectWebdriverSpoof: false,
      injectSavedCookies: false,
    };
  } else if (platformInfo.isWindows) {
    return {
      channel: "chrome",
      args: ["--no-first-run", "--no-default-browser-check"],
      acceptDownloads: false,
      useExistingProfile: true,
      usePlatformProfilePath: false,
      injectWebdriverSpoof: false,
      injectSavedCookies: false,
    };
  } else if (platformInfo.isWSLg) {
    // WSLg環境: システムの Google Chrome を executablePath で直接指定
    // Why: channel:'chrome' は --remote-debugging-pipe の FD 7 継承失敗でタイムアウト。
    //      バンドル版 Chromium は WSL2 カーネルの seccomp-BPF 制限で exitCode=133(SIGTRAP)。
    //      システム Chrome はWSL2向けにビルドされており、これらの問題が起きにくい。
    //      executablePath で直接指定することで channel フラグの副作用を回避する。
    // --enable-automation を除外してGoogle の自動化検出をバイパスする
    // Why: ignoreDefaultArgs で --enable-automation を除外しないと
    //      Google が「This browser or app may not be secure」を表示してログインをブロックする
    return {
      executablePath: "/opt/google/chrome/chrome",
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        // Why: ContextResult::kTransientFailure - GPU プロセスへの IPC が WSLg 環境で失敗する。
        //      --in-process-gpu で GPU をブラウザプロセス内で実行し IPC 失敗を根本解消する。
        //      headless:true 時は --disable-gpu で GPU 全体を無効化する（描画不要のため）。
        ...(options.headless !== false
          ? ["--disable-gpu"]
          : ["--in-process-gpu"]),
        "--hide-crash-restore-bubble",
        "--disable-blink-features=AutomationControlled",
        "--disable-features=IsolateOrigins,site-per-process",
        "--disable-infobars",
      ],
      ignoreDefaultArgs: ["--enable-automation"],
      acceptDownloads: true,
      useExistingProfile: false,
      usePlatformProfilePath: true,
      platformProfileSubPath: ".taskchute/chrome-profile",
      injectWebdriverSpoof: true,
      injectSavedCookies: true,
      cdpPort: 9222,
    };
  } else if (platformInfo.isWSL) {
    // WSL（非WSLg）: Playwright組み込みChromiumを使用
    // Why: Windows側のChromeはWSL-Windows間の通信問題があるため使用しない
    return {
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
      ],
      acceptDownloads: true,
      useExistingProfile: false,
      usePlatformProfilePath: true,
      platformProfileSubPath: ".taskchute/chromium-profile",
      injectWebdriverSpoof: false,
      injectSavedCookies: true,
    };
  } else {
    // その他の環境（Linux等）
    return {
      args: [],
      acceptDownloads: false,
      useExistingProfile: true,
      usePlatformProfilePath: false,
      injectWebdriverSpoof: false,
      injectSavedCookies: false,
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
