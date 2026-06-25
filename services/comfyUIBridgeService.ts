import type {
  ComfyUIBridgeMetadata,
  ComfyUIBridgeWritePayload,
  ComfyUIBridgeWriteResult,
  ImageEditorDocument,
  IndexedImage,
  SourceImageReference,
} from '../types';
import { normalizeImageEditorGenerationPrep, normalizeImageEditorDocument } from './imageEditingService';
import { buildImageSourceReference } from './comfyUIWorkflowBuilder';
import { getRelativeImagePath, splitRelativePath } from '../utils/imagePaths';

const BRIDGE_IMAGE_NAME = 'image.png';
const BRIDGE_MASK_NAME = 'mask.png';

const pad = (value: number) => String(value).padStart(2, '0');

export const createComfyUIBridgeSessionId = (date = new Date(), randomValue = Math.random()): string => {
  const stamp = [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    '_',
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join('');
  const suffix = Math.floor(Math.max(0, Math.min(0.999999, randomValue)) * 0xffffff)
    .toString(16)
    .padStart(6, '0')
    .slice(0, 6);
  return `prep_${stamp}_${suffix}`;
};

export const sanitizeComfyUIBridgeSessionId = (sessionId: string): string => {
  const sanitized = sessionId.trim().replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '');
  return sanitized || createComfyUIBridgeSessionId();
};

const resolveSourcePath = (
  sourceReference: SourceImageReference,
  directoryPath: string | undefined,
  relativePath: string | null,
): string | null => {
  if (sourceReference.absolutePath) {
    return sourceReference.absolutePath;
  }
  if (!directoryPath || !relativePath) {
    return null;
  }
  return `${directoryPath.replace(/[\\/]+$/, '')}/${relativePath.replace(/^[\\/]+/, '')}`;
};

export interface BuildComfyUIBridgeMetadataParams {
  image: IndexedImage;
  editorDocument: ImageEditorDocument;
  hasMask: boolean;
  sessionId: string;
  preparedAt?: string;
  directoryPath?: string;
  sourceImageReference?: SourceImageReference;
}

export const buildComfyUIBridgeMetadata = ({
  image,
  editorDocument,
  hasMask,
  sessionId,
  preparedAt = new Date().toISOString(),
  directoryPath,
  sourceImageReference = buildImageSourceReference(image),
}: BuildComfyUIBridgeMetadataParams): ComfyUIBridgeMetadata => {
  const normalizedDocument = normalizeImageEditorDocument(editorDocument);
  const prep = normalizeImageEditorGenerationPrep(
    normalizedDocument.generationPrep,
    normalizedDocument.canvasDimensions,
  );
  const sourceBounds = prep.sourceBounds;
  const width = normalizedDocument.canvasDimensions.width;
  const height = normalizedDocument.canvasDimensions.height;
  const relativePath = getRelativeImagePath(image);
  const { fileName } = splitRelativePath(relativePath);

  return {
    schema_version: 1,
    app: {
      name: 'Image MetaHub',
      bridge_version: 1,
    },
    session_id: sanitizeComfyUIBridgeSessionId(sessionId),
    prepared_at: preparedAt,
    intent: prep.intent,
    denoise: prep.denoise,
    files: {
      image: {
        name: BRIDGE_IMAGE_NAME,
        width,
        height,
      },
      mask: {
        name: BRIDGE_MASK_NAME,
        available: hasMask,
        width,
        height,
      },
    },
    source: {
      path: resolveSourcePath(sourceImageReference, directoryPath, relativePath),
      name: fileName || image.name,
      id: image.id,
      directory_id: image.directoryId || null,
      relative_path: sourceImageReference.relativePath || relativePath || null,
    },
    lineage: {
      parent_image: sourceImageReference,
    },
    canvas: {
      width,
      height,
      source_bounds: sourceBounds,
      expansion: {
        left: Math.max(0, sourceBounds.x),
        top: Math.max(0, sourceBounds.y),
        right: Math.max(0, width - sourceBounds.x - sourceBounds.width),
        bottom: Math.max(0, height - sourceBounds.y - sourceBounds.height),
      },
    },
    editor: {
      recipe: normalizedDocument.recipe,
      generation_prep: {
        mask_inverted: prep.maskInverted,
        mask_region_count: prep.maskRegions.length,
        mask_stroke_count: prep.maskStrokes.length,
      },
    },
  };
};

export interface SendComfyUIBridgePayloadParams extends BuildComfyUIBridgeMetadataParams {
  bridgeDirectory?: string | null;
  imageBytes: Uint8Array;
  maskBytes?: Uint8Array | null;
}

export const buildComfyUIBridgeWritePayload = ({
  bridgeDirectory,
  imageBytes,
  maskBytes = null,
  ...metadataParams
}: SendComfyUIBridgePayloadParams): ComfyUIBridgeWritePayload => {
  const sessionId = sanitizeComfyUIBridgeSessionId(metadataParams.sessionId);
  const metadata = buildComfyUIBridgeMetadata({
    ...metadataParams,
    sessionId,
    hasMask: Boolean(maskBytes),
  });

  return {
    bridgeDirectory: bridgeDirectory || '',
    sessionId,
    imageBytes,
    maskBytes,
    metadata,
  };
};

export const writeComfyUIBridgePayload = async (
  payload: ComfyUIBridgeWritePayload,
): Promise<ComfyUIBridgeWriteResult> => {
  if (!window.electronAPI?.writeComfyUIBridgePayload) {
    return { success: false, error: 'ComfyUI Bridge is available in the desktop app.' };
  }
  return window.electronAPI.writeComfyUIBridgePayload(payload);
};
