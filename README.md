# Local Image Browser for InvokeAI

> **Disclaimer:** This project is an independent, community-created tool and is **not affiliated with or endorsed by** Invoke AI, Inc. or the official InvokeAI project. "InvokeAI" is a trademark of Invoke AI, Inc. This tool is designed to work with InvokeAI-generated images but is developed and maintained independently.

A fast, local web application for browsing and organizing AI-generated images from InvokeAI with advanced filtering and smart caching capabilities. Built with React + TypeScript for optimal performance with large image collections.

## Features

### Current Features (v1.5)
- **Local-First**: Browse images directly from your local folders - no uploads required
- **Smart Caching**: Intelligent IndexedDB caching with incremental updates for fast subsequent loads
- **Advanced Search**: Full-text search across all metadata including prompts, models, and settings
- **Comprehensive Filtering**: Filter by AI models, LoRA models, and schedulers with auto-detection
- **Multi-Selection**: Windows Explorer-like Ctrl+click selection for bulk operations
- **File Management**: Rename and delete images directly from the app (desktop version only)
- **Bulk Operations**: Delete multiple selected images at once with confirmation
- **Metadata Export**: Export individual image metadata as readable TXT or structured JSON files
- **Thumbnail Support**: Automatic WebP thumbnail detection and display
- **Responsive Design**: Works on desktop and mobile devices
- **Auto-Updates**: Automatic update notifications and installation (desktop version)
- **Privacy First**: Everything runs locally - no data leaves your machine
- **InvokeAI Optimized**: Deep metadata extraction from InvokeAI PNG files

### Performance Features
- **Incremental Indexing**: Only processes new/changed images on subsequent loads
- **Memory Efficient**: Handles 17,000+ images without performance degradation
- **Background Processing**: Non-blocking file indexing with progress indicators
- **Lazy Loading**: Images loaded on-demand for optimal performance
- **Smart Selection**: Visual feedback and efficient multi-selection handling
- **Secure File Operations**: Safe file management through Electron IPC

## Installation

**Prerequisites:** Node.js 16+ (LTS recommended) and a modern browser

### Option 1: Download Installer (Recommended) 🚀
1. Go to [Releases](https://github.com/LuqP2/local-image-browser-for-invokeai/releases)
2. Download the installer for your OS:
   - **Windows**: `.exe` installer
   - **macOS**: `.dmg` file  
   - **Linux**: `.AppImage` file
3. Run the installer and follow the setup wizard
4. Launch "Local Image Browser for InvokeAI" from your applications

### Option 2: Run from Source 🔧
```bash
# Clone the repository
git clone https://github.com/LuqP2/local-image-browser-for-invokeai.git
cd local-image-browser-for-invokeai

# Install dependencies
npm install

# Start development server
npm run dev
```

### Option 3: Desktop App (Development)
```bash
# Run as desktop app
npm run electron-dev

# Build installer
npm run electron-pack
```

## Updating

### If you installed via installer:
The app will automatically check for updates and notify you when new versions are available.

### If you're running from source:
```bash
cd local-image-browser-for-invokeai
git pull origin main
npm install  # In case of new dependencies
npm run dev
```

## Browser Compatibility

| Browser | Support | Notes |
|---------|---------|-------|
| Chrome 86+ | Full Support | File System Access API supported |
| Edge 86+ | Full Support | File System Access API supported |
| Firefox | Limited Support | Fallback implementation needed |
| Safari | Not Supported | File System Access API not available |

## Roadmap

### Recently Completed ✅
- ~~Enhanced Filters: Scheduler filtering with auto-detection~~
- ~~File Management: Rename and delete operations~~
- ~~Multi-Selection: Ctrl+click selection like Windows Explorer~~
- ~~Bulk Operations: Delete multiple images at once~~
- ~~Desktop App: Electron wrapper with auto-updater~~
- ~~Metadata Export: TXT and JSON export functionality~~

### Short Term (v1.6)
- Dimension Filtering: Filter by image dimensions (512x512, 1024x1024, etc.)
- Advanced Filters: Steps slider, CFG Scale slider
- Performance Optimizations: Virtual scrolling for massive collections
- Keyboard Shortcuts: Navigation and selection hotkeys

### Medium Term (v1.8)
- Multi-Platform Support: ComfyUI and Automatic1111 metadata parsing
- Tag System: Custom tagging and organization
- Image Comparison: Side-by-side view for selected images
- Analytics Dashboard: Usage statistics and trends

### Long Term (v2.0)
- Universal AI Browser: Support for all major AI image generation platforms
- Image Similarity: Find similar images using embeddings
- Cloud Sync: Optional cloud backup and sync
- Plugin System: Extensible architecture for custom parsers

## Quick Start

1. **Select Folder**: Click "Change Folder" and select your InvokeAI outputs directory
2. **Wait for Indexing**: First-time indexing takes a few minutes (cached afterwards)
3. **Browse & Select**: Use Ctrl+click to select multiple images like Windows Explorer
4. **Search & Filter**: Use the search bar and filters to find specific images
5. **Manage Files**: Rename, delete, or export metadata for selected images
6. **View Details**: Click any image to see full metadata and larger preview

## Usage Tips

- **First Load**: Initial indexing of large collections (17k+ images) takes 3-4 minutes
- **Subsequent Loads**: Cached data loads in ~10 seconds
- **New Images**: Only new images are processed, maintaining fast performance
- **Multi-Selection**: Use Ctrl+click to select multiple images for bulk operations
- **File Management**: Rename and delete operations available in desktop app only
- **Search**: Use word-boundary search (e.g., "city" won't match "opacity")
- **Thumbnails**: Place your InvokeAI thumbnails directory alongside images for faster loading
- **Export Metadata**: Click any image to open details and use export dropdown for TXT/JSON files
- **Filtering**: Combine multiple filters (model + LoRA + scheduler) for precise searches

## Technical Architecture

Built with modern web technologies for optimal performance:

- **Frontend**: React 18 + TypeScript 5.2
- **Desktop**: Electron 38 with auto-updater
- **Build Tool**: Vite 5.0
- **Storage**: IndexedDB for persistent caching
- **File Access**: File System Access API + Electron File System
- **IPC**: Secure inter-process communication for file operations
- **Styling**: Tailwind CSS (responsive design)

For detailed technical documentation, see [ARCHITECTURE.md](./ARCHITECTURE.md).

## Contributing

Contributions are welcome! This project has potential to become a universal AI image browser supporting multiple platforms.

### Development Setup
```bash
git clone https://github.com/LuqP2/local-image-browser-for-invokeai.git
cd local-image-browser-for-invokeai
npm install
npm run dev
```

### Planned Contributions Areas
- Additional metadata parsers (ComfyUI, A1111)
- Enhanced filtering options
- Performance optimizations
- UI/UX improvements

## License

This project is open source and available under the [MIT License](LICENSE).

## Disclaimer

This is an independent project not affiliated with Invoke AI, Inc. InvokeAI is a trademark of Invoke AI, Inc. This tool is designed to work with InvokeAI-generated content but is developed and maintained independently by the community.
- **Lazy Loading**: Images load as you scroll for optimal performance

### User Experience
- **Accessibility**: Full screen reader compatibility with proper ARIA labels and keyboard navigation
- **Settings Persistence**: Sort preferences and pagination settings are saved automatically
- **Dark Theme**: Eye-friendly dark interface optimized for long browsing sessions
- **Responsive Design**: Works seamlessly on desktop, tablet, and mobile devices

### Privacy & Security

**Complete Local Processing - Zero Data Collection:**

- **100% Local Execution**: All image processing, metadata extraction, and caching happens entirely within your browser
- **No Network Requests**: The application never sends any data to external servers or services
- **No Telemetry**: No usage analytics, tracking pixels, or data collection of any kind
- **No User Accounts**: No registration, login, or personal information required
- **Offline Capable**: Works completely offline after initial page load
- **Browser-Only Storage**: All data (cache, settings, thumbnails) stored locally using browser APIs (IndexedDB, localStorage)
- **No Cloud Dependencies**: Does not rely on any cloud services or external APIs
- **File System Permissions**: Uses browser's File System Access API with explicit user permission for each directory access
- **Your Data Stays Yours**: Images, metadata, prompts, and all generated data never leave your device

**Technical Privacy Implementation:**
- **IndexedDB**: Local database storage for caching (never synchronized)
- **File System Access API**: Direct local file access without file uploads
- **PNG Metadata Parsing**: Client-side metadata extraction from image files
- **No External CDNs**: All dependencies bundled locally (except Tailwind CSS from CDN for styling only)

This tool is designed for users who prioritize data privacy and want complete control over their AI-generated image collections.

## Browser Compatibility

This application requires a modern browser that supports the File System Access API:

- **Chrome 86+** - Fully supported
- **Edge 86+** - Fully supported  
- **Firefox** - Not yet supported (API not implemented)
- **Safari** - Not yet supported (API not implemented)

## Technical Stack

- **React 18** with TypeScript for type safety
- **Vite** for fast development and building  
- **Tailwind CSS** for responsive styling
- **File System Access API** for local file browsing
- **IndexedDB** for intelligent caching
- **PNG Metadata Parsing** for InvokeAI metadata extraction

## Performance Benchmarks

Tested and optimized for large collections:

- **17,559+ images** processed successfully
- **5,500+ images/minute** processing speed
- **3-4 minutes** initial scan for 18k images
- **~10 seconds** subsequent loads with cache
- **Memory efficient** with lazy loading and pagination
- **Thumbnail optimization** using InvokeAI's .webp cache
- **Smart filtering** excludes intermediate/temporary images automatically

## Search Features

**Precise Search Functionality:**
- **Word Boundary Matching**: Searches for complete words only (searching "city" won't match "opacity")
- **Case Insensitive**: Matches regardless of capitalization
- **Metadata Search**: Searches through all PNG metadata including prompts, model names, and generation settings
- **Real-time Results**: Instant filtering as you type
- **Combined Filtering**: Search terms work alongside model and LoRA filters

## License

This project is licensed under MIT License and is completely independent from InvokeAI. 

InvokeAI is licensed under Apache-2.0 by Invoke AI, Inc. This tool reads publicly available metadata from PNG files but does not include any InvokeAI source code.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request. For major changes, please open an issue first to discuss what you would like to change.
