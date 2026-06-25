import { describe, expect, it } from 'vitest';
import {
  buildComfyUIBridgeMetadata,
  buildComfyUIBridgeWritePayload,
  createComfyUIBridgeSessionId,
  sanitizeComfyUIBridgeSessionId,
} from '../services/comfyUIBridgeService';
import {
  createDefaultGenerationPrep,
  createImageEditorDocument,
} from '../services/imageEditingService';
import type { IndexedImage } from '../types';

const image = {
  id: 'dir-1::nested/source.png',
  name: 'source.png',
  directoryId: 'dir-1',
  metadata: {
    normalizedMetadata: {
      width: 640,
      height: 480,
    },
  },
  handle: {
    _filePath: 'D:/images/nested/source.png',
  },
} as unknown as IndexedImage;

describe('comfyUIBridgeService', () => {
  it('creates stable prep session ids', () => {
    expect(createComfyUIBridgeSessionId(new Date(2026, 5, 24, 18, 30, 12), 0.5))
      .toBe('prep_20260624_183012_7fffff');
    expect(sanitizeComfyUIBridgeSessionId(' prep:bad/id ')).toBe('prep_bad_id');
  });

  it('builds bridge metadata with canvas expansion and source lineage', () => {
    const document = createImageEditorDocument({
      imageId: image.id,
      name: image.name,
      width: 640,
      height: 480,
    });
    document.canvasDimensions = { width: 768, height: 608 };
    document.generationPrep = {
      ...createDefaultGenerationPrep(document.canvasDimensions),
      intent: 'outpaint',
      denoise: 0.72,
      sourceBounds: { x: 64, y: 32, width: 640, height: 480 },
      maskInverted: true,
      maskRegions: [{ id: 'region-1', x: 0, y: 0, width: 64, height: 608, source: 'outpaint-expansion' }],
      maskStrokes: [{ id: 'stroke-1', mode: 'paint', brushSize: 24, points: [{ x: 100, y: 100 }] }],
    };

    const metadata = buildComfyUIBridgeMetadata({
      image,
      editorDocument: document,
      hasMask: true,
      sessionId: 'prep_test',
      preparedAt: '2026-06-24T18:30:12.000Z',
      directoryPath: 'D:/images',
    });

    expect(metadata).toMatchObject({
      schema_version: 1,
      session_id: 'prep_test',
      intent: 'outpaint',
      denoise: 0.72,
      files: {
        image: { name: 'image.png', width: 768, height: 608 },
        mask: { name: 'mask.png', available: true, width: 768, height: 608 },
      },
      source: {
        path: 'D:/images/nested/source.png',
        name: 'source.png',
        id: 'dir-1::nested/source.png',
        directory_id: 'dir-1',
        relative_path: 'nested/source.png',
      },
      canvas: {
        width: 768,
        height: 608,
        expansion: { left: 64, top: 32, right: 64, bottom: 96 },
      },
      editor: {
        generation_prep: {
          mask_inverted: true,
          mask_region_count: 1,
          mask_stroke_count: 1,
        },
      },
    });
    expect(metadata.lineage.parent_image.fileName).toBe('source.png');
  });

  it('builds write payloads with mask availability based on mask bytes', () => {
    const document = createImageEditorDocument({
      imageId: image.id,
      name: image.name,
      width: 16,
      height: 16,
    });

    const payload = buildComfyUIBridgeWritePayload({
      image,
      editorDocument: document,
      hasMask: false,
      sessionId: 'prep_payload',
      imageBytes: new Uint8Array([1, 2, 3]),
      maskBytes: null,
    });

    expect(payload.sessionId).toBe('prep_payload');
    expect(payload.metadata.files.mask.available).toBe(false);
    expect(payload.metadata.files.image.name).toBe('image.png');
  });
});
