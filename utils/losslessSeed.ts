import type { IndexedImage } from '../types';

/** Read only authoritative integer text; an unsafe Number cannot recover its original digits. */
export function readLosslessSeed(metadata: unknown, numericSeed?: number | null): string | null {
  const record = metadata && typeof metadata === 'object' ? metadata as Record<string, unknown> : {};
  const normalized = record.normalizedMetadata && typeof record.normalizedMetadata === 'object'
    ? record.normalizedMetadata as Record<string, unknown> : {};
  const original = typeof normalized.seedExact === 'string' ? normalized.seedExact
    : typeof normalized.seed === 'string' ? normalized.seed
    : typeof record.parameters === 'string' ? record.parameters.match(/(?:^|[,\n])\s*Seed:\s*(-?\d+)(?=\s*(?:,|$))/i)?.[1] : undefined;
  if (original && /^-?\d+$/.test(original.trim())
    && (numericSeed == null || Number(original) === numericSeed)) {
    // Canonicalize integer text without passing through Number (including leading zeros).
    return BigInt(original.trim()).toString();
  }
  return typeof numericSeed === 'number' && Number.isSafeInteger(numericSeed) ? String(numericSeed) : null;
}

export function getImageSeedExact(image: IndexedImage): string | null {
  return readLosslessSeed(image.metadata, image.seed);
}
