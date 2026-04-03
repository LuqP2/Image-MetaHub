import { describe, expect, it } from 'vitest';
import { type IndexedImage } from '../types';
import {
  buildWorkflowNodeCatalog,
  extractWorkflowNodeTypes,
  extractWorkflowNodeTypesFromMetadata,
  filterImagesByWorkflowNodes,
} from '../services/comfyUIWorkflowNodes';

const createImage = (overrides: Partial<IndexedImage>): IndexedImage => ({
  id: overrides.id ?? 'dir-1::image.png',
  name: overrides.name ?? 'image.png',
  handle: {} as FileSystemFileHandle,
  metadata: overrides.metadata ?? ({} as any),
  metadataString: overrides.metadataString ?? '',
  lastModified: overrides.lastModified ?? 1,
  models: overrides.models ?? [],
  loras: overrides.loras ?? [],
  scheduler: overrides.scheduler ?? '',
  workflowNodes: overrides.workflowNodes ?? [],
  ...overrides,
});

describe('comfyUIWorkflowNodes', () => {
  it('extracts unique class_type values from prompt graphs', () => {
    expect(
      extractWorkflowNodeTypes({
        prompt: {
          '1': { class_type: 'KSampler' },
          '2': { class_type: 'CLIPTextEncode' },
          '3': { class_type: 'KSampler' },
          '4': { class_type: '   ' },
        },
      })
    ).toEqual(['KSampler', 'CLIPTextEncode']);
  });

  it('falls back to workflow ui node types when prompt graph is unavailable', () => {
    expect(
      extractWorkflowNodeTypes({
        workflow: {
          nodes: [
            { type: 'LoadImage' },
            { type: 'KSampler' },
            { type: 'LoadImage' },
          ],
        },
      })
    ).toEqual(['LoadImage', 'KSampler']);
  });

  it('extracts nodes from imagemetahub metadata prompt_api first', () => {
    expect(
      extractWorkflowNodeTypesFromMetadata({
        imagemetahub_data: {
          workflow: {
            nodes: [{ type: 'IgnoredWorkflowNode' }],
          },
          prompt_api: {
            '1': { class_type: 'ControlNetApplyAdvanced' },
            '2': { class_type: 'KSampler' },
          },
        },
      })
    ).toEqual(['ControlNetApplyAdvanced', 'KSampler']);
  });

  it('returns an empty list for non-comfy metadata', () => {
    expect(
      extractWorkflowNodeTypesFromMetadata({
        parameters: 'Steps: 20, Sampler: Euler a',
      })
    ).toEqual([]);
  });

  it('builds a counted node catalog and filters images with OR logic', () => {
    const images = [
      createImage({ id: '1', workflowNodes: ['KSampler', 'CLIPTextEncode'] }),
      createImage({ id: '2', workflowNodes: ['KSampler', 'LoraLoader'] }),
      createImage({ id: '3', workflowNodes: ['LoadImage'] }),
      createImage({ id: '4', workflowNodes: [] }),
    ];

    expect(buildWorkflowNodeCatalog(images)).toEqual([
      { name: 'KSampler', count: 2 },
      { name: 'CLIPTextEncode', count: 1 },
      { name: 'LoadImage', count: 1 },
      { name: 'LoraLoader', count: 1 },
    ]);

    expect(filterImagesByWorkflowNodes(images, [])).toEqual(images.slice(0, 3));
    expect(filterImagesByWorkflowNodes(images, ['LoraLoader', 'LoadImage']).map((image) => image.id)).toEqual(['2', '3']);
  });
});
