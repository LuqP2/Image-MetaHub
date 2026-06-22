import { describe, expect, it } from 'vitest';
import {
  buildStructuredSearchResult,
  matchStructuredSearchDocument,
  parseStructuredSearchQuery,
  type StructuredSearchDocument,
} from '../utils/structuredSearch';

const document = (overrides: Partial<StructuredSearchDocument> = {}): StructuredSearchDocument => ({
  id: overrides.id ?? 'image-1',
  name: overrides.name ?? 'image.png',
  prompt: overrides.prompt ?? '',
  negativePrompt: overrides.negativePrompt ?? '',
  notes: overrides.notes ?? '',
  tags: overrides.tags ?? [],
  models: overrides.models ?? [],
  loras: overrides.loras ?? [],
  collections: overrides.collections ?? [],
  folder: overrides.folder ?? 'tests',
  source: overrides.source ?? 'comfyui',
  lastModified: overrides.lastModified ?? Date.UTC(2026, 5, 21, 10),
});

describe('structured search parser', () => {
  it('uses OR as a separator between AND groups', () => {
    const parsed = parseStructuredSearchQuery('cake OR cupcake chocolate');
    expect(parsed.groups.map((group) => group.terms.map((term) => term.value))).toEqual([
      ['cake'],
      ['cupcake', 'chocolate'],
    ]);
  });

  it('parses phrases, exclusions, fields, and dates', () => {
    const parsed = parseStructuredSearchQuery('"chocolate cake" -birthday model:flux after:2026-06-01');
    expect(parsed.groups[0].terms).toMatchObject([
      { value: 'chocolate cake', phrase: true, excluded: false },
      { value: 'birthday', phrase: false, excluded: true },
      { value: 'flux', field: 'model' },
    ]);
    expect(parsed.after).toBeTypeOf('number');
  });

  it('warns about unknown fields and suggests the closest supported field', () => {
    const parsed = parseStructuredSearchQuery('lorra:food');
    expect(parsed.warnings[0]).toMatchObject({
      code: 'unknown-field',
      suggestion: 'lora',
    });
  });
});

describe('structured search matching and ranking', () => {
  it('allows AND terms to match across different fields', () => {
    const parsed = parseStructuredSearchQuery('chocolate cake');
    const result = matchStructuredSearchDocument(document({
      prompt: 'studio photograph of chocolate',
      collections: ['Cake tests'],
    }), parsed);
    expect(result).not.toBeNull();
  });

  it('boosts cohesive matches in the same field over cross-field matches', () => {
    const parsed = parseStructuredSearchQuery('chocolate cake');
    const cohesive = matchStructuredSearchDocument(document({ prompt: 'chocolate cake product photo' }), parsed);
    const split = matchStructuredSearchDocument(document({ prompt: 'chocolate product photo', collections: ['Cake tests'] }), parsed);
    expect(cohesive!.score).toBeGreaterThan(split!.score);
  });

  it('supports prefix and light typo matching but not fuzzy short terms', () => {
    expect(matchStructuredSearchDocument(document({ prompt: 'chocolate cake' }), parseStructuredSearchQuery('choco'))).not.toBeNull();
    expect(matchStructuredSearchDocument(document({ prompt: 'chocolate cake' }), parseStructuredSearchQuery('choclate'))).not.toBeNull();
    expect(matchStructuredSearchDocument(document({ prompt: 'cat portrait' }), parseStructuredSearchQuery('cot'))).toBeNull();
  });

  it('ranks positive prompt matches above filename and negative prompt matches', () => {
    const result = buildStructuredSearchResult([
      document({ id: 'prompt', prompt: 'cake', lastModified: 1000 }),
      document({ id: 'filename', name: 'cake.png', lastModified: 1000 + (46 * 60 * 1000) }),
      document({ id: 'negative', negativePrompt: 'cake', lastModified: 1000 + (92 * 60 * 1000) }),
    ], 'cake');

    expect(result.sessions.map((session) => session.representativeImageId)).toEqual(['prompt', 'filename', 'negative']);
  });
});

describe('session-first results', () => {
  it('forms sessions before matching and preserves the full batch', () => {
    const start = Date.UTC(2026, 5, 21, 10);
    const result = buildStructuredSearchResult([
      document({ id: 'match-1', prompt: 'cake', models: ['Flux'], lastModified: start }),
      document({ id: 'context', prompt: 'portrait', models: ['Other'], lastModified: start + 60_000 }),
      document({ id: 'match-2', tags: ['cake'], models: ['Flux'], lastModified: start + 120_000 }),
    ], 'cake');

    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0].matchedImageIds).toHaveLength(2);
    expect(result.sessions[0].imageIds).toHaveLength(3);
    expect(result.facets.models).toEqual([{ value: 'Flux', count: 2 }]);
  });

  it('keeps facet alternatives by ignoring that facet own query field', () => {
    const result = buildStructuredSearchResult([
      document({ id: 'flux', prompt: 'cake', models: ['Flux'] }),
      document({ id: 'sdxl', prompt: 'cake', models: ['SDXL'] }),
    ], 'cake model:Flux');

    expect(result.matchedImageCount).toBe(1);
    expect(result.facets.models).toEqual([
      { value: 'Flux', count: 1 },
      { value: 'SDXL', count: 1 },
    ]);
  });

  it('does not let a large weak batch automatically outrank a compact strong batch', () => {
    const start = Date.UTC(2026, 5, 21, 10);
    const large = Array.from({ length: 40 }, (_, index) => document({
      id: `large-${index}`,
      name: index < 9 ? `cake-${index}.png` : `other-${index}.png`,
      lastModified: start + index * 1000,
    }));
    const compact = Array.from({ length: 8 }, (_, index) => document({
      id: `compact-${index}`,
      prompt: index < 7 ? 'chocolate cake product photograph' : 'other',
      lastModified: start + (2 * 60 * 60 * 1000) + index * 1000,
    }));

    const result = buildStructuredSearchResult([...large, ...compact], 'cake');
    expect(result.sessions[0].representativeImageId).toBe('compact-0');
  });
});
