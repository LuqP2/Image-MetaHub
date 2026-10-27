import { describe, expect, it } from 'vitest';
import { boardMediaType, buildBoardAssetLookup, createBoardAssetReference, resolveBoardAsset, resolveLiveBoardImage } from '../services/boards/assetResolver';
import { boardDirectory, boardImage } from './helpers/boardIntegrationFixtures';

describe('board asset resolution', () => {
  it('rechecks stable identity if a filename was reused while adding assets', () => {
    const original = boardImage('a.png', { assetId: crypto.randomUUID() });
    const replacement = { ...original, assetId: crypto.randomUUID() };
    const moved = { ...original, id: 'root::moved.png' };
    expect(resolveLiveBoardImage(original, [replacement, moved])).toBe(moved);
    expect(() => resolveLiveBoardImage(original, [replacement])).toThrow('Select it again');
  });
  it('resolves live stable assets after a move and treats multiple locations as ambiguous', () => {
    const image = boardImage('a.png', { assetId: crypto.randomUUID(), revisionId: crypto.randomUUID(), provenanceLocationId: crypto.randomUUID(), provenanceRootId: crypto.randomUUID() });
    const reference = createBoardAssetReference(image, [boardDirectory], ['old-operation']);
    expect(reference.kind).toBe('stable');
    const moved = { ...image, id: 'root::moved.png', name: 'moved.png', provenanceLocationId: crypto.randomUUID() };
    expect(resolveBoardAsset(reference, buildBoardAssetLookup([moved], [boardDirectory]))).toEqual({ status: 'resolved', image: moved });
    expect(resolveBoardAsset(reference, buildBoardAssetLookup([moved, { ...moved, id: 'root::copy.png', provenanceLocationId: crypto.randomUUID() }], [boardDirectory]))).toEqual({ status: 'ambiguous' });
    expect(resolveBoardAsset(reference, buildBoardAssetLookup([image, moved], [boardDirectory]))).toEqual({ status: 'resolved', image });
    expect(reference.appliedRemapIds).toEqual(['old-operation']);
  });
  it('never guesses by filename or deletes a reference while the library is loading', () => {
    const reference = createBoardAssetReference(boardImage(), [boardDirectory]);
    const lookup = buildBoardAssetLookup([boardImage('a.png', { id: 'other::a.png', directoryId: 'other' })], [{ ...boardDirectory, id: 'other', path: 'C:/other' }]);
    expect(resolveBoardAsset(reference, lookup, true)).toEqual({ status: 'loading' });
    expect(resolveBoardAsset(reference, lookup)).toEqual({ status: 'missing' });
    expect(resolveBoardAsset(reference, buildBoardAssetLookup([boardImage('a.png', { id: 'new-root::a.png', directoryId: 'new-root' })], [{ ...boardDirectory, id: 'new-root' }])).status).toBe('resolved');
  });
  it('uses complete identities only and classifies all supported media', () => {
    expect(createBoardAssetReference(boardImage('a.png', { assetId: crypto.randomUUID() }), [boardDirectory]).kind).toBe('path');
    expect(['a.png', 'clip.mp4', 'music.wav', 'model.glb'].map(name => boardMediaType(boardImage(name)))).toEqual(['image', 'video', 'audio', 'model3d']);
  });
});
