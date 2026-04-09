import { describe, expect, it } from 'vitest';
import { getRecentTagChips, getTagSuggestions } from '../utils/tagSuggestions';

describe('tagSuggestions utilities', () => {
  it('orders prefix matches before substring matches and prioritizes recent tags within the same tier', () => {
    const suggestions = getTagSuggestions({
      query: 'art',
      recentTags: ['smart-light', 'cinematic'],
      availableTags: [
        { name: 'transport', count: 2 },
        { name: 'art', count: 5 },
        { name: 'cartoon', count: 3 },
        { name: 'smart-light', count: 8 },
      ],
      limit: 10,
    });

    expect(suggestions.map((entry) => entry.name)).toEqual([
      'art',
      'smart-light',
      'cartoon',
    ]);
  });

  it('dedupes, excludes already-applied tags, and respects the suggestion limit', () => {
    const suggestions = getTagSuggestions({
      query: '',
      recentTags: ['portrait', 'portrait', 'landscape', 'macro', 'editorial', 'studio'],
      availableTags: [
        { name: 'portrait', count: 4 },
        { name: 'landscape', count: 3 },
        { name: 'macro', count: 2 },
      ],
      excludedTags: ['landscape'],
      limit: 5,
    });

    expect(suggestions.map((entry) => entry.name)).toEqual(['portrait', 'macro', 'editorial', 'studio']);
  });

  it('limits recent tag chips independently from stored history', () => {
    const chips = getRecentTagChips({
      recentTags: ['portrait', 'macro', 'landscape', 'editorial', 'studio', 'warm'],
      excludedTags: ['macro'],
      limit: 5,
    });

    expect(chips).toEqual(['portrait', 'landscape', 'editorial', 'studio', 'warm']);
  });
});
