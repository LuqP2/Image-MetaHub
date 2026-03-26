import { describe, expect, it } from 'vitest';
import { parseA1111Metadata } from '../services/parsers/automatic1111Parser';
import { resolvePromptFromGraph } from '../services/parsers/comfyUIParser';
import { buildImageLineageIndex, getDirectDerivedImages, resolveImageLineage } from '../utils/imageLineage';
import { type BaseMetadata, type Directory, type IndexedImage } from '../types';

const createImage = (
  id: string,
  name: string,
  metadata?: Partial<BaseMetadata>
): IndexedImage => ({
  id,
  name,
  handle: {} as FileSystemFileHandle,
  thumbnailStatus: 'pending',
  metadata: metadata ? { normalizedMetadata: metadata as BaseMetadata } as any : {} as any,
  metadataString: '',
  lastModified: 1,
  models: [],
  loras: [],
  scheduler: '',
  directoryId: 'dir-1',
  dimensions: metadata?.width && metadata?.height ? `${metadata.width}x${metadata.height}` : undefined,
});

describe('Image lineage detection', () => {
  it('detects A1111 img2img when denoise exists without hires-only markers', () => {
    const result = parseA1111Metadata(
      'portrait of a cat\nNegative prompt: blurry\nSteps: 24, Sampler: Euler a, CFG scale: 7, Seed: 123, Size: 512x512, Resize mode: Just resize, Denoising strength: 0.45'
    );

    expect(result.generationType).toBe('img2img');
    expect(result.lineage?.denoiseStrength).toBe(0.45);
    expect(result.denoise).toBe(0.45);
  });

  it('does not misclassify hires fix as img2img in A1111 metadata', () => {
    const result = parseA1111Metadata(
      'portrait of a cat\nNegative prompt: blurry\nSteps: 24, Sampler: Euler a, CFG scale: 7, Seed: 123, Size: 512x512, Denoising strength: 0.35, Hires upscaler: 4x-UltraSharp, Hires steps: 12'
    );

    expect(result.generationType).toBeUndefined();
    expect(result.lineage).toBeUndefined();
  });

  it('detects ComfyUI img2img lineage from upstream LoadImage nodes', () => {
    const result = resolvePromptFromGraph(
      {
        nodes: [
          { id: 1, type: 'LoadImage', widgets_values: ['base.png'], mode: 0 },
          { id: 2, type: 'VAEEncode', widgets_values: [], mode: 0 },
          { id: 3, type: 'KSampler', widgets_values: [123, 'fixed', 20, 7, 'euler', 'normal', 0.4], mode: 0 },
        ],
      },
      {
        '1': {
          class_type: 'LoadImage',
          inputs: {
            image: 'base.png',
          },
        },
        '2': {
          class_type: 'VAEEncode',
          inputs: {
            image: ['1', 0],
            vae: ['4', 2],
          },
        },
        '3': {
          class_type: 'KSampler',
          inputs: {
            seed: 123,
            steps: 20,
            cfg: 7,
            sampler_name: 'euler',
            scheduler: 'normal',
            denoise: 0.4,
            model: ['4', 0],
            positive: ['5', 0],
            negative: ['6', 0],
            latent_image: ['2', 0],
          },
        },
        '4': {
          class_type: 'CheckpointLoaderSimple',
          inputs: {
            ckpt_name: 'model.safetensors',
          },
        },
        '5': {
          class_type: 'CLIPTextEncode',
          inputs: {
            text: 'cat portrait',
            clip: ['4', 1],
          },
        },
        '6': {
          class_type: 'CLIPTextEncode',
          inputs: {
            text: 'blurry',
            clip: ['4', 1],
          },
        },
      }
    );

    expect(result.generationType).toBe('img2img');
    expect(result.lineage?.sourceImage?.fileName).toBe('base.png');
    expect(result.lineage?.denoiseStrength).toBe(0.4);
  });

  it('does not misclassify generic masked latent nodes as inpaint in ComfyUI graphs', () => {
    const result = resolvePromptFromGraph(
      {
        nodes: [
          { id: 1, type: 'LoadImage', widgets_values: ['base.png'], mode: 0 },
          { id: 2, type: 'VAEEncode', widgets_values: [], mode: 0 },
          { id: 3, type: 'KSampler', widgets_values: [123, 'fixed', 20, 7, 'euler', 'normal', 0.4], mode: 0 },
          { id: 7, type: 'SolidMask', widgets_values: [], mode: 0 },
          { id: 8, type: 'LatentCompositeMasked', widgets_values: [], mode: 0 },
        ],
      },
      {
        '1': {
          class_type: 'LoadImage',
          inputs: {
            image: 'base.png',
          },
        },
        '2': {
          class_type: 'VAEEncode',
          inputs: {
            image: ['1', 0],
            vae: ['4', 2],
          },
        },
        '3': {
          class_type: 'KSampler',
          inputs: {
            seed: 123,
            steps: 20,
            cfg: 7,
            sampler_name: 'euler',
            scheduler: 'normal',
            denoise: 0.4,
            model: ['4', 0],
            positive: ['5', 0],
            negative: ['6', 0],
            latent_image: ['8', 0],
          },
        },
        '4': {
          class_type: 'CheckpointLoaderSimple',
          inputs: {
            ckpt_name: 'model.safetensors',
          },
        },
        '5': {
          class_type: 'CLIPTextEncode',
          inputs: {
            text: 'cat portrait',
            clip: ['4', 1],
          },
        },
        '6': {
          class_type: 'CLIPTextEncode',
          inputs: {
            text: 'blurry',
            clip: ['4', 1],
          },
        },
        '7': {
          class_type: 'SolidMask',
          inputs: {
            width: 512,
            height: 512,
            value: 1,
          },
        },
        '8': {
          class_type: 'LatentCompositeMasked',
          inputs: {
            destination: ['2', 0],
            source: ['2', 0],
            mask: ['7', 0],
          },
        },
      }
    );

    expect(result.generationType).toBe('img2img');
    expect(result.lineage?.sourceImage?.fileName).toBe('base.png');
  });

  it('prefers the actual source image over LoadImageMask references in ComfyUI inpaint graphs', () => {
    const result = resolvePromptFromGraph(
      {
        nodes: [
          { id: 1, type: 'LoadImage', widgets_values: ['base.png'], mode: 0 },
          { id: 2, type: 'VAEEncodeForInpaint', widgets_values: [], mode: 0 },
          { id: 3, type: 'KSampler', widgets_values: [123, 'fixed', 20, 7, 'euler', 'normal', 0.4], mode: 0 },
          { id: 7, type: 'LoadImageMask', widgets_values: ['mask.png'], mode: 0 },
        ],
      },
      {
        '1': {
          class_type: 'LoadImage',
          inputs: {
            image: 'base.png',
          },
        },
        '2': {
          class_type: 'VAEEncodeForInpaint',
          inputs: {
            pixels: ['1', 0],
            mask: ['7', 0],
            vae: ['4', 2],
          },
        },
        '3': {
          class_type: 'KSampler',
          inputs: {
            seed: 123,
            steps: 20,
            cfg: 7,
            sampler_name: 'euler',
            scheduler: 'normal',
            denoise: 0.4,
            model: ['4', 0],
            positive: ['5', 0],
            negative: ['6', 0],
            latent_image: ['2', 0],
          },
        },
        '4': {
          class_type: 'CheckpointLoaderSimple',
          inputs: {
            ckpt_name: 'model.safetensors',
          },
        },
        '5': {
          class_type: 'CLIPTextEncode',
          inputs: {
            text: 'cat portrait',
            clip: ['4', 1],
          },
        },
        '6': {
          class_type: 'CLIPTextEncode',
          inputs: {
            text: 'blurry',
            clip: ['4', 1],
          },
        },
        '7': {
          class_type: 'LoadImageMask',
          inputs: {
            image: 'mask.png',
          },
        },
      }
    );

    expect(result.generationType).toBe('inpaint');
    expect(result.lineage?.sourceImage?.fileName).toBe('base.png');
  });

  it('links a source image only when the filename match is unique', () => {
    const source = createImage('dir-1::inputs/source.png', 'source.png', {
      prompt: 'source',
      model: '',
      width: 512,
      height: 512,
      steps: 0,
      scheduler: '',
    });
    const resultImage = createImage('dir-1::outputs/result.png', 'result.png', {
      prompt: 'result',
      model: '',
      width: 512,
      height: 512,
      steps: 0,
      scheduler: '',
      generationType: 'img2img',
      lineage: {
        detection: 'inferred',
        sourceImage: { fileName: 'source.png' },
      },
    });
    const directories: Directory[] = [{
      id: 'dir-1',
      name: 'Library',
      path: 'D:/Library',
      handle: {} as FileSystemDirectoryHandle,
    }];

    const resolved = resolveImageLineage(resultImage, resultImage.metadata.normalizedMetadata, [source, resultImage], directories);

    expect(resolved?.sourceStatus).toBe('linked');
    expect(resolved?.sourceImage?.id).toBe(source.id);
  });

  it('refuses to link a source image when the filename match is ambiguous', () => {
    const duplicateA = createImage('dir-1::a/source.png', 'source.png', {
      prompt: 'a',
      model: '',
      width: 512,
      height: 512,
      steps: 0,
      scheduler: '',
    });
    const duplicateB = createImage('dir-1::b/source.png', 'source.png', {
      prompt: 'b',
      model: '',
      width: 512,
      height: 512,
      steps: 0,
      scheduler: '',
    });
    const resultImage = createImage('dir-1::outputs/result.png', 'result.png', {
      prompt: 'result',
      model: '',
      width: 512,
      height: 512,
      steps: 0,
      scheduler: '',
      generationType: 'img2img',
      lineage: {
        detection: 'inferred',
        sourceImage: { fileName: 'source.png' },
      },
    });
    const directories: Directory[] = [{
      id: 'dir-1',
      name: 'Library',
      path: 'D:/Library',
      handle: {} as FileSystemDirectoryHandle,
    }];

    const resolved = resolveImageLineage(
      resultImage,
      resultImage.metadata.normalizedMetadata,
      [duplicateA, duplicateB, resultImage],
      directories
    );

    expect(resolved?.sourceStatus).toBe('ambiguous');
    expect(resolved?.sourceImage).toBeUndefined();
  });

  it('links ComfyUI source references that include the [output] storage suffix', () => {
    const source = createImage('dir-1::01ZIT_2026-03-25_res_multistep_1.0_8steps_00002.png', '01ZIT_2026-03-25_res_multistep_1.0_8steps_00002.png', {
      prompt: 'source',
      model: '',
      width: 1024,
      height: 1024,
      steps: 0,
      scheduler: '',
    });
    const resultImage = createImage('dir-1::01ZIT_2026-03-25_res_multistep_1.0_8steps_00003.png', '01ZIT_2026-03-25_res_multistep_1.0_8steps_00003.png', {
      prompt: 'result',
      model: '',
      width: 1024,
      height: 1024,
      steps: 0,
      scheduler: '',
      generationType: 'img2img',
      lineage: {
        detection: 'inferred',
        denoiseStrength: 0.95,
        sourceImage: { fileName: '01ZIT_2026-03-25_res_multistep_1.0_8steps_00002.png [output]' },
      },
    });
    const directories: Directory[] = [{
      id: 'dir-1',
      name: 'Library',
      path: 'D:/Library',
      handle: {} as FileSystemDirectoryHandle,
    }];

    const resolved = resolveImageLineage(resultImage, resultImage.metadata.normalizedMetadata, [source, resultImage], directories);

    expect(resolved?.sourceStatus).toBe('linked');
    expect(resolved?.sourceImage?.id).toBe(source.id);
  });

  it('reuses a precomputed lineage index for derived image lookup', () => {
    const source = createImage('dir-1::inputs/source.png', 'source.png', {
      prompt: 'source',
      model: '',
      width: 1024,
      height: 1024,
      steps: 0,
      scheduler: '',
    });
    const derived = createImage('dir-1::outputs/derived.png', 'derived.png', {
      prompt: 'derived',
      model: '',
      width: 1024,
      height: 1024,
      steps: 0,
      scheduler: '',
      generationType: 'img2img',
      lineage: {
        detection: 'inferred',
        sourceImage: { fileName: 'source.png' },
      },
    });
    const directories: Directory[] = [{
      id: 'dir-1',
      name: 'Library',
      path: 'D:/Library',
      handle: {} as FileSystemDirectoryHandle,
    }];

    const lineageIndex = buildImageLineageIndex([source, derived], directories);
    const derivedImages = getDirectDerivedImages(source, [source, derived], directories, 4, lineageIndex);

    expect(derivedImages.map((image) => image.id)).toEqual([derived.id]);
  });
});
