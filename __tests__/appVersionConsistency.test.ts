import { describe, expect, it } from 'vitest';

import { verifyAppVersionConsistency } from '../scripts/checkAppVersionConsistency.mjs';

describe('application version consistency', () => {
  it('keeps package metadata and release-facing labels aligned', () => {
    expect(verifyAppVersionConsistency()).toEqual({
      version: '0.19.3',
      checkedMarkers: 7,
    });
  });
});
