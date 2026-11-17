// Entry point of the Windows and Linux edition.
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { Menu, app } from 'electron';
import { ConfigError, parseConfig, type AppConfig } from './config';
import { Deck, readTextFile } from './deck';
import { parsePrefs } from './prefs';
import { loadScriptLibrary } from './scripts';

const isSmokeTest = process.argv.includes('--smoke-test');

/** shared/ is packaged as a resource; in development it's next to desktop/. */
const sharedDirectory = app.isPackaged
  ? join(process.resourcesPath, 'shared')
  : join(app.getAppPath(), '..', 'shared');

/**
 * ~/.config/XDeckMulti on Linux, %APPDATA%\XDeckMulti on Windows.
 * XDECK_CONFIG_DIR points development builds at another folder, for testing.
 */
const configDirectory =
  !app.isPackaged && process.env.XDECK_CONFIG_DIR !== undefined
    ? process.env.XDECK_CONFIG_DIR
    : join(app.getPath('appData'), 'XDeckMulti');
const settingsPath = join(configDirectory, 'settings.json');

/** A Chrome user agent without "Electron": X turns away embedded browsers it doesn't know. */
function chromeUserAgent(): string {
  const major = process.versions.chrome.split('.')[0] ?? '140';
  const platform =
    process.platform === 'win32' ? 'Windows NT 10.0; Win64; x64' : 'X11; Linux x86_64';
  return `Mozilla/5.0 (${platform}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`;
}

/** Creates settings.json on first launch and refreshes schema.json, like the macOS edition. */
function loadConfig(): AppConfig | { error: string } {
  try {
    mkdirSync(configDirectory, { recursive: true });
    if (!existsSync(settingsPath)) {
      copyFileSync(join(sharedDirectory, 'settings.json'), settingsPath);
    }
    copyFileSync(join(sharedDirectory, 'schema.json'), join(configDirectory, 'schema.json'));
    const text = readTextFile(settingsPath);
    if (text === null) return { error: 'settings.json could not be read.' };
    return parseConfig(text);
  } catch (error) {
    if (error instanceof ConfigError) return { error: error.message };
    return { error: `The settings folder could not be prepared: ${(error as Error).message}` };
  }
}

let deck: Deck | null = null;

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.userAgentFallback = chromeUserAgent();
  app.on('second-instance', () => {
    deck?.focus();
  });
  app.on('window-all-closed', () => {
    app.quit();
  });

  void app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    const prefsPath = join(app.getPath('userData'), 'preferences.json');
    const icon = join(app.getAppPath(), 'build', 'icon-512.png');
    deck = new Deck({
      config: loadConfig(),
      configDirectory,
      settingsPath,
      library: loadScriptLibrary(join(sharedDirectory, 'scripts')),
      prefsPath,
      prefs: parsePrefs(readTextFile(prefsPath)),
      userAgent: app.userAgentFallback,
      icon: existsSync(icon) ? icon : undefined,
      distDirectory: join(__dirname, '..'),
      smokeTest: isSmokeTest,
      skipLogins: !app.isPackaged && process.env.XDECK_SKIP_LOGINS === '1',
    });

    const captureDirectory = process.env.XDECK_CAPTURE_DIR;
    if (!app.isPackaged && captureDirectory !== undefined) {
      const delay = Number(process.env.XDECK_CAPTURE_DELAY ?? '15') * 1000;
      setTimeout(() => {
        void deck
          ?.captureViews(captureDirectory)
          .then((written) => {
            console.log(`CAPTURED\n${written.join('\n')}`);
          })
          .finally(() => {
            app.quit();
          });
      }, delay);
    }
  });
}
