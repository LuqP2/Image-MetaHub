import { describe, expect, it } from 'vitest';
import { parseWebPMetadata } from '../services/fileIndexer';

/** Little-endian uint32, the byte order WebP/RIFF uses for sizes. */
function le32(n: number): number[] {
  return [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff];
}

/**
 * Builds a RIFF chunk: type(4) + size(4, LE) + data + optional pad byte to an even
 * boundary. `declaredSize` overrides the size field so a fixture can claim a chunk is
 * larger than the bytes actually present (i.e. cut off by a head-read).
 */
function buildChunk(type: string, data: number[], declaredSize?: number): number[] {
  const typeBytes = Array.from(Buffer.from(type, 'latin1')); // must be exactly 4 chars
  const size = declaredSize ?? data.length;
  const padded = data.length % 2 !== 0 ? [...data, 0] : data;
  return [...typeBytes, ...le32(size), ...padded];
}

/** Wraps chunks in a RIFF/WEBP container with a correct RIFF size field. */
function buildWebp(chunks: number[][]): ArrayBuffer {
  const body = [...Array.from(Buffer.from('WEBP', 'latin1')), ...chunks.flat()];
  const bytes = [...Array.from(Buffer.from('RIFF', 'latin1')), ...le32(body.length), ...body];
  return new Uint8Array(bytes).buffer;
}

/** A tiny stand-in for the VP8 image-data chunk (contents are irrelevant to metadata). */
function buildImageChunk(size: number): number[] {
  return buildChunk('VP8 ', new Array(Math.max(0, size)).fill(0x7a));
}

const METAHUB_EXIF_JSON = '{"imagemetahub_data":{"generator":"ComfyUI","seed":12345}}';

describe('parseWebPMetadata head-read truncation handling (issue #448)', () => {
  it('flags truncated=true when the EXIF chunk is cut off mid-file', async () => {
    // A realistic large EXIF payload (e.g. an embedded ComfyUI workflow) whose declared
    // size runs well past what a 64KB head-read would have captured.
    const exifData = new Array(40 * 1024).fill(0x00);
    const fullBuffer = buildWebp([buildImageChunk(8), buildChunk('EXIF', exifData)]);

    // Simulate the head-read: keep the RIFF header, the VP8 chunk, the EXIF chunk *header*
    // (so the parser sees the chunk and its declared size) but cut into the EXIF data.
    const truncatedBuffer = fullBuffer.slice(0, 12 + 16 + 8 + 100);
    expect(truncatedBuffer.byteLength).toBeLessThan(fullBuffer.byteLength);

    const truncationInfo = { truncated: false };
    await parseWebPMetadata(truncatedBuffer, truncationInfo);

    // Core of the fix: the parser reports that the metadata chunk was cut off, so Phase B
    // forces a full-file re-read instead of caching a partial/garbled parse.
    expect(truncationInfo.truncated).toBe(true);
  });

  it('does not flag truncated when the full EXIF chunk is present', async () => {
    const exifData = Array.from(Buffer.from(METAHUB_EXIF_JSON, 'utf-8'));
    const fullBuffer = buildWebp([buildImageChunk(8), buildChunk('EXIF', exifData)]);

    const truncationInfo = { truncated: false };
    const result = await parseWebPMetadata(fullBuffer, truncationInfo);

    expect(truncationInfo.truncated).toBe(false);
    expect(result && 'imagemetahub_data' in result).toBe(true);
  });

  it('does not flag truncated for a WebP cut off in non-metadata (image) data', async () => {
    // No EXIF chunk at all — just image data that overruns the head-read buffer. The
    // truncation flag must stay false; the "no metadata + file bigger than buffer"
    // heuristic in Phase B is what triggers the re-read for this shape, not this flag.
    const fullBuffer = buildWebp([buildImageChunk(80 * 1024)]);
    const truncatedBuffer = fullBuffer.slice(0, 64 * 1024);
    expect(truncatedBuffer.byteLength).toBeLessThan(fullBuffer.byteLength);

    const truncationInfo = { truncated: false };
    await parseWebPMetadata(truncatedBuffer, truncationInfo);

    expect(truncationInfo.truncated).toBe(false);
  });
});
