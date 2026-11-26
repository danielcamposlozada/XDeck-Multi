// Video downloads from the button the shared script adds to X videos (VideoDownloader on macOS).
import { join } from 'node:path';

export interface VideoRequest {
  url: string;
  /** File name without the extension. */
  baseName: string;
}

/** The video address and a safe file name from a download button's message; null if invalid. */
export function parseVideoRequest(body: string): VideoRequest | null {
  let data: unknown;
  try {
    data = JSON.parse(body);
  } catch {
    return null;
  }
  if (typeof data !== 'object' || data === null) return null;
  const { url, name } = data as Record<string, unknown>;
  if (typeof url !== 'string' || typeof name !== 'string') return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  // Only X's video server.
  if (parsed.protocol !== 'https:' || parsed.hostname !== 'video.twimg.com') return null;
  const safe = name.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 80);
  return { url: parsed.href, baseName: `x-${safe === '' ? 'video' : safe}` };
}

/** A path in the folder that doesn't exist yet: name.mp4, then "name (2).mp4" and so on. */
export function uniqueVideoPath(folder: string, baseName: string, exists: (path: string) => boolean): string {
  let path = join(folder, `${baseName}.mp4`);
  for (let copy = 2; exists(path); copy++) path = join(folder, `${baseName} (${copy}).mp4`);
  return path;
}

export interface DownloadProgress {
  received: number;
  /** 0 or less while the size is unknown. */
  total: number;
}

/** The share done of all the given downloads together, or null while a size is unknown. */
export function combinedFraction(downloads: readonly DownloadProgress[]): number | null {
  if (downloads.length === 0 || downloads.some((download) => download.total <= 0)) return null;
  const total = downloads.reduce((sum, download) => sum + download.total, 0);
  const received = downloads.reduce((sum, download) => sum + download.received, 0);
  return Math.min(1, received / total);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1000) return `${bytes} bytes`;
  if (bytes < 1_000_000) return `${Math.round(bytes / 1000)} KB`;
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

/** "45% · 12.0 MB of 40.0 MB", or just what arrived so far while the size is unknown. */
export function progressText(downloads: readonly DownloadProgress[]): string {
  const received = downloads.reduce((sum, download) => sum + download.received, 0);
  const fraction = combinedFraction(downloads);
  if (fraction === null) return formatBytes(received);
  const total = downloads.reduce((sum, download) => sum + download.total, 0);
  return `${Math.round(fraction * 100)}% · ${formatBytes(received)} of ${formatBytes(total)}`;
}
