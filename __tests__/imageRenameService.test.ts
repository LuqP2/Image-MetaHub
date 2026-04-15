import { describe, expect, it } from 'vitest';
import { buildRenamedRelativePath, getRenameBasename } from '../services/imageRenameService';

const image = {
  id: 'dir::nested/old-name.png',
  name: 'nested/old-name.png',
} as any;

describe('imageRenameService', () => {
  it('preserves the current subfolder and extension', () => {
    expect(getRenameBasename(image)).toBe('old-name');
    expect(buildRenamedRelativePath(image, 'new-name')).toBe('nested/new-name.png');
  });
});
