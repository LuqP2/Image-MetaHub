import type { IndexedImage } from '../../types';
import { associateReferences, buildModelDescriptors, imageModelReferences, modelAssociationStrength, type ModelAssociation } from './imageAssociations';
import type { ModelCatalog, ModelUsageSummary } from './types';

export function emptyModelUsage(status: ModelUsageSummary['status']): ModelUsageSummary {
  return { status, confirmedCount: 0, nameMatchedCount: 0, ambiguousCount: 0, totalCount: 0, lastUsedAt: null, dateBasis: 'libraryFileDate' };
}

/** In-memory inverted indexes: no model reads, persistence, or remote requests. */
export async function deriveModelUsage(images: IndexedImage[], catalog: ModelCatalog, partial: boolean, superseded: () => boolean = () => false): Promise<Record<string, ModelUsageSummary> | null> {
  const descriptors = buildModelDescriptors(catalog);
  const byName = new Map<string, Set<number>>();
  const byHash = new Map<string, Set<number>>();
  const summaries = descriptors.map((model) => emptyModelUsage(!model.supported ? 'unsupported' : partial ? 'partial' : 'ready'));
  descriptors.forEach((model, index) => {
    for (const name of model.names) { const entries = byName.get(name.key) ?? new Set<number>(); entries.add(index); byName.set(name.key, entries); }
    if (model.sha256) { const entries = byHash.get(model.sha256) ?? new Set<number>(); entries.add(index); byHash.set(model.sha256, entries); }
  });
  const evidence = descriptors.map(() => new Map<string, ModelAssociation>());
  for (let i = 0; i < images.length; i++) {
    if (i % 500 === 0) { await new Promise<void>((resolve) => setTimeout(resolve, 0)); if (superseded()) return null; }
    const image = images[i];
    const refs = imageModelReferences(image);
    const candidates = new Set<number>();
    for (const ref of refs) { for (const index of byName.get(ref.key) ?? []) candidates.add(index); if (ref.hash) for (const index of byHash.get(ref.hash) ?? []) candidates.add(index); }
    for (const index of candidates) {
      const association = associateReferences(refs, descriptors[index]);
      if (!association) continue;
      const summary = summaries[index];
      const previous = evidence[index].get(image.id);
      if (!previous || modelAssociationStrength[association] > modelAssociationStrength[previous]) {
        if (previous === 'ambiguous') summary.ambiguousCount--;
        else if (previous) { summary.totalCount--; if (previous === 'confirmed') summary.confirmedCount--; else summary.nameMatchedCount--; }
        evidence[index].set(image.id, association);
        if (association === 'ambiguous') summary.ambiguousCount++;
        else { summary.totalCount++; if (association === 'confirmed') summary.confirmedCount++; else summary.nameMatchedCount++; }
      }
      if (association !== 'ambiguous' && Number.isFinite(image.lastModified) && Math.abs(image.lastModified) <= 8.64e15) {
        summary.lastUsedAt = summary.lastUsedAt === null ? image.lastModified : Math.max(summary.lastUsedAt, image.lastModified);
      }
    }
  }
  if (superseded()) return null;
  return Object.fromEntries(descriptors.map((model, index) => [model.identity, summaries[index]]));
}
