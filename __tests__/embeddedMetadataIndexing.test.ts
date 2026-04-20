import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { buildEmbeddedMetaHubPayload } from '../utils/embeddedMetadataPayload';
import { parseImageFile } from '../services/metadataEngine';
import { reparseIndexedImage } from '../services/fileIndexer';
import type { IndexedImage } from '../types';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function pngChunk(type: string, data = Buffer.alloc(0)): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  return Buffer.concat([
    length,
    Buffer.from(type, 'ascii'),
    data,
    Buffer.alloc(4),
  ]);
}

function pngITXt(keyword: string, text: string): Buffer {
  return pngChunk('iTXt', Buffer.concat([
    Buffer.from(keyword, 'latin1'),
    Buffer.from([0, 0, 0, 0, 0]),
    Buffer.from(text, 'utf8'),
  ]));
}

function embeddedPngBuffer(): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(640, 0);
  ihdr.writeUInt32BE(832, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;

  const payload = buildEmbeddedMetaHubPayload({
    prompt: 'edited png prompt',
    negativePrompt: 'edited png negative',
    seed: 12345,
    steps: 32,
    cfg_scale: 6,
    sampler: 'Euler a',
    scheduler: 'normal',
    model: 'edited-model',
    width: 640,
    height: 832,
  });

  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk('IHDR', ihdr),
    pngITXt('imagemetahub_data', JSON.stringify(payload)),
    pngChunk('IEND'),
  ]);
}

describe('embedded Image MetaHub metadata indexing', () => {
  let tempDir: string;
  let pngBuffer: Buffer;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'imh-embedded-metadata-'));
    pngBuffer = embeddedPngBuffer();
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('normalizes edited PNG metadata through the desktop reparse path', async () => {
    const arrayBuffer = pngBuffer.buffer.slice(
      pngBuffer.byteOffset,
      pngBuffer.byteOffset + pngBuffer.byteLength,
    );

    (window as any).electronAPI = {
      joinPaths: vi.fn().mockResolvedValue({ success: true, path: path.join(tempDir, 'image.png') }),
      readFile: vi.fn().mockResolvedValue({ success: true, data: arrayBuffer }),
      getFileStats: vi.fn().mockResolvedValue({
        success: true,
        stats: { mtimeMs: 1000, birthtimeMs: 900, size: pngBuffer.byteLength },
      }),
    };

    const reparsed = await reparseIndexedImage({
      id: 'library::image.png',
      name: 'image.png',
      directoryId: 'library',
      metadata: {},
      metadataString: '',
      lastModified: 1,
      fileType: 'image/png',
      fileSize: pngBuffer.byteLength,
    } as IndexedImage, tempDir);

    expect(reparsed?.metadata?.normalizedMetadata).toMatchObject({
      prompt: 'edited png prompt',
      negativePrompt: 'edited png negative',
      seed: 12345,
      steps: 32,
      cfg_scale: 6,
      sampler: 'Euler a',
      scheduler: 'normal',
      model: 'edited-model',
      width: 640,
      height: 832,
      generator: 'Image MetaHub',
    });
    expect(reparsed?.prompt).toBe('edited png prompt');
  });

  it('normalizes edited PNG metadata through metadataEngine', async () => {
    const filePath = path.join(tempDir, 'image.png');
    await writeFile(filePath, pngBuffer);

    const result = await parseImageFile(filePath);

    expect(result.rawMetadata).toHaveProperty('imagemetahub_data');
    expect(result.metadata).toMatchObject({
      prompt: 'edited png prompt',
      negativePrompt: 'edited png negative',
      seed: 12345,
      steps: 32,
      model: 'edited-model',
      generator: 'Image MetaHub',
    });
  });
});
