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
  it('builds the Pro URL with imh_ref only when a token exists', () => {
    expect(buildProLicenseUrl(null)).toBe('https://imagemetahub.com/getpro.html');
    expect(buildProLicenseUrl('imhcrt_br_creator workflow')).toBe(
      'https://imagemetahub.com/getpro.html?imh_ref=imhcrt_br_creator+workflow'
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
