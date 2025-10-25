import pkg from 'exifr';
const { parse } = pkg;

async function parsePNGMetadata(buffer) {
  const view = new DataView(buffer);
  let offset = 8;
  const decoder = new TextDecoder();
  const chunks = {};

  // OPTIMIZATION: Stop early if we found all needed chunks
  let foundChunks = 0;
  const maxChunks = 5; // invokeai_metadata, parameters, workflow, prompt, Description

  while (offset < view.byteLength && foundChunks < maxChunks) {
    const length = view.getUint32(offset);
    const type = decoder.decode(buffer.slice(offset + 4, offset + 8));

    if (type === 'tEXt') {
      const chunkData = buffer.slice(offset + 8, offset + 8 + length);
      const chunkString = decoder.decode(chunkData);
      const [keyword, text] = chunkString.split('\0');

      if (['invokeai_metadata', 'parameters', 'Parameters', 'workflow', 'prompt', 'Description'].includes(keyword) && text) {
        chunks[keyword.toLowerCase()] = text;
        foundChunks++;
      }
    } else if (type === 'iTXt') {
      const chunkData = new Uint8Array(buffer.slice(offset + 8, offset + 8 + length));
      const keywordEndIndex = chunkData.indexOf(0);
      if (keywordEndIndex === -1) {
        offset += 12 + length;
        continue;
      }
      const keyword = decoder.decode(chunkData.slice(0, keywordEndIndex));

      if (['invokeai_metadata', 'parameters', 'Parameters', 'workflow', 'prompt', 'Description'].includes(keyword)) {
        const compressionFlag = chunkData[keywordEndIndex + 1];
        if (compressionFlag === 0) {
          // 0 -> uncompressed, which is what we expect from A1111
          let currentIndex = keywordEndIndex + 3; // Skip null separator, compression flag, and method

          const langTagEndIndex = chunkData.indexOf(0, currentIndex);
          if (langTagEndIndex === -1) {
            offset += 12 + length;
            continue;
          }
          currentIndex = langTagEndIndex + 1;

          const translatedKwEndIndex = chunkData.indexOf(0, currentIndex);
          if (translatedKwEndIndex === -1) {
            offset += 12 + length;
            continue;
          }
          currentIndex = translatedKwEndIndex + 1;

          const text = decoder.decode(chunkData.slice(currentIndex));
          chunks[keyword] = text;
          foundChunks++;
        }
      }
    }
    if (type === 'IEND') break;
    offset += 12 + length;
  }

  // Prioritize workflow for ComfyUI, then parameters for A1111, then InvokeAI
  if (chunks.workflow) {
    const comfyMetadata = {};
    if (chunks.workflow) comfyMetadata.workflow = chunks.workflow;
    if (chunks.prompt) comfyMetadata.prompt = chunks.prompt;
    return comfyMetadata;
  } else if (chunks.parameters || chunks.description) {
    return { parameters: chunks.parameters || chunks.description };
  } else if (chunks.invokeai_metadata) {
    return JSON.parse(chunks.invokeai_metadata);
  } else if (chunks.prompt) {
    return { prompt: chunks.prompt };
  }

  // Always try to extract EXIF/XMP data from PNG (many modern apps like Draw Things use XMP)
  try {
    const exifResult = await parseJPEGMetadata(buffer);
    if (exifResult) {
      return exifResult;
    }
  } catch {
    // Silent error - EXIF extraction may fail
  }

  return null;
}

async function parseJPEGMetadata(buffer) {
  try {
    // Extract EXIF data with UserComment and XMP support
    const exifData = await parse(buffer, {
      userComment: true,
      xmp: true,
      mergeOutput: true,
      sanitize: false,
      reviveValues: true
    });

    if (!exifData) return null;

    // Check all possible field names for UserComment (A1111 and SwarmUI store metadata here in JPEGs)
    // Also check XMP Description for Draw Things and other XMP-based metadata
    let metadataText =
      exifData.UserComment ||
      exifData.userComment ||
      exifData['User Comment'] ||
      exifData.ImageDescription ||
      exifData.Parameters ||
      exifData.Description || // XMP Description
      null;

    if (!metadataText) return null;

    // Convert Uint8Array to string if needed (exifr returns UserComment as Uint8Array)
    if (metadataText instanceof Uint8Array) {
      metadataText = new TextDecoder().decode(metadataText);
    }

    // Remove null bytes that sometimes appear at the end
    if (typeof metadataText === 'string') {
      metadataText = metadataText.replace(/\0/g, '');
    }

    // Try to parse as JSON first (InvokeAI, ComfyUI workflow)
    try {
      const parsed = JSON.parse(metadataText);
      return parsed;
    } catch {
      // If not JSON, treat as parameters string (A1111, SwarmUI)
      return { parameters: metadataText };
    }
  } catch (error) {
    console.warn('Error parsing JPEG metadata:', error);
    return null;
  }
}

export async function parseFile(fileData, relativePath) {
  // Ensure we have an ArrayBuffer
  let buffer;
  if (fileData instanceof ArrayBuffer) {
    buffer = fileData;
  } else if (fileData instanceof Buffer) {
    buffer = fileData.buffer.slice(fileData.byteOffset, fileData.byteOffset + fileData.byteLength);
  } else {
    throw new Error('fileData must be an ArrayBuffer or Buffer');
  }

  const view = new DataView(buffer);

  let metadata = null;

  // Check PNG signature
  if (view.getUint32(0) === 0x89504E47 && view.getUint32(4) === 0x0D0A1A0A) {
    metadata = await parsePNGMetadata(buffer);
  }
  // Check JPEG signature
  else if (view.getUint16(0) === 0xFFD8) {
    metadata = await parseJPEGMetadata(buffer);
  }

  return {
    metadataString: metadata ? JSON.stringify(metadata) : null,
    metadata
  };
}