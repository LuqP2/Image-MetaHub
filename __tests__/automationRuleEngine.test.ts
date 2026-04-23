import { describe, expect, it } from 'vitest';
import type { AutomationRule, ImageAnnotations, IndexedImage, SmartCollection } from '../types';
import {
  applyAutomationRuleToImages,
  imageMatchesAutomationRule,
  previewAutomationRule,
} from '../services/automationRuleEngine';

const createImage = (overrides: Partial<IndexedImage>): IndexedImage => ({
  id: overrides.id ?? `img-${overrides.name ?? 'image.png'}`,
  name: overrides.name ?? 'image.png',
  handle: {} as FileSystemFileHandle,
  metadata: {} as any,
  metadataString: '',
  lastModified: 1,
  models: [],
  loras: [],
  sampler: '',
  scheduler: '',
  directoryId: 'dir-1',
  ...overrides,
});

const createRule = (overrides: Partial<AutomationRule>): AutomationRule => ({
  id: overrides.id ?? 'rule-1',
  name: overrides.name ?? 'Rule',
  enabled: overrides.enabled ?? true,
  criteria: overrides.criteria ?? {
    matchMode: 'all',
    textConditions: [],
    filters: {},
  },
  actions: overrides.actions ?? {
    addTags: [],
    addToCollectionIds: [],
  },
  runOnNewImages: overrides.runOnNewImages ?? true,
  createdAt: 1,
  updatedAt: 1,
  lastAppliedAt: null,
  lastMatchCount: 0,
  lastChangeCount: 0,
});

describe('automation rule engine', () => {
  it('matches prompt text and previews tag additions', () => {
    const images = [
      createImage({ id: 'cat', prompt: 'small cat in the garden' }),
      createImage({ id: 'dog', prompt: 'small dog in the garden' }),
    ];
    const rule = createRule({
      criteria: {
        matchMode: 'all',
        textConditions: [{ id: 'c1', field: 'prompt', operator: 'contains', value: 'cat' }],
        filters: {},
      },
      actions: { addTags: ['animal'], addToCollectionIds: [] },
    });

    expect(imageMatchesAutomationRule(images[0], rule)).toBe(true);
    expect(imageMatchesAutomationRule(images[1], rule)).toBe(false);
    expect(previewAutomationRule(rule, images, new Map(), [])).toMatchObject({
      matchedImageIds: ['cat'],
      matchCount: 1,
      changeCount: 1,
      tagChangeCount: 1,
    });
  });

  it('matches prompt and checkpoint together', () => {
    const image = createImage({
      prompt: 'dog portrait',
      models: ['CyberRealistic'],
    });
    const rule = createRule({
      criteria: {
        matchMode: 'all',
        textConditions: [{ id: 'c1', field: 'prompt', operator: 'contains', value: 'dog' }],
        filters: { models: ['CyberRealistic'] },
      },
      actions: { addTags: ['realistic'], addToCollectionIds: [] },
    });

    expect(imageMatchesAutomationRule(image, rule)).toBe(true);
  });

  it('matches prompt and excluded LoRA absence', () => {
    const birdWithoutLora = createImage({ id: 'bird-1', prompt: 'bird flying', loras: [] });
    const birdWithLora = createImage({ id: 'bird-2', prompt: 'bird flying', loras: ['x'] });
    const rule = createRule({
      criteria: {
        matchMode: 'all',
        textConditions: [{ id: 'c1', field: 'prompt', operator: 'contains', value: 'bird' }],
        filters: { excludedLoras: ['x'] },
      },
      actions: { addTags: ['y'], addToCollectionIds: [] },
    });

    expect(imageMatchesAutomationRule(birdWithoutLora, rule)).toBe(true);
    expect(imageMatchesAutomationRule(birdWithLora, rule)).toBe(false);
  });

  it('matches the guided condition-row criteria directly', () => {
    const birdWithoutLora = createImage({ id: 'bird-1', prompt: 'bright bird flying', loras: [] });
    const birdWithLora = createImage({ id: 'bird-2', prompt: 'bright bird flying', loras: ['x'] });
    const rule = createRule({
      criteria: {
        matchMode: 'all',
        textConditions: [],
        conditionRows: [
          { id: 'prompt', field: 'prompt', operator: 'contains', value: 'bird' },
          { id: 'lora', field: 'lora', operator: 'not_includes', value: 'x' },
        ],
        filters: {},
      },
      actions: { addTags: ['y'], addToCollectionIds: [] },
    });

    expect(imageMatchesAutomationRule(birdWithoutLora, rule)).toBe(true);
    expect(imageMatchesAutomationRule(birdWithLora, rule)).toBe(false);
  });

  it('keeps OR semantics for multiple values from the same facet row group', () => {
    const fluxImage = createImage({ id: 'flux', models: ['Flux'] });
    const sdxlImage = createImage({ id: 'sdxl', models: ['SDXL'] });
    const otherImage = createImage({ id: 'other', models: ['Other'] });
    const rule = createRule({
      criteria: {
        matchMode: 'all',
        textConditions: [],
        conditionRows: [
          { id: 'model-1', field: 'model', operator: 'includes', value: 'Flux' },
          { id: 'model-2', field: 'model', operator: 'includes', value: 'SDXL' },
        ],
        filters: {},
      },
      actions: { addTags: ['matched'], addToCollectionIds: [] },
    });

    expect(imageMatchesAutomationRule(fluxImage, rule)).toBe(true);
    expect(imageMatchesAutomationRule(sdxlImage, rule)).toBe(true);
    expect(imageMatchesAutomationRule(otherImage, rule)).toBe(false);
  });

  it('requires all excluded values from the same facet row group to be absent', () => {
    const cleanImage = createImage({ id: 'clean', loras: [] });
    const blockedImage = createImage({ id: 'blocked', loras: ['x'] });
    const rule = createRule({
      criteria: {
        matchMode: 'all',
        textConditions: [],
        conditionRows: [
          { id: 'lora-1', field: 'lora', operator: 'not_includes', value: 'x' },
          { id: 'lora-2', field: 'lora', operator: 'not_includes', value: 'y' },
        ],
        filters: {},
      },
      actions: { addTags: ['matched'], addToCollectionIds: [] },
    });

    expect(imageMatchesAutomationRule(cleanImage, rule)).toBe(true);
    expect(imageMatchesAutomationRule(blockedImage, rule)).toBe(false);
  });

  it('preserves all-tags semantics for grouped manual tag rows', () => {
    const imageWithBothTags = createImage({ id: 'both', tags: ['animal', 'portrait'] });
    const imageWithOneTag = createImage({ id: 'one', tags: ['animal'] });
    const rule = createRule({
      criteria: {
        matchMode: 'all',
        textConditions: [],
        conditionRows: [
          { id: 'tag-1', field: 'tag', operator: 'includes', value: 'animal', groupMode: 'all' },
          { id: 'tag-2', field: 'tag', operator: 'includes', value: 'portrait', groupMode: 'all' },
        ],
        filters: {},
      },
      actions: { addTags: ['matched'], addToCollectionIds: [] },
    });

    expect(imageMatchesAutomationRule(imageWithBothTags, rule)).toBe(true);
    expect(imageMatchesAutomationRule(imageWithOneTag, rule)).toBe(false);
  });

  it('matches imported global search rows across searchable image fields', () => {
    const image = createImage({ id: 'cat', prompt: 'cat portrait', metadataString: '' });
    const rule = createRule({
      criteria: {
        matchMode: 'all',
        textConditions: [],
        conditionRows: [{ id: 'search', field: 'search', operator: 'contains', value: 'cat' }],
        filters: {},
      },
      actions: { addTags: ['matched'], addToCollectionIds: [] },
    });

    expect(imageMatchesAutomationRule(image, rule)).toBe(true);
  });

  it('does not apply disabled rules', () => {
    const rule = createRule({
      enabled: false,
      criteria: {
        matchMode: 'all',
        textConditions: [{ id: 'c1', field: 'prompt', operator: 'contains', value: 'cat' }],
        filters: {},
      },
      actions: { addTags: ['animal'], addToCollectionIds: [] },
    });

    expect(previewAutomationRule(rule, [createImage({ prompt: 'cat' })], new Map(), [])).toMatchObject({
      matchCount: 0,
      changeCount: 0,
    });
  });

  it('supports date, media, generation mode, and telemetry metric condition rows', () => {
    const image = createImage({
      id: 'telemetry-match',
      name: 'render.png',
      lastModified: new Date('2026-04-23T12:00:00').getTime(),
      metadata: {
        normalizedMetadata: {
          generationType: 'img2img',
          media_type: 'image',
          _analytics: {
            generation_time_ms: 1500,
            steps_per_second: 8.5,
            vram_peak_mb: 4096,
          },
        },
      } as any,
    });

    const rule = createRule({
      criteria: {
        matchMode: 'all',
        textConditions: [],
        conditionRows: [
          { id: 'date', field: 'date', operator: 'equals', value: '2026-04-23' },
          { id: 'mode', field: 'generationMode', operator: 'includes', value: 'img2img' },
          { id: 'media', field: 'mediaType', operator: 'includes', value: 'image' },
          { id: 'time', field: 'generationTimeMs', operator: 'at_least', value: '1000' },
          { id: 'speed', field: 'stepsPerSecond', operator: 'at_least', value: '8' },
          { id: 'vram', field: 'vramPeakMb', operator: 'between', value: '4000', valueEnd: '5000' },
        ],
        filters: {},
      },
      actions: { addTags: ['matched'], addToCollectionIds: [] },
    });

    expect(imageMatchesAutomationRule(image, rule)).toBe(true);
  });

  it('can evaluate disabled rules in explicit manual mode', () => {
    const rule = createRule({
      enabled: false,
      criteria: {
        matchMode: 'all',
        textConditions: [{ id: 'c1', field: 'prompt', operator: 'contains', value: 'cat' }],
        filters: {},
      },
      actions: { addTags: ['animal'], addToCollectionIds: [] },
    });
    const images = [createImage({ id: 'img-1', prompt: 'cat portrait' })];

    expect(imageMatchesAutomationRule(images[0], rule)).toBe(false);
    expect(imageMatchesAutomationRule(images[0], rule, { ignoreEnabled: true })).toBe(true);

    expect(previewAutomationRule(rule, images, new Map(), [], { ignoreEnabled: true })).toMatchObject({
      matchCount: 1,
      changeCount: 1,
    });
  });

  it('is idempotent for tags and collection image IDs', () => {
    const annotations = new Map<string, ImageAnnotations>([
      ['img-1', { imageId: 'img-1', isFavorite: false, tags: ['animal'], addedAt: 1, updatedAt: 1 }],
    ]);
    const collection: SmartCollection = {
      id: 'collection-1',
      kind: 'manual',
      name: 'Animals',
      sortIndex: 0,
      imageIds: ['img-1'],
      snapshotImageIds: [],
      excludedImageIds: [],
      imageCount: 1,
      createdAt: 1,
      updatedAt: 1,
    };
    const rule = createRule({
      criteria: {
        matchMode: 'all',
        textConditions: [{ id: 'c1', field: 'prompt', operator: 'contains', value: 'cat' }],
        filters: {},
      },
      actions: { addTags: ['animal'], addToCollectionIds: ['collection-1'] },
    });

    const result = applyAutomationRuleToImages(
      rule,
      [createImage({ id: 'img-1', prompt: 'cat', tags: ['animal'] })],
      annotations,
      [collection],
    );

    expect(result.matchCount).toBe(1);
    expect(result.changeCount).toBe(0);
    expect(result.updatedAnnotations).toEqual([]);
    expect(result.collectionImageAdds.size).toBe(0);
  });
});
