import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useImageStore } from '../store/useImageStore';

vi.mock('../services/folderSelectionStorage', () => ({
  loadSelectedFolders: vi.fn().mockResolvedValue([]),
  saveSelectedFolders: vi.fn().mockResolvedValue(undefined),
  loadExcludedFolders: vi.fn().mockResolvedValue([]),
  saveExcludedFolders: vi.fn().mockResolvedValue(undefined),
}));

describe('folder selection', () => {
  beforeEach(() => {
    useImageStore.getState().resetState();
  });

  it('keeps a folder selected when clicking it again without a modifier', () => {
    const store = useImageStore.getState();

    store.toggleFolderSelection('/Output', false);
    store.toggleFolderSelection('/Output', false);

    expect(Array.from(useImageStore.getState().selectedFolders)).toEqual(['/Output']);
  });
});
