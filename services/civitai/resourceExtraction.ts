/**
 * Extracts model/checkpoint and LoRA references from raw image metadata so they
 * can be linked to Civitai on demand. A reference is resolvable either by hash
 * (A1111 `Model hash:`/`Hashes:`, InvokeAI blake3) or directly by Civitai model
 * version id (A1111 `Civitai resources:` JSON, written by Civitai/MetaHub).
 *
 * Extraction only reads already-parsed raw metadata (no network). The actual
 * Civitai lookup happens on click — see services/civitai/civitaiLookup.ts.
 */

export type ResourceType = 'checkpoint' | 'lora';

export interface ResourceRef {
  type: ResourceType;
  /** Best-effort label. The hash/versionId is the value that matters. */
  name: string;
  /** Normalized (lowercase) hash for a by-hash lookup. */
  hash?: string;
  /** Civitai model version id, when known directly (no lookup needed to key). */
  modelVersionId?: number;
}

/** A stable key identifying what a ref resolves to (hash or version id). */
export function refKey(ref: ResourceRef): string {
  return ref.hash ? `h:${ref.hash}` : `v:${ref.modelVersionId}`;
}

/** Civitai-indexed hashes are hex; accept truncated AUTOSHA up to full blake3. */
const HEX_HASH = /^[0-9a-f]{8,64}$/;

function normalizeHash(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  // Strip InvokeAI/Civitai algorithm prefixes like "blake3:" / "sha256:".
  const hash = raw.trim().toLowerCase().replace(/^(blake3|sha256|autov\d+):/, '');
  return HEX_HASH.test(hash) ? hash : null;
}

function getParametersString(rawMetadata: unknown): string {
  if (typeof rawMetadata === 'string') return rawMetadata;
  if (rawMetadata && typeof rawMetadata === 'object') {
    const params = (rawMetadata as Record<string, unknown>).parameters;
    if (typeof params === 'string') return params;
  }
  return '';
}

interface ExtractionState {
  out: ResourceRef[];
  /** Ref keys already emitted, to avoid exact duplicates. */
  seenKeys: Set<string>;
  /** Normalized LoRA names already emitted, so a LoRA links once even when
   *  multiple sources (Civitai resources, Hashes, Lora hashes) record it. */
  seenLoraNames: Set<string>;
}

function hasCheckpoint(state: ExtractionState): boolean {
  return state.out.some((r) => r.type === 'checkpoint');
}

function addCheckpoint(state: ExtractionState, ref: Omit<ResourceRef, 'type'>): void {
  if (hasCheckpoint(state)) return;
  const full: ResourceRef = { type: 'checkpoint', ...ref };
  const key = refKey(full);
  if (state.seenKeys.has(key)) return;
  state.out.push(full);
  state.seenKeys.add(key);
}

function addLora(state: ExtractionState, name: string, ref: Omit<ResourceRef, 'type' | 'name'>): void {
  const full: ResourceRef = { type: 'lora', name, ...ref };
  const key = refKey(full);
  const nameKey = normalizeResourceName(name);
  if (state.seenKeys.has(key) || state.seenLoraNames.has(nameKey)) return;
  state.out.push(full);
  state.seenKeys.add(key);
  state.seenLoraNames.add(nameKey);
}

/**
 * A1111 `Civitai resources: [{type, modelVersionId, modelName, ...}]` — written
 * by Civitai/MetaHub. Carries the model version id directly (highest priority).
 */
function extractCivitaiResources(params: string, state: ExtractionState): void {
  const match = params.match(/Civitai resources:\s*(\[[\s\S]*?\])/);
  if (!match) return;

  let resources: unknown;
  try {
    resources = JSON.parse(match[1]);
  } catch {
    return;
  }
  if (!Array.isArray(resources)) return;

  for (const resource of resources) {
    const versionId = resource?.modelVersionId;
    if (typeof versionId !== 'number') continue;
    const name = typeof resource?.modelName === 'string' ? resource.modelName : undefined;

    if (resource?.type === 'checkpoint') {
      addCheckpoint(state, { name: name || 'Model', modelVersionId: versionId });
    } else if (resource?.type === 'lora') {
      addLora(state, name || 'LoRA', { modelVersionId: versionId });
    }
  }
}

/** A1111 `Hashes: {"model": "...", "lora:Name": "..."}` block. */
function extractFromHashesBlock(params: string, state: ExtractionState): void {
  const match = params.match(/Hashes:\s*(\{[\s\S]*?\})/i);
  if (!match) return;

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(match[1]);
  } catch {
    return;
  }
  if (!parsed || typeof parsed !== 'object') return;

  for (const [key, value] of Object.entries(parsed)) {
    const hash = normalizeHash(value);
    if (!hash) continue;
    const lower = key.toLowerCase();
    if (lower === 'model') {
      addCheckpoint(state, { name: 'Model', hash });
    } else if (lower.startsWith('lora:')) {
      addLora(state, key.slice('lora:'.length) || key, { hash });
    }
  }
}

/** A1111 `Lora hashes: "name: hash, name2: hash2"` block. */
function extractFromLoraHashesBlock(params: string, state: ExtractionState): void {
  const block = params.match(/Lora hashes:\s*"([^"]+)"/i)?.[1];
  if (!block) return;

  for (const pair of block.split(',')) {
    const idx = pair.lastIndexOf(':');
    if (idx === -1) continue;
    const name = pair.slice(0, idx).trim();
    const hash = normalizeHash(pair.slice(idx + 1));
    if (!name || !hash) continue;
    addLora(state, name, { hash });
  }
}

/** Standalone `Model hash: xxxx` (A1111/Forge/SDNext) checkpoint fallback. */
function extractCheckpointHashFallback(params: string, state: ExtractionState): void {
  if (hasCheckpoint(state)) return;
  const hash = normalizeHash(params.match(/Model hash:\s*([0-9a-f]+)/i)?.[1]);
  if (!hash) return;
  const name = params.match(/Model:\s*([^,\n]+)/i)?.[1]?.trim() || 'Model';
  addCheckpoint(state, { name, hash });
}

/**
 * InvokeAI native JSON: `model: { name, hash: "blake3:..." }` and
 * `loras: [{ model: { name, hash }, weight }]`.
 */
function extractInvokeAI(rawMetadata: unknown, state: ExtractionState): void {
  if (!rawMetadata || typeof rawMetadata !== 'object') return;
  const raw = rawMetadata as Record<string, unknown>;

  const model = raw.model;
  if (model && typeof model === 'object') {
    const m = model as Record<string, unknown>;
    const hash = normalizeHash(m.hash);
    if (hash) addCheckpoint(state, { name: typeof m.name === 'string' ? m.name : 'Model', hash });
  }

  if (Array.isArray(raw.loras)) {
    for (const entry of raw.loras) {
      const lm = (entry?.model ?? entry) as Record<string, unknown> | undefined;
      const hash = normalizeHash(lm?.hash);
      if (hash) addLora(state, typeof lm?.name === 'string' ? lm.name : 'LoRA', { hash });
    }
  }
}

/**
 * MetaHub Save Node JSON (`imagemetahub_data`). For MetaHub-saved images the
 * indexer keeps only this chunk and drops the A1111 `parameters` string, so the
 * checkpoint hash must come from here: `{ model, model_hash, loras: [...] }`.
 */
function extractMetaHubData(rawMetadata: unknown, state: ExtractionState): void {
  if (!rawMetadata || typeof rawMetadata !== 'object') return;
  const data = (rawMetadata as Record<string, unknown>).imagemetahub_data;
  if (!data || typeof data !== 'object') return;
  const d = data as Record<string, unknown>;

  const modelHash = normalizeHash(d.model_hash);
  if (modelHash) addCheckpoint(state, { name: typeof d.model === 'string' ? d.model : 'Model', hash: modelHash });

  if (Array.isArray(d.loras)) {
    for (const entry of d.loras) {
      const lora = entry as Record<string, unknown> | undefined;
      const hash = normalizeHash(lora?.hash ?? lora?.model_hash);
      if (hash) addLora(state, typeof lora?.name === 'string' ? lora.name : 'LoRA', { hash });
    }
  }
}

/**
 * Extract all checkpoint + LoRA references from raw metadata, deduped.
 * Returns [] when the format carries nothing linkable.
 */
export function extractResourceRefs(rawMetadata: unknown): ResourceRef[] {
  const state: ExtractionState = {
    out: [],
    seenKeys: new Set<string>(),
    seenLoraNames: new Set<string>(),
  };

  const params = getParametersString(rawMetadata);
  if (params) {
    // Civitai resources first: it gives the version id directly.
    extractCivitaiResources(params, state);
    extractFromHashesBlock(params, state);
    extractFromLoraHashesBlock(params, state);
    extractCheckpointHashFallback(params, state);
  }
  extractInvokeAI(rawMetadata, state);
  extractMetaHubData(rawMetadata, state);

  return state.out;
}

/**
 * Normalize a resource name for matching a displayed label against an extracted
 * ref: lowercase, strip directory prefix and file extension.
 */
export function normalizeResourceName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/\\/g, '/')
    .split('/')
    .pop()!
    .replace(/\.(safetensors|ckpt|pt|pth|bin)$/i, '');
}
