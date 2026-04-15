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
