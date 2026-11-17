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
    /** MAJOR.MINOR, for example "1.0". */
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
        version: VersionInfo;
      }
    | { mode: 'error'; background: string; message: string; settingsPath: string };

  type HostAction =
    | { type: 'skip-login' }
    | { type: 'toggle-dark-mode' }
    | { type: 'toggle-hide-ads' }
    | { type: 'open-settings-folder' }
    | { type: 'open-link'; link: 'github' | 'sponsor' | 'release' | 'latest-release' };

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
}

interface Window {
  xdeckHost: XDeckHostApi;
}
