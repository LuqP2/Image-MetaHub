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

The ComfyUI parser is the most complex metadata parser in the project. It uses a **rule-based, declarative architecture** to handle ComfyUI's graph-based workflow format.

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

3. **Node Registry** (`nodeRegistry.ts`)
   - Declarative node definitions with roles, inputs, outputs, and parameter mappings
   - See `services/parsers/comfyui/DEVELOPMENT.md` for complete reference

**Adding New ComfyUI Nodes:**

1. Add node definition to `nodeRegistry.ts`:

```typescript
'NodeTypeName': {
  category: 'SAMPLING' | 'LOADING' | 'CONDITIONING' | 'ROUTING',
  roles: ['SOURCE', 'SINK', 'TRANSFORM', 'PASS_THROUGH'],
  inputs: { input_name: { type: 'MODEL' | 'CONDITIONING' | ... } },
  outputs: { output_name: { type: 'MODEL' | 'CONDITIONING' | ... } },
  param_mapping: {
    steps: { source: 'widget', key: 'steps' },      // Extract from widgets_values
    seed: { source: 'trace', input: 'seed' },        // Follow connection
    lora: { source: 'custom_extractor', extractor: fn } // Custom logic
  },
  widget_order: ['widget1', 'widget2', ...]  // CRITICAL: Must match PNG export order
}
```

2. **widget_order is CRITICAL**: The array must match the exact sequence in embedded PNG `widgets_values` data. Mismatches cause value swapping bugs (e.g., steps=0, cfg=28 instead of steps=28, cfg=3).

3. Add tests in `__tests__/comfyui/` with real workflow fixtures

4. Verify with actual ComfyUI PNG exports

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
