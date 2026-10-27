import type { Directory, IndexedImage } from '../../types';
export const boardDirectory = { id: 'root', path: 'C:/synthetic', name: 'Synthetic' } as Directory;
export function boardImage(name = 'a.png', patch: Partial<IndexedImage> = {}): IndexedImage {
  return { id: `root::${name}`, directoryId: 'root', name, handle: { name } as FileSystemFileHandle,
    metadata: {} as IndexedImage['metadata'], metadataString: '', lastModified: 1, models: [], loras: [], scheduler: '', ...patch };
}
