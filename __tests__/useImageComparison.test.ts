import { describe, expect, it } from 'vitest';
import { comparisonWillAutoOpen } from '../hooks/useImageComparison';

describe('comparisonWillAutoOpen', () => {
  it('stays closed after adding the first image', () => {
    expect(comparisonWillAutoOpen(0)).toBe(false);
  });

  it('opens comparison when adding the second, third, or fourth image', () => {
    expect(comparisonWillAutoOpen(1)).toBe(true);
    expect(comparisonWillAutoOpen(2)).toBe(true);
    expect(comparisonWillAutoOpen(3)).toBe(true);
  });
});
