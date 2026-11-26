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
