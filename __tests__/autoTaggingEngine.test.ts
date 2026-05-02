import { describe, expect, it } from 'vitest';
import {
  buildTFIDFModel,
  extractAutoTags,
  updateTFIDFModel,
  TaggingImage
} from '../services/autoTaggingEngine';

describe('AutoTaggingEngine', () => {
  describe('buildTFIDFModel', () => {
    it('returns an empty model for an empty input array', () => {
      const model = buildTFIDFModel([]);
      expect(model.documentCount).toBe(0);
      expect(model.vocabulary).toHaveLength(0);
      expect(model.idfScores.size).toBe(0);
    });

    it('returns an empty model for images with no extractable terms', () => {
      const images: TaggingImage[] = [
        { id: '1', prompt: '' },
        { id: '2', prompt: '  ' },
      ];
      const model = buildTFIDFModel(images);
      expect(model.documentCount).toBe(0);
      expect(model.vocabulary).toHaveLength(0);
      expect(model.idfScores.size).toBe(0);
    });

    it('calculates correct model stats for mixed image terms', () => {
      const images: TaggingImage[] = [
        { id: '1', prompt: 'cat dog' },
        { id: '2', prompt: 'cat bird', models: ['SDXL'] },
        { id: '3', prompt: 'dog', loras: ['CuteStyle'] },
      ];

      const model = buildTFIDFModel(images);

      // documentCount should be 3
      expect(model.documentCount).toBe(3);

      // Vocabulary should contain all unique terms (normalized)
      const expectedVocabulary = ['cat', 'dog', 'bird', 'sdxl', 'cutestyle'];
      expect(model.vocabulary).toHaveLength(expectedVocabulary.length);
      expectedVocabulary.forEach(term => {
        expect(model.vocabulary).toContain(term);
      });

      // IDF Score Formula: Math.log((documentCount + 1) / (df + 1)) + 1
      // For 'cat': df = 2, idf = Math.log((3+1)/(2+1)) + 1 = Math.log(4/3) + 1
      const catIdf = Math.log(4 / 3) + 1;
      expect(model.idfScores.get('cat')).toBeCloseTo(catIdf);

      // For 'bird': df = 1, idf = Math.log((3+1)/(1+1)) + 1 = Math.log(4/2) + 1 = Math.log(2) + 1
      const birdIdf = Math.log(2) + 1;
      expect(model.idfScores.get('bird')).toBeCloseTo(birdIdf);
    });
  });

  describe('extractAutoTags', () => {
    const images: TaggingImage[] = [
      { id: '1', prompt: 'cat dog' },
      { id: '2', prompt: 'cat bird' },
      { id: '3', prompt: 'dog fish' },
    ];
    const model = buildTFIDFModel(images);

    it('extracts tags from prompt correctly', () => {
      const image: TaggingImage = { id: '4', prompt: 'cat fish' };
      const tags = extractAutoTags(image, model);

      // 'cat' and 'fish' should be present
      const tagNames = tags.map(t => t.tag);
      expect(tagNames).toContain('cat');
      expect(tagNames).toContain('fish');

      // Check one score
      // 'cat': count=1, totalTokens=2 -> tf=0.5
      // 'cat' in model: df=2, documentCount=3 -> idf = Math.log(4/3) + 1
      // score = tf * idf * PROMPT_WEIGHT(1.0) = 0.5 * (Math.log(4/3) + 1)
      const expectedScore = 0.5 * (Math.log(4 / 3) + 1);
      const catTag = tags.find(t => t.tag === 'cat');
      expect(catTag?.tfidfScore).toBeCloseTo(expectedScore, 4);
      expect(catTag?.sourceType).toBe('prompt');
    });

    it('applies higher weights for model and LoRA terms', () => {
      const image: TaggingImage = {
        id: '5',
        prompt: 'cat',
        models: ['SDXL'],
        loras: ['CuteStyle']
      };
      const tags = extractAutoTags(image, model);

      // 'cat': tf=1/1, idf=Math.log(4/3)+1, weight=1.0 -> score = 1.0 * (Math.log(4/3)+1)
      // 'sdxl': tf=1/1 (metadataTerms use 1/totalTokens), idf=Math.log(4/1)+1, weight=1.8 (MODEL_WEIGHT)
      // 'cutestyle': tf=1/1, idf=Math.log(4/1)+1, weight=2.0 (LORA_WEIGHT)

      const catTag = tags.find(t => t.tag === 'cat');
      const sdxlTag = tags.find(t => t.tag === 'sdxl');
      const loraTag = tags.find(t => t.tag === 'cutestyle');

      expect(sdxlTag?.sourceType).toBe('metadata');
      expect(loraTag?.sourceType).toBe('metadata');

      // sdxl and cutestyle should have higher scores than cat due to weights and lower df
      expect(sdxlTag!.tfidfScore).toBeGreaterThan(catTag!.tfidfScore);
      expect(loraTag!.tfidfScore).toBeGreaterThan(sdxlTag!.tfidfScore);
    });

    it('respects topN and minScore options', () => {
      const image: TaggingImage = { id: '6', prompt: 'cat dog bird fish' };

      // topN = 2
      const tagsTop2 = extractAutoTags(image, model, { topN: 2 });
      expect(tagsTop2).toHaveLength(2);

      // minScore = 100 (too high for any tag)
      const tagsHighMin = extractAutoTags(image, model, { minScore: 100 });
      expect(tagsHighMin).toHaveLength(0);
    });
  });

  describe('updateTFIDFModel', () => {
    it('correctly updates an existing model with new images', () => {
      const initialImages: TaggingImage[] = [
        { id: '1', prompt: 'cat dog' },
      ];
      const initialModel = buildTFIDFModel(initialImages);
      expect(initialModel.documentCount).toBe(1);

      const newImages: TaggingImage[] = [
        { id: '2', prompt: 'cat bird' },
      ];
      const updatedModel = updateTFIDFModel(initialModel, newImages);

      expect(updatedModel.documentCount).toBe(2);
      expect(updatedModel.vocabulary).toContain('cat');
      expect(updatedModel.vocabulary).toContain('dog');
      expect(updatedModel.vocabulary).toContain('bird');

      // 'cat' was in both images
      // dfEstimate for 'cat' from initialModel:
      // idf = Math.log((1+1)/(1+1)) + 1 = 1
      // dfEstimate = Math.max(1, Math.round((1+1)/Math.exp(1-1) - 1)) = Math.max(1, Math.round(2/1 - 1)) = 1
      // new df for 'cat' = 1 (estimate) + 1 (from new images) = 2
      // new idf for 'cat' = Math.log((2+1)/(2+1)) + 1 = 1
      expect(updatedModel.idfScores.get('cat')).toBeCloseTo(1);

      // 'dog' was only in initial image
      // dfEstimate for 'dog' = 1
      // new df for 'dog' = 1 + 0 = 1
      // new idf for 'dog' = Math.log((2+1)/(1+1)) + 1 = Math.log(1.5) + 1
      expect(updatedModel.idfScores.get('dog')).toBeCloseTo(Math.log(1.5) + 1);
    });
  });
});
