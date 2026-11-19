import type { Directory, IndexedImage } from '../types';
import { getElectronAbsoluteMediaPath } from './mediaSourceCache';

/** Viewer-only directory records; external files never become library roots. */
export function getComparisonDirectories(images: IndexedImage[], directories: Directory[]): Omit<Directory, 'handle'>[] {
  const result = new Map(directories.filter(directory => images.some(image => image.directoryId === directory.id))
    .map(({ handle: _handle, ...directory }) => [directory.id, directory]));
  for (const image of images) {
    if (!image.directoryId || result.has(image.directoryId)) continue;
    const path = getElectronAbsoluteMediaPath(image)?.replace(/\\/g, '/');
    if (!path) continue;
    const directoryPath = path.slice(0, path.lastIndexOf('/') + 1);
    if (directoryPath) result.set(image.directoryId, { id: image.directoryId, name: directoryPath, path: directoryPath, transient: true });
  }
  return [...result.values()];
}
