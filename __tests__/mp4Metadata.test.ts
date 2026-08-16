import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { parseImageFile } from '../services/metadataEngine';
import { readBasicMp4Metadata } from '../utils/mp4Metadata.mjs';

const box = (type: string, body: Buffer) => {
  const result = Buffer.alloc(8 + body.length);
  result.writeUInt32BE(result.length, 0);
  result.write(type, 4, 4, 'ascii');
  body.copy(result, 8);
  return result;
};

const createBasicMp4 = (zeroSizedMoov = false) => {
  const mvhd = Buffer.alloc(20);
  mvhd.writeUInt32BE(1000, 12);
  mvhd.writeUInt32BE(12_500, 16);

  const tkhd = Buffer.alloc(84);
  tkhd.writeUInt32BE(1920 * 65536, tkhd.length - 8);
  tkhd.writeUInt32BE(1080 * 65536, tkhd.length - 4);

  const hdlr = Buffer.alloc(12);
  hdlr.write('vide', 8, 4, 'ascii');

  const trak = box('trak', Buffer.concat([
    box('tkhd', tkhd),
    box('mdia', box('hdlr', hdlr)),
  ]));
  const moov = box('moov', Buffer.concat([box('mvhd', mvhd), trak]));
  if (zeroSizedMoov) moov.writeUInt32BE(0, 0);
  return Buffer.concat([box('ftyp', Buffer.from('isom0000')), moov]);
};

describe('basic packaged MP4 metadata fallback', () => {
  let directory: string | null = null;
  const previousFfprobePath = process.env.FFPROBE_PATH;

  afterEach(async () => {
    if (previousFfprobePath === undefined) delete process.env.FFPROBE_PATH;
    else process.env.FFPROBE_PATH = previousFfprobePath;
    if (directory) await fs.rm(directory, { recursive: true, force: true });
    directory = null;
  });

  it('reads dimensions and duration from bounded ISO-BMFF boxes', async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'imh-mp4-'));
    const filePath = path.join(directory, 'sample.mp4');
    await fs.writeFile(filePath, createBasicMp4());

    await expect(readBasicMp4Metadata(filePath)).resolves.toEqual({
      width: 1920,
      height: 1080,
      duration_seconds: 12.5,
    });
  });

  it('resolves a final zero-sized moov box against the file length', async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'imh-mp4-zero-moov-'));
    const filePath = path.join(directory, 'sample.mp4');
    await fs.writeFile(filePath, createBasicMp4(true));

    await expect(readBasicMp4Metadata(filePath)).resolves.toEqual({
      width: 1920,
      height: 1080,
      duration_seconds: 12.5,
    });
  });

  it('normalizes basic MP4 metadata when ffprobe is absent', async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'imh-mp4-'));
    const filePath = path.join(directory, 'sample.mp4');
    await fs.writeFile(filePath, createBasicMp4());
    process.env.FFPROBE_PATH = 'definitely-missing-ffprobe-binary';

    const result = await parseImageFile(filePath);

    expect(result.metadata?.media_type).toBe('video');
    expect(result.metadata?.width).toBe(1920);
    expect(result.metadata?.height).toBe(1080);
    expect(result.metadata?.video?.duration_seconds).toBe(12.5);
    expect(result.errors ?? []).not.toContain('ffprobe not available or failed to read media metadata.');
  });
});
