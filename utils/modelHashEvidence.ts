export const normalizeModelName = (value: string) => value.split(/[\\/]/).pop()!.replace(/\.safetensors$/i, '').toLowerCase().trim().replace(/[\s_.-]+/g, '_');
export const fullModelHash = (value: unknown): string | undefined => typeof value === 'string' && /^[a-f\d]{64}$/i.test(value.trim()) ? value.trim().toLowerCase() : undefined;

const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

// Keep only identity evidence when large raw payloads are compacted. Never read
// parametersPreview: it may contain prompt text or a truncated sampling line.
export function readModelHashEvidence(metadata: unknown): { modelHash?: string; loraHashes: Record<string, string> } {
  const raw = record(metadata);
  const retained = record(raw._modelHashEvidence);
  const loraHashes: Record<string, string> = Object.create(null);
  for (const [name, value] of Object.entries(record(retained.loraHashes))) {
    const hash = fullModelHash(value);
    if (hash) loraHashes[normalizeModelName(name)] = hash;
  }
  const parameters = typeof raw.parameters === 'string' ? raw.parameters : '';
  const sampling = parameters.split(/\r?\n/).reverse().find((line) => /^Steps:\s*\d/.test(line)) ?? '';
  const rawModelHash = fullModelHash(sampling.match(/(?:^|,)\s*Model hash:\s*([a-f\d]+)(?=\s*(?:,|$))/i)?.[1]);
  for (const entry of (sampling.match(/(?:^|,)\s*Lora hashes:\s*"([^"]*)"/i)?.[1] ?? '').split(',')) {
    const match = entry.match(/^\s*(.+):\s*([a-f\d]{64})\s*$/i);
    if (match) loraHashes[normalizeModelName(match[1])] = match[2].toLowerCase();
  }
  let hashFields: Record<string, unknown> = {};
  try { hashFields = record(JSON.parse(sampling.match(/(?:^|,)\s*Hashes:\s*(\{[^}]*\})/i)?.[1] ?? '{}')); } catch { /* Incomplete exports have no usable hash evidence. */ }
  for (const [name, value] of Object.entries(hashFields)) {
    const hash = fullModelHash(value);
    if (name.startsWith('lora:') && hash) loraHashes[normalizeModelName(name.slice(5))] = hash;
  }
  const modelHash = fullModelHash(record(raw.imagemetahub_data).model_hash) ?? rawModelHash ?? fullModelHash(hashFields.model) ?? fullModelHash(retained.modelHash);
  return { modelHash, loraHashes };
}
