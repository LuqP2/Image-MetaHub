import { describe, expect, it } from 'vitest';
import type { IndexedImage } from '../types';
import {
  DEFAULT_SIMILAR_SEARCH_CRITERIA,
  findSimilarImages,
  getModelPromptOverlapGroups,
  normalizePromptForSimilarSearch,
  promptsExactlyMatchNormalized,
} from '../services/similarImageSearch';

const createImage = (overrides: Partial<IndexedImage>): IndexedImage => ({
  id: overrides.id ?? 'dir-1::image.png',
  name: overrides.name ?? 'image.png',
  handle: overrides.handle ?? ({} as FileSystemFileHandle),
  metadata: overrides.metadata ?? ({} as any),
  metadataString: overrides.metadataString ?? '',
  lastModified: overrides.lastModified ?? 1,
  directoryId: overrides.directoryId ?? 'dir-1',
  models: overrides.models ?? [],
  loras: overrides.loras ?? [],
  scheduler: overrides.scheduler ?? '',
  workflowNodes: overrides.workflowNodes ?? [],
  prompt: overrides.prompt ?? '',
  negativePrompt: overrides.negativePrompt ?? '',
  ...overrides,
});

describe('similarImageSearch helpers', () => {
  it('normalizes prompt text for exact matching', () => {
    expect(normalizePromptForSimilarSearch('  Hello\r\nWorld   ')).toBe('hello world');
    expect(promptsExactlyMatchNormalized('Hello\n World', ' hello   world ')).toBe(true);
    expect(promptsExactlyMatchNormalized('Hello world', 'Hello moon')).toBe(false);
  });

  it('matches prompt-only groups while excluding the source checkpoint in different mode', () => {
    const source = createImage({
      id: 'source',
      prompt: 'A castle on a hill',
      models: ['model-a'],
      lastModified: 10,
    });
    const images = [
      source,
      createImage({ id: 'same-model', prompt: 'A castle on a hill', models: ['model-a'], lastModified: 30 }),
      createImage({ id: 'alt-model', prompt: 'a castle   on a hill', models: ['model-b'], lastModified: 20 }),
      createImage({ id: 'no-prompt-match', prompt: 'A forest', models: ['model-c'], lastModified: 40 }),
    ];

    const result = findSimilarImages({
      sourceImage: source,
      allImages: images,
      currentViewImages: images,
      criteria: DEFAULT_SIMILAR_SEARCH_CRITERIA,
    });

    expect(result.results.map((entry) => entry.image.id)).toEqual(['alt-model']);
    expect(result.results[0]?.matchedFields).toContain('prompt');
    expect(result.results[0]?.matchedFields).toContain('checkpoint');
  });

  it('supports prompt plus exact seed matching', () => {
    const source = createImage({
      id: 'source',
      prompt: 'Robot portrait',
      seed: 42,
      models: ['model-a'],
    });
    const images = [
      source,
      createImage({ id: 'seed-match', prompt: 'Robot portrait', seed: 42, models: ['model-b'] }),
      createImage({ id: 'seed-miss', prompt: 'Robot portrait', seed: 7, models: ['model-c'] }),
    ];

    const result = findSimilarImages({
      sourceImage: source,
      allImages: images,
      currentViewImages: images,
      criteria: {
        ...DEFAULT_SIMILAR_SEARCH_CRITERIA,
        seed: true,
      },
    });

    expect(result.results.map((entry) => entry.image.id)).toEqual(['seed-match']);
  });

  it('supports prompt plus exact LoRA-name matching', () => {
    const source = createImage({
      id: 'source',
      prompt: 'Character sheet',
      models: ['model-a'],
      loras: [{ name: 'style-lora', weight: 0.8 }, { name: 'detail-lora', weight: 1 }],
    });
    const images = [
      source,
      createImage({
        id: 'lora-match',
        prompt: 'Character sheet',
        models: ['model-b'],
        loras: ['style-lora', 'detail-lora'],
      }),
      createImage({
        id: 'lora-miss',
        prompt: 'Character sheet',
        models: ['model-c'],
        loras: ['style-lora'],
      }),
    ];

    const result = findSimilarImages({
      sourceImage: source,
      allImages: images,
      currentViewImages: images,
      criteria: {
        ...DEFAULT_SIMILAR_SEARCH_CRITERIA,
        lora: true,
      },
    });

    expect(result.results.map((entry) => entry.image.id)).toEqual(['lora-match']);
  });

  it('supports prompt plus exact LoRA weight matching', () => {
    const source = createImage({
      id: 'source',
      prompt: 'Studio portrait',
      models: ['model-a'],
      loras: [{ name: 'style-lora', weight: 0.75 }],
    });
    const images = [
      source,
      createImage({
        id: 'weight-match',
        prompt: 'Studio portrait',
        models: ['model-b'],
        loras: [{ name: 'style-lora', weight: 0.75 }],
      }),
      createImage({
        id: 'weight-miss',
        prompt: 'Studio portrait',
        models: ['model-c'],
        loras: [{ name: 'style-lora', weight: 0.7 }],
      }),
    ];

    const result = findSimilarImages({
      sourceImage: source,
      allImages: images,
      currentViewImages: images,
      criteria: {
        ...DEFAULT_SIMILAR_SEARCH_CRITERIA,
        lora: true,
        matchLoraWeight: true,
      },
    });

    expect(result.results.map((entry) => entry.image.id)).toEqual(['weight-match']);
  });

  it('disables unavailable source criteria and falls back to the remaining active rules', () => {
    const source = createImage({
      id: 'source',
      prompt: 'Ocean at dusk',
      models: [],
      loras: [],
    });
    const images = [
      source,
      createImage({ id: 'prompt-match', prompt: 'Ocean at dusk', models: ['model-b'] }),
      createImage({ id: 'prompt-miss', prompt: 'City at dusk', models: ['model-c'] }),
    ];

    const result = findSimilarImages({
      sourceImage: source,
      allImages: images,
      currentViewImages: images,
      criteria: {
        ...DEFAULT_SIMILAR_SEARCH_CRITERIA,
        lora: true,
        checkpointMode: 'same',
      },
    });

    expect(result.effectiveCriteria.lora).toBe(false);
    expect(result.effectiveCriteria.checkpointMode).toBe('ignore');
    expect(result.results.map((entry) => entry.image.id)).toEqual(['prompt-match']);
  });

  it('falls back to normalized metadata prompt when the flattened prompt is empty', () => {
    const source = createImage({
      id: 'source',
      prompt: '',
      metadata: {
        normalizedMetadata: {
          prompt: 'Legacy prompt still present in normalized metadata',
        },
      } as any,
      models: ['model-a'],
    });
    const images = [
      source,
      createImage({
        id: 'prompt-match',
        prompt: 'legacy prompt still present in normalized metadata',
        models: ['model-b'],
      }),
      createImage({
        id: 'prompt-miss',
        prompt: 'Completely different prompt',
        models: ['model-c'],
      }),
    ];

    const result = findSimilarImages({
      sourceImage: source,
      allImages: images,
      currentViewImages: images,
      criteria: DEFAULT_SIMILAR_SEARCH_CRITERIA,
    });

    expect(result.availability.prompt).toBe(true);
    expect(result.effectiveCriteria.prompt).toBe(true);
    expect(result.results.map((entry) => entry.image.id)).toEqual(['prompt-match']);
  });

  it('only reports model prompt overlaps when another checkpoint has matching prompt images', () => {
    const selectedModel = 'model-a';
    const overlappingPrompt = 'Shared prompt';
    const groups = getModelPromptOverlapGroups(selectedModel, [
      createImage({
        id: 'source-with-secondary-model',
        prompt: overlappingPrompt,
        models: ['model-b', 'model-a'],
        lastModified: 10,
      }),
      createImage({
        id: 'same-group',
        prompt: overlappingPrompt,
        models: ['model-a'],
        lastModified: 20,
      }),
      createImage({
        id: 'real-alternate',
        prompt: overlappingPrompt,
        models: ['model-c'],
        lastModified: 30,
      }),
      createImage({
        id: 'another-source-only-prompt',
        prompt: 'Only inside selected model',
        models: ['model-d', 'model-a'],
        lastModified: 40,
      }),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      normalizedPrompt: 'shared prompt',
      sourceCount: 2,
      alternateCheckpointCount: 1,
    });
  });
});
