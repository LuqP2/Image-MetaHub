import { describe, expect, it } from 'vitest';
import { version } from '../package.json';

import { verifyAppVersionConsistency } from '../scripts/checkAppVersionConsistency.mjs';

describe('application version consistency', () => {
  it('keeps package metadata and release-facing labels aligned', () => {
    expect(verifyAppVersionConsistency()).toEqual({
      version,
      checkedMarkers: 6,
    });
  });
});
