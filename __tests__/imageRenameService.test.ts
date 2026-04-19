import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IndexedImage } from '../types';
import { buildRenamedRelativePath, getRenameBasename, renameIndexedImage } from '../services/imageRenameService';
import { FileOperations } from '../services/fileOperations';
import { useImageStore } from '../store/useImageStore';

vi.mock('../services/folderSelectionStorage', () => ({
  loadSelectedFolders: vi.fn().mockResolvedValue([]),
  saveSelectedFolders: vi.fn().mockResolvedValue(undefined),
  loadExcludedFolders: vi.fn().mockResolvedValue([]),
  saveExcludedFolders: vi.fn().mockResolvedValue(undefined),
}));

const image = {
  id: 'dir::nested/old-name.png',
  name: 'nested/old-name.png',
} as any;

const createImage = (id: string, name: string): IndexedImage => ({
  id,
  name,
  handle: { name: name.split('/').pop() || name } as FileSystemFileHandle,
  metadata: {} as any,
  metadataString: '',
  lastModified: 1,
  models: [],
  loras: [],
  scheduler: '',
  directoryId: 'dir',
});

describe('imageRenameService', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useImageStore.getState().resetState();
  });

  it('preserves the current subfolder and extension', () => {
    expect(getRenameBasename(image)).toBe('old-name');
    expect(buildRenamedRelativePath(image, 'new-name')).toBe('nested/new-name.png');
  });

  it('trims the requested name before building the renamed path', () => {
    expect(buildRenamedRelativePath(image, '  new-name  ')).toBe('nested/new-name.png');
  });

  it('rejects indexed filename collisions before touching the filesystem', async () => {
    const source = createImage('dir::old.png', 'old.png');
    const existingTarget = createImage('dir::target.png', 'target.png');
    const renameSpy = vi.spyOn(FileOperations, 'renameFile').mockResolvedValue({ success: true });
    useImageStore.setState({
      images: [source, existingTarget],
      filteredImages: [source, existingTarget],
    } as any);

    const result = await renameIndexedImage(source, 'target');

    expect(result.success).toBe(false);
    expect(result.error).toBe('An image with that filename already exists in this folder.');
    expect(renameSpy).not.toHaveBeenCalled();
    expect(useImageStore.getState().images.map((entry) => entry.id)).toEqual(['dir::old.png', 'dir::target.png']);
  });
});
