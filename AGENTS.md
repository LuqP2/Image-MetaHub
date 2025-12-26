This document provides guidance for AI assistants working on the Image MetaHub codebase.

## Project Overview

Image MetaHub is a desktop application (Electron + React + TypeScript) for browsing, searching, and organizing AI-generated images locally. It focuses on performance with large collections, powerful metadata filtering, and complete privacy.

**Key Technologies:**

- Frontend: React 18 with TypeScript
- Desktop: Electron with auto-updater
- Storage: IndexedDB for caching
- Build: Vite
- Testing: Vitest
- Styling: Tailwind CSS

## Project Structure

```
/
├── App.tsx                 # Main React application component
├── electron.mjs            # Electron main process
├── preload.js             # Electron preload script
├── cli.ts                 # CLI tool for metadata parsing
├── types.ts               # TypeScript type definitions
├── components/            # React components
├── services/              # Business logic services
├── store/                 # Zustand state management
├── utils/                 # Utility functions
├── hooks/                 # Custom React hooks
├── src/                   # Additional source files
├── __tests__/             # Test files
└── public/                # Static assets
```

## Important Documentation

- **README.md**: User-facing documentation and features
- **ARCHITECTURE.md**: Technical architecture and design decisions
- **CHANGELOG.md**: Version history and changes
- **RELEASE-GUIDE.md**: Release workflow for maintainers
- **CLI-README.md**: CLI tool documentation

## Development Workflow

### Running the Project

```bash
# Browser-only development
npm run dev

# Electron app development
npm run dev:app

# With specific directory
npm run dev:app -- --dir "/path/to/images"

# Run tests
npm test

# Build for production
npm run build

# Create distributable
npm run electron-dist
```

### Code Style

- Use TypeScript strict mode
- Follow existing naming conventions
- Use functional React components with hooks
- Prefer explicit typing over `any`
- Keep components focused and single-responsibility

## ComfyUI Parser Architecture

The ComfyUI parser is the most complex metadata parser in the project. It uses a **rule-based, declarative architecture** to handle ComfyUI's graph-based workflow format, recently refactored to separate data extraction from presentation logic.

**Location**: `services/parsers/comfyui/`

**Key Components:**

1. **Graph Construction** (`comfyUIParser.ts`)
   - Merges `workflow` (UI data with widgets_values) and `prompt` (execution data)
   - Handles NaN sanitization and incomplete exports
   - Overlays workflow nodes onto prompt data for complete graph representation

2. **Traversal Engine** (`traversalEngine.ts`)
   - Traverses graph backwards from SINK nodes (like KSampler)
   - Skips muted nodes (mode 2/4)
   - Supports multiple traversal strategies:
     - **Single Path**: For unique parameters (seed)
     - **Multi-Path**: For prompts (explores all paths)
     - **Pass-Through**: For routing nodes
   - **Generic Accumulation**: Uses declarative `accumulate: boolean` flag on param rules instead of hardcoded logic
   - **Structured Output**: `resolveFacts()` returns type-safe `WorkflowFacts` object with prompts, model, loras, sampling, and dimensions

3. **Node Registry** (`nodeRegistry.ts`)
   - Declarative node definitions with roles, inputs, outputs, and parameter mappings
   - **WorkflowFacts Interface**: Structured type for extracted workflow metadata
   - **Accumulate Flag**: Mark parameters that should collect values from all nodes in path (e.g., `lora: { source: 'widget', key: 'lora_name', accumulate: true }`)
   - See `services/parsers/comfyui/DEVELOPMENT.md` for complete reference

4. **Reusable Extractors** (`extractors.ts`)
   - Composable extraction functions for common patterns:
     - `concatTextExtractor`: Concatenate multiple text inputs
     - `extractLorasFromText`: Extract LoRA tags from `<lora:name>` syntax
     - `removeLoraTagsFromText`: Strip LoRA tags from prompts
     - `cleanWildcardText`: Remove unresolved wildcard artifacts
     - `extractLorasFromStack`: Parse LoRA Stack widget arrays
     - `getWildcardOrPopulatedText`: Prioritize populated over template text
   - Reduces code duplication by 80-90% across node definitions

**Adding New ComfyUI Nodes:**

1. Add node definition to `nodeRegistry.ts`:

```typescript
'NodeTypeName': {
  category: 'SAMPLING' | 'LOADING' | 'CONDITIONING' | 'ROUTING',
  roles: ['SOURCE', 'SINK', 'TRANSFORM', 'PASS_THROUGH'],
  inputs: { input_name: { type: 'MODEL' | 'CONDITIONING' | ... } },
  outputs: { output_name: { type: 'MODEL' | 'CONDITIONING' | ... } },
  param_mapping: {
    steps: { source: 'widget', key: 'steps' },              // Extract from widgets_values
    seed: { source: 'trace', input: 'seed' },                // Follow connection
    lora: { source: 'widget', key: 'lora_name', accumulate: true }, // Collect from all nodes
    prompt: {
      source: 'custom_extractor',
      extractor: (node, state, graph, traverse) =>
        extractors.concatTextExtractor(node, state, graph, traverse, ['text1', 'text2'])
    }
  },
  widget_order: ['widget1', 'widget2', ...]  // CRITICAL: Must match PNG export order
}
```

2. **Use Extractors When Possible**: Check `extractors.ts` for reusable functions before writing custom extractors. Common patterns like text concatenation, LoRA extraction, and wildcard cleaning are already implemented.

3. **Accumulate Flag**: For parameters that should collect values from multiple nodes in the graph (like LoRAs), add `accumulate: true` to the param mapping rule. The traversal engine will automatically collect values from all nodes instead of stopping at the first match.

4. **widget_order is CRITICAL**: The array must match the exact sequence in embedded PNG `widgets_values` data. Mismatches cause value swapping bugs (e.g., steps=0, cfg=28 instead of steps=28, cfg=3).

5. Add tests in `__tests__/comfyui/` with real workflow fixtures

6. Verify with actual ComfyUI PNG exports

**Common Issues:**

- **Value Swapping**: Missing `__unknown__` placeholders in `widget_order`
- **Unknown Nodes**: Add logging and fallback behavior in NodeRegistry
- **Missing Prompts**: Check if CLIPTextEncode nodes are properly traced
- **Dimensions**: Always read from image file properties, not workflow settings (images may be upscaled/cropped)

**Testing ComfyUI Parser:**

```bash
# Unit tests for specific nodes
npm test -- comfyui

# Test with real workflows
npm run cli:parse -- path/to/comfyui-image.png
```

For detailed documentation, see `services/parsers/comfyui/DEVELOPMENT.md`.

## Metadata Parsing

The application supports multiple AI image generators:

- InvokeAI
- Automatic1111
- ComfyUI
- SwarmUI
- Easy Diffusion
- Midjourney/Niji Journey
- Forge
- DALL-E
- Adobe Firefly
- DreamStudio
- Draw Things

Metadata sources:

- PNG chunks (tEXt, iTXt, zTXt)
- JPEG EXIF/XMP
- Sidecar JSON files
- C2PA manifests

## Key Features to Maintain

1. **Privacy**: All processing is local, no external connections (except auto-updater and A1111 integration)
2. **Performance**: Optimized for 18,000+ images with smart caching
3. **Metadata Search**: Full-text search across all metadata fields
4. **Multi-Format Support**: Handle various AI generator formats
5. **File Operations**: Rename, delete, export metadata (desktop only)
6. **A1111 Integration**: Send images back to Automatic1111 for editing or regeneration

## A1111 Integration

The application includes bidirectional workflow with Automatic1111 WebUI, allowing users to send image metadata back to A1111 for editing or regeneration.

**Location:** `services/a1111ApiClient.ts`, `hooks/useCopyToA1111.ts`, `hooks/useGenerateWithA1111.ts`, `utils/a1111Formatter.ts`

**Key Components:**

1. **A1111 API Client** (`services/a1111ApiClient.ts`)
   - REST API client for A1111 WebUI
   - Connection testing (`/sdapi/v1/options`)
   - Sampler list fetching with 5-minute cache
   - Fuzzy sampler matching (case-insensitive, removes underscores/spaces)
   - Image generation endpoint (`/sdapi/v1/txt2img`)
   - 3-minute timeout for longer generations

2. **Metadata Formatter** (`utils/a1111Formatter.ts`)
   - Converts `BaseMetadata` to A1111 parseable format
   - Three-line format:
     - Line 1: Positive prompt
     - Line 2: `Negative prompt: [text]` (if exists)
     - Line 3: Comma-separated parameters (Steps, Sampler, CFG, Seed, Size, Model)
   - Compatible with A1111's "Read generation parameters" feature (blue arrow button)

3. **Copy to Clipboard Hook** (`hooks/useCopyToA1111.ts`)
   - Formats metadata and copies to clipboard
   - Toast notification: "Copied! Paste into A1111 prompt box and click the Blue Arrow."
   - Error handling for clipboard API failures
   - Primary workflow for manual parameter editing

4. **Background Generation Hook** (`hooks/useGenerateWithA1111.ts`)
   - Sends metadata directly to A1111 API
   - Always starts generation (`autoStart: true`)
   - Toast notifications for success/failure
   - Secondary workflow for quick image variations

**UI Integration:**

- **ImagePreviewSidebar**: Split button (Copy primary, Generate in dropdown)
- **ImageModal**: Split button (same design)
- **Context Menu**: Two separate items (Copy to A1111, Quick Generate)

**User Workflows:**

1. **Copy for Manual Editing** (Primary):
   - Click "Copy to A1111"
   - Paste (Ctrl+V) into A1111 prompt box
   - Click blue arrow icon ("Read generation parameters")
   - All fields populate automatically
   - User edits parameters before generating

2. **Quick Generate** (Secondary):
   - Click dropdown → "Quick Generate"
   - Image generates immediately in background
   - No UI interaction required on A1111 side

**Configuration:**

Settings in `store/useSettingsStore.ts`:
- `a1111ServerUrl`: Default `http://127.0.0.1:7860`
- `a1111LastConnectionStatus`: Connection state tracking
- Connection test button in Settings modal

**A1111 Setup Requirements:**

User must start A1111 with API flags:
```bash
--api --cors-allow-origins=http://localhost:5173
```

**Common Issues:**

- **CORS errors**: Missing `--cors-allow-origins` flag
- **Connection timeout**: A1111 not running or wrong port
- **Generation timeout**: Increase timeout in `a1111ApiClient.ts` if using slow models
- **Sampler mismatch**: Fuzzy matching handles most cases, but custom samplers may not match

**Testing A1111 Integration:**

```bash
# Start A1111 with API enabled
webui.bat --api --cors-allow-origins=http://localhost:5173

# In app:
# 1. Settings → A1111 Integration → Test Connection
# 2. Open image → Click "Copy to A1111"
# 3. Paste in A1111 → Click blue arrow
# 4. Verify all fields populated correctly
```

## ComfyUI Integration

The application includes bidirectional workflow with ComfyUI, allowing users to generate image variations by sending workflow data to ComfyUI via API. Unlike A1111's polling approach, ComfyUI integration uses real-time WebSocket communication for progress tracking.

**Location:** `services/comfyUIApiClient.ts`, `hooks/useCopyToComfyUI.ts`, `hooks/useGenerateWithComfyUI.ts`, `contexts/ComfyUIProgressContext.tsx`, `utils/telemetryDetection.ts`

**Key Components:**

1. **ComfyUI API Client** (`services/comfyUIApiClient.ts`)
   - REST API client for ComfyUI backend
   - Connection testing (`/system_stats`)
   - WebSocket connection for real-time progress tracking (`ws://127.0.0.1:8188/ws`)
   - Workflow submission endpoint (`POST /prompt`)
   - Image generation with progress callbacks
   - 5-minute timeout for long generations
   - Graceful error handling with connection state tracking

2. **Workflow Builder** (`services/comfyUIApiClient.ts` - `buildWorkflowFromMetadata()`)
   - Converts `BaseMetadata` to simple txt2img ComfyUI workflow
   - **Does NOT attempt to recreate original workflow** - generates minimal working workflow
   - Linear pipeline structure:
     ```
     CheckpointLoader → MetaHub Timer → CLIPTextEncode (positive/negative)
                                       ↓
     EmptyLatent → KSampler → VAEDecode → MetaHub Save Node
     ```
   - **Preserved Parameters:**
     - Positive and negative prompts
     - Model name (checkpoint)
     - Seed, steps, CFG scale
     - Sampler and scheduler
     - Image dimensions (width/height)
   - **MetaHub Timer Node Integration:**
     - Automatically included in generated workflows
     - Records timestamp when it executes
     - Save Node calculates elapsed time from timestamp
     - Ensures accurate `generation_time_ms` and `steps_per_second` metrics
   - **Not Preserved (Advanced Features):**
     - ControlNet inputs and preprocessing
     - Upscalers and high-res fixes
     - Refiner models and switch points
     - Custom node configurations
     - Multi-stage workflows
     - Advanced LoRA configurations beyond basic weights
   - **Approach Rationale:**
     - Reliable generation from any source image (A1111, ComfyUI, Fooocus, etc.)
     - Consistent parameter extraction across different formats
     - Compatibility across different ComfyUI setups and versions
     - Fast workflow execution with minimal overhead
     - No dependency on complex custom nodes

3. **Progress Tracking** (`contexts/ComfyUIProgressContext.tsx`)
   - Real-time WebSocket-based progress tracking (unlike A1111's polling)
   - Context provider wraps entire app (see `index.tsx`)
   - Tracks: current node, total nodes, progress percentage, current image
   - Preview image updates during generation
   - Automatic cleanup on completion/error
   - Connection state management

4. **Copy to Clipboard Hook** (`hooks/useCopyToComfyUI.ts`)
   - Formats metadata as JSON workflow
   - Copies complete workflow to clipboard
   - Toast notification: "Workflow copied! Load it in ComfyUI."
   - Error handling for clipboard API failures
   - Use case: Manual workflow customization in ComfyUI

5. **Background Generation Hook** (`hooks/useGenerateWithComfyUI.ts`)
   - Builds workflow from metadata
   - Sends workflow directly to ComfyUI API via `POST /prompt`
   - Real-time progress tracking via WebSocket
   - Toast notifications for success/failure
   - Generated images automatically saved by MetaHub Save Node with full metadata
   - Modal UI with customizable generation parameters:
     - Seed (randomize or specify)
     - Steps (1-100 range)
     - CFG scale (0-20 range)
     - Prompt editing (positive/negative)
   - Primary workflow for quick image variations

**MetaHub Save Node (Official Companion Node):**

The ComfyUI integration relies on the [MetaHub Save Node](https://github.com/LuqP2/ImageMetaHub-ComfyUI-Save) custom node for complete metadata support.

**Repository:** `d:\ImageMetaHub-ComfyUI-Save` (additional working directory)

**Features:**
- **Auto-Extraction:** Detects sampler params, prompts, model/VAE, and LoRAs directly from workflow
- **Performance Metrics:** Auto-tracks GPU usage, VRAM peak, generation time, and software versions
- **Dual Metadata Format:**
  - PNG tEXt "parameters" (A1111/Civitai compatible)
  - PNG iTXt "imagemetahub_data" (extended JSON with full workflow)
- **Model Hashes:** Calculates SHA256 hashes (AutoV2 format) for models and LoRAs
- **Never Fails:** Silent fallback on errors - generation never stops

**Performance Metrics Structure:**
```json
{
  "_analytics": {
    "vram_peak_mb": 3165.44,           // CUDA GPUs only
    "gpu_device": "NVIDIA GeForce RTX 3060 Ti",
    "generation_time_ms": 1523,        // Requires MetaHub Timer node
    "steps_per_second": 13.2,          // Calculated from time + steps
    "comfyui_version": "0.1.0",        // Can be null (Colab environments)
    "torch_version": "2.6.0+cu124",
    "python_version": "3.10.6"
  }
}
```

**Installation:**
```bash
cd ComfyUI/custom_nodes
git clone https://github.com/LuqP2/ImageMetaHub-ComfyUI-Save.git
cd ImageMetaHub-ComfyUI-Save
pip install -r requirements.txt
```

**Verified Telemetry System:**

The app includes a visual badge and filter system to distinguish images generated with MetaHub Save Node from images saved with default ComfyUI Save Image node.

**Location:** `utils/telemetryDetection.ts`, `components/ImageModal.tsx`, `components/ImagePreviewSidebar.tsx`, `components/AdvancedFilters.tsx`, `store/useImageStore.ts`

**Detection Logic (`hasVerifiedTelemetry()`):**

Images are considered to have "verified telemetry" if they contain:
- **VRAM Peak** (`vram_peak_mb`): Must be number > 0
- **GPU Device** (`gpu_device`): Must be non-empty string
- **Software Versions**: At least one of:
  - `comfyui_version` (can be null for Colab)
  - `torch_version`
  - `python_version`

**Optional Metrics (Not Required):**
- `generation_time_ms`: Only present if MetaHub Timer node in workflow
- `steps_per_second`: Only present if MetaHub Timer node in workflow

**Metadata Field Access Pattern:**
```typescript
// Try both analytics and _analytics (underscore version used in normalizedMetadata)
const analytics = image.metadata?.normalizedMetadata?.analytics ||
                  (image.metadata?.normalizedMetadata as any)?._analytics;
```

**Badge UI Implementation:**

**ImageModal.tsx (lines 592-602):**
```tsx
{hasVerifiedTelemetry(image) && (
  <span
    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-gradient-to-r from-green-500/20 to-emerald-500/20 text-green-400 border border-green-500/30 shadow-sm shadow-green-500/20"
    title="Verified Telemetry - Generated with MetaHub Save Node. Includes accurate performance metrics: generation time, VRAM usage, GPU device, and software versions."
  >
    <CheckCircle size={14} className="flex-shrink-0" />
    <span className="whitespace-nowrap">Verified Telemetry</span>
  </span>
)}
```

**ImagePreviewSidebar.tsx (lines 275-286):**
- Same badge design with shorter text: "Verified" instead of "Verified Telemetry"

**AdvancedFilters.tsx (lines 362-382):**
- Checkbox filter with green styling
- Label: "Verified Telemetry Only (MetaHub Save Node)"
- Explanation text about complete performance metrics

**Filter Implementation (`store/useImageStore.ts`, lines 603-605):**
```typescript
if (advancedFilters.hasVerifiedTelemetry === true) {
  results = results.filter(image => hasVerifiedTelemetry(image));
}
```

**Design Intent:**
- Create "desire for completeness" encouraging users to use MetaHub Save Node
- Visual distinction between images with/without complete metrics
- Easy filtering to find images with verified telemetry data

**UI Integration:**

- **ImagePreviewSidebar**: Split button (Copy to ComfyUI primary, Generate in dropdown)
- **ImageModal**: Split button (same design) + Generate Variation modal
- **ComfyUIGenerateModal**: Full-screen modal with parameter customization
  - Seed input with randomize button
  - Steps slider (1-100)
  - CFG slider (0-20)
  - Positive/negative prompt text areas
  - Real-time progress bar with node tracking
  - Preview image updates during generation

**User Workflows:**

1. **Copy for Manual Editing**:
   - Click "Copy to ComfyUI"
   - Open ComfyUI web interface
   - Load workflow from clipboard (Ctrl+V or Load button)
   - Customize workflow with additional nodes (ControlNet, upscalers, etc.)
   - Generate manually

2. **Quick Generate** (Primary):
   - Click "Generate with ComfyUI" button
   - Modal opens with pre-filled parameters
   - Customize seed, steps, CFG, prompts as needed
   - Click "Generate"
   - Real-time progress tracking via WebSocket
   - Generated image automatically saved by MetaHub Save Node
   - Image includes verified telemetry badge

**Configuration:**

Settings in `store/useSettingsStore.ts`:
- `comfyUIServerUrl`: Default `http://127.0.0.1:8188`
- `comfyUIConnectionStatus`: Connection state tracking ('connected' | 'disconnected' | 'checking')
- Connection test button in Settings modal (tests `/system_stats` endpoint)

**ComfyUI Setup Requirements:**

User must:
1. Install ComfyUI locally
2. Install MetaHub Save Node custom node
3. Install MetaHub Timer node (included with Save Node package)
4. ComfyUI API runs by default on `http://127.0.0.1:8188` (no flags needed)
5. Ensure CORS is configured if using non-default ports

**Common Issues:**

- **Connection timeout**: ComfyUI not running or wrong port
  - Check ComfyUI is running: `http://127.0.0.1:8188` should load web interface
  - Verify port in Settings → ComfyUI Integration

- **"MetaHub Save Node not found" error**: Custom node not installed
  - Clone repo to `ComfyUI/custom_nodes/ImageMetaHub-ComfyUI-Save`
  - Run `pip install -r requirements.txt`
  - Restart ComfyUI

- **Generation works but no verified telemetry badge**: Old workflow without Timer node
  - This is expected for images generated before Timer node was added to workflow builder
  - Badge requires: VRAM, GPU device, software versions (timing metrics optional)
  - Update to latest version for Timer node integration

- **WebSocket connection fails**: CORS or firewall issue
  - Check browser console for WebSocket errors
  - Verify ComfyUI allows WebSocket connections
  - Try disabling browser extensions

- **Workflow fails with "node type not found"**: Model or sampler not available
  - Check that model referenced in metadata exists in `ComfyUI/models/checkpoints/`
  - Workflow builder may fall back to default model if specified model not found

- **Generated images missing LoRAs**: Workflow builder limitation
  - Current implementation preserves basic LoRA info but doesn't include in generated workflow
  - Load generated workflow in ComfyUI and manually add LoRA Loader nodes

- **Images from Google Colab show `comfyui_version: null`**: Expected behavior
  - Colab environments don't report ComfyUI version
  - Detection still works via torch_version and python_version
  - Badge will still appear

**Testing ComfyUI Integration:**

```bash
# Start ComfyUI (default port 8188)
python main.py

# In app:
# 1. Settings → ComfyUI Integration → Test Connection
# 2. Verify "Connected" status
# 3. Open image with metadata → Click "Generate with ComfyUI"
# 4. Customize parameters in modal
# 5. Click Generate and watch real-time progress
# 6. Verify generated image appears with verified telemetry badge
# 7. Check image metadata includes _analytics field with performance metrics

# Test verified telemetry filter:
# 1. Advanced Filters → Check "Verified Telemetry Only"
# 2. Verify only images with MetaHub Save Node metadata appear
# 3. Verify badge appears on all visible images
```

**MetaHub Timer Node Integration:**

Generated workflows automatically include the MetaHub Timer node for accurate timing:
- Placed between CheckpointLoader and CLIPTextEncode nodes
- Records timestamp when it executes
- Save Node calculates elapsed time from this timestamp
- Ensures `generation_time_ms` and `steps_per_second` are populated
- Required for complete verified telemetry (VRAM + GPU device + timing + software versions)

**Workflow Generation vs Original Workflow:**

IMPORTANT: Image MetaHub does NOT attempt to recreate the original workflow used to generate an image. Instead, it:
1. Extracts normalized parameters from metadata (regardless of source: A1111, ComfyUI, Fooocus, etc.)
2. Generates a **minimal txt2img workflow** with those parameters
3. Focuses on core parameters: prompts, model, seed, steps, CFG, sampler, dimensions
4. Omits advanced features like ControlNet, upscalers, refiner models, custom nodes

**Why This Approach:**
- Universal compatibility: works with images from any AI generator
- Consistent behavior: same workflow structure every time
- Reliability: no dependency on custom nodes or complex setups
- Performance: fast execution with minimal overhead
- Starting point: users can load and enhance workflow in ComfyUI if needed

For advanced workflows (ControlNet, upscaling, multi-stage), users should:
1. Use "Copy to ComfyUI" to get basic workflow
2. Load in ComfyUI web interface
3. Manually add advanced nodes (ControlNet, upscaler, etc.)
4. Save custom workflow template for reuse

## Common Tasks

### Adding New Metadata Format Support

1. Add parser in `services/` or `utils/`
2. Update type definitions in `types.ts`
3. Add tests in `__tests__/`
4. Update CLI parser if applicable
5. Document in CHANGELOG.md

### Adding New UI Features

1. Create component in `components/`
2. Add state management in `store/` if needed
3. Update App.tsx to integrate
4. Consider Electron/browser compatibility
5. Test with large collections

### Fixing Performance Issues

1. Check IndexedDB caching logic
2. Review virtual scrolling implementation
3. Profile with large image collections
4. Consider lazy loading and background processing

## Testing Strategy

- Unit tests for parsers and utilities
- Component tests for React components
- Integration tests for metadata extraction
- Manual testing with various AI generator outputs
- Performance testing with 10,000+ images

## Git Workflow

- Main branch: `main`
- Always commit with descriptive messages
- Push to feature branches, not main
- Follow conventional commit style

## Browser vs Desktop Considerations

Some features are desktop-only (Electron):

- File system operations (rename, delete, show in folder)
- Command-line arguments
- Auto-updater
- Native file dialogs

Browser version uses File System Access API with limited capabilities.

## Performance Tips

- Always test with large image collections (10,000+ images)
- Use React.memo() for expensive components
- Implement proper virtualization for lists
- Cache metadata aggressively in IndexedDB
- Process files in background threads when possible

## Common Pitfalls

1. **Metadata Parsing**: Different generators use different formats and field names
2. **File System**: Path handling differs between Windows/macOS/Linux
3. **Memory**: Large images can cause memory issues if not handled properly
4. **Caching**: Invalid cache can cause stale data - include cache versioning
5. **Electron IPC**: Properly handle async communication between main and renderer

## Release Process

This is an Electron desktop app with a robust multi-platform release pipeline combining local scripts and GitHub Actions.

### Versionioning

**Pattern:** Semantic Versioning (SemVer) - `MAJOR.MINOR.PATCH[-PRERELEASE]`

**Files to sync:**
- `package.json` - version field
- `ARCHITECTURE.md` - version field
- Git tags - format `v{VERSION}` (e.g., `v0.9.6`)

**Prerelease Support:**
- Format: `0.9.6-rc`, `1.0.0-beta.1`
- Used for testing before stable releases

### Release Scripts

Three main scripts available in `package.json`:

**1. `npm run auto-release <version>` (Fully Automated - RECOMMENDED)**
```bash
npm run auto-release 0.9.6
```

Executes complete pipeline:
- Runs `npm run build` (compile + test)
- Updates `package.json` version
- Updates `ARCHITECTURE.md` version
- Generates release notes via `generate-release.js`
- Creates git commit with standardized message
- Creates git tag `v{VERSION}`
- Pushes branch and tag to origin
- Waits for GitHub Actions to trigger

**2. `npm run release-workflow <version>` (Automated, No Build)**
```bash
npm run release-workflow 0.9.6
```

Same as above but **skips build step** (safe for pre-tested changes):
- Does NOT run tests/build
- Updates versions and creates tag
- Generates release notes
- Opens GitHub releases page for final manual step

**3. Manual Process** (see RELEASE-GUIDE.md)
```bash
npm version 0.9.6
node generate-release.js 0.9.6
git tag v0.9.6
git push origin main v0.9.6
```

### Git Tags and Triggering Builds

**Tag Creation:**
```bash
git tag v0.9.6           # Create locally
git push origin v0.9.6   # Push to GitHub
```

**GitHub Actions Trigger:**
- `.github/workflows/publish.yml` automatically triggers on any tag matching `v*`
- Builds Windows, macOS, and Linux installers **in parallel**
- Creates draft GitHub Release and uploads all artifacts
- Publishes release (removes draft flag) after all builds complete

**Tag Convention:**
- Always use `v` prefix
- Match version in `package.json` exactly
- Never push tags directly to main branch; push separately

### GitHub Actions Workflow (`publish.yml`)

Three parallel build jobs execute on tag push:

**build-windows** (runs-on: windows-latest)
- Builds Electron app with electron-builder
- Generates Windows installer (`.exe`) and ZIP
- Creates GitHub Release (draft mode)
- Uploads assets and YAML update manifest

**build-macos** (runs-on: macos-latest)
- Builds for macOS
- Generates DMG installer
- Uploads to same GitHub Release

**build-linux** (runs-on: ubuntu-latest)
- Builds for Linux
- Generates AppImage
- Uploads to same GitHub Release

All jobs upload to the **same release draft**, ensuring single unified release with all platforms.

### Release Notes Generation

**Script:** `generate-release.js`

Reads `CHANGELOG.md` and generates `release-v{VERSION}.md` with:
- Changelog content from new version section
- Download links for all platforms (Windows/macOS/Linux)
- System requirements
- Documentation links
- Release date

**CHANGELOG.md Format Requirements:**
```markdown
## [0.9.6] - 2025-11-23

### Fixed
- **Bug title**: Description

### Added
- **Feature title**: Description

### Improved
- **Item**: Technical details
```

Format must match exactly for parser to extract correct section.

### Complete Release Workflow

```
1. PREPARATION
   ├─ Update CHANGELOG.md with new version section
   ├─ Test locally (npm run dev, npm test)
   └─ Verify version consistency

2. TRIGGER RELEASE
   └─ npm run release-workflow 0.9.6
      (or npm run auto-release 0.9.6 to skip manual testing)
      ├─ Updates package.json and ARCHITECTURE.md
      ├─ Generates release-v0.9.6.md
      ├─ Creates git commit
      ├─ Creates git tag v0.9.6
      └─ Pushes to origin (main + tag)

3. GITHUB ACTIONS (publish.yml)
   ├─ Windows build (creates release draft)
   ├─ macOS build (parallel, uploads to draft)
   └─ Linux build (parallel, uploads to draft)

4. FINALIZATION
   ├─ Release published (removes draft flag)
   ├─ All downloads available on GitHub
   └─ Auto-updater detects new version
```

### Auto-Updater (electron-updater)

**Configuration:**
- Provider: GitHub
- Delta updates: Uses `.blockmap` files for efficient downloads
- Settings: Users can disable auto-check in app preferences

**Update Flow:**
1. App checks for updates 3 seconds after startup
2. If new version available, shows dialog with:
   - Version number
   - Changelog preview (400 chars)
   - Link to full release notes
3. User can: Download Now, Download Later, or Skip Version
4. Download proceeds in background
5. After download: Restart app to install

**Skip Version Handling:**
- Users can skip individual versions
- Skipped versions stored in memory (session-based)
- Next manual check or app restart resets

### Multi-Platform Distribution

**Windows:**
- NSIS installer: `ImageMetaHub-Setup-{version}.exe`
- Portable ZIP: `ImageMetaHub-{version}.zip`
- Auto-update manifest: `latest.yml`

**macOS:**
- DMG installer: `ImageMetaHub-{version}.dmg`
- Auto-update manifest: `latest-mac.yml`
- Notarization: Configured in `electron-builder.json`

**Linux:**
- AppImage: `ImageMetaHub-{version}.AppImage`
- Auto-update manifest: `latest-linux.yml`
- One-file deployment (no dependencies)

All artifacts uploaded to GitHub Releases automatically by CI/CD.

### Configuration Files

**`electron-builder.json`**
- Target platforms and formats
- GitHub publish configuration
- Code signing settings
- Update manifest generation

**`.github/workflows/publish.yml`**
- Triggers on `v*` tags
- Build matrix for Windows, macOS, Linux
- Release creation and artifact upload
- Runs: Node.js v22 (fixed version)

**`electron.mjs`**
- Auto-updater initialization
- Update checking and download logic
- Dialog handling with user preferences
- Release notes extraction and formatting

### Cache Invalidation

**Parser Version:**
```javascript
const PARSER_VERSION = 3;
```

Located in `electron.mjs`, used for metadata cache invalidation:
- Increment when parser logic changes significantly
- Forces reprocessing of all cached metadata
- Current version affects ComfyUI parser improvements

### Release Troubleshooting

**GitHub Actions fails to build:**
- Verify tag is pushed to origin (not just created locally)
- Check that `PARSER_VERSION` in electron.mjs is valid
- Ensure `package.json` version matches tag (without `v` prefix)

**Auto-updater not detecting new version:**
- Check that GitHub Release is published (not draft)
- Verify latest.yml was created in Release assets
- Clear IndexedDB cache if testing locally

**Release notes look wrong:**
- Verify CHANGELOG.md uses exact format: `## [VERSION] - YYYY-MM-DD`
- Check section headers: `### Fixed`, `### Added`, `### Improved`
- Run `npm run generate-release VERSION` to test

**Version mismatch across files:**
- Always use `npm run release-workflow` (updates both files)
- Or manually sync: `package.json`, `ARCHITECTURE.md`, git tag
- Check with: `npm run build` before final push

See RELEASE-GUIDE.md and `.github/workflows/publish.yml` for additional details.

## License

Mozilla Public License Version 2.0 (MPL-2.0)

## Support

- GitHub Issues: https://github.com/LuqP2/image-metahub/issues
- Ko-fi: https://ko-fi.com/lucaspierri

---

When working on this codebase:

- Always read existing code before modifying
- Maintain backward compatibility with cached data
- Test with multiple AI generator formats
- Consider performance impact on large collections
- Keep privacy-first approach (no external connections)
- Follow TypeScript best practices
- Write tests for new functionality
