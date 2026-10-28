import { describe, expect, it } from 'vitest';
import { searchBoardAssets } from '../services/boards/assetSearch';
import { boardImage } from './helpers/boardIntegrationFixtures';
describe('board asset search', () => {
  it('shares deterministic text semantics and keeps filtering independent of library state', () => {
    const alpha = boardImage('alpha.png', { prompt: 'cinematic portrait', models: ['Flux'], lastModified: 1 });
    const beta = boardImage('beta.mp4', { prompt: 'ocean', directoryId: 'other', lastModified: 3 });
    const images = [alpha, beta];
    expect(searchBoardAssets(images, 'CINEMATIC Flux', '', '')).toEqual([alpha]);
    expect(searchBoardAssets(images, 'alpha', '', '')).toEqual([alpha]);
    expect(searchBoardAssets(images, '', 'root', 'video')).toEqual([]);
    expect(searchBoardAssets(images, '', '', 'video')).toEqual([beta]);
    expect(images).toEqual([alpha, beta]);
  });
});
