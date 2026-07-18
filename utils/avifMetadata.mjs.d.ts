export const AVIF_MIME_TYPE: 'image/avif';
export const COMFYUI_XMP_NAMESPACE: 'https://github.com/Comfy-Org/ComfyUI';
export const PIXELMETA_XMP_NAMESPACE: 'https://ai-foundry.dev/ns/pixelmeta/1.0/';
export const IMAGE_METAHUB_XMP_NAMESPACE: 'https://github.com/LuqP2/Image-MetaHub';

export interface AvifCarrierConflict {
  field: 'prompt' | 'workflow';
  canonicalSource: string;
  conflictingSource: string;
}

export interface AvifRawMetadata extends Record<string, unknown> {
  _carrierFormat: 'avif';
  prompt?: string;
  workflow?: string;
  parameters?: string;
  imagemetahub_data?: Record<string, unknown>;
  imagemetahub_extension?: Record<string, unknown>;
  _carrierConflicts?: AvifCarrierConflict[];
}

export interface AvifMetadataParseResult {
  rawMetadata: AvifRawMetadata | null;
  dimensions: { width: number; height: number } | null;
  metadataTruncated: boolean;
  xmpNamespaces: string[];
  errors: string[];
}

export function isAvifBuffer(input: ArrayBuffer | ArrayBufferView): boolean;
export function getAvifDimensions(input: ArrayBuffer | ArrayBufferView): { width: number; height: number } | null;
export function parseAvifMetadata(input: ArrayBuffer | ArrayBufferView): Promise<AvifMetadataParseResult>;
export function rewriteAvifMetadata(
  input: ArrayBuffer | ArrayBufferView,
  update: {
    extension: Record<string, unknown>;
  },
): ArrayBuffer;
export function stripAvifMetadata(input: ArrayBuffer | ArrayBufferView): ArrayBuffer;
