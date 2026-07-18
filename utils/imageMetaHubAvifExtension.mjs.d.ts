export const IMAGE_METAHUB_AVIF_EXTENSION_VERSION: 1;

export interface ImageMetaHubAvifExtension extends Record<string, unknown> {
  version: 1;
  source_generator?: string;
  tags?: string[];
  notes?: string;
  attribution?: Record<string, unknown>;
  analytics?: Record<string, unknown>;
  lineage?: Record<string, unknown>;
}

export interface AvifCarrierConflict {
  field: 'prompt' | 'workflow';
  canonicalSource: string;
  conflictingSource: string;
}

export function buildImageMetaHubAvifExtension(
  metadata: Record<string, unknown> | null | undefined,
): ImageMetaHubAvifExtension;

export function applyImageMetaHubAvifExtension(
  metadata: Record<string, unknown> | null | undefined,
  extensionValue: unknown,
): Record<string, unknown> | null;

export function getAvifCarrierConflicts(metadata: unknown): AvifCarrierConflict[];
