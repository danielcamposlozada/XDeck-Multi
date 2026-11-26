// settings.json: the same format as the macOS edition (see shared/schema.json).

export const SIDE_HEADER_WIDTH = 68;
export const DEFAULT_WINDOW_WIDTH = 1280;
export const DEFAULT_WINDOW_HEIGHT = 900;

export const COLUMN_TYPES = [
  'forYou',
  'following',
  'notifications',
  'profile',
  'search',
  'custom',
] as const;
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
    // X's Explore page, which has the search box at the top.
    case 'search':
      return 'https://x.com/explore';
    case 'custom': {
      const url = parseUrl(column.url);
      return url !== null && (url.protocol === 'https:' || url.protocol === 'http:') ? url.href : null;
    }
  }
}

export function profileUrlFor(userName: string): string | null {
  return /^[A-Za-z0-9_]{1,50}$/.test(userName) ? `https://x.com/${userName}` : null;
}

/** The query of a column that shows X search results, if it has one. */
export function searchQuery(column: Column): string | null {
  if (column.type !== 'custom') return null;
  const url = parseUrl(column.url);
  if (url === null || !X_HOSTS.includes(url.hostname) || url.pathname !== '/search') return null;
  const query = url.searchParams.get('q');
  return query !== null && query.trim() !== '' ? query : null;
}

const TYPE_NAMES: Readonly<Record<ColumnType, string>> = {
  forYou: 'For You',
  following: 'Following',
  notifications: 'Notifications',
  profile: 'Profile',
  search: 'Search',
  custom: 'Custom URL',
};

export function typeName(type: ColumnType): string {
  return TYPE_NAMES[type];
}

/** A short name for the column: its search query, a custom URL's path, or the type's name. */
export function columnTitle(column: Column): string {
  const query = searchQuery(column);
  if (query !== null) return query;
  if (column.type !== 'custom') return typeName(column.type);
  const url = parseUrl(column.url);
  if (url === null) return column.url ?? typeName('custom');
  return url.pathname === '' || url.pathname === '/' ? url.hostname : url.pathname;
}

export type ColumnIcon = ColumnType | 'searchQuery';

/** Which icon a column shows: a magnifying glass for searches, otherwise its type's icon. */
export function columnIcon(column: Column): ColumnIcon {
  return searchQuery(column) !== null ? 'searchQuery' : column.type;
}

/** A column with X's latest results for a search. */
export function searchColumn(query: string, account?: string): Column {
  const url = new URL('https://x.com/search');
  url.searchParams.set('q', query.trim());
  url.searchParams.set('f', 'live');
  const column: Column = { type: 'custom', url: url.href };
  if (account !== undefined && account.trim() !== '') column.account = account.trim();
  return column;
}

/** The custom URL as typed, with https:// added when the scheme is missing; null if invalid. */
export function normalizeCustomUrl(text: string): string | null {
  let value = text.trim();
  if (value === '') return null;
  if (!/^https?:\/\//i.test(value)) value = `https://${value}`;
  const url = parseUrl(value);
  return url !== null && url.hostname !== '' ? url.href : null;
}

/** Validates columns sent by the host page (the Columns window) before they are saved. */
export function sanitizeColumns(value: unknown): Column[] | null {
  if (!Array.isArray(value)) return null;
  const columns: Column[] = [];
  for (const item of value) {
    if (!isRecord(item) || !isColumnType(item.type)) return null;
    const column: Column = { type: item.type };
    if (typeof item.url === 'string') column.url = item.url;
    if (typeof item.account === 'string' && item.account.trim() !== '') column.account = item.account;
    columns.push(column);
  }
  return columns;
}

/**
 * settings.json with its columns replaced and every other key kept, like AppConfig.saveColumns in
 * the macOS edition.
 */
export function withColumns(settingsText: string | null, columns: readonly Column[]): string {
  let root: Record<string, unknown> = {};
  if (settingsText !== null) {
    try {
      const data: unknown = JSON.parse(settingsText);
      if (isRecord(data)) root = data;
    } catch {
      // Unreadable: write a fresh file with the columns.
    }
  }
  root.columns = columns.map((column) => {
    const item: Record<string, string> = { type: column.type };
    if (column.url !== undefined) item.url = column.url;
    if (column.account !== undefined) item.account = column.account;
    return item;
  });
  return `${JSON.stringify(root, null, 2)}\n`;
}
