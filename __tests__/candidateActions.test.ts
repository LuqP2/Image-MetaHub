import { describe, expect, it, vi } from 'vitest';
import { toggleRejectedCandidates } from '../services/candidateActions';

describe('toggleRejectedCandidates', () => {
  const createOptions = () => ({
    ids: ['image-a', 'image-b'],
    isRejected: vi.fn(() => false),
    canUseBulkTagging: false,
    onBulkTaggingBlocked: vi.fn(),
    addTag: vi.fn(),
    removeTag: vi.fn(),
  });

  it('blocks multi-selection for Free before mutating tags', () => {
    const options = createOptions();
    expect(toggleRejectedCandidates(options)).toBe(false);
    expect(options.onBulkTaggingBlocked).toHaveBeenCalledOnce();
    expect(options.addTag).not.toHaveBeenCalled();
    expect(options.removeTag).not.toHaveBeenCalled();
  });

  it('allows a single candidate and restores an entirely rejected selection', () => {
    const options = createOptions();
    options.ids = ['image-a'];
    expect(toggleRejectedCandidates(options)).toBe(true);
    expect(options.addTag).toHaveBeenCalledWith(['image-a'], 'rejected');

    options.ids = ['image-a', 'image-b'];
    options.canUseBulkTagging = true;
    options.isRejected.mockReturnValue(true);
    expect(toggleRejectedCandidates(options)).toBe(true);
    expect(options.removeTag).toHaveBeenCalledWith(['image-a', 'image-b'], 'rejected');
  });
});
