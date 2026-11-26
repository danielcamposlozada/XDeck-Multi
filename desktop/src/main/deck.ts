// The window: login screens one account at a time, then a row of columns, each a WebContentsView
// with its account's session. The port of ContentView, LoginView and WebView from the macOS edition.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import {
  BaseWindow,
  Menu,
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
  columnIcon,
  columnTitle,
  columnUrl,
  isXColumn,
  normalizeCustomUrl,
  partitionFor,
  profileUrlFor,
  searchColumn,
  searchQuery,
  sideHeaderColumnIndices,
  withColumns,
  type AppConfig,
  type Column,
} from './config';
import { combinedFraction, parseVideoRequest, progressText, uniqueVideoPath } from './download';
import { computeLayout } from './layout';
import { decideNavigation, isWebUrl } from './navigation';
import {
  MAX_ZOOM,
  MIN_ZOOM,
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
  compactScript,
  nightModeScript,
  type ScriptLibrary,
} from './scripts';
import {
  LATEST_RELEASE_URL,
  REPOSITORY_URL,
  extractVersion,
  isNewerVersion,
  releaseUrl,
} from './version';

const LOGIN_URL = 'https://x.com/login';
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

type PageInfo = { kind: 'login'; accountKey: string } | { kind: 'column'; id: number };

/** A column and its web view. The id stays the same when the column moves. */
interface ColumnEntry {
  id: number;
  column: Column;
  view: WebContentsView | null;
  url: string | null;
  /** Whether the page hides X's side navigation (it isn't its account's first column). */
  isCompact: boolean;
}

interface VideoDownload {
  url: string;
  fileName: string;
  state: 'downloading' | 'done' | 'failed';
  received: number;
  total: number;
  path: string | null;
}

/** A row of the Columns window: an existing column (with its id) or one added there. */
interface DraftColumn {
  id: number | null;
  column: Column;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export class Deck {
  private readonly window: BaseWindow;
  private readonly host: WebContentsView;
  private readonly pages = new Map<number, PageInfo>();
  private readonly profileUrls = new Map<string, string>();
  private readonly skippedAccountKeys = new Set<string>();
  private readonly preparedSessions = new Set<Session>();
  private entries: ColumnEntry[] = [];
  private nextColumnId = 1;
  private loginView: WebContentsView | null = null;
  private mode: XDeckIpc.HostState['mode'] = 'loading';
  private hostLayout: XDeckIpc.HostLayout | null = null;
  private expandedColumnId: number | null = null;
  /** Where the host page has the columns while one is being dragged. */
  private dragFrame: XDeckIpc.DragFrame | null = null;
  private columnsDraft: { rows: DraftColumn[]; error: string | null } | null = null;
  /** Video downloads of this session, newest last. */
  private downloads: VideoDownload[] = [];
  /** The last finished download stays in the toolbar for a while. */
  private finishedDownload: VideoDownload | null = null;
  private noticeTimer: NodeJS.Timeout | null = null;
  private lastProgressUpdate = 0;
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

    if ('error' in options.config) {
      this.entries = [];
    } else {
      this.entries = options.config.columns.map((column) => this.newEntry(column));
    }

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

  private get hasConfig(): boolean {
    return !('error' in this.options.config);
  }

  /** The current columns, in order, as settings.json has them. */
  private get config(): AppConfig | null {
    if (!this.hasConfig) return null;
    const base = this.options.config as AppConfig;
    return {
      ...(base.columnWidth === undefined ? {} : { columnWidth: base.columnWidth }),
      columns: this.entries.map((entry) => entry.column),
    };
  }

  private newEntry(column: Column): ColumnEntry {
    return { id: this.nextColumnId++, column, view: null, url: null, isCompact: false };
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
    for (const entry of this.entries) entry.view?.setVisible(false);
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

  /** Creates the web views the columns still need; columns that already have one keep it. */
  private showColumns(): void {
    if (this.config === null) return;
    this.closeLoginView();
    this.updateCompactRoles();
    for (const entry of this.entries) {
      const key = accountKey(entry.column);
      const url = columnUrl(entry.column, this.profileUrls.get(key));
      if (entry.view !== null && entry.url === url) continue;
      this.closeColumnView(entry);
      if (url === null) continue;
      const view = this.createPageView(key);
      entry.view = view;
      entry.url = url;
      this.pages.set(view.webContents.id, { kind: 'column', id: entry.id });
      this.window.contentView.addChildView(view);
      view.setVisible(false);
      void view.webContents.loadURL(url).catch(() => undefined);
    }
    this.mode = 'deck';
    this.hostLayout = null;
    this.sendState();
  }

  private closeColumnView(entry: ColumnEntry): void {
    if (entry.view === null) return;
    this.pages.delete(entry.view.webContents.id);
    this.window.contentView.removeChildView(entry.view);
    entry.view.webContents.close();
    entry.view = null;
    entry.url = null;
  }

  /**
   * Which columns hide X's side navigation follows their order. A column whose role changed is
   * updated in place, without reloading its page; its next load gets the new scripts anyway,
   * since they are built when the page asks for them.
   */
  private updateCompactRoles(): void {
    const config = this.config;
    if (config === null) return;
    const sideHeaders = sideHeaderColumnIndices(config);
    this.entries.forEach((entry, index) => {
      const isCompact = isXColumn(entry.column) && !sideHeaders.has(index);
      if (isCompact === entry.isCompact) return;
      entry.isCompact = isCompact;
      void entry.view?.webContents
        .executeJavaScript(compactScript(this.options.library, isCompact))
        .catch(() => undefined);
    });
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
        info?.kind === 'column' ? (this.entryById(info.id)?.url ?? LOGIN_URL) : LOGIN_URL;
      const decision = decideNavigation(event.url, startUrl);
      if (decision === 'allow') return;
      event.preventDefault();
      if (decision === 'external') void shell.openExternal(event.url);
    });
    return view;
  }

  private entryById(id: number): ColumnEntry | undefined {
    return this.entries.find((entry) => entry.id === id);
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
    const views = this.entries.flatMap((entry) => (entry.view === null ? [] : [entry.view]));
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

    // The Columns window covers the whole deck.
    const isDialogOpen = this.columnsDraft !== null;
    const layout = this.computeColumnsLayout(area.width);
    const dragged = new Map((this.dragFrame?.positions ?? []).map(({ id, x }) => [id, x]));
    layout.slots.forEach((slot, index) => {
      const entry = this.entries[index];
      if (entry === undefined || entry.view === null) return;
      const contentX = dragged.get(entry.id) ?? slot.x;
      const x = area.x + contentX - hostLayout.scrollLeft;
      const isOnScreen = x + slot.width > area.x && x < area.x + area.width;
      entry.view.setVisible(!isDialogOpen && slot.visible && isOnScreen);
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
    const expandedIndex =
      this.expandedColumnId === null
        ? -1
        : this.entries.findIndex((entry) => entry.id === this.expandedColumnId);
    return computeLayout({
      columnCount: config?.columns.length ?? 0,
      columnWidth: config?.columnWidth,
      areaWidth,
      zoom: this.options.prefs.pageZoom,
      sideHeaderIndices: config === null ? new Set() : sideHeaderColumnIndices(config),
      expandedIndex: expandedIndex === -1 ? null : expandedIndex,
      isPresent: this.entries.map((entry) => entry.view !== null),
    });
  }

  // MARK: Host page

  private sendState(): void {
    this.host.webContents.send('xdeck:host-state', this.hostState());
  }

  /** The @handle of a signed-in account, or the account's name until then. */
  private handleFor(column: Column): string | null {
    const profileUrl = this.profileUrls.get(accountKey(column));
    if (profileUrl !== undefined) return `@${profileUrl.split('/').pop() ?? ''}`;
    return accountKey(column) === '' ? null : (column.account ?? '').trim();
  }

  private columnsDialogState(): XDeckIpc.ColumnsDialog | null {
    const draft = this.columnsDraft;
    if (draft === null) return null;
    const accounts: string[] = [];
    const seen = new Set<string>();
    for (const { column } of draft.rows) {
      const key = accountKey(column);
      if (key !== '' && !seen.has(key)) {
        seen.add(key);
        accounts.push((column.account ?? '').trim());
      }
    }
    return {
      rows: draft.rows.map(({ column }) => ({
        title: columnTitle(column),
        subtitle:
          searchQuery(column) !== null
            ? 'Search · Latest'
            : column.type === 'custom'
              ? (column.url ?? null)
              : null,
        icon: columnIcon(column),
        account: accountKey(column) === '' ? null : (column.account ?? '').trim(),
      })),
      accounts,
      error: draft.error,
    };
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
        const keys = config === null ? [] : accountKeys(config);
        const hasMultipleAccounts = keys.length > 1;
        const key = this.pendingLoginAccountKey() ?? '';
        return {
          mode: 'login',
          background,
          isDarkMode: prefs.isDarkMode,
          accountLabel: hasMultipleAccounts ? (key === '' ? 'default' : key) : null,
          progress: hasMultipleAccounts ? `Account ${keys.indexOf(key) + 1} of ${keys.length}` : null,
          canSkip: hasMultipleAccounts,
        };
      }
      case 'deck': {
        const layout = this.computeColumnsLayout(this.hostLayout?.area.width ?? 0);
        return {
          mode: 'deck',
          background,
          isDarkMode: prefs.isDarkMode,
          isDarkModeUpdating: this.isDarkModeUpdating,
          hideAds: prefs.hideAds,
          contentWidth: layout.contentWidth,
          isWindowFittingEnabled: this.config?.columnWidth !== undefined,
          zoomPercent: Math.round(prefs.pageZoom * 100),
          canZoomIn: prefs.pageZoom < MAX_ZOOM,
          canZoomOut: prefs.pageZoom > MIN_ZOOM,
          columns: this.entries.map((entry, index) => ({
            id: entry.id,
            title: columnTitle(entry.column),
            icon: columnIcon(entry.column),
            handle: this.handleFor(entry.column),
            x: layout.slots[index]?.x ?? 0,
            width: layout.slots[index]?.width ?? 0,
          })),
          dialog: this.columnsDialogState(),
          notice: this.downloadNotice(),
          version: {
            current: app.getVersion(),
            isDev: !app.isPackaged,
            latest: this.latestVersion,
          },
        };
      }
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

  private readonly onHostDragFrame = (event: IpcMainEvent, frame: unknown): void => {
    if (event.sender !== this.host.webContents || this.mode !== 'deck') return;
    if (frame === null) {
      this.dragFrame = null;
      this.layoutViews();
      return;
    }
    if (!isRecord(frame) || typeof frame.draggedId !== 'number' || !Array.isArray(frame.positions)) {
      return;
    }
    const positions = frame.positions.filter(
      (item): item is { id: number; x: number } =>
        isRecord(item) && typeof item.id === 'number' && typeof item.x === 'number' && Number.isFinite(item.x),
    );
    // The dragged column passes over the others, so its view goes on top.
    if (this.dragFrame?.draggedId !== frame.draggedId) {
      const view = this.entryById(frame.draggedId)?.view;
      if (view) this.window.contentView.addChildView(view);
    }
    this.dragFrame = { draggedId: frame.draggedId, positions };
    this.layoutViews();
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
      case 'zoom':
        if (action.direction === 'reset') this.setZoom(1);
        else this.changeZoom(action.direction === 'in' ? ZOOM_STEP : -ZOOM_STEP);
        break;
      case 'refresh':
        this.refresh();
        break;
      case 'fit-window':
        this.fitWindowToContent();
        break;
      case 'column-menu':
        this.showColumnMenu(action.id);
        break;
      case 'move-column':
        this.moveColumn(action.id, action.delta);
        break;
      case 'reorder-columns':
        if (Array.isArray(action.order)) this.reorderColumns(action.order);
        break;
      case 'columns-open':
        this.openColumnsDialog();
        break;
      case 'columns-cancel':
        this.closeColumnsDialog();
        break;
      case 'columns-save':
        this.saveColumnsDialog();
        break;
      case 'columns-add':
        this.addDraftColumn(action);
        break;
      case 'columns-remove':
        this.columnsDraft?.rows.splice(action.index, 1);
        this.sendState();
        break;
      case 'columns-move': {
        const rows = this.columnsDraft?.rows;
        const target = action.index + action.delta;
        if (rows !== undefined && target >= 0 && target < rows.length) {
          const [row] = rows.splice(action.index, 1);
          if (row !== undefined) rows.splice(target, 0, row);
          this.sendState();
        }
        break;
      }
      case 'show-downloaded-file':
        if (this.finishedDownload?.path) shell.showItemInFolder(this.finishedDownload.path);
        break;
      case 'dismiss-notice':
        this.finishedDownload = null;
        this.sendState();
        break;
      case 'open-link': {
        const version = app.getVersion();
        const urls = {
          github: REPOSITORY_URL,
          release: releaseUrl(version),
          'latest-release': LATEST_RELEASE_URL,
        };
        const url = urls[action.link];
        if (typeof url === 'string') void shell.openExternal(url);
        break;
      }
    }
  };

  // MARK: Moving columns

  private showColumnMenu(id: number): void {
    const index = this.entries.findIndex((entry) => entry.id === id);
    if (index === -1 || this.mode !== 'deck') return;
    Menu.buildFromTemplate([
      {
        label: 'Move Left',
        enabled: index > 0,
        click: () => {
          this.moveColumn(id, -1);
        },
      },
      {
        label: 'Move Right',
        enabled: index < this.entries.length - 1,
        click: () => {
          this.moveColumn(id, 1);
        },
      },
      { type: 'separator' },
      {
        label: 'Edit Columns…',
        click: () => {
          this.openColumnsDialog();
        },
      },
    ]).popup();
  }

  private moveColumn(id: number, delta: -1 | 1): void {
    const order = this.entries.map((entry) => entry.id);
    const index = order.indexOf(id);
    const target = index + delta;
    if (index === -1 || target < 0 || target >= order.length) return;
    order.splice(index, 1);
    order.splice(target, 0, id);
    this.reorderColumns(order);
  }

  /** Puts the columns in the order the host page sent and saves it. No page reloads. */
  private reorderColumns(order: unknown[]): void {
    if (this.mode !== 'deck') return;
    const byId = new Map(this.entries.map((entry) => [entry.id, entry]));
    const reordered = order.flatMap((id) => {
      const entry = typeof id === 'number' ? byId.get(id) : undefined;
      if (entry === undefined) return [];
      byId.delete(id as number);
      return [entry];
    });
    // Anything the host page didn't mention keeps its place at the end.
    reordered.push(...byId.values());
    const changed = reordered.some((entry, index) => entry !== this.entries[index]);
    this.entries = reordered;
    this.dragFrame = null;
    if (changed) {
      this.updateCompactRoles();
      this.saveColumns();
    }
    this.sendState();
    this.layoutViews();
  }

  // MARK: Columns window

  private openColumnsDialog(): void {
    if (this.mode !== 'deck') return;
    this.columnsDraft = {
      rows: this.entries.map((entry) => ({ id: entry.id, column: { ...entry.column } })),
      error: null,
    };
    this.sendState();
    this.layoutViews();
  }

  private closeColumnsDialog(): void {
    this.columnsDraft = null;
    this.sendState();
    this.layoutViews();
  }

  private addDraftColumn(action: Extract<XDeckIpc.HostAction, { type: 'columns-add' }>): void {
    const draft = this.columnsDraft;
    if (draft === null) return;
    const account = typeof action.account === 'string' && action.account.trim() !== '' ? action.account.trim() : undefined;
    const text = typeof action.text === 'string' ? action.text.trim() : '';
    let column: Column;
    if (action.columnType === 'search' && text !== '') {
      column = searchColumn(text, account);
    } else if (action.columnType === 'custom') {
      const url = normalizeCustomUrl(text);
      if (url === null) {
        draft.error = 'Type a web address, such as https://x.com/i/lists/123456789.';
        this.sendState();
        return;
      }
      column = { type: 'custom', url };
    } else {
      column = { type: action.columnType };
    }
    if (account !== undefined) column.account = account;
    draft.rows.push({ id: null, column });
    draft.error = null;
    this.sendState();
  }

  /** Applies the Columns window: keeps the web views of the columns that stay, and saves. */
  private saveColumnsDialog(): void {
    const draft = this.columnsDraft;
    if (draft === null) return;
    if (draft.rows.length === 0) {
      draft.error = 'Keep at least one column.';
      this.sendState();
      return;
    }
    const kept = new Set(draft.rows.flatMap((row) => (row.id === null ? [] : [row.id])));
    for (const entry of this.entries) {
      if (!kept.has(entry.id)) this.closeColumnView(entry);
    }
    if (this.expandedColumnId !== null && !kept.has(this.expandedColumnId)) this.expandedColumnId = null;
    this.entries = draft.rows.map((row) => {
      const existing = row.id === null ? undefined : this.entryById(row.id);
      return existing ?? this.newEntry(row.column);
    });
    this.columnsDraft = null;
    this.saveColumns();
    // A new account signs in first; the other columns are kept meanwhile.
    this.advance();
  }

  private saveColumns(): void {
    const config = this.config;
    if (config === null) return;
    try {
      writeFileSync(this.options.settingsPath, withColumns(readTextFile(this.options.settingsPath), config.columns));
    } catch (error) {
      void dialog.showMessageBox(this.window, {
        type: 'warning',
        message: "Couldn't save settings.json",
        detail: `The new columns will be lost when the app quits. ${(error as Error).message}`,
      });
    }
  }

  // MARK: Video downloads

  /** Progress of the downloads still running, or the last one that finished. */
  private downloadNotice(): XDeckIpc.Notice | null {
    const active = this.downloads.filter((download) => download.state === 'downloading');
    const [first] = active;
    if (first !== undefined) {
      return {
        kind: 'working',
        text: active.length === 1 ? `Downloading ${first.fileName}` : `Downloading ${active.length} videos`,
        detail: progressText(active),
        fraction: combinedFraction(active),
        canShowFile: false,
      };
    }
    const finished = this.finishedDownload;
    if (finished === null) return null;
    return finished.state === 'done'
      ? {
          kind: 'done',
          text: 'Saved to Downloads',
          detail: finished.fileName,
          fraction: null,
          canShowFile: finished.path !== null,
        }
      : {
          kind: 'failed',
          text: "Couldn't download the video",
          detail: 'Click its button to try again',
          fraction: null,
          canShowFile: false,
        };
  }

  /** Updates the toolbar, the pages' download buttons and the taskbar progress. */
  private reportDownloads(): void {
    const states: Record<string, { state: string; fraction?: number }> = {};
    for (const download of this.downloads) {
      states[download.url] = {
        state: download.state,
        ...(download.total > 0 ? { fraction: Math.min(1, download.received / download.total) } : {}),
      };
    }
    this.broadcast(`window.__xdeckDownloadStates && window.__xdeckDownloadStates(${JSON.stringify(states)});`, true);
    const active = this.downloads.filter((download) => download.state === 'downloading');
    if (active.length === 0) {
      this.window.setProgressBar(-1);
    } else {
      const fraction = combinedFraction(active);
      if (fraction === null) this.window.setProgressBar(2, { mode: 'indeterminate' });
      else this.window.setProgressBar(fraction);
    }
    this.sendState();
  }

  private finishDownload(download: VideoDownload): void {
    this.finishedDownload = download;
    if (this.noticeTimer !== null) clearTimeout(this.noticeTimer);
    this.noticeTimer = setTimeout(() => {
      if (this.finishedDownload === download) {
        this.finishedDownload = null;
        this.sendState();
      }
    }, 10_000);
    if (!this.window.isFocused()) this.window.flashFrame(true);
    this.reportDownloads();
  }

  /** Saves a video a column's download button asked for to the Downloads folder. */
  private async downloadVideo(body: string): Promise<void> {
    const request = parseVideoRequest(body);
    if (request === null) return;
    if (this.downloads.some((item) => item.url === request.url && item.state === 'downloading')) return;
    // A finished or failed earlier try of the same video starts over.
    this.downloads = this.downloads.filter((item) => item.url !== request.url);
    const download: VideoDownload = {
      url: request.url,
      fileName: `${request.baseName}.mp4`,
      state: 'downloading',
      received: 0,
      total: 0,
      path: null,
    };
    this.downloads.push(download);
    this.reportDownloads();
    try {
      const response = await net.fetch(request.url);
      if (!response.ok || response.body === null) throw new Error(`HTTP ${response.status}`);
      download.total = Number(response.headers.get('content-length') ?? 0) || 0;
      const chunks: Uint8Array[] = [];
      const reader = response.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        download.received += value.byteLength;
        // About ten updates a second is plenty for a progress bar.
        const now = Date.now();
        if (now - this.lastProgressUpdate > 100) {
          this.lastProgressUpdate = now;
          this.reportDownloads();
        }
      }
      const path = uniqueVideoPath(app.getPath('downloads'), request.baseName, existsSync);
      writeFileSync(path, Buffer.concat(chunks));
      download.state = 'done';
      download.path = path;
      download.fileName = basename(path);
    } catch {
      download.state = 'failed';
    }
    this.finishDownload(download);
  }

  // MARK: Pages

  private readonly onPageScript = (event: IpcMainEvent): void => {
    const info = this.pages.get(event.sender.id);
    event.returnValue = info === undefined ? '' : this.pageScript(info);
  };

  private pageScript(info: PageInfo): string {
    const { library, prefs } = this.options;
    if (info.kind === 'login') return buildPageScript(library, LOGIN_SCRIPTS);
    const config = this.config;
    const index = this.entries.findIndex((entry) => entry.id === info.id);
    const column = this.entries[index]?.column;
    if (config === null || column === undefined) return '';
    return buildPageScript(
      library,
      columnScripts({
        type: column.type,
        columnId: info.id,
        isXColumn: isXColumn(column),
        showsSideHeader: sideHeaderColumnIndices(config).has(index),
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
        const changed = color !== this.background;
        this.setBackground(color);
        this.options.prefs.isDarkMode = isDarkThemeColor(color);
        if (changed) this.savePrefs();
        if (info.kind === 'column') this.setDarkModeUpdating(false);
        // Every X column reports the theme, so only redraw when something changed.
        if (changed || info.kind === 'column') this.sendState();
        break;
      }
      case 'mediaOverlay': {
        if (info.kind !== 'column') return;
        if (message.body === 'close') {
          this.expandedColumnId = null;
        } else {
          const id = Number(message.body);
          if (Number.isInteger(id) && this.entryById(id) !== undefined) this.expandedColumnId = id;
        }
        this.sendState();
        this.layoutViews();
        break;
      }
      case 'downloadVideo':
        if (info.kind === 'column') void this.downloadVideo(message.body);
        break;
      case 'debug':
        if (!app.isPackaged) console.log(`[column ${info.kind === 'column' ? info.id : 'login'}] ${message.body}`);
        break;
    }
  };

  private readonly onScrollBy = (event: IpcMainEvent, deltaX: unknown): void => {
    if (!this.pages.has(event.sender.id) || typeof deltaX !== 'number' || !Number.isFinite(deltaX)) return;
    this.host.webContents.send('xdeck:host-scroll-by', deltaX);
  };

  private registerIpc(): void {
    ipcMain.on('xdeck:host-layout', this.onHostLayout);
    ipcMain.on('xdeck:host-drag-frame', this.onHostDragFrame);
    ipcMain.on('xdeck:host-action', this.onHostAction);
    ipcMain.on('xdeck:page-script', this.onPageScript);
    ipcMain.on('xdeck:page-message', this.onPageMessage);
    ipcMain.on('xdeck:scroll-by', this.onScrollBy);
  }

  private dispose(): void {
    ipcMain.off('xdeck:host-layout', this.onHostLayout);
    ipcMain.off('xdeck:host-drag-frame', this.onHostDragFrame);
    ipcMain.off('xdeck:host-action', this.onHostAction);
    ipcMain.off('xdeck:page-script', this.onPageScript);
    ipcMain.off('xdeck:page-message', this.onPageMessage);
    ipcMain.off('xdeck:scroll-by', this.onScrollBy);
    if (this.darkModeTimer !== null) clearTimeout(this.darkModeTimer);
    if (this.noticeTimer !== null) clearTimeout(this.noticeTimer);
  }

  private broadcast(script: string, onlyXColumns: boolean): void {
    for (const entry of this.entries) {
      if (entry.view === null) continue;
      if (onlyXColumns && !isXColumn(entry.column)) continue;
      void entry.view.webContents.executeJavaScript(script).catch(() => undefined);
    }
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
    for (const entry of this.entries) {
      if (entry.view !== null && entry.url !== null) {
        void entry.view.webContents.loadURL(entry.url).catch(() => undefined);
      }
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
        message: 'Open the settings folder?',
        detail:
          'Edit settings.json, then restart XDeck Multi. To add, remove or move columns, use the Columns button instead.',
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
      if (isNewerVersion(latest, app.getVersion())) {
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
    this.entries.forEach((entry, index) => {
      if (entry.view !== null) targets.push([`column-${index}`, entry.view]);
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

