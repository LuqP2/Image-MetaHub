# Local Image Browser for InvokeAI

> **Disclaimer:** This project is an independent, community-created tool and is **not affiliated with or endorsed by** Invoke AI, Inc. or the official InvokeAI project. "InvokeAI" is a trademark of Invoke AI, Inc. This tool is designed to work with InvokeAI-generated images but is developed and maintained independently.

A fast, local web application for browsing and organizing AI-generated images from InvokeAI with advanced filtering and smart caching capabilities. Built with React + TypeScript for optimal performance with large image collections.

## Features

### Current Features (v1.1)
- **Local-First**: Browse images directly from your local folders - no uploads required
- **Smart Caching**: Intelligent IndexedDB caching with incremental updates for fast subsequent loads
- **Advanced Search**: Full-text search across all metadata including prompts, models, and settings
- **Intelligent Filtering**: Filter by AI models and LoRA models with auto-detection
- **Thumbnail Support**: Automatic WebP thumbnail detection and display
- **Responsive Design**: Works on desktop and mobile devices
- **Privacy First**: Everything runs locally - no data leaves your machine
- **InvokeAI Optimized**: Deep metadata extraction from InvokeAI PNG files

### Performance Features
- **Incremental Indexing**: Only processes new/changed images on subsequent loads
- **Memory Efficient**: Handles 17,000+ images without performance degradation
- **Background Processing**: Non-blocking file indexing with progress indicators
- **Lazy Loading**: Images loaded on-demand for optimal performance

## Installation

**Prerequisites:** Node.js 16+ (LTS recommended) and a modern browser

```bash
# Clone the repository
git clone https://github.com/LuqP2/local-image-browser-for-invokeai.git
cd local-image-browser-for-invokeai

# Install dependencies
npm install

# Start development server
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

### Short Term (v1.1)
- Enhanced Filters: Scheduler, Steps slider, CFG Scale slider
- Dimension Filtering: Filter by image dimensions (512x512, 1024x1024, etc.)
- Performance Optimizations: Virtual scrolling for massive collections

### Medium Term (v1.5)
- Multi-Platform Support: ComfyUI and Automatic1111 metadata parsing
- Tag System: Custom tagging and organization
- Batch Operations: Move, delete, export multiple images
- Analytics Dashboard: Usage statistics and trends

### Long Term (v2.0)
- Universal AI Browser: Support for all major AI image generation platforms
- Image Similarity: Find similar images using embeddings
- Cloud Sync: Optional cloud backup and sync
- Plugin System: Extensible architecture for custom parsers

## Quick Start

1. **Select Folder**: Click "Change Folder" and select your InvokeAI outputs directory
2. **Wait for Indexing**: First-time indexing takes a few minutes (cached afterwards)
3. **Search & Filter**: Use the search bar and filters to find specific images
4. **View Details**: Click any image to see full metadata and larger preview

## Usage Tips

- **First Load**: Initial indexing of large collections (17k+ images) takes 3-4 minutes
- **Subsequent Loads**: Cached data loads in ~10 seconds
- **New Images**: Only new images are processed, maintaining fast performance
- **Search**: Use word-boundary search (e.g., "city" won't match "opacity")
- **Thumbnails**: Place your InvokeAI thumbnails directory alongside images for faster loading

## Technical Architecture

Built with modern web technologies for optimal performance:

- **Frontend**: React 18 + TypeScript 5.2
- **Build Tool**: Vite 5.0
- **Storage**: IndexedDB for persistent caching
- **File Access**: File System Access API (Chrome/Edge)
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
