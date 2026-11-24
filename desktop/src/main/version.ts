// Versions are MAJOR.MINOR, like the git tags (for example "1.0"), in both editions.

export const REPOSITORY_URL = 'https://github.com/danielcamposlozada/XDeck-Multi';
export const LATEST_RELEASE_URL = `${REPOSITORY_URL}/releases/latest`;

export function releaseUrl(version: string): string {
  return `${REPOSITORY_URL}/releases/tag/${version}`;
}

/** "1.0.0" → "1.0" */
export function shortVersion(version: string): string {
  return version.split('.').slice(0, 2).join('.');
}

/** The version in a release URL, as UpdateButton.extractVersion does on macOS. */
export function extractVersion(url: string): string {
  return /\/tag\/([0-9]+\.[0-9]+)/.exec(url)?.[1] ?? '0.0';
}

export function isNewerVersion(candidate: string, current: string): boolean {
  const a = candidate.split('.').map(Number);
  const b = current.split('.').map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x > y;
  }
  return false;
}
