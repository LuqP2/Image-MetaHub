import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { parseImageFile } from '../services/metadataEngine';

let tempDir: string | null = null;

afterEach(async () => {
  if (tempDir) {
    await fs.rm(tempDir, { recursive: true, force: true });
    tempDir = null;
  }
});

const chunk = (type: string, data: Buffer): Buffer => {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  return Buffer.concat([length, Buffer.from(type, 'ascii'), data, Buffer.alloc(4)]);
};

const textChunk = (keyword: string, text: string): Buffer =>
  chunk('tEXt', Buffer.concat([Buffer.from(keyword, 'utf8'), Buffer.from([0]), Buffer.from(text, 'utf8')]));

const iTextChunk = (keyword: string, text: string): Buffer =>
  chunk(
    'iTXt',
    Buffer.concat([
      Buffer.from(keyword, 'utf8'),
      Buffer.from([0, 0, 0, 0, 0]),
      Buffer.from(text, 'utf8'),
    ])
  );

const minimalPng = (chunks: Buffer[]): Buffer => {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(512, 0);
  ihdr.writeUInt32BE(768, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    ...chunks,
    chunk('IEND', Buffer.alloc(0)),
  ]);
};

describe('metadataEngine MetaHub PNG chunks', () => {
  it('preserves imagemetahub_data attribution through the CLI parsing path', async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'imh-cli-metahub-'));
    const filePath = path.join(tempDir, 'attributed.png');
    const payload = {
      generator: 'ComfyUI',
      prompt: 'cli metahub prompt',
      negativePrompt: '',
      seed: 123,
      steps: 20,
      cfg: 7,
      sampler_name: 'euler',
      scheduler: 'normal',
      model: 'model.safetensors',
      width: 512,
      height: 768,
      imh_attribution: {
        schema_version: 1,
        token: 'imhcrt_br_creator_workflow_v1_random',
        source: 'metahub_save_node',
        node_version: '1.0.10',
      },
    };

    await fs.writeFile(
      filePath,
      minimalPng([
        textChunk('parameters', 'fallback prompt\nSteps: 1, Seed: 1'),
        textChunk('workflow', '{"nodes":[]}'),
        iTextChunk('imagemetahub_data', JSON.stringify(payload)),
      ])
    );

    const result = await parseImageFile(filePath);

    expect(result.rawSource).toBe('png');
    expect((result.rawMetadata as any)?.imagemetahub_data?.imh_attribution?.token).toBe(
      'imhcrt_br_creator_workflow_v1_random'
    );
    expect(result.metadata?.prompt).toBe('cli metahub prompt');
    expect(result.metadata?.imh_attribution?.token).toBe('imhcrt_br_creator_workflow_v1_random');
  });

  it('falls back to standard parameters when imagemetahub_data is malformed', async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'imh-cli-metahub-bad-'));
    const filePath = path.join(tempDir, 'fallback.png');

    await fs.writeFile(
      filePath,
      minimalPng([
        iTextChunk('imagemetahub_data', '{"generator":"ComfyUI","prompt":'),
        textChunk('parameters', 'fallback prompt\nSteps: 12, Sampler: euler, CFG scale: 6, Seed: 99, Size: 512x768, Model: fallback.safetensors'),
      ])
    );

    const result = await parseImageFile(filePath);

    expect(result.rawSource).toBe('png');
    expect((result.rawMetadata as any)?.imagemetahub_data).toBeUndefined();
    expect(result.rawMetadata).toMatchObject({
      parameters: expect.stringContaining('fallback prompt'),
    });
    expect(result.metadata?.prompt).toBe('fallback prompt');
    expect(result.metadata?.model).toBe('fallback.safetensors');
    expect(result.metadata?.imh_attribution).toBeUndefined();
  });
});
