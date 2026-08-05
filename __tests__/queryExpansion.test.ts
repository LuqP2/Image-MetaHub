import { describe, it, expect } from 'vitest';
import { QUERY_TEMPLATES, expandQuery } from '../services/embeddings/embeddingModel';

describe('expandQuery', () => {
  it('expands a short query into every template phrasing', () => {
    const prompts = expandQuery('dog');
    expect(prompts).toHaveLength(QUERY_TEMPLATES.length);
    expect(prompts).toContain('dog');
    expect(prompts).toContain('a photo of dog');
  });

  it('keeps a caption-shaped query verbatim', () => {
    const query = 'a misty forest at dawn with a lone figure';
    expect(expandQuery(query)).toEqual([query]);
  });

  it('templates up to the word limit and not past it', () => {
    expect(expandQuery('a red sports car')).toHaveLength(QUERY_TEMPLATES.length);
    expect(expandQuery('a red sports car driving')).toEqual(['a red sports car driving']);
  });

  it('trims surrounding whitespace before templating', () => {
    expect(expandQuery('  cat  ')).toContain('a photo of cat');
  });

  it('returns nothing for an empty query', () => {
    expect(expandQuery('   ')).toEqual([]);
  });
});
