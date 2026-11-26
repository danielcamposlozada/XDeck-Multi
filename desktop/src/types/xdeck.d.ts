// Types shared by the main process, the preload scripts and the host page.
// Kept ambient (no imports or exports) so the host page can use them without a module loader.

declare namespace XDeckIpc {
  interface Rect {
    x: number;
    y: number;
    width: number;
    height: number;
  }

  interface VersionInfo {
    /** MAJOR.MINOR.PATCH, for example "1.3.0". */
    current: string;
    isDev: boolean;
    /** Set when a newer release exists on GitHub. */
    latest: string | null;
  }

  type HostState =
    | { mode: 'loading'; background: string }
    | {
        mode: 'login';
        background: string;
        isDarkMode: boolean;
        /** Shown above the login page when the columns use more than one account. */
        accountLabel: string | null;
        /** "Account 2 of 3", when there is more than one account. */
        progress: string | null;
        canSkip: boolean;
      }
    | {
        mode: 'deck';
        background: string;
        isDarkMode: boolean;
        isDarkModeUpdating: boolean;
        hideAds: boolean;
        /** Total width of the columns, in CSS pixels of the host page. */
        contentWidth: number;
        isWindowFittingEnabled: boolean;
        zoomPercent: number;
        canZoomIn: boolean;
        canZoomOut: boolean;
        /** The columns in order, with where their title bars go. */
        columns: ColumnInfo[];
        /** The Columns window, while it is open. */
        dialog: ColumnsDialog | null;
        version: VersionInfo;
      }
    | { mode: 'error'; background: string; message: string; settingsPath: string };

  type ColumnIcon =
    | 'forYou'
    | 'following'
    | 'notifications'
    | 'profile'
    | 'search'
    | 'custom'
    | 'searchQuery';

  interface ColumnInfo {
    /** Stays the same while the app runs, even when the column moves. */
    id: number;
    title: string;
    icon: ColumnIcon;
    /** The account's @handle, or its name until it signs in. */
    handle: string | null;
    /** Position and width in the scrollable row of columns; width 0 when hidden. */
    x: number;
    width: number;
  }

  interface ColumnsDialogRow {
    title: string;
    subtitle: string | null;
    icon: ColumnIcon;
    account: string | null;
  }

  interface ColumnsDialog {
    rows: ColumnsDialogRow[];
    /** Account names already used by some column, in order. */
    accounts: string[];
    error: string | null;
  }

  type NewColumnType = 'forYou' | 'following' | 'notifications' | 'profile' | 'search' | 'custom';

  type HostAction =
    | { type: 'skip-login' }
    | { type: 'toggle-dark-mode' }
    | { type: 'toggle-hide-ads' }
    | { type: 'open-settings-folder' }
    | { type: 'zoom'; direction: 'in' | 'out' | 'reset' }
    | { type: 'refresh' }
    | { type: 'fit-window' }
    | { type: 'column-menu'; id: number }
    | { type: 'move-column'; id: number; delta: -1 | 1 }
    | { type: 'reorder-columns'; order: number[] }
    | { type: 'columns-open' }
    | { type: 'columns-cancel' }
    | { type: 'columns-save' }
    | {
        type: 'columns-add';
        columnType: NewColumnType;
        /** The search query or the custom URL, depending on the type. */
        text: string;
        /** null for the default session. */
        account: string | null;
      }
    | { type: 'columns-remove'; index: number }
    | { type: 'columns-move'; index: number; delta: -1 | 1 }
    | { type: 'open-link'; link: 'github' | 'release' | 'latest-release' };

  /** Where the dragged column and the ones around it are right now, in content coordinates. */
  interface DragFrame {
    draggedId: number;
    positions: { id: number; x: number }[];
  }

  /** Where the host page wants the web views: the login area or the columns area. */
  interface HostLayout {
    area: Rect;
    scrollLeft: number;
  }
}

interface XDeckHostApi {
  onState(callback: (state: XDeckIpc.HostState) => void): void;
  onScrollBy(callback: (deltaX: number) => void): void;
  send(action: XDeckIpc.HostAction): void;
  reportLayout(layout: XDeckIpc.HostLayout): void;
  /** null when the drag is over. */
  reportDragFrame(frame: XDeckIpc.DragFrame | null): void;
}

interface Window {
  xdeckHost: XDeckHostApi;
}
