import { describe, expect, it } from 'vitest';
import { parseA1111Metadata } from '../services/parsers/automatic1111Parser';
import { parseInvokeAIMetadata } from '../services/parsers/invokeAIParser';
import {
  buildProvenanceViewModel,
  serializeProvenanceSummary,
} from '../services/provenanceSummary';
import { type BaseMetadata, type IndexedImage, type InvokeAIMetadata } from '../types';
import { type ResolvedLineageEntry } from '../services/lineageRegistry';

const createImage = (name: string, metadata: Partial<BaseMetadata> = {}): IndexedImage => ({
  id: `library::${name}`,
  name,
  handle: { _filePath: `D:\\library\\${name}` } as FileSystemFileHandle,
  metadata: { normalizedMetadata: metadata as BaseMetadata } as IndexedImage['metadata'],
  metadataString: '',
  lastModified: Date.UTC(2026, 7, 30, 12, 0, 0),
  fileSize: 2048,
  models: [],
  loras: [],
  scheduler: '',
  directoryId: 'library',
});

describe('Provenance Summary view model', () => {
  it('presents representative ComfyUI metadata as embedded generation information', () => {
    const image = createImage('comfy.png', {
      generator: 'ComfyUI',
      generationType: 'txt2img',
      prompt: 'cinematic mountain lake',
      negativePrompt: 'blurry',
      model: 'sdxl.safetensors',
      seed: 42,
      steps: 28,
      cfg_scale: 6.5,
      sampler: 'euler',
      scheduler: 'normal',
      width: 1024,
      height: 768,
      loras: [{ name: 'detailer', weight: 0.8 }],
    });

    const model = buildProvenanceViewModel({ image });

    expect(model.generation).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'Generator/application', value: 'ComfyUI', evidence: 'embedded' }),
      expect.objectContaining({ label: 'Positive prompt', value: 'cinematic mountain lake' }),
      expect.objectContaining({ label: 'LoRAs', value: 'detailer (0.8)' }),
      expect.objectContaining({ label: 'Dimensions', value: '1024x768' }),
    ]));
  });

  it('uses the normalized Automatic1111 parser output without inventing fields', () => {
    const metadata = parseA1111Metadata(
      'portrait of a fox\nNegative prompt: noisy\nSteps: 24, Sampler: Euler a, CFG scale: 7, Seed: 123, Size: 512x512, Model: fox.safetensors'
    );
    const image = createImage('a1111.png', metadata);
    const model = buildProvenanceViewModel({ image });

    expect(model.generation).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'Positive prompt', value: 'portrait of a fox' }),
      expect.objectContaining({ label: 'Sampler', value: 'Euler a' }),
      expect.objectContaining({ label: 'Seed', value: '123' }),
    ]));
  });

  it('uses representative InvokeAI normalized metadata and its explicit source reference', () => {
    const metadata = parseInvokeAIMetadata({
      positive_prompt: 'studio portrait',
      negative_prompt: 'grain',
      model_name: 'invoke-model.safetensors',
      width: 640,
      height: 832,
      steps: 30,
      cfg_scale: 5,
      scheduler: 'euler',
      seed: 99,
      generation_mode: 'img2img',
      ref_images: [{ image_name: 'original.png' }],
    } as InvokeAIMetadata);
    const image = createImage('invoke.png', metadata);
    const source = createImage('original.png');
    const resolved: ResolvedLineageEntry = {
      generationType: 'img2img',
      sourceStatus: 'linked',
      sourceImageId: source.id,
      sourceReference: { fileName: 'original.png' },
      lineage: { detection: 'explicit', sourceImage: { fileName: 'original.png' } },
    };

    const model = buildProvenanceViewModel({ image, resolvedLineage: resolved, sourceImage: source });

    expect(model.generation).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'Generator/application', value: 'InvokeAI' }),
      expect.objectContaining({ label: 'Generation type', value: 'Img2Img' }),
    ]));
    expect(model.relationships).toContainEqual(expect.objectContaining({
      label: 'Source image', value: 'original.png', evidence: 'embedded',
    }));
  });

  it('keeps partial metadata partial and labels registry matches as inferred', () => {
    const image = createImage('partial.png', {
      prompt: '', model: '', steps: 0, scheduler: '', width: 0, height: 0,
    });
    const derived = createImage('derived.png');
    const model = buildProvenanceViewModel({ image, derivedImages: [derived] });

    expect(model.generation).toEqual([]);
    expect(model.relationships).toEqual([expect.objectContaining({
      label: 'Derived image', value: 'derived.png', evidence: 'inferred',
    })]);
  });

  it('includes Image MetaHub edit information only when stored in metadata', () => {
    const image = createImage('edited.png');
    const model = buildProvenanceViewModel({
      image,
      rawMetadata: {
        imagemetahub_data: {
          generator: 'Image MetaHub',
          source_generator: 'ComfyUI',
          edited_at: '2026-08-30T12:00:00.000Z',
          edit: {
            tool: 'image-editor-v2',
            source_image_id: 'library::source.png',
            recipe: { crop: { enabled: true } },
          },
        },
      },
    });

    expect(model.operation).toEqual({
      tool: 'image-editor-v2',
      sourceGenerator: 'ComfyUI',
      sourceImageId: 'library::source.png',
      editedAt: '2026-08-30T12:00:00.000Z',
      recipeSummary: 'crop',
    });
  });

  it('serializes a concise copyable summary without calculating a fingerprint', () => {
    const image = createImage('copy.png', { generator: 'ComfyUI', prompt: 'sunset', model: 'model.safetensors', steps: 20, scheduler: 'normal' });
    const model = buildProvenanceViewModel({ image, derivedImages: [createImage('copy-derived.png')] });
    const text = serializeProvenanceSummary(model);

    expect(text).toContain('SHA-256: Not calculated');
    expect(text).toContain('Generator/application: ComfyUI [Embedded metadata]');
    expect(text).toContain('Derived image: copy-derived.png');
    expect(text).toContain('[Inferred]');
  });
});
