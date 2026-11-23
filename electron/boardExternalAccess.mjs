import fs from 'node:fs';
import path from 'node:path';
import { isModel3DFileName, isSupportedMediaFileName } from '../utils/mediaTypes.js';

const MODEL_RESOURCE_EXTENSION = /\.(?:png|jpe?g|webp|gif|bmp|tga|ktx2?|dds|bin|mtl)$/i;

const increment = (map, key) => { map.set(key, (map.get(key) ?? 0) + 1); };
const decrement = (map, key) => {
  const next = (map.get(key) ?? 0) - 1;
  if (next <= 0) map.delete(key);
  else map.set(key, next);
};

/** Board-scoped read-only capability for individual Canvas files, independent of library roots. */
export function createBoardExternalAccess() {
  const boards = new Map();
  const canonical = value => fs.realpathSync(value);
  const normalizeBoardId = boardId => {
    if (typeof boardId !== 'string' || !boardId.trim()) throw new Error('A board identifier is required.');
    return boardId.trim();
  };
  const getOrCreateBoard = boardId => {
    let entry = boards.get(boardId);
    if (!entry) {
      entry = { files: new Map(), sidecars: new Map(), modelRoots: new Map() };
      boards.set(boardId, entry);
    }
    return entry;
  };
  const removeGrant = (boardId, board, file, grant) => {
    board.files.delete(file);
    for (const sidecar of grant.sidecars) decrement(board.sidecars, sidecar);
    if (grant.modelRoot) decrement(board.modelRoots, grant.modelRoot);
    if (board.files.size === 0) boards.delete(boardId);
  };
  return {
    authorize(boardId, value) {
      const id = normalizeBoardId(boardId);
      if (typeof value !== 'string' || !path.isAbsolute(value) || !isSupportedMediaFileName(value)) throw new Error('Choose a supported media file.');
      const file = canonical(value);
      if (!fs.statSync(file).isFile()) throw new Error('Drag files rather than folders.');
      const board = getOrCreateBoard(id);
      const existing = board.files.get(file);
      if (existing) {
        existing.count += 1;
        return file;
      }
      const sidecars = [];
      for (const candidate of [`${file}.json`, file.replace(/\.[^.]+$/, '.json')]) {
        try {
          const resolved = canonical(candidate);
          if (!sidecars.includes(resolved)) sidecars.push(resolved);
        } catch { /* Optional sidecar. */ }
      }
      // Models can reference sibling textures, MTL and binary buffers.
      const modelRoot = isModel3DFileName(file) ? path.dirname(file) : null;
      board.files.set(file, { count: 1, sidecars, modelRoot });
      for (const sidecar of sidecars) increment(board.sidecars, sidecar);
      if (modelRoot) increment(board.modelRoots, modelRoot);
      return file;
    },
    revoke(boardId, value) {
      if (typeof boardId !== 'string' || !boardId.trim() || typeof value !== 'string' || !value) return;
      const id = boardId.trim();
      const board = boards.get(id);
      if (!board) return;
      let file;
      try { file = canonical(value); } catch { file = path.resolve(value); }
      const grant = board.files.get(file);
      if (!grant) return;
      grant.count -= 1;
      if (grant.count <= 0) removeGrant(id, board, file, grant);
    },
    revokeBoard(boardId) {
      if (typeof boardId !== 'string' || !boardId.trim()) return;
      boards.delete(boardId.trim());
    },
    hasGrant(boardId, value) {
      if (typeof boardId !== 'string' || !boardId.trim() || typeof value !== 'string' || !value) return false;
      const board = boards.get(boardId.trim());
      if (!board) return false;
      const resolved = path.resolve(value);
      if (board.files.has(resolved) || board.sidecars.has(resolved)) return true;
      try {
        const file = canonical(value);
        return board.files.has(file) || board.sidecars.has(file);
      } catch { return false; }
    },
    allows(boardId, value) {
      if (typeof boardId !== 'string' || !boardId.trim() || typeof value !== 'string' || !value) return false;
      const board = boards.get(boardId.trim());
      if (!board) return false;
      try {
        const file = canonical(value);
        if (board.files.has(file) || board.sidecars.has(file)) return true;
        if (!MODEL_RESOURCE_EXTENSION.test(file)) return false;
        return [...board.modelRoots.keys()].some(root => {
          const relative = path.relative(root, file);
          return relative && !relative.startsWith('..') && !path.isAbsolute(relative);
        });
      } catch { return false; }
    },
  };
}
