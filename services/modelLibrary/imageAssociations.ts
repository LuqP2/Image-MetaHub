import type { IndexedImage } from '../../types';
import { buildManagedModels } from './catalog';
import type { ManagedModelDescriptor, ModelCatalog, ModelLocation, ModelUsageMode } from './types';

export type ModelAssociation = 'confirmed' | 'suggested' | 'ambiguous';
export const modelAssociationStrength = { ambiguous: 1, suggested: 2, confirmed: 3 };
export const normalizeModelName = (value: string) => value.split(/[\\/]/).pop()!.replace(/\.safetensors$/i, '').toLowerCase().trim().replace(/[\s_.-]+/g, '_');
const fullHash = (value: unknown): string | undefined => typeof value === 'string' && /^[a-f\d]{64}$/i.test(value.trim()) ? value.trim().toLowerCase() : undefined;
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
  // A1111 keeps hashes in its already-loaded parameters rather than the normalized
  // record. Read only the sampling line, so text in a prompt is not identity evidence.
  const raw = image.metadata as unknown as Record<string, unknown>;
  // Indexed MetaHub Save payloads retain the hash even when normalization omits it.
  const metaHubData = raw?.imagemetahub_data;
  const metaHubModelHash = metaHubData && typeof metaHubData === 'object' && !Array.isArray(metaHubData)
    ? fullHash((metaHubData as Record<string, unknown>).model_hash)
    : undefined;
  const parameters = typeof raw?.parameters === 'string' ? raw.parameters : '';
  const sampling = parameters.split(/\r?\n/).reverse().find((line: string) => /^Steps:\s*\d/.test(line)) ?? '';
  const rawModelHash = fullHash(sampling.match(/(?:^|,)\s*Model hash:\s*([a-f\d]+)(?=\s*(?:,|$))/i)?.[1]);
  const loraHashes = new Map<string, string>();
  for (const entry of (sampling.match(/(?:^|,)\s*Lora hashes:\s*"([^"]*)"/i)?.[1] ?? '').split(',')) {
    const match = entry.match(/^\s*(.+):\s*([a-f\d]{64})\s*$/i);
    if (match) loraHashes.set(normalizeModelName(match[1]), match[2].toLowerCase());
  }
  let hashFields: Record<string, unknown> = {};
  try { hashFields = JSON.parse(sampling.match(/(?:^|,)\s*Hashes:\s*(\{[^}]*\})/i)?.[1] ?? '{}'); } catch { /* Incomplete exports have no usable hash evidence. */ }
  for (const [name, value] of Object.entries(hashFields)) if (name.startsWith('lora:') && fullHash(value)) loraHashes.set(normalizeModelName(name.slice(5)), fullHash(value)!);
  const modelHash = fullHash(metadata?.model_hash ?? metadata?.modelHash) ?? metaHubModelHash ?? rawModelHash ?? fullHash(hashFields.model);
  const refs = (image.models ?? []).map((name) => ({ key: key('model', name), hash: modelHash }));
  if (modelHash && !refs.length) refs.push({ key: 'model:', hash: modelHash });
  for (const lora of image.loras ?? []) {
    const record = typeof lora === 'string' ? undefined : lora as typeof lora & { hash?: string; sha256?: string };
    const name = typeof lora === 'string' ? lora : lora.name || lora.model_name || '';
    refs.push({ key: key('lora', name), hash: fullHash(record?.sha256 ?? record?.hash) ?? loraHashes.get(normalizeModelName(name)) });
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
