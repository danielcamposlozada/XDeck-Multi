// The window: login screens one account at a time, then a row of columns, each a WebContentsView
// with its account's session. The port of ContentView, LoginView and WebView from the macOS edition.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  BaseWindow,
  WebContentsView,
  app,
  dialog,
  ipcMain,
  net,
  screen,
  session,
  shell,
  type IpcMainEvent,
  type Session,
  type WebContents,
} from 'electron';
import {
  DEFAULT_WINDOW_HEIGHT,
  DEFAULT_WINDOW_WIDTH,
  accountKey,
  accountKeys,
  columnUrl,
  isXColumn,
  leftMostXColumnIndex,
  partitionFor,
  profileUrlFor,
  sideHeaderColumnIndices,
  type AppConfig,
} from './config';
import { computeLayout } from './layout';
import { decideNavigation, isWebUrl } from './navigation';
import {
  ZOOM_STEP,
  clampZoom,
  defaultBackground,
  isDarkThemeColor,
  normalizeThemeColor,
  type Prefs,
} from './prefs';
import {
  LOGIN_SCRIPTS,
  buildPageScript,
  columnScripts,
  nightModeScript,
  type ScriptLibrary,
} from './scripts';
import {
  LATEST_RELEASE_URL,
  REPOSITORY_URL,
  extractVersion,
  isNewerVersion,
  releaseUrl,
  shortVersion,
} from './version';

const LOGIN_URL = 'https://x.com/login';
const SPONSOR_URL = 'https://github.com/sponsors/morishin?frequency=one-time';
/** Covers the reload plus the theme-color debounce; a fallback if the page never confirms. */
const DARK_MODE_UPDATE_TIMEOUT_MS = 5000;

export interface DeckOptions {
  /** settings.json, or the reason it couldn't be loaded. */
  config: AppConfig | { error: string };
  configDirectory: string;
  settingsPath: string;
  library: ScriptLibrary;
  prefsPath: string;
  prefs: Prefs;
  userAgent: string;
  icon: string | undefined;
  distDirectory: string;
  /** Exit right after the first screen is ready (CI). */
  smokeTest: boolean;
  /** Development aid: go straight to the columns, as if every login was skipped. */
  skipLogins: boolean;
}

type PageInfo =
  | { kind: 'login'; accountKey: string }
  | { kind: 'column'; index: number };

interface ColumnEntry {
  view: WebContentsView;
  url: string;
}

interface PageMessage {
  type: string;
  body: string;
}

function parsePageMessage(raw: string): PageMessage | null {
  try {
    const data: unknown = JSON.parse(raw);
    if (typeof data !== 'object' || data === null) return null;
    const { type, body } = data as Record<string, unknown>;
    return typeof type === 'string' && typeof body === 'string' ? { type, body } : null;
  } catch {
    return null;
  }
}

export class Deck {
  private readonly window: BaseWindow;
  private readonly host: WebContentsView;
  private readonly pages = new Map<number, PageInfo>();
  private readonly profileUrls = new Map<string, string>();
  private readonly skippedAccountKeys = new Set<string>();
  private readonly preparedSessions = new Set<Session>();
  private columns: (ColumnEntry | null)[] = [];
  private loginView: WebContentsView | null = null;
  private mode: XDeckIpc.HostState['mode'] = 'loading';
  private hostLayout: XDeckIpc.HostLayout | null = null;
  private expandedColumnIndex: number | null = null;
  private background: string;
  private isDarkModeUpdating = false;
  private darkModeTimer: NodeJS.Timeout | null = null;
  private latestVersion: string | null = null;
  private hasFitWindow = false;
  private isFinishingSmokeTest = false;

  constructor(private readonly options: DeckOptions) {
    this.background = defaultBackground(options.prefs.isDarkMode);
    this.window = new BaseWindow({
      width: DEFAULT_WINDOW_WIDTH,
      height: DEFAULT_WINDOW_HEIGHT,
      minWidth: 400,
      minHeight: 300,
      title: 'XDeck Multi',
      backgroundColor: this.background,
      autoHideMenuBar: true,
      show: false,
      ...(options.icon === undefined ? {} : { icon: options.icon }),
    });
    this.window.setMenuBarVisibility(false);

    this.host = new WebContentsView({
      webPreferences: {
        preload: join(options.distDirectory, 'preload', 'host.js'),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
      },
    });
    this.host.setBackgroundColor(this.background);
    this.window.contentView.addChildView(this.host);
    this.fitHostToWindow();
    this.attachCommonHandlers(this.host.webContents);
    this.host.webContents.on('will-navigate', (event) => {
      event.preventDefault();
    });

    this.window.on('resize', () => {
      this.fitHostToWindow();
    });
    this.window.on('closed', () => {
      this.dispose();
    });

    this.registerIpc();
    this.host.webContents.once('did-finish-load', () => {
      this.window.show();
      this.start();
    });
    void this.host.webContents.loadFile(join(options.distDirectory, 'renderer', 'host.html'));
  }

  focus(): void {
    if (this.window.isMinimized()) this.window.restore();
    this.window.focus();
  }

  // MARK: Flow

  private get config(): AppConfig | null {
    return 'error' in this.options.config ? null : this.options.config;
  }

  private start(): void {
    const config = this.config;
    if (config === null) {
      this.mode = 'error';
      this.sendState();
      return;
    }
    void this.checkForUpdate();
    if (this.options.skipLogins) {
      for (const key of accountKeys(config)) this.skippedAccountKeys.add(key);
    }
    this.advance();
  }

  /** The account whose login screen is showing, or undefined once every account is ready. */
  private pendingLoginAccountKey(): string | undefined {
    const config = this.config;
    if (config === null) return undefined;
    return accountKeys(config).find(
      (key) => !this.profileUrls.has(key) && !this.skippedAccountKeys.has(key),
    );
  }

  private advance(): void {
    const key = this.pendingLoginAccountKey();
    if (key === undefined) {
      this.showColumns();
    } else {
      this.showLogin(key);
    }
  }

  private showLogin(key: string): void {
    this.closeLoginView();
    // A fresh web view for each account, so each one uses its own session.
    const view = this.createPageView(key);
    this.pages.set(view.webContents.id, { kind: 'login', accountKey: key });
    this.loginView = view;
    this.window.contentView.addChildView(view);
    view.setVisible(false);
    this.mode = 'login';
    this.hostLayout = null;
    this.sendState();
    void view.webContents.loadURL(LOGIN_URL).catch(() => undefined);
  }

  private closeLoginView(): void {
    if (this.loginView === null) return;
    this.pages.delete(this.loginView.webContents.id);
    this.window.contentView.removeChildView(this.loginView);
    this.loginView.webContents.close();
    this.loginView = null;
  }

  private showColumns(): void {
    const config = this.config;
    if (config === null) return;
    this.closeLoginView();
    this.columns = config.columns.map((column, index) => {
      const key = accountKey(column);
      const url = columnUrl(column, this.profileUrls.get(key));
      if (url === null) return null;
      const view = this.createPageView(key);
      this.pages.set(view.webContents.id, { kind: 'column', index });
      this.window.contentView.addChildView(view);
      view.setVisible(false);
      void view.webContents.loadURL(url).catch(() => undefined);
      return { view, url };
    });
    this.mode = 'deck';
    this.hostLayout = null;
    this.sendState();
  }

  // MARK: Views

  private prepareSession(partition: string): Session {
    const accountSession = session.fromPartition(partition);
    if (this.preparedSessions.has(accountSession)) return accountSession;
    this.preparedSessions.add(accountSession);
    accountSession.setUserAgent(this.options.userAgent);
    const allowed = new Set(['clipboard-sanitized-write', 'fullscreen']);
    accountSession.setPermissionRequestHandler((_contents, permission, callback) => {
      callback(allowed.has(permission));
    });
    accountSession.setPermissionCheckHandler((_contents, permission) => allowed.has(permission));
    return accountSession;
  }

  private createPageView(key: string): WebContentsView {
    const view = new WebContentsView({
      webPreferences: {
        session: this.prepareSession(partitionFor(key)),
        preload: join(this.options.distDirectory, 'preload', 'column.js'),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        webSecurity: true,
      },
    });
    view.setBackgroundColor(this.background);
    const contents = view.webContents;
    this.attachCommonHandlers(contents);
    contents.setZoomFactor(this.options.prefs.pageZoom);
    contents.on('dom-ready', () => {
      contents.setZoomFactor(this.options.prefs.pageZoom);
    });
    contents.setWindowOpenHandler(({ url }) => {
      if (isWebUrl(url)) void shell.openExternal(url);
      return { action: 'deny' };
    });
    contents.on('will-navigate', (event) => {
      const info = this.pages.get(contents.id);
      const startUrl =
        info?.kind === 'column' ? (this.columns[info.index]?.url ?? LOGIN_URL) : LOGIN_URL;
      const decision = decideNavigation(event.url, startUrl);
      if (decision === 'allow') return;
      event.preventDefault();
      if (decision === 'external') void shell.openExternal(event.url);
    });
    return view;
  }

  /** Keyboard shortcuts work wherever the focus is, so every web contents gets them. */
  private attachCommonHandlers(contents: WebContents): void {
    contents.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown' || input.alt) return;
      if (!(input.control || input.meta)) {
        if (input.key === 'F5') {
          this.refresh();
          event.preventDefault();
        }
        return;
      }
      const key = input.key.toLowerCase();
      let handled = true;
      if (key === '+' || key === '=' || key === 'add') this.changeZoom(ZOOM_STEP);
      else if (key === '-' || key === '_' || key === 'subtract') this.changeZoom(-ZOOM_STEP);
      else if (key === '.' || key === '0') this.setZoom(1);
      else if (key === 'r') this.refresh();
      else if (key === 'f') this.fitWindowToContent();
      else if (key === ',') this.confirmOpenSettings();
      else if (key === 'i' && input.shift && !app.isPackaged) contents.openDevTools({ mode: 'detach' });
      else handled = false;
      if (handled) event.preventDefault();
    });
  }

  private pageViews(): WebContentsView[] {
    const views = this.columns.flatMap((entry) => (entry === null ? [] : [entry.view]));
    if (this.loginView !== null) views.push(this.loginView);
    return views;
  }

  private fitHostToWindow(): void {
    const [width = 0, height = 0] = this.window.getContentSize();
    this.host.setBounds({ x: 0, y: 0, width, height });
  }

  /** Puts the web views where the host page says the login area or the columns are. */
  private layoutViews(): void {
    const hostLayout = this.hostLayout;
    if (hostLayout === null) return;
    const { area } = hostLayout;

    if (this.mode === 'login' && this.loginView !== null) {
      this.loginView.setBounds(roundRect(area));
      this.loginView.setVisible(area.width > 0 && area.height > 0);
      return;
    }
    const config = this.config;
    if (this.mode !== 'deck' || config === null) return;

    const layout = this.computeColumnsLayout(area.width);
    layout.slots.forEach((slot, index) => {
      const entry = this.columns[index];
      if (entry === undefined || entry === null) return;
      const x = area.x + slot.x - hostLayout.scrollLeft;
      const isOnScreen = x + slot.width > area.x && x < area.x + area.width;
      entry.view.setVisible(slot.visible && isOnScreen);
      if (slot.visible) {
        entry.view.setBounds(roundRect({ x, y: area.y, width: slot.width, height: area.height }));
      }
    });

    if (!this.hasFitWindow && config.columnWidth !== undefined) {
      this.hasFitWindow = true;
      this.fitWindowToContent();
    }
  }

  private computeColumnsLayout(areaWidth: number): ReturnType<typeof computeLayout> {
    const config = this.config;
    return computeLayout({
      columnCount: config?.columns.length ?? 0,
      columnWidth: config?.columnWidth,
      areaWidth,
      zoom: this.options.prefs.pageZoom,
      sideHeaderIndices: config === null ? new Set() : sideHeaderColumnIndices(config),
      expandedIndex: this.expandedColumnIndex,
      isPresent: this.columns.map((entry) => entry !== null),
    });
  }

  // MARK: Host page

  private sendState(): void {
    this.host.webContents.send('xdeck:host-state', this.hostState());
  }

  private hostState(): XDeckIpc.HostState {
    const { prefs } = this.options;
    const background = this.background;
    switch (this.mode) {
      case 'loading':
        return { mode: 'loading', background };
      case 'error': {
        const message = 'error' in this.options.config ? this.options.config.error : '';
        return { mode: 'error', background, message, settingsPath: this.options.settingsPath };
      }
      case 'login': {
        const config = this.config;
        const hasMultipleAccounts = config !== null && accountKeys(config).length > 1;
        const key = this.pendingLoginAccountKey() ?? '';
        return {
          mode: 'login',
          background,
          isDarkMode: prefs.isDarkMode,
          accountLabel: hasMultipleAccounts ? (key === '' ? 'default' : key) : null,
          canSkip: hasMultipleAccounts,
        };
      }
      case 'deck':
        return {
          mode: 'deck',
          background,
          isDarkMode: prefs.isDarkMode,
          isDarkModeUpdating: this.isDarkModeUpdating,
          hideAds: prefs.hideAds,
          contentWidth: this.computeColumnsLayout(this.hostLayout?.area.width ?? 0).contentWidth,
          isWindowFittingEnabled: this.config?.columnWidth !== undefined,
          version: {
            current: shortVersion(app.getVersion()),
            isDev: !app.isPackaged,
            latest: this.latestVersion,
          },
        };
    }
  }

  private readonly onHostLayout = (event: IpcMainEvent, layout: XDeckIpc.HostLayout): void => {
    if (event.sender !== this.host.webContents) return;
    const previousWidth = this.hostLayout?.area.width;
    this.hostLayout = layout;
    this.layoutViews();
    this.finishSmokeTest();
    // The automatic column width depends on the area's width, and so does the scroll width.
    if (this.mode === 'deck' && previousWidth !== layout.area.width) this.sendState();
  };

  private readonly onHostAction = (event: IpcMainEvent, action: XDeckIpc.HostAction): void => {
    if (event.sender !== this.host.webContents) return;
    switch (action.type) {
      case 'skip-login': {
        const key = this.pendingLoginAccountKey();
        if (key !== undefined && this.mode === 'login') {
          this.skippedAccountKeys.add(key);
          this.advance();
        }
        break;
      }
      case 'toggle-dark-mode':
        this.toggleDarkMode();
        break;
      case 'toggle-hide-ads':
        this.toggleHideAds();
        break;
      case 'open-settings-folder':
        void shell.openPath(this.options.configDirectory);
        break;
      case 'open-link': {
        const version = shortVersion(app.getVersion());
        const urls = {
          github: REPOSITORY_URL,
          sponsor: SPONSOR_URL,
          release: releaseUrl(version),
          'latest-release': LATEST_RELEASE_URL,
        };
        void shell.openExternal(urls[action.link]);
        break;
      }
    }
  };

  // MARK: Pages

  private readonly onPageScript = (event: IpcMainEvent): void => {
    const info = this.pages.get(event.sender.id);
    event.returnValue = info === undefined ? '' : this.pageScript(info);
  };

  private pageScript(info: PageInfo): string {
    const { library, prefs } = this.options;
    if (info.kind === 'login') return buildPageScript(library, LOGIN_SCRIPTS);
    const config = this.config;
    const column = config?.columns[info.index];
    if (config === null || column === undefined) return '';
    return buildPageScript(
      library,
      columnScripts({
        type: column.type,
        columnIndex: info.index,
        isXColumn: isXColumn(column),
        isLeftMostXColumn: info.index === leftMostXColumnIndex(config),
        showsSideHeader: sideHeaderColumnIndices(config).has(info.index),
        hideAds: prefs.hideAds,
      }),
    );
  }

  private readonly onPageMessage = (event: IpcMainEvent, raw: unknown): void => {
    const info = this.pages.get(event.sender.id);
    if (info === undefined || typeof raw !== 'string') return;
    const message = parsePageMessage(raw);
    if (message === null) return;

    switch (message.type) {
      case 'userName': {
        // Usernames come from the login screen, one per account.
        if (info.kind !== 'login' || info.accountKey !== this.pendingLoginAccountKey()) return;
        const url = profileUrlFor(message.body);
        if (url === null) return;
        this.profileUrls.set(info.accountKey, url);
        this.advance();
        break;
      }
      case 'themeColor': {
        const color = normalizeThemeColor(message.body);
        if (color === null) return;
        this.setBackground(color);
        this.options.prefs.isDarkMode = isDarkThemeColor(color);
        this.savePrefs();
        if (info.kind === 'column') this.setDarkModeUpdating(false);
        this.sendState();
        break;
      }
      case 'mediaOverlay': {
        if (info.kind !== 'column') return;
        if (message.body === 'close') {
          this.expandedColumnIndex = null;
        } else {
          const index = Number(message.body);
          if (Number.isInteger(index) && index >= 0 && index < this.columns.length) {
            this.expandedColumnIndex = index;
          }
        }
        this.sendState();
        this.layoutViews();
        break;
      }
      case 'debug':
        if (!app.isPackaged) console.log(`[column ${info.kind === 'column' ? info.index : 'login'}] ${message.body}`);
        break;
    }
  };

  private readonly onScrollBy = (event: IpcMainEvent, deltaX: unknown): void => {
    if (!this.pages.has(event.sender.id) || typeof deltaX !== 'number' || !Number.isFinite(deltaX)) return;
    this.host.webContents.send('xdeck:host-scroll-by', deltaX);
  };

  private registerIpc(): void {
    ipcMain.on('xdeck:host-layout', this.onHostLayout);
    ipcMain.on('xdeck:host-action', this.onHostAction);
    ipcMain.on('xdeck:page-script', this.onPageScript);
    ipcMain.on('xdeck:page-message', this.onPageMessage);
    ipcMain.on('xdeck:scroll-by', this.onScrollBy);
  }

  private dispose(): void {
    ipcMain.off('xdeck:host-layout', this.onHostLayout);
    ipcMain.off('xdeck:host-action', this.onHostAction);
    ipcMain.off('xdeck:page-script', this.onPageScript);
    ipcMain.off('xdeck:page-message', this.onPageMessage);
    ipcMain.off('xdeck:scroll-by', this.onScrollBy);
    if (this.darkModeTimer !== null) clearTimeout(this.darkModeTimer);
  }

  private broadcast(script: string, onlyXColumns: boolean): void {
    const config = this.config;
    this.columns.forEach((entry, index) => {
      if (entry === null) return;
      const column = config?.columns[index];
      if (onlyXColumns && (column === undefined || !isXColumn(column))) return;
      void entry.view.webContents.executeJavaScript(script).catch(() => undefined);
    });
  }

  // MARK: Commands

  private setBackground(color: string): void {
    this.background = color;
    this.window.setBackgroundColor(color);
    this.host.setBackgroundColor(color);
  }

  private setDarkModeUpdating(isUpdating: boolean): void {
    this.isDarkModeUpdating = isUpdating;
    if (this.darkModeTimer !== null) clearTimeout(this.darkModeTimer);
    this.darkModeTimer = null;
    if (isUpdating) {
      this.darkModeTimer = setTimeout(() => {
        this.setDarkModeUpdating(false);
        this.sendState();
      }, DARK_MODE_UPDATE_TIMEOUT_MS);
    }
  }

  private toggleDarkMode(): void {
    if (this.mode !== 'deck' || this.isDarkModeUpdating) return;
    const { prefs, library } = this.options;
    prefs.isDarkMode = !prefs.isDarkMode;
    this.savePrefs();
    this.setBackground(defaultBackground(prefs.isDarkMode));
    this.setDarkModeUpdating(true);
    this.broadcast(nightModeScript(library, prefs.isDarkMode), true);
    this.sendState();
  }

  private toggleHideAds(): void {
    if (this.mode !== 'deck') return;
    const { prefs, library } = this.options;
    prefs.hideAds = !prefs.hideAds;
    this.savePrefs();
    this.broadcast(prefs.hideAds ? library.hideAds : library.showAds, false);
    this.sendState();
  }

  private setZoom(zoom: number): void {
    const { prefs } = this.options;
    const next = clampZoom(zoom);
    if (next === prefs.pageZoom) return;
    prefs.pageZoom = next;
    this.savePrefs();
    for (const view of this.pageViews()) view.webContents.setZoomFactor(next);
    this.sendState();
    this.layoutViews();
  }

  private changeZoom(delta: number): void {
    this.setZoom(this.options.prefs.pageZoom + delta);
  }

  private refresh(): void {
    if (this.mode === 'login') {
      this.loginView?.webContents.reload();
      return;
    }
    for (const entry of this.columns) {
      if (entry !== null) void entry.view.webContents.loadURL(entry.url).catch(() => undefined);
    }
  }

  /** Resizes the window to the columns' width (only with a fixed columnWidth, like on macOS). */
  private fitWindowToContent(): void {
    const area = this.hostLayout?.area;
    if (this.mode !== 'deck' || this.config?.columnWidth === undefined || area === undefined) return;
    const { naturalWidth } = this.computeColumnsLayout(area.width);
    if (naturalWidth <= 0) return;
    if (this.window.isMaximized()) this.window.unmaximize();
    const [contentWidth = 0, contentHeight = 0] = this.window.getContentSize();
    const frameWidth = this.window.getBounds().width - contentWidth;
    const workArea = screen.getDisplayMatching(this.window.getBounds()).workArea;
    const extra = contentWidth - area.width; // anything beside the columns area
    const width = Math.min(naturalWidth + extra, workArea.width - frameWidth);
    this.window.setContentSize(Math.round(width), contentHeight);
  }

  private confirmOpenSettings(): void {
    void dialog
      .showMessageBox(this.window, {
        type: 'question',
        message: 'Do you want to open the settings folder?',
        detail: 'Edit settings.json and restart the app.',
        buttons: ['Open Folder', 'Cancel'],
        defaultId: 0,
        cancelId: 1,
      })
      .then(({ response }) => {
        if (response === 0) void shell.openPath(this.options.configDirectory);
      });
  }

  private savePrefs(): void {
    try {
      writeFileSync(this.options.prefsPath, JSON.stringify(this.options.prefs, null, 2));
    } catch (error) {
      console.error('Could not save preferences:', error);
    }
  }

  private async checkForUpdate(): Promise<void> {
    if (this.options.smokeTest) return;
    try {
      const response = await net.fetch(LATEST_RELEASE_URL, { method: 'HEAD', redirect: 'follow' });
      const latest = extractVersion(response.url);
      if (isNewerVersion(latest, shortVersion(app.getVersion()))) {
        this.latestVersion = latest;
        this.sendState();
      }
    } catch {
      // Offline or no releases yet: keep showing the current version.
    }
  }

  /**
   * Development aid: saves what the host page and each visible web view show, as PNG files.
   * Used to check the layout without looking at the screen (XDECK_CAPTURE_DIR).
   */
  async captureViews(directory: string): Promise<string[]> {
    const targets: [string, WebContentsView][] = [['host', this.host]];
    if (this.loginView !== null) targets.push(['login', this.loginView]);
    this.columns.forEach((entry, index) => {
      if (entry !== null) targets.push([`column-${index}`, entry.view]);
    });
    const written: string[] = [];
    for (const [name, view] of targets) {
      if (!view.getVisible()) continue;
      const image = await view.webContents.capturePage();
      const path = join(directory, `${name}.png`);
      writeFileSync(path, image.toPNG());
      const { x, y, width, height } = view.getBounds();
      written.push(`${name}: ${x},${y} ${width}x${height}`);
    }
    return written;
  }

  private finishSmokeTest(): void {
    if (!this.options.smokeTest || this.isFinishingSmokeTest) return;
    this.isFinishingSmokeTest = true;
    console.log(`SMOKE TEST OK: ${this.mode} screen ready`);
    setTimeout(() => {
      app.exit(0);
    }, 500);
  }
}

export function readTextFile(path: string): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

function roundRect(rect: XDeckIpc.Rect): Electron.Rectangle {
  return {
    x: Math.round(rect.x),
    y: Math.round(rect.y),
    width: Math.max(0, Math.round(rect.width)),
    height: Math.max(0, Math.round(rect.height)),
  };
}
