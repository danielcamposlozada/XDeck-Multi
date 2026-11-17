// settings.json: the same format as the macOS edition (see shared/schema.json).

export const SIDE_HEADER_WIDTH = 68;
export const DEFAULT_WINDOW_WIDTH = 1280;
export const DEFAULT_WINDOW_HEIGHT = 900;

export const COLUMN_TYPES = ['forYou', 'following', 'notifications', 'profile', 'custom'] as const;
export type ColumnType = (typeof COLUMN_TYPES)[number];

export interface Column {
  type: ColumnType;
  url?: string;
  /**
   * Optional name of the X account this column belongs to. Columns with the same name share one
   * login session; columns without a name use the default session.
   */
  account?: string;
}

export interface AppConfig {
  columnWidth?: number;
  columns: Column[];
}

export class ConfigError extends Error {
  override name = 'ConfigError';
}

const X_HOSTS = ['x.com', 'twitter.com'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isColumnType(value: unknown): value is ColumnType {
  return typeof value === 'string' && (COLUMN_TYPES as readonly string[]).includes(value);
}

/**
 * Parses settings.json. Like the macOS edition, unknown keys are ignored and a custom column
 * without a valid URL is kept but not shown.
 */
export function parseConfig(text: string): AppConfig {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (error) {
    throw new ConfigError(`settings.json is not valid JSON: ${(error as Error).message}`);
  }
  if (!isRecord(data)) {
    throw new ConfigError('settings.json must contain a JSON object.');
  }

  const config: AppConfig = { columns: [] };
  if (data.columnWidth !== undefined && data.columnWidth !== null) {
    const width = data.columnWidth;
    if (typeof width !== 'number' || !Number.isInteger(width) || width <= 0) {
      throw new ConfigError('"columnWidth" must be a positive whole number.');
    }
    config.columnWidth = width;
  }

  if (!Array.isArray(data.columns)) {
    throw new ConfigError('"columns" must be a list of columns.');
  }
  data.columns.forEach((item: unknown, index) => {
    const where = `Column ${index + 1}`;
    if (!isRecord(item)) {
      throw new ConfigError(`${where} must be an object.`);
    }
    if (!isColumnType(item.type)) {
      throw new ConfigError(`${where}: "type" must be one of ${COLUMN_TYPES.join(', ')}.`);
    }
    const column: Column = { type: item.type };
    if (item.url !== undefined && item.url !== null) {
      if (typeof item.url !== 'string') {
        throw new ConfigError(`${where}: "url" must be text.`);
      }
      column.url = item.url;
    }
    if (item.account !== undefined && item.account !== null) {
      if (typeof item.account !== 'string') {
        throw new ConfigError(`${where}: "account" must be text.`);
      }
      column.account = item.account;
    }
    config.columns.push(column);
  });
  return config;
}

/** Key of the login session a column uses ("" is the default session). Case-insensitive. */
export function accountKey(column: Column): string {
  return (column.account ?? '').trim().toLowerCase();
}

function parseUrl(text: string | undefined): URL | null {
  if (text === undefined) return null;
  try {
    return new URL(text);
  } catch {
    return null;
  }
}

export function isXColumn(column: Column): boolean {
  if (column.type !== 'custom') return true;
  const url = parseUrl(column.url);
  return url !== null && X_HOSTS.includes(url.hostname);
}

/**
 * The login sessions the X columns need, in order of first appearance.
 * Without any X column it's just the default session, as before accounts existed.
 */
export function accountKeys(config: AppConfig): string[] {
  const keys: string[] = [];
  for (const column of config.columns) {
    const key = accountKey(column);
    if (isXColumn(column) && !keys.includes(key)) keys.push(key);
  }
  return keys.length === 0 ? [''] : keys;
}

/**
 * Indices of the columns that keep X's side navigation: the first X column of each account, so
 * every account has its own navigation, Post button and avatar.
 */
export function sideHeaderColumnIndices(config: AppConfig): Set<number> {
  const seen = new Set<string>();
  const indices = new Set<number>();
  config.columns.forEach((column, index) => {
    if (!isXColumn(column)) return;
    const key = accountKey(column);
    if (!seen.has(key)) {
      seen.add(key);
      indices.add(index);
    }
  });
  return indices;
}

export function leftMostXColumnIndex(config: AppConfig): number {
  return config.columns.findIndex(isXColumn);
}

/** The Electron session partition of an account. */
export function partitionFor(key: string): string {
  return key === '' ? 'persist:default' : `persist:account-${encodeURIComponent(key)}`;
}

/**
 * The page a column opens, or null when it can't be shown yet (a profile column of an account
 * that isn't signed in, or a custom column without a valid web address).
 */
export function columnUrl(column: Column, profileUrl: string | undefined): string | null {
  switch (column.type) {
    case 'forYou':
    case 'following':
      return 'https://x.com/home';
    case 'notifications':
      return 'https://x.com/notifications';
    case 'profile':
      return profileUrl ?? null;
    case 'custom': {
      const url = parseUrl(column.url);
      return url !== null && (url.protocol === 'https:' || url.protocol === 'http:') ? url.href : null;
    }
  }
}

export function profileUrlFor(userName: string): string | null {
  return /^[A-Za-z0-9_]{1,50}$/.test(userName) ? `https://x.com/${userName}` : null;
}
