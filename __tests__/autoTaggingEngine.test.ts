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
      { id: '1', prompt: 'blue bicycle, marble staircase, soft window light' },
      { id: '2', prompt: 'blue bicycle, city street' },
    ];
    const model = buildTFIDFModel(images);
    const tags = extractAutoTags(images[0], model);

    expect(model.documentCount).toBe(2);
    expect(model.vocabulary).toContain('blue bicycle');
    expect(model.vocabulary).toContain('marble staircase');
    expect(model.vocabulary).toContain('soft window light');
    expect(model.vocabulary).not.toContain('bicycle');
    expect(tags.map(tag => tag.tag)).toEqual(expect.arrayContaining([
      'blue bicycle', 'marble staircase', 'soft window light',
    ]));
    expect(tags.every(tag => tag.sourceType === 'prompt')).toBe(true);
  });

  it('uses fragment frequency and document frequency for TF-IDF', () => {
    const images: TaggingImage[] = [
      { id: '1', prompt: 'marble staircase, marble staircase, blue bicycle' },
      { id: '2', prompt: 'blue bicycle, lake' },
    ];
    const model = buildTFIDFModel(images);
    const tags = extractAutoTags(images[0], model);
    const staircase = tags.find(tag => tag.tag === 'marble staircase');
    const bicycle = tags.find(tag => tag.tag === 'blue bicycle');

    expect(model.idfScores.get('marble staircase')).toBeCloseTo(Math.log(3 / 2) + 1);
    expect(model.idfScores.get('blue bicycle')).toBeCloseTo(1);
    expect(staircase?.frequency).toBe(2);
    expect(staircase?.tfidfScore).toBeCloseTo((2 / 3) * (Math.log(3 / 2) + 1), 4);
    expect(bicycle?.tfidfScore).toBeCloseTo(1 / 3, 4);
  });

  it('removes weighting, LoRA markers and standalone quality or score boilerplate', () => {
    const image: TaggingImage = {
      id: '1',
      prompt: '((Blue_Bicycle:1.2)), [marble staircase:0.8], <lora:CustomStyle:0.7>, masterpiece, best quality, score_9_up, SCORE_8, café à noite',
    };
    const model = buildTFIDFModel([image]);

    expect(model.vocabulary).toEqual([
      'blue bicycle', 'marble staircase', 'café à noite',
    ]);
    expect(extractAutoTags(image, model).map(tag => tag.tag)).toEqual(model.vocabulary);
  });

  it('keeps short single fragments and ignores empty, numeric and long prose fragments', () => {
    const image: TaggingImage = {
      id: '1',
      prompt: ', cat, 123, , a blue bicycle resting beside a long empty road at sunrise with birds, oak tree',
    };
    const model = buildTFIDFModel([image]);

    expect(model.vocabulary).toEqual(['cat', 'oak tree']);
    expect(extractAutoTags({ id: '2', prompt: 'one two three four five six seven eight nine' }, model)).toEqual([]);
  });

  it('separates sentences within comma fragments without breaking decimal values', () => {
    const image = {
      id: '1',
      prompt: 'red coat. they, river valley. the stone bridge, striped scarf. she, 35mm f/2.8 lens. amber light, he turns away',
    };
    const model = buildTFIDFModel([image]);

    expect(model.vocabulary).toEqual([
      'red coat',
      'river valley',
      'stone bridge',
      'striped scarf',
      '35mm f/2.8 lens',
      'amber light',
    ]);
    expect(extractAutoTags(image, model).map(tag => tag.tag)).toEqual(model.vocabulary);
  });

  it('rejects incomplete clauses without discarding complete descriptive phrases', () => {
    const image = {
      id: '1',
      prompt: 'its narrow base extending beyond the, and a lone, old clock shows a faint, featuring curved handles and chipped blue glaze, patterned tiles lining the hall, shadows stretching across the floor, warm reflected evening light, antique finish, metal hinges, garden arch, quality',
    };
    const model = buildTFIDFModel([image]);

    expect(model.vocabulary).toEqual([
      'old clock',
      'curved handles',
      'chipped blue glaze',
      'patterned tiles lining the hall',
      'shadows stretching across the floor',
      'warm reflected evening light',
      'antique finish',
      'metal hinges',
      'garden arch',
    ]);
  });

  it('does not turn the subject of a copular sentence into a tag', () => {
    const image = {
      id: '1',
      prompt: 'This is a digital artwork, It is softly lit, these are distant trees, marble staircase',
    };
    const model = buildTFIDFModel([image]);

    expect(model.vocabulary).toEqual(['marble staircase']);
    expect(extractAutoTags(image, model).map(tag => tag.tag)).toEqual(['marble staircase']);
  });

  it('rejects imperative prefixes cut off by an internal comma', () => {
    const image = {
      id: '1',
      prompt: 'Imagine a tiny, striped balloon drifting slowly across the square beside an old clock, marble staircase, Create a single, blue kite',
    };
    const model = buildTFIDFModel([image]);

    expect(model.vocabulary).toEqual(['marble staircase', 'blue kite']);
    expect(extractAutoTags(image, model).map(tag => tag.tag)).toEqual(['marble staircase', 'blue kite']);
  });

  it('offers the next ranked fragments instead of repeating current auto-tags', () => {
    const image = { id: '1', prompt: 'marble staircase, blue bicycle, garden fountain' };
    const model = buildTFIDFModel([image]);
    const initial = extractAutoTags(image, model, { topN: 2 });
    const next = extractAutoTags(image, model, {
      topN: 2,
      excludeTags: initial.map(tag => tag.tag),
    });

    expect(next.map(tag => tag.tag)).toEqual(['garden fountain']);
  });

  it('reserves all default slots for descriptive fragments, independent of model and LoRA metadata', () => {
    const image: TaggingImage = {
      id: '1',
      prompt: 'blue bicycle, marble staircase, lake shore, striped awning, amber lantern, oak tree, garden fountain, <lora:RareStyle:1>',
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
    const initial = buildTFIDFModel([{ id: '1', prompt: 'marble staircase, cat' }]);
    const updated = updateTFIDFModel(initial, [{ id: '2', prompt: 'marble staircase, lake shore' }]);

    expect(updated.documentCount).toBe(2);
    expect(updated.vocabulary).toEqual(expect.arrayContaining(['marble staircase', 'cat', 'lake shore']));
    expect(updated.idfScores.get('marble staircase')).toBeCloseTo(1);
    expect(updated.idfScores.get('cat')).toBeCloseTo(Math.log(3 / 2) + 1);
  });
});
