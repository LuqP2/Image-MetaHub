import { describe, expect, it } from 'vitest';
import { buildProLicenseUrl, findLatestCreatorAttributionToken } from '../utils/creatorAttribution';
import type { IndexedImage } from '../types';

const createImage = (id: string, lastModified: number, token?: string): IndexedImage => ({
  id,
  name: `${id}.png`,
  handle: {} as FileSystemFileHandle,
  lastModified,
  metadataString: '',
  models: [],
  loras: [],
  scheduler: '',
  metadata: {
    normalizedMetadata: {
      prompt: '',
      negativePrompt: '',
      width: 512,
      height: 512,
      imh_attribution: token
        ? {
            schema_version: 1,
            token,
            source: 'metahub_save_node',
          }
        : null,
    },
    rawMetadata: {},
  },
} as IndexedImage);

describe('creator attribution', () => {
  it('builds the Pro URL with src=app, optional ctx, and imh_ref only when a token exists', () => {
    expect(buildProLicenseUrl(null)).toBe('https://www.imagemetahub.com/pro?src=app');
    expect(buildProLicenseUrl(null, 'menu')).toBe('https://www.imagemetahub.com/pro?src=app&ctx=menu');
    expect(buildProLicenseUrl('imhcrt_br_creator workflow', 'lockedfeature')).toBe(
      'https://www.imagemetahub.com/pro?src=app&ctx=lockedfeature&imh_ref=imhcrt_br_creator+workflow'
    );
  });

  it('supports the post-trial recovery context', () => {
    expect(buildProLicenseUrl(null, 'trial_expired')).toBe(
      'https://www.imagemetahub.com/pro?src=app&ctx=trial_expired'
    );
    expect(buildProLicenseUrl('imhcrt_x', 'trial_expired')).toBe(
      'https://www.imagemetahub.com/pro?src=app&ctx=trial_expired&imh_ref=imhcrt_x'
    );
  });

  it('selects the newest attributed image token', () => {
    const token = findLatestCreatorAttributionToken([
      createImage('old', 100, 'imhcrt_old'),
      createImage('none', 300),
      createImage('new', 200, 'imhcrt_new'),
    ]);

    expect(token).toBe('imhcrt_new');
  });
});
