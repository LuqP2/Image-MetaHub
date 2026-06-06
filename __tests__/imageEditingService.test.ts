import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_IMAGE_ADJUSTMENTS,
  DEFAULT_IMAGE_EDIT_RECIPE,
  createImageEditorDocument,
  buildImageAdjustmentFilter,
  clampImageAdjustment,
  clampImageEditCropRect,
  embedMetaHubMetadataInPngBytes,
  getImageEditOutputDimensions,
  hasImageEditRecipeChanges,
  hasImageEditorDocumentChanges,
  hasImageAdjustments,
  normalizeImageAdjustments,
  normalizeImageEditorDocument,
  normalizeImageEditRecipe,
  normalizeImageEditRotation,
  renderAdjustedImageToPngBytes,
} from '../services/imageEditingService';

const collectPngChunkTypes = (bytes: Uint8Array): string[] => {
  const types: string[] = [];
  let offset = 8;
  while (offset + 12 <= bytes.byteLength) {
    const view = new DataView(bytes.buffer, bytes.byteOffset + offset, 8);
    const length = view.getUint32(0, false);
    const type = String.fromCharCode(bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7]);
    types.push(type);
    offset += length + 12;
    if (type === 'IEND') {
      break;
    }
  }
  return types;
};

const collectPngTextChunks = (bytes: Uint8Array): Record<string, string> => {
  const chunks: Record<string, string> = {};
  const decoder = new TextDecoder();
  let offset = 8;
  while (offset + 12 <= bytes.byteLength) {
    const view = new DataView(bytes.buffer, bytes.byteOffset + offset, 8);
    const length = view.getUint32(0, false);
    const type = String.fromCharCode(bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7]);
    if (type === 'tEXt' || type === 'iTXt') {
      const data = bytes.slice(offset + 8, offset + 8 + length);
      const separatorIndex = data.indexOf(0);
      if (separatorIndex !== -1) {
        const keyword = decoder.decode(data.slice(0, separatorIndex));
        if (type === 'tEXt') {
          chunks[keyword] = decoder.decode(data.slice(separatorIndex + 1));
        } else {
          const textStart = separatorIndex + 5;
          chunks[keyword] = decoder.decode(data.slice(textStart));
        }
      }
    }
    offset += length + 12;
    if (type === 'IEND') {
      break;
    }
  }
  return chunks;
};

describe('imageEditingService', () => {
  it('treats default adjustments as neutral', () => {
    expect(hasImageAdjustments(DEFAULT_IMAGE_ADJUSTMENTS)).toBe(false);
    expect(hasImageAdjustments({ brightness: 101 })).toBe(true);
  });

  it('clamps adjustment values to supported ranges', () => {
    expect(clampImageAdjustment('brightness', 250)).toBe(200);
    expect(clampImageAdjustment('contrast', -10)).toBe(0);
    expect(clampImageAdjustment('saturation', Number.NaN)).toBe(100);
    expect(clampImageAdjustment('hue', 300)).toBe(180);

    expect(normalizeImageAdjustments({ brightness: 101.4, hue: -220 })).toEqual({
      brightness: 101,
      contrast: 100,
      saturation: 100,
      hue: -180,
    });
  });

  it('builds a CSS/canvas filter string', () => {
    expect(buildImageAdjustmentFilter({ brightness: 120, contrast: 80, saturation: 150, hue: -30 }))
      .toBe('brightness(120%) contrast(80%) saturate(150%) hue-rotate(-30deg)');
  });

  it('normalizes edit recipes and detects neutral edits', () => {
    expect(hasImageEditRecipeChanges(DEFAULT_IMAGE_EDIT_RECIPE)).toBe(false);
    expect(normalizeImageEditRotation(275)).toBe(270);
    expect(normalizeImageEditRotation(-90)).toBe(270);
    expect(clampImageEditCropRect({ x: -5, y: 20, width: 999, height: 40 }, { width: 100, height: 80 })).toEqual({
      x: 0,
      y: 20,
      width: 100,
      height: 40,
    });

    const recipe = normalizeImageEditRecipe({
      transform: { rotation: 91, flipHorizontal: true },
      crop: { enabled: true, aspect: '1:1', rect: { x: 10, y: 15, width: 40, height: 40 } },
      resize: { enabled: true, width: 64, height: 32, lockAspectRatio: false },
      effects: { sharpen: 150, blur: -5 },
    }, { width: 100, height: 80 });

    expect(recipe.transform.rotation).toBe(90);
    expect(recipe.transform.flipHorizontal).toBe(true);
    expect(recipe.resize).toMatchObject({ enabled: true, width: 64, height: 32 });
    expect(recipe.effects).toEqual({ sharpen: 100, blur: 0 });
    expect(hasImageEditRecipeChanges(recipe)).toBe(true);
    expect(hasImageEditRecipeChanges({
      ...DEFAULT_IMAGE_EDIT_RECIPE,
      resize: { enabled: true, width: 64, height: 32, lockAspectRatio: false },
    })).toBe(true);
  });

  it('computes output dimensions for crop, rotate, and resize', () => {
    expect(getImageEditOutputDimensions({
      crop: { enabled: true, aspect: 'free', rect: { x: 0, y: 0, width: 40, height: 20 } },
    }, { width: 100, height: 80 })).toEqual({ width: 40, height: 20 });

    expect(getImageEditOutputDimensions({
      crop: { enabled: true, aspect: 'free', rect: { x: 0, y: 0, width: 40, height: 20 } },
      transform: { rotation: 90, flipHorizontal: false, flipVertical: false },
    }, { width: 100, height: 80 })).toEqual({ width: 20, height: 40 });

    expect(getImageEditOutputDimensions({
      resize: { enabled: true, width: 12, height: 10, lockAspectRatio: false },
    }, { width: 100, height: 80 })).toEqual({ width: 12, height: 10 });
  });

  it('normalizes image editor documents and clamps object bounds', () => {
    const document = normalizeImageEditorDocument({
      sourceImageId: 'dir::image.png',
      sourceName: 'image.png',
      sourceDimensions: { width: 400, height: 300 },
      canvasDimensions: { width: 400, height: 300 },
      objects: [
        {
          id: 'rect-1',
          type: 'rectangle',
          bounds: { x: -10, y: 20, width: 999, height: 60 },
          zIndex: 3,
          opacity: 2,
          style: { stroke: '#ffffff', fill: 'transparent', strokeWidth: 200, fontSize: 0 },
        },
      ],
    });

    expect(document.objects).toHaveLength(1);
    expect(document.objects[0].bounds).toEqual({ x: 0, y: 20, width: 400, height: 60 });
    expect(document.objects[0].style.opacity).toBe(1);
    expect(document.objects[0].style.strokeWidth).toBe(80);
    expect(document.objects[0].style.fontSize).toBe(8);
  });

  it('preserves directional points for line and arrow objects', () => {
    const document = normalizeImageEditorDocument({
      sourceImageId: 'dir::image.png',
      sourceName: 'image.png',
      sourceDimensions: { width: 400, height: 300 },
      canvasDimensions: { width: 400, height: 300 },
      objects: [
        {
          id: 'arrow-1',
          type: 'arrow',
          bounds: { x: 20, y: 20, width: 180, height: 120 },
          points: [
            { x: 200, y: 40 },
            { x: 20, y: 140 },
          ],
          zIndex: 1,
          style: { strokeColor: '#ffffff', fillColor: 'transparent', textColor: '#ffffff', strokeWidth: 4, fontSize: 24, opacity: 1 },
        },
      ],
    });

    expect(document.objects[0].points).toEqual([
      { x: 200, y: 40 },
      { x: 20, y: 140 },
    ]);
  });

  it('detects neutral and dirty image editor documents', () => {
    const document = createImageEditorDocument({
      imageId: 'dir::image.png',
      name: 'image.png',
      width: 400,
      height: 300,
    });

    expect(hasImageEditorDocumentChanges(document)).toBe(false);
    expect(hasImageEditorDocumentChanges({
      ...document,
      objects: [
        {
          id: 'arrow-1',
          type: 'arrow',
          bounds: { x: 10, y: 10, width: 120, height: 40 },
          zIndex: 1,
          opacity: 1,
          style: { stroke: '#ffffff', fill: 'transparent', strokeWidth: 4, fontSize: 24 },
        },
      ],
    })).toBe(true);
    expect(hasImageEditorDocumentChanges({
      ...document,
      background: { ...document.background, kind: 'color', color: '#101820' },
    })).toBe(true);
  });

  it('renders adjusted image bytes as PNG', async () => {
    const drawImage = vi.fn();
    const toBlob = vi.fn((callback: BlobCallback) => {
      callback(new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' }));
    });
    const originalCreateElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation(((tagName: string) => {
      if (tagName === 'canvas') {
        return {
          width: 0,
          height: 0,
          getContext: () => ({
            filter: '',
            drawImage,
            translate: vi.fn(),
            rotate: vi.fn(),
            scale: vi.fn(),
            setTransform: vi.fn(),
          }),
          toBlob,
        } as unknown as HTMLCanvasElement;
      }

      return originalCreateElement(tagName);
    }) as typeof document.createElement);

    const OriginalImage = globalThis.Image;
    class MockImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      decoding = '';
      naturalWidth = 8;
      naturalHeight = 6;
      width = 8;
      height = 6;

      set src(_value: string) {
        queueMicrotask(() => this.onload?.());
      }
    }

    globalThis.Image = MockImage as unknown as typeof Image;
    try {
      const bytes = await renderAdjustedImageToPngBytes('blob:test', { brightness: 120 });
      expect([...bytes]).toEqual([137, 80, 78, 71]);
      expect(drawImage).toHaveBeenCalled();
      expect(toBlob).toHaveBeenCalled();
    } finally {
      globalThis.Image = OriginalImage;
      vi.restoreAllMocks();
    }
  });

  it('embeds MetaHub metadata chunks into PNG bytes', () => {
    const pngBytes = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      0x00, 0x00, 0x00, 0x00,
      0x49, 0x45, 0x4e, 0x44,
      0xae, 0x42, 0x60, 0x82,
    ]);

    const output = embedMetaHubMetadataInPngBytes(pngBytes, {
      prompt: 'a test prompt',
      negativePrompt: 'blur',
      model: 'model.safetensors',
      models: ['model.safetensors'],
      width: 64,
      height: 32,
      steps: 20,
      scheduler: 'normal',
      sampler: 'euler',
      cfg_scale: 7,
      seed: 123,
    }, DEFAULT_IMAGE_ADJUSTMENTS);
    const text = new TextDecoder().decode(output);

    expect(text).toContain('parameters');
    expect(text).toContain('a test prompt');
    expect(text).toContain('imagemetahub_data');
    expect(text).toContain('Image MetaHub');
    expect(text).toContain('model.safetensors');
  });

  it('stores edited output dimensions in the top-level MetaHub payload', () => {
    const pngBytes = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      0x00, 0x00, 0x00, 0x00,
      0x49, 0x45, 0x4e, 0x44,
      0xae, 0x42, 0x60, 0x82,
    ]);

    const output = embedMetaHubMetadataInPngBytes(
      pngBytes,
      {
        prompt: 'cropped edit',
        width: 1024,
        height: 768,
      },
      DEFAULT_IMAGE_ADJUSTMENTS,
      undefined,
      { width: 512, height: 384 },
    );
    const chunks = collectPngTextChunks(output);
    const payload = JSON.parse(chunks.imagemetahub_data);

    expect(payload.width).toBe(512);
    expect(payload.height).toBe(384);
    expect(payload.edit.output_dimensions).toEqual({ width: 512, height: 384 });
  });

  it('preserves resize edits in embedded MetaHub recipe metadata', () => {
    const pngBytes = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      0x00, 0x00, 0x00, 0x00,
      0x49, 0x45, 0x4e, 0x44,
      0xae, 0x42, 0x60, 0x82,
    ]);

    const output = embedMetaHubMetadataInPngBytes(
      pngBytes,
      {
        prompt: 'resized edit',
        width: 1024,
        height: 768,
      },
      {
        ...DEFAULT_IMAGE_EDIT_RECIPE,
        resize: {
          enabled: true,
          width: 512,
          height: 384,
          lockAspectRatio: true,
        },
      },
      undefined,
      { width: 512, height: 384 },
    );
    const chunks = collectPngTextChunks(output);
    const payload = JSON.parse(chunks.imagemetahub_data);

    expect(payload.edit.recipe.resize).toEqual({
      enabled: true,
      width: 512,
      height: 384,
      lockAspectRatio: true,
    });
  });

  it('preserves embedded ComfyUI workflow chunks when saving edited PNG bytes', () => {
    const pngBytes = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      0x00, 0x00, 0x00, 0x00,
      0x49, 0x45, 0x4e, 0x44,
      0xae, 0x42, 0x60, 0x82,
    ]);
    const workflow = { nodes: [{ id: 1, type: 'KSampler' }] };
    const prompt = { '1': { class_type: 'KSampler', inputs: { seed: 123 } } };

    const output = embedMetaHubMetadataInPngBytes(pngBytes, {
      prompt: 'a test prompt',
      model: 'model.safetensors',
      models: ['model.safetensors'],
    }, DEFAULT_IMAGE_ADJUSTMENTS, {
      workflow,
      prompt,
    }, undefined, {
      tool: 'image-editor-workspace-v1',
      annotationCount: 2,
      sourceImageId: 'dir::image.png',
    });
    const text = new TextDecoder().decode(output);

    expect(text).toContain('workflow');
    expect(text).toContain('prompt_api');
    expect(text).toContain('KSampler');
    expect(text).toContain('"seed":123');
    expect(text).toContain('image-editor-workspace-v1');
    expect(text).toContain('"annotation_count":2');

    const types = collectPngChunkTypes(output);
    expect(types.filter((type) => type === 'tEXt')).toHaveLength(3);
  });

  it('preserves raw ComfyUI workflow chunks even without normalized metadata', () => {
    const pngBytes = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      0x00, 0x00, 0x00, 0x00,
      0x49, 0x45, 0x4e, 0x44,
      0xae, 0x42, 0x60, 0x82,
    ]);
    const workflow = { nodes: [{ id: 2, type: 'CLIPTextEncode' }] };
    const promptApi = { '2': { class_type: 'CLIPTextEncode', inputs: { text: 'original prompt' } } };

    const output = embedMetaHubMetadataInPngBytes(
      pngBytes,
      undefined,
      DEFAULT_IMAGE_ADJUSTMENTS,
      {
        workflow,
        prompt_api: promptApi,
      },
    );
    const text = new TextDecoder().decode(output);

    expect(text).toContain('workflow');
    expect(text).toContain('prompt');
    expect(text).toContain('CLIPTextEncode');
    expect(text).toContain('original prompt');
    expect(text).not.toContain('imagemetahub_data');
    expect(collectPngChunkTypes(output).filter((type) => type === 'tEXt')).toHaveLength(2);
  });
});
