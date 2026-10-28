import { useCallback, useMemo } from 'react';
import { useImageStore } from '../store/useImageStore';
import { buildBoardAssetLookup, resolveBoardAsset } from '../services/boards/assetResolver';
import type { BoardAssetObject } from '../services/boards/types';

export function useBoardAssets(loading: boolean) {
  const images = useImageStore(state => state.images);
  const directories = useImageStore(state => state.directories);
  const lookup = useMemo(() => buildBoardAssetLookup(images, directories), [images, directories]);
  const resolve = useCallback((object: BoardAssetObject) => resolveBoardAsset(object.reference, lookup, loading), [lookup, loading]);
  return { images, directories, resolve };
}
