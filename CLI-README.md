# Image MetaHub CLI

Command-line tool for parsing AI-generated image metadata.

## Installation

```bash
npm install -g image-metahub
```

Or run directly with `npx`:

```bash
npx image-metahub parse image.png --json
```

## Commands

### Parse Single File

Parse metadata from a single PNG file:

```bash
imagemetahub-cli parse image.png --json
```

**Options:**
- `--json` - Output as JSON (default: true)
- `--pretty` - Pretty-print JSON output

**Example Output:**
```json
{
  "file": "/path/to/image.png",
  "format": "comfyui",
  "metadata": {
    "prompt": "beautiful landscape, mountains, sunset",
    "negativePrompt": "blurry, low quality",
    "seed": 12345,
    "steps": 20,
    "cfg": 8,
    "sampler_name": "euler",
    "model": "sd_xl_base_1.0.safetensors",
    "loras": [
      { "name": "style_lora_v1.safetensors", "weight": 0.8 }
    ],
    "_telemetry": {
      "detection_method": "standard",
      "unknown_nodes_count": 0,
      "warnings": []
    }
  },
  "parsed_at": "2025-01-12T23:00:00.000Z"
}
```

### Batch Index Directory

Parse all images in a directory and output JSONL index:

```bash
imagemetahub-cli index ./images --out index.jsonl
```

**Options:**
- `--out <file>` - Output JSONL file (default: `index.jsonl`)
- `--recursive` - Scan subdirectories recursively

**Example Output (index.jsonl):**
```jsonl
{"file":"/path/image1.png","format":"comfyui","metadata":{...},"parsed_at":"2025-01-12T23:00:00.000Z"}
{"file":"/path/image2.png","format":"invokeai","metadata":{...},"parsed_at":"2025-01-12T23:00:00.000Z"}
{"file":"/path/image3.png","format":"automatic1111","metadata":{...},"parsed_at":"2025-01-12T23:00:00.000Z"}
```

## Use Cases

### 1. Quick Metadata Inspection

```bash
# Check what metadata is embedded in an image
imagemetahub-cli parse suspicious-image.png --json --pretty
```

### 2. Batch Processing for ML Pipelines

```bash
# Index all training images for a dataset
imagemetahub-cli index ./training_data --recursive --out dataset_metadata.jsonl

# Filter images by specific criteria
cat dataset_metadata.jsonl | jq 'select(.metadata.steps > 50)'
```

### 3. Workflow Analysis

```bash
# Find all images using a specific LoRA
cat index.jsonl | jq 'select(.metadata.loras[]? | .name == "style_lora_v1.safetensors")'

# Find all ComfyUI workflows with unknown nodes
cat index.jsonl | jq 'select(.metadata._telemetry.unknown_nodes_count > 0)'
```

### 4. Model/LoRA Audit

```bash
# List all models used in a collection
cat index.jsonl | jq -r '.metadata.model' | sort -u

# List all LoRAs with usage count
cat index.jsonl | jq -r '.metadata.loras[]?.name' | sort | uniq -c | sort -rn
```

## Supported Formats

- **ComfyUI** - Full workflow parsing with Phase 1, 2, 3 enhancements
- **InvokeAI** - Complete metadata extraction
- **Automatic1111** - PNG and JPEG support
- **Forge** - A1111-compatible with hires parameters
- **Easy Diffusion** - Sidecar JSON and embedded metadata
- **SwarmUI** - sui_image_params structure
- **Midjourney** - Parameter extraction from PNG
- **DALL-E 3** - C2PA/EXIF metadata
- **Adobe Firefly** - C2PA Content Credentials
- **DreamStudio** - Stability AI formats
- **Niji Journey** - Anime-focused parameters
- **Draw Things** - iOS/Mac AI app metadata

## Development

Run from source:

```bash
npm run cli:parse -- image.png --json --pretty
npm run cli:index -- ./images --out index.jsonl
```

## Troubleshooting

**Q: CLI command not found after global install?**

A: Ensure npm global bin is in your PATH:
```bash
npm config get prefix
# Add <prefix>/bin to your PATH
```

**Q: Getting "Unknown format" for my images?**

A: Use `--json --pretty` to inspect raw metadata and check if format is supported. Open an issue with sample workflow if needed.

**Q: Batch indexing is slow?**

A: This is expected for large collections. The parser processes ~85 images/second. For 10,000 images, expect ~2 minutes.

## Contributing

See [COMFYUI-PARSER-GUIDE.md](./COMFYUI-PARSER-GUIDE.md) for:
- How to add new node types
- Common failure modes
- Testing guidelines

## License

MIT
