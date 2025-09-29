# AI Coding Assistant Instructions for Local Image Browser for InvokeAI

## Project Overview
This is a React + TypeScript + Electron application that provides local browsing and filtering of AI-generated images from InvokeAI. The app runs in both web browsers and as a desktop application, with dual file system APIs for cross-platform compatibility.

## Architecture & Data Flow

### Core Architecture
- **Frontend**: React 18 + TypeScript + Vite build system
- **Desktop**: Electron wrapper with auto-updater
- **Storage**: IndexedDB for client-side caching, localStorage for UI preferences
- **File Access**: File System Access API (browser) + Node.js fs APIs (Electron)

### Key Components
- `App.tsx` - Main application with state management and filtering logic
- `hooks/useImageLoader.ts` - Directory loading and automatic filter extraction
- `components/` - Reusable UI components (ImageGrid, SearchBar, ImageModal, Sidebar, BrowserCompatibilityWarning, etc.)
- `services/` - Business logic (fileIndexer, cacheManager, fileOperations)
- `types.ts` - TypeScript interfaces for InvokeAI metadata and file handles

### Data Flow Patterns
1. **Directory Selection** → Environment detection (browser vs Electron)
2. **File Indexing** → PNG metadata extraction → IndexedDB caching
3. **Automatic Filter Extraction** → Models, LoRAs, and schedulers extracted from loaded images
4. **Search/Filter** → In-memory filtering with word-boundary matching
5. **File Operations** → IPC communication for Electron file management

## Critical Developer Workflows

### Development Commands
```bash
npm run dev              # Start Vite dev server (port 5173)
npm run build            # TypeScript compilation + Vite build
npm run electron-dev     # Run desktop app in development (concurrent with dev server)
npm run electron-pack    # Build desktop installer (all platforms)
npm run electron-dist    # Build desktop installer without publishing
npm run release          # Build + publish release (automated)
npm run generate-release # Generate release notes from CHANGELOG.md
npm run release-workflow # Advanced release workflow script
```

### Environment Detection Pattern
```typescript
// Always check environment before file operations
const isElectron = typeof window !== 'undefined' && window.process && window.process.type;

if (isElectron && window.electronAPI) {
  // Use Electron IPC APIs
  const result = await window.electronAPI.listDirectoryFiles(electronPath);
} else {
  // Use browser File System Access API
  for await (const entry of directoryHandle.values()) {
    // Process files using browser APIs
  }
}
```

### Build Process
- **Development**: `npm run dev` starts Vite server, `npm run electron-dev` runs concurrently
- **Production**: `npm run build` compiles TypeScript and bundles with Vite
- **Desktop**: `npm run electron-pack` creates platform-specific installers
- **Auto-updater**: Integrated with user choice controls (skip, download later, etc.)

## Development Workflow & Best Practices

### Dual Logging System

**Two-Tier Documentation Approach:**

1. **`development-changelog.md`** (Unversioned - Your "Scratch Pad")
   - Daily work log with timestamps
   - Detailed notes, failed attempts, debugging info
   - Iterative development tracking
   - Added to .gitignore - stays local

2. **`DECISIONS.md`** (Versioned - Architectural Record)
   - Major architectural decisions only
   - Summarized conclusions and rationale
   - Permanent project knowledge
   - Committed with code changes

### Workflow Process:

**During Development:**
```bash
# Log everything in your scratch pad
node log-change.js FEATURE "Started implementing favorites system"
node log-change.js FIX "Fixed favorites breaking the app - wrong approach"
node log-change.js FEATURE "Favorites working with IndexedDB + Set approach"
```

**At Session End:**
1. Review `development-changelog.md` for completed work
2. Summarize key decisions in `DECISIONS.md`
3. Commit code + updated `DECISIONS.md`

### Change Logging
**All changes must be logged** in `development-changelog.md` with timestamps and details:

**CRITICAL RULE: NEVER REPLACE EXISTING LOGS**
- ❌ **NEVER** use replace_string_in_file to modify existing log entries
- ❌ **NEVER** delete or remove any existing log entries
- ❌ **NEVER** overwrite or replace log content
- ✅ **ALWAYS** add NEW log entries at the top of the "Recent Changes" section
- ✅ **ALWAYS** preserve the complete chronological history
- ✅ **ALWAYS** keep failed attempts and debugging history for future reference

**Quick Logging:**
```bash
node log-change.js FIX "Fixed clipboard operations in ImageModal"
```

**Manual Logging Format:**
```
[2025-09-20] - FIX Fixed clipboard operations in ImageModal
  Files: components/ImageModal.tsx
  Rationale: Copy prompt and copy metadata functions were failing
  Impact: Right-click context menu now works properly
  Testing: Verified in both browser and Electron environments
```

**When to Log in development-changelog.md:**
- ✅ Code changes (new features, bug fixes, refactoring)
- ✅ Configuration changes
- ✅ Documentation updates
- ✅ Build/deployment changes
- ✅ Performance improvements
- ✅ Error handling improvements
- ✅ **FAILED ATTEMPTS** - document what didn't work for future reference

**When to Log in DECISIONS.md:**
- ✅ Major architectural decisions
- ✅ Technology stack changes
- ✅ Significant refactoring conclusions
- ✅ API design decisions
- ✅ Data structure choices

**Types:** `FEATURE`, `FIX`, `REFACTOR`, `DOCS`, `CONFIG`, `BUILD`, `PERF`

**Why This Approach:**
- **development-changelog.md**: Keeps development history separate from production code
- **DECISIONS.md**: Provides permanent record of architectural decisions
- **Git History**: Clean commits with summarized decisions
- **Collaboration**: New contributors can understand "why" behind decisions

**File Locations:**
- `development-changelog.md` (added to .gitignore - local only)
- `DECISIONS.md` (versioned in Git - permanent record)

### Instructions Maintenance
**CRITICAL: Update this file (.github/copilot-instructions.md) after significant changes**

**When to update copilot-instructions.md:**
- ✅ **MAJOR** architectural changes (new folders, moved files, renamed components)
- ✅ **BREAKING** changes (API changes, removed features, renamed functions)
- ✅ **NEW** components or services added
- ✅ **BUILD** process changes (new scripts, workflow updates, release process changes)
- ✅ **DEPENDENCY** updates that affect development workflow
- ✅ **CROSS-PLATFORM** changes (new browser/Electron compatibility issues)
- ✅ **RELEASE** process changes (new manual steps, workflow fixes)

**How to update:**
1. Review what changed in the codebase
2. Update relevant sections (file paths, component names, scripts, workflows)
3. Test that new contributors could understand the current state
4. Commit with message: "docs: update copilot-instructions.md for [change description]"

**What to check when updating:**
- File structure references still accurate?
- Component names and locations current?
- npm scripts match package.json?
- Build/release process reflects reality?
- Common issues section covers current problems?
- New features documented in appropriate sections?

### Metadata Extraction (`services/fileIndexer.ts`)
```typescript
// Complex object-to-array conversion for InvokeAI metadata
function extractModels(metadata: InvokeAIMetadata): string[] {
  // Handle both arrays and objects gracefully
  if (Array.isArray(metadata.models)) {
    return metadata.models;
  } else if (typeof metadata.models === 'object') {
    // Extract values from object properties
    return Object.values(metadata.models).filter(v => typeof v === 'string');
  }
  return [];
}
```

### Search Implementation
- **Word Boundary Matching**: Searches use regex with word boundaries for precision
- **Case Insensitive**: All searches ignore case
- **Metadata Search**: Searches through all PNG metadata including prompts and settings
- **Real-time Filtering**: Instant results as user types

### Automatic Filter System
The automatic filter extraction system dynamically generates filter options from loaded images:

**Architecture**: Filter extraction moved from `App.tsx` to `hooks/useImageLoader.ts` for better separation of concerns

**Filter Types**:
- **Models**: Checkpoint models used for generation (e.g., "sdxl_base_1.0", "realistic_vision_v5.1")
- **LoRAs**: Low-Rank Adaptations applied during generation
- **Schedulers**: Sampling methods (e.g., "euler", "ddim", "k_lms")

**Implementation Pattern**:
```typescript
// In useImageLoader.ts - automatic filter extraction
const updateFilterOptions = (images: IndexedImage[]) => {
  const models = new Set<string>();
  const loras = new Set<string>();
  const schedulers = new Set<string>();
  
  images.forEach(image => {
    // Extract from metadata and add to sets
    if (image.metadata?.models) {
      image.metadata.models.forEach(model => models.add(model));
    }
    // Similar for LoRAs and schedulers
  });
  
  setFilterOptions({ models: Array.from(models), loras: Array.from(loras), schedulers: Array.from(schedulers) });
};
```

**Cross-Format Support**: Works with InvokeAI, A1111, and ComfyUI metadata formats by normalizing single model strings to arrays

### File Handle Management
```typescript
// Use file handles instead of blob URLs for memory efficiency
interface IndexedImage {
  id: string;
  handle: FileSystemFileHandle;  // File handle reference
  thumbnailHandle?: FileSystemFileHandle;
  // ... other metadata
}
```

### Caching Strategy (`services/cacheManager.ts`)
- **Incremental Updates**: Only process new/changed files
- **Time-based Invalidation**: Refresh cache after 1 hour
- **Count-based Validation**: Refresh if image count changes
- **Thumbnail Caching**: Separate storage for WebP thumbnails

### IPC Communication Pattern (`preload.js`)
```javascript
// Secure API exposure with contextBridge
contextBridge.exposeInMainWorld('electronAPI', {
  listDirectoryFiles: (dirPath) => ipcRenderer.invoke('list-directory-files', dirPath),
  readFile: (filePath) => ipcRenderer.invoke('read-file', filePath),
  // ... other secure APIs
});
```

### UI State Persistence
```typescript
// Save user preferences to localStorage
useEffect(() => {
  const savedSortOrder = localStorage.getItem('invokeai-sort-order');
  const savedItemsPerPage = localStorage.getItem('invokeai-items-per-page');
  // Apply saved preferences on component mount
}, []);
```

### Error Handling Patterns
- **Graceful Fallbacks**: Browser API fallbacks when Electron APIs unavailable
- **User-Friendly Messages**: Clear error messages for file system operations
- **Recovery Mechanisms**: Automatic retry for failed operations

### Clipboard Operations Pattern
```typescript
// Handle clipboard operations with focus management
const copyToClipboard = async (text: string) => {
  try {
    // Ensure document has focus before clipboard operation
    if (document.hidden || !document.hasFocus()) {
      window.focus();
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    await navigator.clipboard.writeText(text);
    showSuccessNotification('Copied to clipboard!');
  } catch (error) {
    console.error('Clipboard error:', error);
    alert('Failed to copy to clipboard');
  }
};
```

### Metadata Parsing Pattern
```typescript
// Handle different InvokeAI metadata formats
const extractPrompt = (metadata: InvokeAIMetadata): string => {
  if (metadata?.prompt) {
    if (typeof metadata.prompt === 'string') {
      return metadata.prompt;
    } else if (Array.isArray(metadata.prompt)) {
      return metadata.prompt
        .map(p => typeof p === 'string' ? p : (p as any)?.prompt || '')
        .filter(p => p.trim())
        .join(' ');
    } else if (typeof metadata.prompt === 'object' && (metadata.prompt as any).prompt) {
      return (metadata.prompt as any).prompt;
    }
  }
  
  // Try alternative fields
  const alternatives = ['Prompt', 'prompt_text', 'positive_prompt'];
  for (const field of alternatives) {
    if (metadata?.[field] && typeof metadata[field] === 'string') {
      return metadata[field];
    }
  }
  
  return '';
};
```

### Performance Optimizations
- **Lazy Loading**: Intersection Observer for image loading
- **Memory Management**: File handles instead of blob storage
- **Batch Processing**: Progress updates every 20 files during indexing
- **Virtual Scrolling**: Efficient rendering for large image collections

## Key Files to Reference

### Architecture Understanding
- `ARCHITECTURE.md` - Detailed technical documentation
- `README.md` - Feature overview and setup instructions
- `types.ts` - Core data structures and interfaces

### Implementation Examples
- `App.tsx` - State management and component orchestration
- `services/fileIndexer.ts` - Metadata extraction patterns
- `services/cacheManager.ts` - IndexedDB caching implementation
- `components/ImageGrid.tsx` - Lazy loading and selection patterns
- `components/ImageModal.tsx` - Image viewing and clipboard operations
- `components/BrowserCompatibilityWarning.tsx` - Browser compatibility detection

### Configuration Files
- `package.json` - Build scripts and dependencies
- `vite.config.ts` - Build configuration
- `electron.cjs` - Desktop app configuration and IPC handlers
- `preload.js` - Secure API bridge implementation

## Common Development Tasks

### Adding New Filters
1. Add filter state to `App.tsx` or `useImageFilters.ts`
2. Update `updateFilterOptions()` function in `hooks/useImageLoader.ts`
3. Add UI controls in `SearchBar.tsx`, `Sidebar.tsx`, or create new component
4. Implement filtering logic in search/filter functions

### Adding New Components
1. Create component in `components/` directory
2. Add TypeScript interfaces to `types.ts` if needed
3. Import and use in `App.tsx` or parent component
4. Handle both browser and Electron environments if needed

### Adding File Operations
1. Add IPC handler in `electron.cjs`
2. Expose API in `preload.js`
3. Add UI controls in components
4. Handle both browser and Electron environments

### Adding Metadata Fields
1. Update `InvokeAIMetadata` interface in `types.ts`
2. Add extraction logic in `services/fileIndexer.ts`
3. Update caching in `services/cacheManager.ts`
4. Add display in `ImageModal.tsx` or create new component

### Browser Compatibility Features
- `BrowserCompatibilityWarning.tsx` - Detects and warns about unsupported browsers
- File System Access API fallback for modern browsers
- Graceful degradation for older browsers

## Testing & Debugging

### Environment Testing
- Test in both browser and Electron environments
- Verify File System Access API fallbacks
- Check IPC communication in desktop mode

### Performance Testing
- Test with 17,000+ images for performance
- Monitor memory usage with lazy loading
- Verify caching effectiveness

### Cross-Platform Testing
- Windows, macOS, and Linux compatibility
- File path handling differences
- Auto-updater functionality

## Code Quality Guidelines

### TypeScript Usage
- Strict typing for all data structures
- Proper interface definitions for API responses
- Generic types for reusable components

### Error Handling
- Try-catch blocks around async operations
- User-friendly error messages
- Graceful degradation for missing features

### Performance Considerations
- Avoid unnecessary re-renders
- Use React.memo for expensive components
- Implement proper cleanup in useEffect hooks

## Release Management

### Release Management

**Current Approach**: Manual builds with GitHub Actions support

**How to Create a New Release:**

1. **Update Version**: Modify `version` in `package.json`
2. **Test Build Locally**: 
   ```bash
   npm run build
   npx electron-builder --publish=never
   ```
3. **Create Git Tag**: 
   ```bash
   git tag v1.7.4
   git push origin v1.7.4
   ```
4. **GitHub Actions**: The workflow will attempt automated builds, but manual intervention may be needed
5. **Manual Upload**: If automated workflow fails, upload installers manually:
   ```bash
   gh release upload v1.7.4 "dist-electron\LocalImageBrowser-InvokeAI-Setup-1.7.4.exe" --clobber
   gh release upload v1.7.4 "dist-electron\latest.yml" --clobber
   ```

**Release Artifacts:**
- **Windows**: `LocalImageBrowser-InvokeAI-Setup-{version}.exe` + `latest.yml`
- **macOS**: `.dmg` files for Intel and Apple Silicon + `latest-mac.yml`
- **Linux**: `.AppImage` files + `latest-linux.yml`

**Note**: The automated workflow often requires manual fixes for Windows builds. Always verify all platforms have their installers and latest.yml files before considering a release complete.

## Common Issues & Solutions

### GitHub Actions Windows Build Failures
**Problem**: Windows builds fail in GitHub Actions despite working locally
**Solution**: Build manually and upload to releases:
```bash
npm run build
npx electron-builder --publish=never
gh release upload v{version} "dist-electron\LocalImageBrowser-InvokeAI-Setup-{version}.exe" --clobber
gh release upload v{version} "dist-electron\latest.yml" --clobber
```

### Clipboard Operations in Modals
**Problem**: "Document is not focused" error when copying from modal context menus
**Solution**: Ensure document focus before clipboard operations:
```typescript
if (document.hidden || !document.hasFocus()) {
  window.focus();
  await new Promise(resolve => setTimeout(resolve, 100));
}
```

### Browser Compatibility Issues
**Problem**: App doesn't work in older browsers or unsupported environments
**Solution**: Check for required APIs and show compatibility warning:
```typescript
const isCompatible = 'showDirectoryPicker' in window || 
                    (typeof window !== 'undefined' && window.process && window.process.type);
```

### InvokeAI Metadata Variations
**Problem**: Prompt data stored in different formats across InvokeAI versions
**Solution**: Check multiple possible locations and handle different data types:
```typescript
// Handle string, array, and object formats
if (typeof metadata.prompt === 'string') {
  prompt = metadata.prompt;
} else if (Array.isArray(metadata.prompt)) {
  prompt = metadata.prompt.map(p => typeof p === 'string' ? p : p.prompt).join(' ');
}
```

### File Handle Compatibility
**Problem**: Browser vs Electron file handle differences
**Solution**: Always check environment before file operations:
```typescript
const isElectron = typeof window !== 'undefined' && window.process && window.process.type;
if (isElectron && window.electronAPI) {
  // Use Electron APIs
} else {
  // Use browser File System Access API
}
```

Remember: This codebase prioritizes local-first operation, cross-platform compatibility, and performance with large image collections. Always consider both browser and Electron execution environments when making changes.