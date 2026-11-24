import { useBoardStore } from '../store/useBoardStore';
import { loadExternalBoardAsset, type ExternalBoardAssetResolution } from '../services/boards/externalAssets';
import { useCallback, useMemo, useEffect, useState } from 'react';
import { useImageStore } from '../store/useImageStore';
import { buildBoardAssetLookup, resolveBoardAsset } from '../services/boards/assetResolver';
import type { BoardAssetObject } from '../services/boards/types';

export function useBoardAssets(loading: boolean) {
  const images = useImageStore(state => state.images);
  const directories = useImageStore(state => state.directories);
  const boardId = useBoardStore(state => state.activeBoardId);
  const objects = useBoardStore(state => boardId ? state.sessions[boardId]?.document.objects : undefined);
  const references = useMemo(() => objects?.flatMap(object => object.type === 'asset' && object.reference.kind === 'external' ? [object.reference] : []) ?? [], [objects]);
  const key = JSON.stringify(references);
  const [external, setExternal] = useState<Record<string, ExternalBoardAssetResolution>>({});
  const [externalRevision, setExternalRevision] = useState(0);
  const refreshExternalAssets = useCallback(() => setExternalRevision(revision => revision + 1), []);
  useEffect(() => {
    let cancelled = false;
    const refs = JSON.parse(key) as typeof references;
    setExternal({});
    if (!boardId) return () => { cancelled = true; };
    // Sequential parsing keeps large external media drops from spiking memory.
    void (async () => { for (const reference of refs) {
      if (cancelled) return;
      const result = await loadExternalBoardAsset(boardId, reference).catch((): ExternalBoardAssetResolution => ({ status: 'missing' }));
      if (!cancelled) setExternal(current => ({ ...current, [reference.locator.imageId]: result }));
    } })();
    return () => { cancelled = true; };
  }, [boardId, key, externalRevision]);
  const lookup = useMemo(() => buildBoardAssetLookup(images, directories), [images, directories]);
  const resolve = useCallback((object: BoardAssetObject) => {
    if (object.reference.kind !== 'external') return resolveBoardAsset(object.reference, lookup, loading);
    const result = external[object.reference.locator.imageId];
    return result ?? { status: 'loading' as const };
  }, [lookup, loading, external]);
  return { images, directories, resolve, refreshExternalAssets };
}
