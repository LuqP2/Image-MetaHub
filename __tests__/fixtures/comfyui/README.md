# ComfyUI Test Fixtures

This directory contains PNG fixtures for testing the ComfyUI metadata parser.

## Fixture Coverage

1. **basic-ksampler.json** - Simple KSampler workflow with standard parameters
2. **compressed-payload.json** - Base64 + zlib compressed workflow data
3. **multi-node-prompt.json** - Multiple CLIPTextEncode nodes concatenated
4. **lora-workflow.json** - LoraLoader with weight parameters
5. **controlnet-workflow.json** - ControlNet with preprocessor and strength
6. **batch-output.json** - SaveImage with batch processing
7. **grouped-workflow.json** - Grouped nodes (workflow>Node Name format)
8. **hex-seed.json** - Workflow with hex seed format (0xabc123)
9. **derived-seed.json** - Workflow with random/derived seed
10. **model-hash.json** - Workflow with model hash instead of name
11. **edit-history.json** - Workflow with LoadImage/SaveImage history
12. **version-metadata.json** - Workflow with ComfyUI version info

## Usage

Tests load these fixtures using `fs.readFileSync()` and pass them to the parser.
Each fixture has a corresponding assertion set in `comfyui-parser.test.ts`.
