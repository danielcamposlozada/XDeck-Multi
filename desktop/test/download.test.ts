import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseVideoRequest, uniqueVideoPath } from '../src/main/download';

describe('video downloads', () => {
  it('accepts only videos from X and makes a safe name', () => {
    expect(
      parseVideoRequest(JSON.stringify({ url: 'https://video.twimg.com/ext_tw_video/1/pu/vid/a.mp4', name: 'NASA-123' })),
    ).toEqual({ url: 'https://video.twimg.com/ext_tw_video/1/pu/vid/a.mp4', baseName: 'x-NASA-123' });
    expect(parseVideoRequest(JSON.stringify({ url: 'https://evil.example/a.mp4', name: 'x' }))).toBeNull();
    expect(parseVideoRequest(JSON.stringify({ url: 'http://video.twimg.com/a.mp4', name: 'x' }))).toBeNull();
    expect(parseVideoRequest(JSON.stringify({ url: 'https://video.twimg.com/a.mp4', name: '../../etc' }))?.baseName).toBe(
      'x-etc',
    );
    expect(parseVideoRequest('nope')).toBeNull();
  });

  it('never overwrites a file', () => {
    const taken = new Set([join('/d', 'x-a.mp4'), join('/d', 'x-a (2).mp4')]);
    expect(uniqueVideoPath('/d', 'x-a', (path) => taken.has(path))).toBe(join('/d', 'x-a (3).mp4'));
    expect(uniqueVideoPath('/d', 'x-b', (path) => taken.has(path))).toBe(join('/d', 'x-b.mp4'));
  });
});
