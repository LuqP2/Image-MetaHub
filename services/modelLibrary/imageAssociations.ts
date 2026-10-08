import type { IndexedImage } from '../../types';
import { fullModelHash as fullHash, normalizeModelName, readModelHashEvidence } from '../../utils/modelHashEvidence';
import { buildManagedModels } from './catalog';
import type { ManagedModelDescriptor, ModelCatalog, ModelLocation, ModelUsageMode } from './types';

export type ModelAssociation = 'confirmed' | 'suggested' | 'ambiguous';
export const modelAssociationStrength = { ambiguous: 1, suggested: 2, confirmed: 3 };
export { normalizeModelName };
const category = (kind: string) => kind === 'checkpoint' || kind === 'diffusion' ? 'model' : kind === 'lora' ? 'lora' : null;
const key = (kind: string, name: string) => `${kind}:${normalizeModelName(name)}`;

export function buildModelDescriptors(catalog: ModelCatalog): ManagedModelDescriptor[] {
  const locations = new Map(catalog.locations.map((location) => [location.id, location]));
  const owners = new Map<string, Set<string>>();
  const descriptors = buildManagedModels(catalog.locations).map((model): ManagedModelDescriptor => {
    const names = new Set<string>();
    for (const id of model.locationIds) {
      const location = locations.get(id)!;
      const kind = category(location.sourceKind);
      if (kind) names.add(key(kind, location.fileName));
    }
    for (const name of names) {
      const entries = owners.get(name) ?? new Set<string>();
      entries.add(model.id); owners.set(name, entries);
    }
    return { identity: model.id, locationIds: model.locationIds, sha256: fullHash(model.sha256), names: [...names].map((key) => ({ key, ambiguous: false, knownHashes: [] })), supported: names.size > 0, mode: 'total' };
  });
  const hashes = new Map<string, string[]>();
  for (const descriptor of descriptors) if (descriptor.sha256) for (const name of descriptor.names) hashes.set(name.key, [...(hashes.get(name.key) ?? []), descriptor.sha256]);
  for (const descriptor of descriptors) for (const name of descriptor.names) {
    name.ambiguous = owners.get(name.key)!.size > 1;
    name.knownHashes = hashes.get(name.key) ?? [];
  }
  return descriptors;
}

export function imageModelReferences(image: IndexedImage): { key: string; hash?: string }[] {
  const metadata = image.metadata?.normalizedMetadata;
  const evidence = readModelHashEvidence(image.metadata);
  const modelHash = fullHash(metadata?.model_hash ?? metadata?.modelHash) ?? evidence.modelHash;
  const refs = (image.models ?? []).map((name) => ({ key: key('model', name), hash: modelHash }));
  if (modelHash && !refs.length) refs.push({ key: 'model:', hash: modelHash });
  for (const lora of image.loras ?? []) {
    const record = typeof lora === 'string' ? undefined : lora as typeof lora & { hash?: string; sha256?: string; model_hash?: string };
    const name = typeof lora === 'string' ? lora : lora.name || lora.model_name || '';
    refs.push({ key: key('lora', name), hash: fullHash(record?.sha256 ?? record?.hash ?? record?.model_hash) ?? evidence.loraHashes[normalizeModelName(name)] });
  }
  return refs;
}

export function associateReferences(refs: ReturnType<typeof imageModelReferences>, descriptor: ManagedModelDescriptor): ModelAssociation | null {
  if (!descriptor.supported) return null;
  let evidence: ModelAssociation | null = null;
  for (const ref of refs) {
    if (ref.hash && descriptor.sha256 === ref.hash && descriptor.names.some((name) => name.key.split(':')[0] === ref.key.split(':')[0])) return 'confirmed';
    const name = descriptor.names.find((name) => name.key === ref.key);
    if (!name || (ref.hash && descriptor.sha256 && ref.hash !== descriptor.sha256)) continue;
    if (ref.hash && name.knownHashes.includes(ref.hash) && ref.hash !== descriptor.sha256) continue;
    if (name.ambiguous) { evidence ??= 'ambiguous'; } else evidence = 'suggested';
  }
  return evidence;
}

export const associationInMode = (association: ModelAssociation | null, mode: ModelUsageMode) => mode === 'confirmed' ? association === 'confirmed' : mode === 'ambiguous' ? association === 'ambiguous' : association === 'confirmed' || association === 'suggested';
const resolved = new WeakMap<IndexedImage[], WeakMap<ManagedModelDescriptor, Set<string>>>();
export function resolveManagedModelImages(images: IndexedImage[], descriptor: ManagedModelDescriptor): Set<string> {
  let cache = resolved.get(images);
  if (!cache) { cache = new WeakMap(); resolved.set(images, cache); }
  let ids = cache.get(descriptor);
  if (!ids) {
    const evidence = new Map<string, ModelAssociation>();
    for (const image of images) {
      const association = associateReferences(imageModelReferences(image), descriptor);
      const previous = evidence.get(image.id);
      if (association && (!previous || modelAssociationStrength[association] > modelAssociationStrength[previous])) evidence.set(image.id, association);
    }
    ids = new Set([...evidence].filter(([, association]) => associationInMode(association, descriptor.mode)).map(([id]) => id));
    cache.set(descriptor, ids);
  }
  return ids;
}

export function modelImageAssociation(image: IndexedImage, location: ModelLocation, catalog: ModelCatalog = { version: 1, locations: [location], updatedAt: 0 }): ModelAssociation | null {
  const descriptor = buildModelDescriptors(catalog).find((model) => model.locationIds.includes(location.id));
  return descriptor ? associateReferences(imageModelReferences(image), descriptor) : null;
}
