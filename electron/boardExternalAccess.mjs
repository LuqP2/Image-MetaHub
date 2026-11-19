import fs from 'node:fs';
import path from 'node:path';
import { isModel3DFileName, isSupportedMediaFileName } from '../utils/mediaTypes.js';

/** Read-only capability for individual Canvas files, independent of library roots. */
export function createBoardExternalAccess() {
  const files = new Set();
  const modelRoots = new Set();
  const canonical = value => fs.realpathSync(value);
  return {
    authorize(value) {
      if (typeof value !== 'string' || !path.isAbsolute(value) || !isSupportedMediaFileName(value)) throw new Error('Choose a supported media file.');
      const file = canonical(value);
      if (!fs.statSync(file).isFile()) throw new Error('Drag files rather than folders.');
      files.add(file);
      // Models can reference sibling textures, MTL and binary buffers.
      if (isModel3DFileName(file)) modelRoots.add(path.dirname(file));
      for (const sidecar of [`${file}.json`, file.replace(/\.[^.]+$/, '.json')]) { try { files.add(canonical(sidecar)); } catch { /* Optional sidecar. */ } }
      return file;
    },
    allows(value) {
      try {
        const file = canonical(value);
        if (files.has(file)) return true;
        if (!/\.(?:png|jpe?g|webp|gif|bmp|tga|ktx2?|dds|bin|mtl)$/i.test(file)) return false;
        return [...modelRoots].some(root => { const relative = path.relative(root, file); return relative && !relative.startsWith('..') && !path.isAbsolute(relative); });
      } catch { return false; }
    },
  };
}
