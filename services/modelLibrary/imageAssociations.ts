import type { IndexedImage } from '../../types';
import type { ModelLocation } from './types';

const normalizeName = (value: string) => value.split(/[\\/]/).pop()!.replace(/\.safetensors$/i, '').toLowerCase();
export function modelImageAssociation(image: IndexedImage, location: ModelLocation): 'confirmed' | 'suggested' | null {
  const metadata = image.metadata.normalizedMetadata;
  if (location.sourceKind === 'checkpoint' || location.sourceKind === 'diffusion') {
    const hash = metadata?.model_hash ?? metadata?.modelHash;
    if (typeof hash === 'string' && hash.length === 64 && location.sha256?.toLowerCase() === hash.toLowerCase()) return 'confirmed';
    return image.models.some((name) => normalizeName(name) === normalizeName(location.fileName)) ? 'suggested' : null;
  }
  if (location.sourceKind !== 'lora') return null;
  for (const lora of image.loras) {
    const record = typeof lora === 'string' ? undefined : lora as typeof lora & { hash?: string; sha256?: string };
    const hash = record?.sha256 ?? record?.hash;
    if (typeof hash === 'string' && hash.length === 64 && location.sha256?.toLowerCase() === hash.toLowerCase()) return 'confirmed';
  }
  return image.loras.some((lora) => normalizeName(typeof lora === 'string' ? lora : lora.name || lora.model_name || '') === normalizeName(location.fileName)) ? 'suggested' : null;
}
