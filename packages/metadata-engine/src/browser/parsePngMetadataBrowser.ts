import type { ImageMetadata, ComfyUIMetadata } from '../core/types';

const PNG_CHUNK_TYPE_tEXt = 0x74455874;
const PNG_CHUNK_TYPE_iTXt = 0x69545874;
const PNG_CHUNK_TYPE_IEND = 0x49454e44;
const PNG_RELEVANT_TEXT_KEYS = new Set([
  'invokeai_metadata',
  'parameters',
  'workflow',
  'prompt',
  'description',
  'imagemetahub_data',
]);

export function isPngSignature(buffer: ArrayBuffer): boolean {
  if (buffer.byteLength < 8) return false;
  const view = new DataView(buffer);
  return view.getUint32(0) === 0x89504e47 && view.getUint32(4) === 0x0d0a1a0a;
}

function readPngTextKeyword(
  chunkData: Uint8Array,
  decoder: TextDecoder
): { keyword: string; keywordEndIndex: number } | null {
  const keywordEndIndex = chunkData.indexOf(0);
  if (keywordEndIndex === -1) {
    return null;
  }

  return {
    keyword: decoder.decode(chunkData.subarray(0, keywordEndIndex)),
    keywordEndIndex,
  };
}

// Decode iTXt text payload (uncompressed or deflate-compressed). Browser-only:
// relies on the native DecompressionStream API (supported in all evergreen browsers).
async function decodeITXtText(
  data: Uint8Array,
  compressionFlag: number,
  decoder: TextDecoder
): Promise<string> {
  if (compressionFlag === 0) {
    return decoder.decode(data);
  }

  if (compressionFlag === 1) {
    try {
      const arrayCopy = new Uint8Array(data.byteLength);
      arrayCopy.set(data);
      const ds = new DecompressionStream('deflate');
      const decompressedStream = new Blob([arrayCopy.buffer]).stream().pipeThrough(ds);
      const decompressedBuffer = await new Response(decompressedStream).arrayBuffer();
      return decoder.decode(decompressedBuffer);
    } catch {
      return '';
    }
  }

  return '';
}

/**
 * Walk a PNG's tEXt/iTXt chunks and return the raw generator metadata payload.
 * Mirrors the parsing rules used by the desktop app (services/fileIndexer.ts),
 * scoped to PNG-embedded generator metadata only (no EXIF/XMP fallback, no
 * Easy Diffusion sidecar JSON — those require filesystem access this module
 * doesn't have).
 */
export async function parsePNGMetadata(buffer: ArrayBuffer): Promise<ImageMetadata | null> {
  const view = new DataView(buffer);
  let offset = 8;
  const decoder = new TextDecoder();
  const chunks: Record<string, string> = {};
  let foundChunks = 0;
  const maxChunks = 6; // invokeai_metadata, parameters, workflow, prompt, description, imagemetahub_data

  while (offset < view.byteLength && foundChunks < maxChunks) {
    if (offset + 8 > view.byteLength) break;

    const length = view.getUint32(offset, false);
    const type = view.getUint32(offset + 4, false);
    if (offset + 12 + length > view.byteLength) break;

    if (type === PNG_CHUNK_TYPE_tEXt) {
      const chunkData = new Uint8Array(buffer, offset + 8, length);
      const keywordInfo = readPngTextKeyword(chunkData, decoder);
      if (keywordInfo) {
        const keyword = keywordInfo.keyword.toLowerCase();
        if (PNG_RELEVANT_TEXT_KEYS.has(keyword) && keywordInfo.keywordEndIndex + 1 < chunkData.length) {
          const text = decoder.decode(chunkData.subarray(keywordInfo.keywordEndIndex + 1));
          if (text) {
            if (keyword === 'imagemetahub_data') {
              try {
                return { imagemetahub_data: JSON.parse(text) } as ImageMetadata;
              } catch {
                // fall through to other chunks/parsers
              }
            } else {
              chunks[keyword] = text;
              foundChunks++;
            }
          }
        }
      }
    } else if (type === PNG_CHUNK_TYPE_iTXt) {
      const chunkData = new Uint8Array(buffer, offset + 8, length);
      const keywordInfo = readPngTextKeyword(chunkData, decoder);
      if (keywordInfo && PNG_RELEVANT_TEXT_KEYS.has(keywordInfo.keyword.toLowerCase())) {
        const keyword = keywordInfo.keyword.toLowerCase();
        const compressionFlag = chunkData[keywordInfo.keywordEndIndex + 1];
        let currentIndex = keywordInfo.keywordEndIndex + 3; // null separator, compression flag, method

        const langTagEndIndex = chunkData.indexOf(0, currentIndex);
        if (langTagEndIndex !== -1) {
          currentIndex = langTagEndIndex + 1;
          const translatedKwEndIndex = chunkData.indexOf(0, currentIndex);
          if (translatedKwEndIndex !== -1) {
            currentIndex = translatedKwEndIndex + 1;
            const text = await decodeITXtText(chunkData.slice(currentIndex), compressionFlag, decoder);
            if (text) {
              if (keyword === 'imagemetahub_data') {
                try {
                  return { imagemetahub_data: JSON.parse(text) } as ImageMetadata;
                } catch {
                  // fall through
                }
              } else {
                chunks[keyword] = text;
                foundChunks++;
              }
            }
          }
        }
      }
    }

    if (type === PNG_CHUNK_TYPE_IEND) break;
    offset += 12 + length;
  }

  if (chunks.imagemetahub_data) {
    try {
      return { imagemetahub_data: JSON.parse(chunks.imagemetahub_data) } as ImageMetadata;
    } catch {
      // fall through to other chunks
    }
  }

  if (chunks.workflow) {
    const comfyMetadata: ComfyUIMetadata = { workflow: chunks.workflow };
    if (chunks.prompt) comfyMetadata.prompt = chunks.prompt;
    return comfyMetadata as ImageMetadata;
  }

  if (chunks.parameters || chunks.description) {
    return { parameters: chunks.parameters || chunks.description } as ImageMetadata;
  }

  if (chunks.invokeai_metadata) {
    try {
      return JSON.parse(chunks.invokeai_metadata) as ImageMetadata;
    } catch {
      return null;
    }
  }

  if (chunks.prompt) {
    return { prompt: chunks.prompt } as ImageMetadata;
  }

  return null;
}
