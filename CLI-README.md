# Image MetaHub CLI

Command-line tool to extract and normalize AI image metadata (PNG/JPG) into JSON/JSONL for pipelines. Uses the same parser/normalizer as the app (MPL‑2.0 codebase).

## Install locally
```bash
npm install
npx tsx cli.ts parse ./sample.png --pretty
```

## Commands
### Parse one file
```bash
imagemetahub-cli parse image.png --pretty --raw
```
- `--pretty`: pretty-print JSON output  
- `--raw`: include the raw metadata payload found (EXIF/PNG chunks/sidecar)

Example:
```json
{
  "file": "/data/image.png",
  "format": "ComfyUI",
  "raw_source": "png",
  "sha256": "7f2d...",
  "dimensions": { "width": 1024, "height": 1024 },
  "metadata": { "prompt": "...", "model": "sd_xl_base", "sampler": "euler", "steps": 20, "loras": [] },
  "parsed_at": "2025-01-12T23:00:00.000Z",
  "errors": null
}
```

### Index a directory → JSONL
```bash
imagemetahub-cli index ./images --recursive --out index.jsonl --raw
```
Each line in `index.jsonl` is a JSON object:
```jsonl
{"file":"/data/image.png","format":"ComfyUI","sha256":"...","metadata":{...},"parsed_at":"2025-01-12T23:00:00.000Z"}
```

## Docker (recommended for pipelines)
```bash
# Build
docker build -t imagemetahub-cli .

# Recursive index
docker run --rm -v /host/images:/data -v /host/output:/out imagemetahub-cli index /data --out /out/index.jsonl --recursive --raw

# Single parse
docker run --rm -v /host/images:/data imagemetahub-cli parse /data/image.png --pretty
```

## Supported formats (normalized)
- ComfyUI (graph → facts, accumulated LoRAs)
- Automatic1111 / Forge / Fooocus / SD.Next
- InvokeAI
- SwarmUI
- Easy Diffusion (includes sidecar JSON)
- Midjourney / Niji
- DALL-E 3 (C2PA/EXIF)
- Adobe Firefly (C2PA/EXIF)
- DreamStudio
- Draw Things

## Tips
- Use `--raw` to audit the original payload.
- Filter JSONL with `jq`, e.g. `jq 'select(.metadata.model == "sd_xl_base")' index.jsonl`.
- LoRA audit: `jq -r '.metadata.loras[]?.name' index.jsonl | sort | uniq -c`.

## Development
```bash
npm run cli:parse -- ./image.png --pretty --raw
npm run cli:index -- ./images --out index.jsonl --recursive
```

## License
The app and parser code are MPL-2.0; the CLI uses the same codebase. Please keep the MPL notice when redistributing.
