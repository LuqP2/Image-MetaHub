import { describe, expect, it } from 'vitest';
import {
  buildProCheckoutUrl,
  buildProLicenseUrl,
  findLatestCreatorAttributionToken,
  type ProLicenseUrlContext,
  type ProPlan,
} from '../utils/creatorAttribution';
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

  it.each([
    ['monthly', '/00w9ASeuo9tUgtN45r3Ru01'],
    ['annual', '/eVq28q5XSgWmb9t45r3Ru02'],
    ['lifetime', '/14AfZg9a48pQa5p8lH3Ru00'],
  ] as const)('builds the direct Stripe checkout URL for %s', (plan, expectedPath) => {
    const url = new URL(buildProCheckoutUrl(plan, 'imhcrt_creator-01', 'lockedfeature', 'Compare View'));

    expect(url.origin).toBe('https://buy.stripe.com');
    expect(url.pathname).toBe(expectedPath);
    expect(url.searchParams.get('src')).toBe('app');
    expect(url.searchParams.get('ctx')).toBe('lockedfeature');
    expect(url.searchParams.get('feature')).toBe('Compare View');
    expect(url.searchParams.get('imh_ref')).toBe('imhcrt_creator-01');
    expect(url.searchParams.get('utm_source')).toBe('app');
    expect(url.searchParams.get('utm_campaign')).toBe('image_metahub_pro');
    expect(url.searchParams.get('utm_term')).toBe(plan);
    expect(url.searchParams.get('client_reference_id')).toBe(
      'src-app_f-compareview_ctx-lockedfeature_ref-imhcrt_creator-01'
    );
  });

  it('keeps direct checkout attribution optional while always identifying the app source', () => {
    const url = new URL(buildProCheckoutUrl('lifetime'));

    expect(url.searchParams.get('src')).toBe('app');
    expect(url.searchParams.get('ctx')).toBeNull();
    expect(url.searchParams.get('feature')).toBeNull();
    expect(url.searchParams.get('imh_ref')).toBeNull();
    expect(url.searchParams.get('client_reference_id')).toBe('src-app');
  });

  it('matches the website client-reference sanitization and Stripe length limit', () => {
    const oversizedToken = ` imhcrt_${'A'.repeat(240)}<>!?_- `;
    const url = new URL(
      buildProCheckoutUrl(
        'annual' as ProPlan,
        oversizedToken,
        'C'.repeat(100) as ProLicenseUrlContext,
        'Compare View / 3D + Visual Search'
      )
    );
    const clientReferenceId = url.searchParams.get('client_reference_id');

    expect(clientReferenceId).toBeTruthy();
    expect(clientReferenceId).toMatch(/^src-app_f-compareview3dvis_ctx-c{15}_ref-imhcrt_[A]{113}$/);
    expect(clientReferenceId).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(clientReferenceId).toHaveLength(171);
    expect(clientReferenceId!.length).toBeLessThanOrEqual(200);
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
