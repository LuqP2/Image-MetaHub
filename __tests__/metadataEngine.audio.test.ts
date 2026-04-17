import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { parseImageFile } from '../services/metadataEngine';

let tempDir: string | null = null;
const previousFfprobePath = process.env.FFPROBE_PATH;

afterEach(async () => {
  if (previousFfprobePath === undefined) {
    delete process.env.FFPROBE_PATH;
  } else {
    process.env.FFPROBE_PATH = previousFfprobePath;
  }
  if (tempDir) {
    await fs.rm(tempDir, { recursive: true, force: true });
    tempDir = null;
  }
});

describe('metadataEngine audio fallback', () => {
  it('normalizes audio files even when ffprobe is unavailable', async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'imh-audio-'));
    const filePath = path.join(tempDir, 'sample.mp3');
    await fs.writeFile(filePath, Buffer.from([0x49, 0x44, 0x33, 0x03, 0x00, 0x00]));
    process.env.FFPROBE_PATH = 'definitely-missing-ffprobe-binary';

    const result = await parseImageFile(filePath);

    expect(result.rawSource).toBe('audio');
    expect(result.metadata?.media_type).toBe('audio');
    expect(result.metadata?.audio).toBeNull();
    expect(result.dimensions).toEqual({ width: 0, height: 0 });
    expect(result.errors).toContain('ffprobe not available or failed to read media metadata.');
  });
});
