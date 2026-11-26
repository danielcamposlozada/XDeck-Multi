// The app's own preferences (the macOS edition keeps them in @AppStorage).

export interface Prefs {
  pageZoom: number;
  isDarkMode: boolean;
  hideAds: boolean;
}

export const DEFAULT_PREFS: Readonly<Prefs> = { pageZoom: 1, isDarkMode: false, hideAds: false };

export const ZOOM_STEP = 0.1;
export const MIN_ZOOM = 0.5;
export const MAX_ZOOM = 2.5;

export function clampZoom(zoom: number): number {
  return Math.round(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom)) * 10) / 10;
}

export function parsePrefs(text: string | null): Prefs {
  const prefs: Prefs = { ...DEFAULT_PREFS };
  if (text === null) return prefs;
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return prefs;
  }
  if (typeof data !== 'object' || data === null) return prefs;
  const record = data as Record<string, unknown>;
  if (typeof record.pageZoom === 'number' && Number.isFinite(record.pageZoom)) {
    prefs.pageZoom = clampZoom(record.pageZoom);
  }
  if (typeof record.isDarkMode === 'boolean') prefs.isDarkMode = record.isDarkMode;
  if (typeof record.hideAds === 'boolean') prefs.hideAds = record.hideAds;
  return prefs;
}

export function defaultBackground(isDarkMode: boolean): string {
  return isDarkMode ? '#17202A' : '#FFFFFF';
}

/** X reports its theme as a hex color; anything else is ignored. */
export function normalizeThemeColor(color: string): string | null {
  return /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(color.trim()) ? color.trim().toUpperCase() : null;
}

/** Like the macOS edition: any theme other than white is dark mode. */
export function isDarkThemeColor(color: string): boolean {
  return color !== '#FFFFFF' && color !== '#FFF';
}
