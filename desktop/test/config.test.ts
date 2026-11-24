import { describe, expect, it } from 'vitest';
import {
  ConfigError,
  accountKey,
  accountKeys,
  columnUrl,
  isXColumn,
  leftMostXColumnIndex,
  parseConfig,
  partitionFor,
  profileUrlFor,
  sideHeaderColumnIndices,
  type AppConfig,
} from '../src/main/config';

const multiAccount: AppConfig = {
  columns: [
    { type: 'following' },
    { type: 'notifications' },
    { type: 'following', account: 'Trabajo' },
    { type: 'custom', url: 'https://example.com' },
    { type: 'profile', account: ' trabajo ' },
  ],
};

describe('parseConfig', () => {
  it('reads the default settings', () => {
    const config = parseConfig('{"columnWidth": 380, "columns": [{"type": "forYou"}, {"type": "profile"}]}');
    expect(config).toEqual({ columnWidth: 380, columns: [{ type: 'forYou' }, { type: 'profile' }] });
  });

  it('keeps the account and the url, and ignores unknown keys like $schema', () => {
    const config = parseConfig(
      '{"$schema": "./schema.json", "columns": [{"type": "custom", "url": "https://x.com/i/lists/1", "account": "work"}]}',
    );
    expect(config.columns).toEqual([{ type: 'custom', url: 'https://x.com/i/lists/1', account: 'work' }]);
    expect(config.columnWidth).toBeUndefined();
  });

  it.each([
    ['not json', 'not valid JSON'],
    ['[]', 'JSON object'],
    ['{}', '"columns"'],
    ['{"columns": [{"type": "home"}]}', 'Column 1'],
    ['{"columnWidth": 380.5, "columns": []}', 'columnWidth'],
    ['{"columns": [{"type": "following", "account": 3}]}', 'account'],
  ])('rejects %s', (text, message) => {
    expect(() => parseConfig(text)).toThrow(ConfigError);
    expect(() => parseConfig(text)).toThrow(message);
  });
});

describe('accounts', () => {
  it('trims and lowercases account names; empty means the default session', () => {
    expect(accountKey({ type: 'following' })).toBe('');
    expect(accountKey({ type: 'following', account: '   ' })).toBe('');
    expect(accountKey({ type: 'following', account: ' Trabajo ' })).toBe('trabajo');
  });

  it('lists the sessions of the X columns in order of first appearance', () => {
    expect(accountKeys(multiAccount)).toEqual(['', 'trabajo']);
  });

  it('falls back to the default session without X columns', () => {
    expect(accountKeys({ columns: [{ type: 'custom', url: 'https://example.com', account: 'a' }] })).toEqual(['']);
  });

  it('keeps the side header on the first X column of each account', () => {
    expect([...sideHeaderColumnIndices(multiAccount)]).toEqual([0, 2]);
    expect(leftMostXColumnIndex(multiAccount)).toBe(0);
  });

  it('gives each account its own persistent partition', () => {
    expect(partitionFor('')).toBe('persist:default');
    expect(partitionFor('trabajo')).toBe('persist:account-trabajo');
    expect(partitionFor('mi cuenta/2')).toBe('persist:account-mi%20cuenta%2F2');
  });
});

describe('columns', () => {
  it('treats x.com and twitter.com custom columns as X columns', () => {
    expect(isXColumn({ type: 'custom', url: 'https://x.com/search?q=a' })).toBe(true);
    expect(isXColumn({ type: 'custom', url: 'https://twitter.com/i/lists/1' })).toBe(true);
    expect(isXColumn({ type: 'custom', url: 'https://example.com' })).toBe(false);
    expect(isXColumn({ type: 'custom' })).toBe(false);
  });

  it('opens the right page for each column type', () => {
    expect(columnUrl({ type: 'forYou' }, undefined)).toBe('https://x.com/home');
    expect(columnUrl({ type: 'following' }, undefined)).toBe('https://x.com/home');
    expect(columnUrl({ type: 'notifications' }, undefined)).toBe('https://x.com/notifications');
    expect(columnUrl({ type: 'profile' }, 'https://x.com/jack')).toBe('https://x.com/jack');
    expect(columnUrl({ type: 'profile' }, undefined)).toBeNull();
    expect(columnUrl({ type: 'custom', url: 'https://x.com/i/lists/1' }, undefined)).toBe('https://x.com/i/lists/1');
    expect(columnUrl({ type: 'custom', url: 'file:///etc/passwd' }, undefined)).toBeNull();
    expect(columnUrl({ type: 'custom', url: 'nope' }, undefined)).toBeNull();
  });

  it('builds profile URLs only from user names', () => {
    expect(profileUrlFor('jack')).toBe('https://x.com/jack');
    expect(profileUrlFor('../evil')).toBeNull();
    expect(profileUrlFor('')).toBeNull();
  });
});
