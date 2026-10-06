import type { CivitaiModelMetadata, ModelInspectorItem } from './types';

export type ModelCivitaiLookupResult =
  | { status: 'found'; metadata: CivitaiModelMetadata }
  | { status: 'notFound' }
  | { status: 'unavailable' };

export async function fetchCivitaiInfoWithIdentity({
  item,
  ensureSha256,
  fetchByHash,
  now = Date.now,
}: {
  item: ModelInspectorItem;
  ensureSha256: () => Promise<ModelInspectorItem | null>;
  fetchByHash: (sha256: string) => Promise<ModelCivitaiLookupResult>;
  now?: () => number;
}): Promise<ModelInspectorItem | null> {
  const identifiedItem = item.location.sha256 ? item : await ensureSha256();
  const sha256 = identifiedItem?.location.sha256;
  if (!identifiedItem || !sha256) return null;
  const result = await fetchByHash(sha256);
  if (result.status === 'unavailable') throw new Error('Civitai is unavailable. Try again later.');
  return {
    ...identifiedItem,
    location: {
      ...identifiedItem.location,
      civitai: result.status === 'found'
        ? result.metadata
        : { status: 'notFound', fetchedAt: now(), url: '' },
    },
  };
}
