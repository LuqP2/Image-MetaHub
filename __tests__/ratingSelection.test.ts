import { describe, expect, it } from 'vitest';
import {
  getBulkRatingTargetIds,
  getContextMenuRatingTargetIds,
} from '../utils/ratingSelection';

describe('rating selection helpers', () => {
  it('uses the full selected set for bulk toolbar ratings', () => {
    const selectedImages = new Set(['img-1', 'img-7', 'img-12']);

    expect(getBulkRatingTargetIds(selectedImages)).toEqual(['img-1', 'img-7', 'img-12']);
  });

  it('uses the full selected set when the context image is selected', () => {
    const selectedImages = new Set(['img-1', 'img-7', 'img-12']);

    expect(getContextMenuRatingTargetIds(selectedImages, 'img-7')).toEqual([
      'img-1',
      'img-7',
      'img-12',
    ]);
  });

  it('targets only the context image when it is not selected', () => {
    const selectedImages = new Set(['img-1', 'img-7']);

    expect(getContextMenuRatingTargetIds(selectedImages, 'img-12')).toEqual(['img-12']);
  });
});
