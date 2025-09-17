# Local Image Browser for InvokeAI

> **Disclaimer:** This project is an independent, community-created tool and is **not affiliated with or endorsed by** Invoke AI, Inc. or the official InvokeAI project. "InvokeAI" is a trademark of Invoke AI, Inc. This tool is designed to work with InvokeAI-generated images but is developed and maintained independently.

A fast, local web application for browsing and organizing AI-generated images from InvokeAI with advanced filtering and caching capabilities.

## Installation

**Prerequisites:** Node.js (LTS recommended)

```bash
# Clone the repository
git clone https://github.com/your-username/local-image-browser-for-invokeai.git
cd local-image-browser-for-invokeai

# Install dependencies
npm install

# Start development server
npm run dev
```

## Features

### Core Functionality
- **Local Image Browsing**: Browse AI-generated images directly from your local folder
- **Metadata Search**: Search through image metadata including prompts, models, and settings
- **File System Access**: Uses modern browser APIs to access local directories securely
- **InvokeAI Compatibility**: Optimized for browsing InvokeAI outputs with metadata extraction

### Advanced Filtering & Organization
- **Model & LoRA Filtering**: Filter images by AI models and LoRA
- **Smart Search**: Word-boundary search that finds exact matches (e.g., "city" won't match "opacity")
- **Multiple Sort Options**: Alphabetical (A-Z, Z-A) and Date-based (Newest/Oldest First)
- **Flexible Pagination**: Choose 10, 20, 50, 100 items per page, or view all images at once
- **Real-time Search**: Instant search results as you type through large collections

### Performance & Caching
- **Thumbnail Support**: Automatic detection and use of InvokeAI thumbnail cache (.webp files)
- **Smart Caching**: IndexedDB cache for instant loading (first scan ~4 min, subsequent loads ~10 sec)
- **Intermediate Image Filtering**: Automatically excludes InvokeAI intermediate/temporary images from indexing
- **Intelligent Cache Invalidation**: Detects new images and refreshes cache only when needed
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
