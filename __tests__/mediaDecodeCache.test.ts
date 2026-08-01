import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mediaDecodeCache } from '../services/mediaDecodeCache';

class FakeImage {
  static instances: FakeImage[] = [];

  decoding = 'sync';
  onload: unknown = () => {};
  onerror: unknown = () => {};
  src = '';

  private resolveDecode!: () => void;
  private rejectDecode!: (error: Error) => void;
  private readonly decodePromise: Promise<void>;

  constructor() {
    this.decodePromise = new Promise<void>((resolve, reject) => {
      this.resolveDecode = resolve;
      this.rejectDecode = reject;
    });
    FakeImage.instances.push(this);
  }

  decode(): Promise<void> {
    return this.decodePromise;
  }

  removeAttribute(name: string): void {
    if (name === 'src') {
      this.src = '';
    }
  }

  settle(): void {
    this.resolveDecode();
  }

  fail(message = 'decode failed'): void {
    this.rejectDecode(new Error(message));
  }
}

const lastInstance = (): FakeImage => FakeImage.instances[FakeImage.instances.length - 1]!;

/** Starts a warm and lets its decode succeed, resolving once the cache has recorded it. */
const warmAndSettle = async (url: string): Promise<void> => {
  const warming = mediaDecodeCache.warm(url);
  lastInstance().settle();
  await warming;
};

describe('mediaDecodeCache', () => {
  let originalImage: typeof globalThis.Image;
  let clock = 0;

  beforeEach(() => {
    originalImage = globalThis.Image;
    FakeImage.instances = [];
    globalThis.Image = FakeImage as unknown as typeof globalThis.Image;

    // Real timestamps collide across fast successive calls, which would make LRU order arbitrary.
    clock = 1_000;
    vi.spyOn(Date, 'now').mockImplementation(() => (clock += 1));
  });

  afterEach(() => {
    mediaDecodeCache.clear();
    globalThis.Image = originalImage;
    vi.restoreAllMocks();
  });

  it('reports warmth only once the decode has resolved', async () => {
    const warming = mediaDecodeCache.warm('a.png');
    expect(mediaDecodeCache.isWarm('a.png')).toBe(false);

    lastInstance().settle();
    await warming;

    expect(mediaDecodeCache.isWarm('a.png')).toBe(true);
  });

  it('decodes a url once even when warmed concurrently', async () => {
    const first = mediaDecodeCache.warm('a.png');
    const second = mediaDecodeCache.warm('a.png');

    expect(FakeImage.instances).toHaveLength(1);

    lastInstance().settle();
    await Promise.all([first, second]);

    expect(mediaDecodeCache.isWarm('a.png')).toBe(true);
  });

  it('serves an already decoded url without building another image', async () => {
    await warmAndSettle('a.png');
    expect(FakeImage.instances).toHaveLength(1);

    await mediaDecodeCache.warm('a.png');

    expect(FakeImage.instances).toHaveLength(1);
    expect(mediaDecodeCache.isWarm('a.png')).toBe(true);
  });

  it('evicts the least recently used decoded entry past the cap', async () => {
    for (const url of ['a.png', 'b.png', 'c.png', 'd.png', 'e.png']) {
      await warmAndSettle(url);
    }

    await warmAndSettle('f.png');

    expect(mediaDecodeCache.isWarm('a.png')).toBe(false);
    expect(mediaDecodeCache.isWarm('b.png')).toBe(true);
    expect(mediaDecodeCache.isWarm('f.png')).toBe(true);
  });

  it('promotes an entry when it is warmed again', async () => {
    for (const url of ['a.png', 'b.png', 'c.png', 'd.png', 'e.png']) {
      await warmAndSettle(url);
    }

    await mediaDecodeCache.warm('a.png');
    await warmAndSettle('f.png');

    // Warming 'a.png' again counted as real usage, so 'b.png' became the oldest instead.
    expect(mediaDecodeCache.isWarm('a.png')).toBe(true);
    expect(mediaDecodeCache.isWarm('b.png')).toBe(false);
  });

  it('does not let repeated warmth checks keep an entry alive', async () => {
    for (const url of ['a.png', 'b.png', 'c.png', 'd.png', 'e.png']) {
      await warmAndSettle(url);
    }

    for (let index = 0; index < 20; index += 1) {
      mediaDecodeCache.isWarm('a.png');
    }

    await warmAndSettle('f.png');

    // isWarm runs on every render, so it must not register as use of the cache.
    expect(mediaDecodeCache.isWarm('a.png')).toBe(false);
    expect(mediaDecodeCache.isWarm('b.png')).toBe(true);
  });

  it('never evicts a decode that is still in flight', async () => {
    for (const url of ['a.png', 'b.png', 'c.png', 'd.png', 'e.png']) {
      await warmAndSettle(url);
    }

    const pending = mediaDecodeCache.warm('f.png');
    const pendingImage = lastInstance();

    // Completing another entry triggers a prune while 'f.png' is mid-decode.
    await warmAndSettle('g.png');

    expect(mediaDecodeCache.isWarm('a.png')).toBe(false);
    expect(pendingImage.src).toBe('f.png');

    pendingImage.settle();
    await pending;

    expect(mediaDecodeCache.isWarm('f.png')).toBe(true);
  });

  it('swallows a failed decode and leaves the url cold', async () => {
    const warming = mediaDecodeCache.warm('broken.png');
    const failedImage = lastInstance();
    failedImage.fail();

    await expect(warming).resolves.toBeUndefined();
    expect(mediaDecodeCache.isWarm('broken.png')).toBe(false);
    expect(failedImage.src).toBe('');
    expect(failedImage.onload).toBeNull();
    expect(failedImage.onerror).toBeNull();
  });

  it('drops every bitmap once the last holder releases it', async () => {
    mediaDecodeCache.retain();
    mediaDecodeCache.retain();
    await warmAndSettle('a.png');
    const image = lastInstance();

    mediaDecodeCache.release();
    expect(mediaDecodeCache.isWarm('a.png')).toBe(true);

    mediaDecodeCache.release();

    expect(mediaDecodeCache.isWarm('a.png')).toBe(false);
    expect(image.src).toBe('');
    expect(image.onload).toBeNull();
  });
});
