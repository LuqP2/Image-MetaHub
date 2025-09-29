# Architecture Documentation

## Project Overview

**Image MetaHub** is a web-based application built with React and TypeScript that provides fast, intelligent browsing and filtering of AI-generated images. The application focuses on performance, user experience, and extensibility.

### Current Version
- **Version**: 1.7.6
- **Build System**: Vite
- **Framework**: React 18 with TypeScript
- **State Management**: Zustand
- **Desktop**: Electron 38 with auto-updater
- **Styling**: Tailwind CSS v4

### Recent Architecture Changes (v1.7.6)
- **Major Refactoring**: Complete restructuring for better maintainability
  - Migrated from monolithic App.tsx to modular hooks-based architecture
  - Introduced Zustand for centralized state management
  - Extracted business logic into custom hooks (useImageLoader, useImageFilters, useImageSelection)
  - Componentized UI elements (Header, StatusBar, ActionToolbar)
  - Modularized metadata parsing into separate parser modules
- **Cross-Platform Improvements**: Enhanced Electron/browser compatibility
- **Performance Optimizations**: Better state management and reduced re-renders

## Core Architecture

### 1. **Frontend Stack**
```
React 18.2.0
├── TypeScript 5.2.2
├── Zustand 5.0.8 (State Management)
├── Vite 5.0.8 (Build Tool)
├── Electron 38 (Desktop Wrapper)
├── DOM APIs (File System Access API)
└── IndexedDB (Client-side Storage)
```

### 2. **Project Structure**
```
src/
├── App.tsx                 # Main application orchestrator (lean, uses hooks)
├── index.tsx              # Application entry point
├── types.ts               # TypeScript type definitions
├── components/            # Reusable UI components
│   ├── ActionToolbar.tsx  # Action buttons (delete, copy, etc.)
│   ├── BrowserCompatibilityWarning.tsx # Browser support checks
│   ├── DropdownMenu.tsx   # Dropdown component for UI
│   ├── FolderSelector.tsx # Directory selection interface
│   ├── Header.tsx         # Application header
│   ├── ImageGrid.tsx      # Grid display with multi-selection
│   ├── ImageModal.tsx     # Image details and metadata
│   ├── Loader.tsx         # Loading states and progress
│   ├── SearchBar.tsx      # Search and filtering interface
│   ├── Sidebar.tsx        # Filter sidebar
│   ├── StatusBar.tsx      # Status information display
│   └── StepsRangeSlider.tsx # Range slider for steps filter
├── hooks/                 # Custom React hooks
│   ├── useImageFilters.ts # Filtering logic and state
│   ├── useImageLoader.ts  # Directory loading and processing
│   └── useImageSelection.ts # Multi-selection management
├── services/              # Business logic services
│   ├── cacheManager.ts    # IndexedDB cache management
│   ├── fileIndexer.ts     # File processing and metadata extraction
│   ├── fileOperations.ts  # File management (rename/delete)
│   └── parsers/           # Modular metadata parsers
│       ├── index.ts       # Parser factory and exports
│       ├── parseA1111.ts  # Automatic1111 metadata parser
│       ├── parseComfyUI.ts # ComfyUI metadata parser
│       └── parseInvokeAI.ts # InvokeAI metadata parser
├── store/                 # State management
│   └── useImageStore.ts   # Zustand store for global state
├── utils/                 # Utility functions
│   ├── imageUtils.ts      # Image-related utilities
│   └── README.md          # Utils documentation
├── electron.cjs           # Electron main process
├── preload.js             # Secure IPC bridge
└── dist-electron/         # Built desktop application
```

### 3. **State Management & Logic Separation**
- **Global State**: Zustand store (`useImageStore.ts`) for centralized application state
- **Custom Hooks**: Business logic extracted into reusable hooks
  - `useImageLoader.ts`: Directory loading and file processing
  - `useImageFilters.ts`: Search and filtering logic
  - `useImageSelection.ts`: Multi-selection management
- **Component Architecture**: Lean components focused on UI rendering
- **Separation of Concerns**: State, logic, and UI are cleanly separated

#### Zustand Store Structure
```typescript
interface ImageState {
  // Data
  images: IndexedImage[];
  filteredImages: IndexedImage[];
  selectedImages: Set<string>;
  
  // UI State
  loading: boolean;
  error: string | null;
  directoryHandle: FileSystemDirectoryHandle | null;
  
  // Actions
  setImages: (images: IndexedImage[]) => void;
  setSelectedImages: (ids: Set<string>) => void;
  // ... more actions
}
```

## Core Systems

### 1. **File System Integration**
- **Browser Environment**: File System Access API for direct local directory access
- **Electron Environment**: Native Node.js file system APIs via IPC communication
- **Cross-Platform Compatibility**: Automatic environment detection and API switching
- **Recursive Directory Traversal**: Scans subdirectories for PNG files in both environments
- **File Handle Management**: Maintains references to files without copying data
- **Secure File Operations**: IPC-based file management (rename/delete) in Electron

#### Environment Detection & API Switching
```typescript
// Automatic environment detection
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

#### Electron IPC Bridge
```typescript
// preload.js - Secure API exposure
contextBridge.exposeInMainWorld('electronAPI', {
  listDirectoryFiles: (dirPath) => ipcRenderer.invoke('list-directory-files', dirPath),
  readFile: (filePath) => ipcRenderer.invoke('read-file', filePath),
  showDirectoryDialog: () => ipcRenderer.invoke('show-directory-dialog'),
  // ... other APIs
});

// electron.cjs - IPC handlers
ipcMain.handle('list-directory-files', async (event, dirPath) => {
  const files = await fs.readdir(dirPath);
  return { success: true, files: files.filter(f => f.endsWith('.png')) };
});
```

### 2. **Desktop Application (Electron)**
- **Auto-Updater**: Automatic update notifications and installation
- **IPC Communication**: Secure bridge between renderer and main process
- **File Operations**: Native file system operations (rename, delete, trash)
- **Cross-Platform**: Windows, macOS, and Linux support
- **Environment Detection**: Automatic switching between browser and Electron APIs
- **Mock File Handles**: Compatible file handle objects for Electron environment
- **Code Signing**: Signed executables for security

#### Electron-Specific Implementation
```typescript
// Mock file handle for Electron compatibility
const mockHandle = {
  name: fileName,
  kind: 'file' as const,
  getFile: async () => {
    const fileResult = await window.electronAPI.readFile(fullPath);
    const uint8Array = new Uint8Array(fileResult.data);
    return new File([uint8Array], fileName, { type: 'image/png' });
  }
};
```

### 2. **Metadata Extraction System**
- **Modular Parser Architecture**: Separate parsers for each metadata format
  - `parseInvokeAI.ts`: InvokeAI workflow and metadata parsing
  - `parseComfyUI.ts`: ComfyUI workflow parsing
  - `parseA1111.ts`: Automatic1111 parameters parsing
- **Parser Factory**: Intelligent format detection and parser selection
- **PNG Chunk Parsing**: Extracts metadata from PNG tEXt chunks
- **JPEG EXIF Parsing**: Extracts metadata from JPEG EXIF data using exifr library
- **Multi-Format Support**: Unified interface for InvokeAI, ComfyUI, and Automatic1111
- **Error-Resilient Parsing**: Graceful handling of malformed metadata
- **Normalized Metadata**: Consistent data structure across all formats
- **Model/LoRA Extraction**: Intelligent parsing of complex metadata objects
- **Thumbnail Detection**: Automatic mapping of WebP thumbnails to images

```typescript
interface IndexedImage {
  id: string;
  name: string;
  handle: FileSystemFileHandle;
  thumbnailHandle?: FileSystemFileHandle;
  metadata: InvokeAIMetadata;
  metadataString: string;
  lastModified: number;
  models: string[];
  loras: string[];
  scheduler: string;
}
```

### 3. **Smart Caching System**
- **IndexedDB Storage**: Persistent client-side cache
- **Incremental Updates**: Only processes new/changed files
- **Cache Invalidation**: Time-based and count-based validation
- **Thumbnail Caching**: Separate storage for image thumbnails
- **Smart Cleanup**: Automatic removal of stale cache entries for deleted files

#### Cache Strategy:
```typescript
interface CacheEntry {
  id: string;
  directoryName: string;
  lastScan: number;
  imageCount: number;
  metadata: ImageMetadata[];
  thumbnails: Map<string, Blob>;
}
```

**Cache Refresh Logic**:
- Refresh if image count changes
- Refresh if cache is older than 1 hour
- Incremental updates for new images
- Smart cleanup of stale entries without full reindexing

### 4. **Search and Filtering Engine**
- **Full-text Search**: Regex-based metadata searching
- **Model Filtering**: Filter by AI models used
- **LoRA Filtering**: Filter by LoRA models applied
- **Scheduler Filtering**: Filter by scheduler type (DPM, Euler, etc.)
- **Multi-Selection**: Windows Explorer-like Ctrl+click selection
- **Sorting Options**: Alphabetical and date-based sorting
- **Pagination**: Configurable items per page with click-to-edit page numbers

### 5. **File Management System**
- **Rename Operations**: In-place file renaming with validation
- **Delete Operations**: Safe file deletion to system trash
- **Bulk Operations**: Multi-file operations with confirmation
- **State Synchronization**: UI updates after file operations
- **Error Handling**: Comprehensive error reporting and recovery

### 6. **User Interface Components**
- **Selection Feedback**: Visual indicators for selected images
- **Modal Interface**: Detailed metadata view with inline editing
- **Export Functionality**: Metadata export to TXT/JSON formats
- **Progress Indicators**: Real-time feedback for long operations
- **Responsive Design**: Mobile and desktop optimized layouts

### 5. **Performance Optimizations**
- **Lazy Loading**: Images loaded as needed
- **Batch Processing**: Progress updates every 20 files
- **Memory Management**: File handles instead of blob storage
- **Incremental Selection**: Efficient multi-selection handling
- **Background Operations**: Non-blocking file operations
- **Virtual Scrolling**: (Planned) for large datasets

## Current Features

### Implemented ✅
- [x] Directory selection and recursive scanning
- [x] PNG metadata extraction (InvokeAI and Automatic1111 formats)
- [x] Smart caching with incremental updates and automatic cleanup
- [x] Full-text search across metadata
- [x] Model and LoRA filtering
- [x] Scheduler filtering with auto-detection
- [x] Enhanced LoRA object extraction
- [x] Thumbnail support (WebP thumbnails)
- [x] Multi-selection with Ctrl+click
- [x] File management (rename/delete)
- [x] Bulk delete operations
- [x] Metadata export (TXT/JSON)
- [x] Desktop application with Electron
- [x] Auto-updater functionality
- [x] Responsive grid layout
- [x] Image modal with metadata display
- [x] Pagination and sorting with click-to-edit page numbers
- [x] Intermediate image filtering
- [x] Multi-format metadata parser (InvokeAI + Automatic1111)
- [x] Structured metadata display with organized fields
- [x] Context menu and keyboard navigation
- [x] Cross-platform file operations ("Show in Folder")
- [x] Enhanced UI with export functionality

### In Progress 🚧
- [ ] Performance monitoring and analytics
- [ ] Keyboard shortcuts and hotkeys

## Planned Features

### Short Term (v1.8)
- Dimension filtering (512x512, 1024x1024, etc.)
- Steps slider filter (range selection)
- CFG Scale slider filter
- Keyboard shortcuts and hotkeys
- Enhanced performance monitoring
- Cache cleanup and optimization

### Medium Term (v1.8)
- ComfyUI metadata support
- Custom tag system
- Image comparison view
- Favorites/Rating system
- Analytics dashboard

### Long Term (v2.0)
- Multi-platform metadata parser
- Image similarity search
- Cloud sync integration
- Plugin system for custom parsers
- Workflow integration
- Cloud sync capabilities

## Technical Challenges & Solutions

### 1. **Large Dataset Performance**
**Challenge**: Handling 17,000+ images without memory issues
**Solution**: 
- File handles instead of blob storage
- Incremental cache updates
- Lazy loading and pagination
- Smart cache cleanup for stale entries

### 2. **Complex Metadata Parsing**
**Challenge**: LoRA objects stored as `[object Object]`
**Solution**: 
- Recursive object property extraction
- Fallback naming strategies
- Type-safe parsing with validation

### 3. **Browser Compatibility**
**Challenge**: File System Access API limited browser support
**Solution**: 
- Feature detection and graceful fallbacks
- Progressive enhancement approach
- Electron wrapper for full desktop functionality

### 4. **Cache Management**
**Challenge**: Stale cache entries causing refresh failures and requiring expensive full reindexing
**Solution**:
- Intelligent cache cleanup comparing cached files against directory contents
- Selective removal of stale entries while preserving valid cache data
- Fast incremental updates instead of full reindexing

## Electron Architecture

### 1. **Process Architecture**
```
Main Process (electron.cjs)
├── Window Management
├── Auto-Updater
├── File Operations (IPC Handlers)
└── Security (CSP, Permissions)

Renderer Process (React App)
├── User Interface
├── File System Access API
├── IndexedDB Cache
└── IPC Communication

Preload Script (preload.js)
├── Secure API Bridge
├── Context Isolation
└── IPC Exposure
```

### 2. **IPC Communication**
```typescript
// Main Process Handlers (electron.cjs)
ipcMain.handle('list-directory-files', async (event, dirPath) => {
  const files = await fs.readdir(dirPath);
  const pngFiles = files.filter(file => file.toLowerCase().endsWith('.png'));
  return { success: true, files: pngFiles };
});

ipcMain.handle('read-file', async (event, filePath) => {
  const data = await fs.readFile(filePath);
  return { success: true, data: data };
});

ipcMain.handle('show-directory-dialog', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory']
  });
  return {
    success: !result.canceled,
    path: result.filePaths[0],
    name: path.basename(result.filePaths[0]),
    canceled: result.canceled
  };
});

// Renderer Process Calls
const dirResult = await window.electronAPI.listDirectoryFiles(electronPath);
const fileResult = await window.electronAPI.readFile(filePath);
const dialogResult = await window.electronAPI.showDirectoryDialog();
```

### 3. **Auto-Updater Integration**
- GitHub Releases integration
- Automatic update checking
- User notification system
- Background downloads
- Restart and install process

### 4. **Cross-Platform Compatibility**
- **Environment Detection**: Runtime detection of Electron vs browser environment
- **API Abstraction**: Unified interface for file operations across platforms
- **Mock Objects**: Browser-compatible file handle objects for Electron
- **Error Handling**: Platform-specific error handling and fallbacks
- **Performance Optimization**: Optimized file access patterns for each platform

#### Platform-Specific Optimizations
```typescript
// Browser: Direct File System Access API
const handle = await window.showDirectoryPicker();
for await (const entry of handle.values()) {
  // Direct file access
}

// Electron: IPC-based file system access
const result = await window.electronAPI.listDirectoryFiles(path);
const mockHandle = createMockFileHandle(result.files[0]);
```

### 5. **Security Model**
- Context isolation enabled
- Node integration disabled in renderer
- Secure IPC communication
- Code signing for distributables

## Security Considerations

- **Local-Only Processing**: No data leaves the user's machine
- **File System Permissions**: User explicitly grants directory access
- **No Network Requests**: Fully offline application (except auto-updater)
- **Memory Safety**: Proper cleanup of file handles and blobs
- **Electron Security**: Context isolation, disabled node integration
- **IPC Security**: Whitelist-based API exposure through preload script
- **Code Signing**: Signed executables for Windows and macOS

## Development Guidelines

### Code Style
- TypeScript strict mode
- Functional components with hooks
- Async/await for file operations
- Error boundaries for robust UX

### Performance Best Practices
- Minimize re-renders with React.memo
- Use useCallback for expensive operations
- Implement proper cleanup in useEffect
- Batch DOM updates where possible

## Future Architecture Considerations

### 1. **Plugin System**
```typescript
interface MetadataParser {
  platform: string;
  supports: (file: File) => boolean;
  parse: (file: File) => Promise<UniversalMetadata>;
}
```

### 2. **Universal Metadata Format**
```typescript
interface UniversalMetadata {
  platform: 'invokeai' | 'comfyui' | 'auto1111';
  prompt: string;
  model: string;
  parameters: Record<string, any>;
  extensions: Record<string, any>;
}
```

### 3. **Modular Architecture**
- Service-based architecture
- Dependency injection for parsers
- Event-driven updates
- Configurable pipeline processing

## Build and Deployment

### Development
```bash
npm run dev    # Start development server
npm run build  # Production build
npm run preview # Preview production build
```

### Dependencies
- **React Ecosystem**: React, React-DOM
- **Build Tools**: Vite, TypeScript
- **Types**: @types/react, @types/react-dom, @types/node

### Browser Requirements
- Chrome/Edge 86+ (File System Access API)
- Firefox: Limited support (fallback needed)
- Safari: Not supported (fallback needed)

---

*This architecture document is living documentation and will be updated as the project evolves.*