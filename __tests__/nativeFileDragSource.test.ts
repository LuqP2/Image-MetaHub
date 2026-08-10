import { describe, expect, it } from 'vitest';
import { dropMatchesNativeDragSource } from '../components/DirectoryList';

type DragSource = { directoryPath: string; relativePath: string; imageId?: string };

const source: DragSource = {
  directoryPath: 'D:/library',
  relativePath: 'renders/portrait.png',
  imageId: 'library::renders/portrait.png',
};

const makeDropEvent = (types: string[], fileNames: string[]) => ({
  dataTransfer: {
    types,
    files: fileNames.map((name) => ({ name })),
  },
}) as unknown as Parameters<typeof dropMatchesNativeDragSource>[0];

describe('native file drag source gating', () => {
  it('accepts the drop that carries the dragged file', () => {
    expect(dropMatchesNativeDragSource(makeDropEvent(['Files'], ['portrait.png']), source)).toBe(true);
  });

  it('matches the dragged file case-insensitively among several dropped files', () => {
    expect(
      dropMatchesNativeDragSource(makeDropEvent(['Files'], ['other.png', 'PORTRAIT.PNG']), source)
    ).toBe(true);
  });

  // The regression this guards: a recorded drag stays around for a while, and an
  // unrelated file dropped from Explorer/Finder must never move the dragged image.
  it('rejects a drop carrying a different file', () => {
    expect(dropMatchesNativeDragSource(makeDropEvent(['Files'], ['unrelated.png']), source)).toBe(false);
  });

  it('rejects drops without OS files', () => {
    expect(dropMatchesNativeDragSource(makeDropEvent(['text/plain'], []), source)).toBe(false);
    expect(dropMatchesNativeDragSource(makeDropEvent(['Files'], []), source)).toBe(false);
  });

  it('rejects a source without a usable filename', () => {
    expect(
      dropMatchesNativeDragSource(makeDropEvent(['Files'], ['portrait.png']), {
        directoryPath: 'D:/library',
        relativePath: '',
      })
    ).toBe(false);
  });
});
