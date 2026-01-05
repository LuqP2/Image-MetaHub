# @image-metahub/metadata-engine

Parse AI-generated image metadata from 15+ formats including ComfyUI, InvokeAI, Automatic1111, DALL-E, Adobe Firefly, and more.

## Features

- 🚀 **Fast and lightweight** - Optimized for performance with large image collections
- 📦 **Minimal dependencies** - Only `exifr` for JPEG EXIF parsing
- 🔍 **15+ AI generators supported** - ComfyUI, InvokeAI, A1111, Midjourney, DALL-E, and more
- 💪 **Full TypeScript support** - Complete type definitions and type guards
- 🧪 **Battle-tested** - Used in production by Image MetaHub desktop app
- 📄 **JSONL export** - Batch processing with structured output
- 🔧 **Works in Node.js 16+** - Modern JavaScript with ESM and CJS support

## Supported Formats

| Generator | Detection | Notes |
|-----------|-----------|-------|
| **ComfyUI** | ✅ Graph traversal | Full workflow parsing with node registry |
| **InvokeAI** | ✅ JSON metadata | Supports boards, VAE, and workflow data |
| **Automatic1111** | ✅ Text parsing | Includes Civitai resources |
| **Forge** | ✅ Text parsing | SD WebUI Forge variant |
| **SD.Next** | ✅ Text parsing | Automatic1111 fork |
| **SwarmUI** | ✅ JSON + text | sui_image_params detection |
| **Easy Diffusion** | ✅ Sidecar JSON | JSON sidecar file support |
| **Midjourney** | ✅ Prompt flags | --v, --ar, --q, --s detection |
| **Niji Journey** | ✅ --niji flag | Anime-focused variant |
| **DALL-E 3** | ✅ C2PA/EXIF | Content credentials support |
| **Adobe Firefly** | ✅ C2PA/EXIF | Adobe AI metadata |
| **DreamStudio** | ✅ Text parsing | Stability AI format |
| **Draw Things** | ✅ iOS/Mac app | XMP data parsing |
| **Fooocus** | ✅ Flux support | Distilled CFG Scale detection |

## Installation

```bash
npm install @image-metahub/metadata-engine
```

## Quick Start

### Parse a Single Image

```typescript
import { parseImageFile } from '@image-metahub/metadata-engine';

const result = await parseImageFile('/path/to/image.png');

console.log(result.metadata?.generator);  // "ComfyUI"
console.log(result.metadata?.prompt);     // "beautiful landscape..."
console.log(result.metadata?.model);      // "sd_xl_base_1.0.safetensors"
console.log(result.sha256);               // "abc123..."
console.log(result.dimensions);           // { width: 1024, height: 768 }
```

### Batch Processing

```typescript
import { parseFiles } from '@image-metahub/metadata-engine';

const files = [
  '/path/to/image1.png',
  '/path/to/image2.jpg',
  '/path/to/image3.png'
];

const results = await parseFiles(files);

results.forEach(result => {
  if (result.metadata) {
    console.log(`${result.file}: ${result.metadata.generator}`);
  }
});
```

### Type Guards

```typescript
import {
  parseImageFile,
  isComfyUIMetadata,
  isInvokeAIMetadata
} from '@image-metahub/metadata-engine';

const result = await parseImageFile('/path/to/comfy.png');

if (result.rawMetadata && isComfyUIMetadata(result.rawMetadata)) {
  // TypeScript knows this is ComfyUIMetadata
  console.log(result.rawMetadata.workflow);
  console.log(result.rawMetadata.prompt);
}
```

### Advanced: Direct Parser Access

```typescript
import { getMetadataParser } from '@image-metahub/metadata-engine';

const rawMetadata = { /* your metadata object */ };
const parser = getMetadataParser(rawMetadata);

if (parser) {
  const normalized = parser.parse(rawMetadata);
  console.log(`Generator: ${parser.generator}`);
  console.log(`Prompt: ${normalized.prompt}`);
}
```

## API Reference

### `parseImageFile(filePath: string): Promise<MetadataEngineResult>`

Parses a single image file and returns normalized metadata.

**Parameters:**
- `filePath` (string): Absolute path to the image file (PNG, JPEG)

**Returns:** `MetadataEngineResult` with:
- `file` (string): Absolute file path
- `sha256` (string): SHA-256 hash of file contents
- `rawMetadata` (ImageMetadata | null): Raw metadata as extracted from file
- `metadata` (BaseMetadata | null): Normalized metadata
- `dimensions` ({ width, height } | null): Image dimensions
- `rawSource` ('png' | 'jpeg' | 'sidecar' | 'unknown'): Metadata source
- `errors` (string[]): Parsing errors, if any
- `schema_version` (string): Metadata schema version
- `_telemetry` (object): Performance metrics

### `parseFiles(filePaths: string[]): Promise<MetadataEngineResult[]>`

Batch processes multiple image files.

**Parameters:**
- `filePaths` (string[]): Array of absolute file paths

**Returns:** Array of `MetadataEngineResult` objects

### Type Guards

- `isInvokeAIMetadata(metadata)` - Check if metadata is InvokeAI format
- `isComfyUIMetadata(metadata)` - Check if metadata is ComfyUI format
- `isAutomatic1111Metadata(metadata)` - Check if metadata is A1111 format
- `isSwarmUIMetadata(metadata)` - Check if metadata is SwarmUI format
- `isEasyDiffusionMetadata(metadata)` - Check if metadata is Easy Diffusion format
- `isMidjourneyMetadata(metadata)` - Check if metadata is Midjourney format
- `isDalleMetadata(metadata)` - Check if metadata is DALL-E format
- `isFireflyMetadata(metadata)` - Check if metadata is Adobe Firefly format
- And more...

## BaseMetadata Schema

All metadata is normalized to this common schema:

```typescript
interface BaseMetadata {
  prompt: string;
  negativePrompt?: string;
  model: string;
  models?: string[];
  width: number;
  height: number;
  seed?: number;
  steps: number;
  cfg_scale?: number;
  scheduler: string;
  sampler?: string;
  loras?: string[];
  generator?: string;
  version?: string;
  [key: string]: any;  // Additional generator-specific fields
}
```

## Schema Version

Current schema: `1.0.0`

The schema version is included in every `MetadataEngineResult` and can be imported:

```typescript
import { SCHEMA_VERSION } from '@image-metahub/metadata-engine';
console.log(SCHEMA_VERSION);  // "1.0.0"
```

## Metadata Sources

The engine reads metadata from multiple sources:

1. **PNG chunks** (tEXt, iTXt, zTXt)
   - `invokeai_metadata` - InvokeAI JSON
   - `parameters` - A1111-style text
   - `workflow` + `prompt` - ComfyUI graph data
   - `Description` - General description field

2. **JPEG EXIF/XMP**
   - `UserComment` - Text metadata
   - `ImageDescription` - Description field
   - `Parameters` - Parameter string
   - XMP data for advanced formats

3. **Sidecar JSON files**
   - `.json` files next to images (Easy Diffusion)

4. **C2PA manifests**
   - Content credentials (DALL-E 3, Adobe Firefly)

## Performance

- **Single file parsing:** ~5-20ms per image (depending on complexity)
- **Batch processing:** Processes hundreds of images per second
- **Memory efficient:** Streams file reading, minimal memory footprint
- **SHA-256 hashing:** Included for deduplication

## Requirements

- Node.js 16.0.0 or higher
- Supports ESM and CommonJS

## License

Apache-2.0

## Repository

https://github.com/LuqP2/image-metahub/tree/main/packages/metadata-engine

## Related Projects

- [Image MetaHub](https://github.com/LuqP2/image-metahub) - Desktop app using this engine
- Issues and contributions welcome!

## Examples

### Extract all LoRAs from a directory

```typescript
import { parseFiles } from '@image-metahub/metadata-engine';
import { readdir } from 'fs/promises';
import { join } from 'path';

const dir = '/path/to/images';
const files = (await readdir(dir))
  .filter(f => f.endsWith('.png') || f.endsWith('.jpg'))
  .map(f => join(dir, f));

const results = await parseFiles(files);
const allLoras = new Set<string>();

results.forEach(r => {
  r.metadata?.loras?.forEach(lora => allLoras.add(lora));
});

console.log('Unique LoRAs found:', Array.from(allLoras));
```

### Generate JSONL index

```typescript
import { parseFiles } from '@image-metahub/metadata-engine';
import { writeFile } from 'fs/promises';

const files = [/* your file paths */];
const results = await parseFiles(files);

const jsonl = results
  .map(r => JSON.stringify(r))
  .join('\n');

await writeFile('index.jsonl', jsonl);
```

### Filter by generator

```typescript
import { parseFiles, isComfyUIMetadata } from '@image-metahub/metadata-engine';

const results = await parseFiles(files);

const comfyImages = results.filter(r =>
  r.metadata?.generator === 'ComfyUI' ||
  (r.rawMetadata && isComfyUIMetadata(r.rawMetadata))
);

console.log(`Found ${comfyImages.length} ComfyUI images`);
```

## Contributing

Contributions welcome! Please:

1. Add tests for new parsers
2. Update this README with new supported formats
3. Follow existing code style
4. Ensure `npm run build` and `npm test` pass

## Credits

Built by the [Image MetaHub](https://github.com/LuqP2/image-metahub) team.

Special thanks to the AI image generation community for format documentation.
