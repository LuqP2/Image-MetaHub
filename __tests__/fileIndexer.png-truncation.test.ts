import { describe, expect, it } from 'vitest';
import { parsePNGMetadata } from '../services/fileIndexer';

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/**
 * Builds a raw tEXt chunk: length(4) + type('tEXt') + keyword + 0x00 + text + crc(4, dummy).
 * parsePNGMetadata never validates the CRC, so any 4 bytes are fine there.
 */
function buildTextChunk(keyword: string, text: string): number[] {
  const keywordBytes = Array.from(Buffer.from(keyword, 'latin1'));
  const textBytes = Array.from(Buffer.from(text, 'utf-8'));
  const data = [...keywordBytes, 0x00, ...textBytes];
  const length = data.length;
  const lengthBytes = [
    (length >>> 24) & 0xff,
    (length >>> 16) & 0xff,
    (length >>> 8) & 0xff,
    length & 0xff,
  ];
  const typeBytes = Array.from(Buffer.from('tEXt', 'latin1'));
  const crcBytes = [0, 0, 0, 0]; // never checked by parsePNGMetadata
  return [...lengthBytes, ...typeBytes, ...data, ...crcBytes];
}

function buildIendChunk(): number[] {
  return [0, 0, 0, 0, ...Array.from(Buffer.from('IEND', 'latin1')), 0, 0, 0, 0];
}

/**
 * Builds a minimal (fake, not spec-perfect, but good enough for this parser) IHDR chunk
 * so the buffer starts like a real PNG. parsePNGMetadata starts walking chunks at byte 8
 * and doesn't validate IHDR contents.
 */
function buildIhdrChunk(): number[] {
  const data = new Array(13).fill(0);
  return [0, 0, 0, 13, ...Array.from(Buffer.from('IHDR', 'latin1')), ...data, 0, 0, 0, 0];
}

/** A ComfyUI-style API prompt graph: small, and contains the class_type/inputs markers. */
function buildComfyPromptJson(): string {
  return JSON.stringify({
    '1': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'model.safetensors' } },
    '2': { class_type: 'KSampler', inputs: { seed: 12345, steps: 20 } },
  });
}

/** A large ComfyUI-style UI workflow graph (no class_type keys — that's the 'prompt' chunk's job). */
function buildLargeComfyWorkflowJson(approxBytes: number): string {
  const filler = 'x'.repeat(Math.max(0, approxBytes));
  return JSON.stringify({
    last_node_id: 2,
    nodes: [{ id: 1, type: 'CheckpointLoaderSimple', pos: [0, 0], widgets_values: [filler] }],
  });
}

function buildPng(chunks: number[][]): ArrayBuffer {
  const bytes = [...PNG_SIGNATURE, ...buildIhdrChunk(), ...chunks.flat(), ...buildIendChunk()];
  return new Uint8Array(bytes).buffer;
}

describe('parsePNGMetadata head-read truncation handling (issue #448)', () => {
  it('flags truncated=true and drops the workflow chunk when the buffer is cut off mid-file', async () => {
    const promptJson = buildComfyPromptJson();
    const workflowJson = buildLargeComfyWorkflowJson(80 * 1024); // ~80KB, like a complex real workflow

    const promptChunk = buildTextChunk('prompt', promptJson);
    const workflowChunk = buildTextChunk('workflow', workflowJson);

    const fullBuffer = buildPng([promptChunk, workflowChunk]);

    // Simulate the app's 64KB head-read optimization (HEAD_READ_MAX_BYTES in fileIndexer.ts).
    const HEAD_READ_MAX_BYTES = 64 * 1024;
    const truncatedBuffer = fullBuffer.slice(0, Math.min(HEAD_READ_MAX_BYTES, fullBuffer.byteLength));

    // Sanity check for the test fixture itself: the workflow chunk must genuinely be cut off.
    expect(truncatedBuffer.byteLength).toBeLessThan(fullBuffer.byteLength);

    const truncationInfo = { truncated: false };
    const partialResult = await parsePNGMetadata(truncatedBuffer, truncationInfo);

    // This is the core of the fix: the parser must tell the caller it stopped early,
    // rather than silently returning an incomplete-but-non-empty result.
    expect(truncationInfo.truncated).toBe(true);

    // The prompt chunk (small, appears first) survives; the workflow chunk (large,
    // appears second) does not — this is exactly the shape that used to get
    // permanently mis-cached instead of triggering a full re-read.
    expect(partialResult).not.toBeNull();
    expect(partialResult && 'workflow' in partialResult).toBe(false);
  });

  it('does not flag truncated when the full file is provided', async () => {
    const promptJson = buildComfyPromptJson();
    const workflowJson = buildLargeComfyWorkflowJson(80 * 1024);
    const promptChunk = buildTextChunk('prompt', promptJson);
    const workflowChunk = buildTextChunk('workflow', workflowJson);
    const fullBuffer = buildPng([promptChunk, workflowChunk]);

    const truncationInfo = { truncated: false };
    const result = await parsePNGMetadata(fullBuffer, truncationInfo);

    expect(truncationInfo.truncated).toBe(false);
    expect(result && 'workflow' in result).toBe(true);
  });

  it('does not flag truncated for a small PNG that legitimately has no relevant metadata', async () => {
    // No relevant tEXt chunks at all — just signature, IHDR, and IEND.
    const buffer = buildPng([]);
    const truncationInfo = { truncated: false };
    const result = await parsePNGMetadata(buffer, truncationInfo);

    expect(truncationInfo.truncated).toBe(false);
    expect(result == null).toBe(true);
  });
});
