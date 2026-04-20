import { describe, expect, it } from 'vitest';
import type { IndexedImage } from '../types';
import { buildSlideshowPlaylist, isSlideshowMedia } from '../utils/slideshowPlaylist';

const createImage = (id: string, name: string, fileType?: string): IndexedImage => ({
  id,
  name,
  handle: {} as FileSystemFileHandle,
  metadata: {} as any,
  metadataString: '',
  lastModified: 1,
  models: [],
  loras: [],
  scheduler: '',
  fileType,
});

describe('buildSlideshowPlaylist', () => {
  const first = createImage('1', 'first.png');
  const second = createImage('2', 'second.mp4', 'video/mp4');
  const third = createImage('3', 'third.gif');
  const audio = createImage('4', 'song.mp3', 'audio/mpeg');
  const outOfScope = createImage('5', 'elsewhere.webp');

  it('uses visual media from the current scope when no images are selected', () => {
    const playlist = buildSlideshowPlaylist({
      scopeImages: [first, audio, second],
      selectedImageIds: new Set(),
      allImages: [first, audio, second],
    });

    expect(playlist.source).toBe('scope');
    expect(playlist.images.map((image) => image.id)).toEqual(['1', '2']);
  });

  it('uses selected images before the broader current scope', () => {
    const playlist = buildSlideshowPlaylist({
      scopeImages: [first, second, third],
      selectedImageIds: new Set(['3', '1']),
      allImages: [first, second, third],
    });

    expect(playlist.source).toBe('selection');
    expect(playlist.images.map((image) => image.id)).toEqual(['1', '3']);
  });

  it('appends selected images that are not in the current visible scope', () => {
    const playlist = buildSlideshowPlaylist({
      scopeImages: [first, second],
      selectedImageIds: new Set(['5', '2']),
      allImages: [first, second, third, outOfScope],
    });

    expect(playlist.images.map((image) => image.id)).toEqual(['2', '5']);
  });

  it('excludes selected audio while keeping gif and video items', () => {
    const playlist = buildSlideshowPlaylist({
      scopeImages: [first, second, third, audio],
      selectedImageIds: new Set(['2', '3', '4']),
      allImages: [first, second, third, audio],
    });

    expect(playlist.images.map((image) => image.id)).toEqual(['2', '3']);
  });
});

describe('isSlideshowMedia', () => {
  it('allows images and videos but rejects audio', () => {
    expect(isSlideshowMedia(createImage('png', 'image.png'))).toBe(true);
    expect(isSlideshowMedia(createImage('gif', 'animation.gif'))).toBe(true);
    expect(isSlideshowMedia(createImage('video', 'clip.webm'))).toBe(true);
    expect(isSlideshowMedia(createImage('audio', 'clip.wav'))).toBe(false);
  });
});
