# Architecture Documentation

## Project Overview

**Local Image Browser for InvokeAI** is a web-based application built with React and TypeScript that provides fast, intelligent browsing and filtering of AI-generated images. The application focuses on performance, user experience, and extensibility.

### Current Version
- **Version**: 1.5.0
- **Build System**: Vite
- **Framework**: React 18 with TypeScript
- **Desktop**: Electron 38 with auto-updater
- **Styling**: Tailwind CSS

## Core Architecture

### 1. **Frontend Stack**
```
React 18.2.0
├── TypeScript 5.2.2
├── Vite 5.0.8 (Build Tool)
├── Electron 38 (Desktop Wrapper)
├── DOM APIs (File System Access API)
└── IndexedDB (Client-side Storage)
```

### 2. **Project Structure**
```
src/
├── App.tsx                 # Main application component
├── index.tsx              # Application entry point
├── types.ts               # TypeScript type definitions
├── components/            # Reusable UI components
│   ├── DropdownMenu.tsx   # Dropdown component for UI
│   ├── FolderSelector.tsx # Directory selection interface
│   ├── ImageGrid.tsx      # Grid display with multi-selection
│   ├── ImageModal.tsx     # Image details and metadata
│   ├── Loader.tsx         # Loading states and progress
│   └── SearchBar.tsx      # Search and filtering interface
├── services/              # Business logic services
│   ├── cacheManager.ts    # IndexedDB cache management
│   ├── fileIndexer.ts     # File processing and metadata extraction
│   └── fileOperations.ts  # File management (rename/delete)
├── electron.cjs           # Electron main process
├── preload.js             # Secure IPC bridge
└── dist-electron/         # Built desktop application
```

## Core Systems

### 1. **File System Integration**
- **File System Access API**: Direct browser access to local directories (web)
- **Electron File System**: Native file access for desktop app
- **Recursive Directory Traversal**: Scans subdirectories for PNG files
- **File Handle Management**: Maintains references to files without copying data
- **Secure File Operations**: IPC-based file management (rename/delete)

### 2. **Desktop Application (Electron)**
- **Auto-Updater**: Automatic update notifications and installation
- **IPC Communication**: Secure bridge between renderer and main process
- **File Operations**: Native file system operations (rename, delete, trash)
- **Cross-Platform**: Windows, macOS, and Linux support
- **Code Signing**: Signed executables for security

### 2. **Metadata Extraction System**
- **PNG Chunk Parsing**: Extracts metadata from PNG tEXt chunks
- **InvokeAI Format Support**: Parses `invokeai_metadata` JSON
- **Model/LoRA Extraction**: Intelligent parsing of complex metadata objects
- **Scheduler Detection**: Automatic scheduler type extraction
- **Thumbnail Detection**: Automatic mapping of WebP thumbnails to PNG images

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

### 4. **Search and Filtering Engine**
- **Full-text Search**: Regex-based metadata searching
- **Model Filtering**: Filter by AI models used
- **LoRA Filtering**: Filter by LoRA models applied
- **Scheduler Filtering**: Filter by scheduler type (DPM, Euler, etc.)
- **Multi-Selection**: Windows Explorer-like Ctrl+click selection
- **Sorting Options**: Alphabetical and date-based sorting
- **Pagination**: Configurable items per page

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
- [x] PNG metadata extraction (InvokeAI format)
- [x] Smart caching with incremental updates
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
- [x] Pagination and sorting
- [x] Intermediate image filtering

### In Progress 🚧
- [ ] Performance monitoring and analytics
- [ ] Keyboard shortcuts and hotkeys

## Planned Features

### Short Term (v1.6)
- Dimension filtering (512x512, 1024x1024, etc.)
- Steps slider filter (range selection)
- CFG Scale slider filter
- Keyboard shortcuts and hotkeys
- Enhanced performance monitoring
- Cache cleanup and optimization

### Medium Term (v1.8)
- ComfyUI metadata support
- Automatic1111/WebUI metadata support
- Custom tag system
- Image comparison view
- Favorites/Rating system
- Analytics dashboard

### Long Term (v2.0)
- Multi-platform metadata parser
- Image similarity search
- Cloud sync integration
- Plugin system for custom parsers
- Image similarity search
- Workflow integration
- Plugin system for custom parsers
- Cloud sync capabilities

## Technical Challenges & Solutions

### 1. **Large Dataset Performance**
**Challenge**: Handling 17,000+ images without memory issues
**Solution**: 
- File handles instead of blob storage
- Incremental cache updates
- Lazy loading and pagination

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
// Main Process Handlers
ipcMain.handle('trash-file', async (event, filename) => {
  return await shell.trashItem(filePath);
});

// Renderer Process Calls
const result = await window.electronAPI.trashFile(filename);
```

### 3. **Auto-Updater Integration**
- GitHub Releases integration
- Automatic update checking
- User notification system
- Background downloads
- Restart and install process

### 4. **Security Model**
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