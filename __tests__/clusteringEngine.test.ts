import { describe, expect, it } from 'vitest';
import { generateClusters, LightweightImage } from '../services/clusteringEngine';

describe('clustering engine', () => {
  it('keeps low-threshold clustering behavior for zero-overlap pairs in the same bucket', async () => {
    const images: LightweightImage[] = [
      {
        id: 'a',
        lastModified: 1,
        prompt: 'aaaaaaaaab aaaaaaaaac',
      },
      {
        id: 'b',
        lastModified: 2,
        prompt: 'aaaaaaaaad aaaaaaaaae',
      },
      {
        id: 'bridge',
        lastModified: 3,
        prompt: 'aaaaaaaaab aaaaaaaaac aaaaaaaaad aaaaaaaaae',
      },
    ];

    const clusters = await generateClusters(images, { threshold: 0.33 });

    expect(clusters).toHaveLength(1);
    expect(clusters[0].imageIds).toEqual(['a', 'b', 'bridge']);
  });
});
