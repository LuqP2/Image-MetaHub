import type { BaseMetadata, ImageMetadata } from '../core/types';
import { parseImageMetadata } from '../parsers';
import { isPngSignature, parsePNGMetadata } from './parsePngMetadataBrowser';

export type ParseAiImageMetadataResult =
  | { ok: true; raw: ImageMetadata; normalized: BaseMetadata | null }
  | { ok: false; error: 'unsupported-format' | 'no-metadata-found' };

/**
 * Browser entry point: parse AI generator metadata out of a PNG File/Blob
 * fully client-side (no upload, no filesystem access). PNG only — JPEG/EXIF
 * formats (Midjourney, DALL-E, Adobe Firefly) are out of scope here.
 */
export async function parseAiImageMetadata(file: File | Blob): Promise<ParseAiImageMetadataResult> {
  const buffer = await file.arrayBuffer();

  if (!isPngSignature(buffer)) {
    return { ok: false, error: 'unsupported-format' };
  }

  const raw = await parsePNGMetadata(buffer);
  if (!raw) {
    return { ok: false, error: 'no-metadata-found' };
  }

  const normalized = await parseImageMetadata(raw, buffer);
  return { ok: true, raw, normalized };
}
