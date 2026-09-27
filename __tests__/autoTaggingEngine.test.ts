import { describe, expect, it } from 'vitest';
import {
  buildTFIDFModel,
  extractAutoTags,
  updateTFIDFModel,
  type TaggingImage,
} from '../services/autoTaggingEngine';

describe('AutoTaggingEngine', () => {
  it('keeps comma-separated descriptive phrases intact in the vocabulary and tags', () => {
    const images: TaggingImage[] = [
      { id: '1', prompt: 'golden retriever, pine forest, shallow depth of field' },
      { id: '2', prompt: 'golden retriever, city street' },
    ];
    const model = buildTFIDFModel(images);
    const tags = extractAutoTags(images[0], model);

    expect(model.documentCount).toBe(2);
    expect(model.vocabulary).toContain('golden retriever');
    expect(model.vocabulary).toContain('pine forest');
    expect(model.vocabulary).toContain('shallow depth of field');
    expect(model.vocabulary).not.toContain('retriever');
    expect(tags.map(tag => tag.tag)).toEqual(expect.arrayContaining([
      'golden retriever', 'pine forest', 'shallow depth of field',
    ]));
    expect(tags.every(tag => tag.sourceType === 'prompt')).toBe(true);
  });

  it('uses fragment frequency and document frequency for TF-IDF', () => {
    const images: TaggingImage[] = [
      { id: '1', prompt: 'pine forest, pine forest, golden retriever' },
      { id: '2', prompt: 'golden retriever, lake' },
    ];
    const model = buildTFIDFModel(images);
    const tags = extractAutoTags(images[0], model);
    const forest = tags.find(tag => tag.tag === 'pine forest');
    const retriever = tags.find(tag => tag.tag === 'golden retriever');

    expect(model.idfScores.get('pine forest')).toBeCloseTo(Math.log(3 / 2) + 1);
    expect(model.idfScores.get('golden retriever')).toBeCloseTo(1);
    expect(forest?.frequency).toBe(2);
    expect(forest?.tfidfScore).toBeCloseTo((2 / 3) * (Math.log(3 / 2) + 1), 4);
    expect(retriever?.tfidfScore).toBeCloseTo(1 / 3, 4);
  });

  it('removes weighting, LoRA markers and standalone quality or score boilerplate', () => {
    const image: TaggingImage = {
      id: '1',
      prompt: '((Golden_Retriever:1.2)), [pine forest:0.8], <lora:CustomStyle:0.7>, masterpiece, best quality, score_9_up, SCORE_8, café à noite',
    };
    const model = buildTFIDFModel([image]);

    expect(model.vocabulary).toEqual([
      'golden retriever', 'pine forest', 'café à noite',
    ]);
    expect(extractAutoTags(image, model).map(tag => tag.tag)).toEqual(model.vocabulary);
  });

  it('keeps short single fragments and ignores empty, numeric and long prose fragments', () => {
    const image: TaggingImage = {
      id: '1',
      prompt: ', cat, 123, , a golden retriever running through a dark forest at sunrise with birds, oak tree',
    };
    const model = buildTFIDFModel([image]);

    expect(model.vocabulary).toEqual(['cat', 'oak tree']);
    expect(extractAutoTags({ id: '2', prompt: 'one two three four five six seven eight nine' }, model)).toEqual([]);
  });

  it('rejects incomplete clauses without discarding complete descriptive phrases', () => {
    const image = {
      id: '1',
      prompt: 'his small frame contrasting against the oversized, and a single, flickering fluorescent bulb casts a harsh, featuring jagged edges and peeling olive-green paint, fallen leaves scattered on the path, mist clinging low to the ground, soft diffused morning light, vintage look, facial features, fashion show, quality',
    };
    const model = buildTFIDFModel([image]);

    expect(model.vocabulary).toEqual([
      'flickering fluorescent bulb',
      'jagged edges',
      'peeling olive-green paint',
      'fallen leaves scattered on the path',
      'mist clinging low to the ground',
      'soft diffused morning light',
      'vintage look',
      'facial features',
      'fashion show',
    ]);
  });

  it('does not turn the subject of a copular sentence into a tag', () => {
    const image = {
      id: '1',
      prompt: 'This is a digital artwork, It is softly lit, these are distant trees, pine forest',
    };
    const model = buildTFIDFModel([image]);

    expect(model.vocabulary).toEqual(['pine forest']);
    expect(extractAutoTags(image, model).map(tag => tag.tag)).toEqual(['pine forest']);
  });

  it('offers the next ranked fragments instead of repeating current auto-tags', () => {
    const image = { id: '1', prompt: 'pine forest, golden retriever, mountain trail' };
    const model = buildTFIDFModel([image]);
    const initial = extractAutoTags(image, model, { topN: 2 });
    const next = extractAutoTags(image, model, {
      topN: 2,
      excludeTags: initial.map(tag => tag.tag),
    });

    expect(next.map(tag => tag.tag)).toEqual(['mountain trail']);
  });

  it('reserves all default slots for descriptive fragments, independent of model and LoRA metadata', () => {
    const image: TaggingImage = {
      id: '1',
      prompt: 'golden retriever, pine forest, lake shore, red collar, morning mist, oak tree, mountain trail, <lora:RareStyle:1>',
      models: ['SDXL'],
      loras: ['RareStyle'],
    };
    const model = buildTFIDFModel([image]);
    const tags = extractAutoTags(image, model);

    expect(model.vocabulary).toHaveLength(7);
    expect(tags).toHaveLength(6);
    expect(tags.every(tag => tag.sourceType === 'prompt')).toBe(true);
    expect(tags.map(tag => tag.tag)).not.toContain('sdxl');
    expect(tags.map(tag => tag.tag)).not.toContain('rarestyle');
  });

  it('respects topN and minScore', () => {
    const image = { id: '1', prompt: 'cat, dog, bird' };
    const model = buildTFIDFModel([image]);

    expect(extractAutoTags(image, model, { topN: 2 })).toHaveLength(2);
    expect(extractAutoTags(image, model, { minScore: 100 })).toEqual([]);
  });

  it('updates the model using whole fragments', () => {
    const initial = buildTFIDFModel([{ id: '1', prompt: 'pine forest, cat' }]);
    const updated = updateTFIDFModel(initial, [{ id: '2', prompt: 'pine forest, lake shore' }]);

    expect(updated.documentCount).toBe(2);
    expect(updated.vocabulary).toEqual(expect.arrayContaining(['pine forest', 'cat', 'lake shore']));
    expect(updated.idfScores.get('pine forest')).toBeCloseTo(1);
    expect(updated.idfScores.get('cat')).toBeCloseTo(Math.log(3 / 2) + 1);
  });
});
