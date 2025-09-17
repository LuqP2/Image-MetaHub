# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0] - 2025-09-17

### Added
- **Intelligent Cache System**: Implemented proper incremental cache updates
- **Enhanced LoRA Extraction**: Robust parsing of complex LoRA object structures
- **Performance Optimization**: Subsequent directory loads now take ~10 seconds instead of 3-4 minutes

### Fixed
- **Cache Invalidation Bug**: Cache was being cleared on every directory selection
- **LoRA Filter Broken**: LoRAs were appearing as `[object Object]` instead of readable names
- **Unnecessary Reindexing**: Application now properly detects and processes only new images

### Changed
- **Cache Logic**: Restructured cache validation and update flow
- **Metadata Parsing**: Improved extraction of nested object properties in LoRA metadata
- **Error Handling**: Better validation of extracted metadata values

### Technical Improvements
- Incremental cache updates instead of full reindexing
- Enhanced object property traversal for complex metadata structures
- Optimized file handle management for large collections
- Improved memory efficiency during indexing

### Performance
- **Initial Load**: 3-4 minutes (unchanged)
- **Subsequent Loads**: ~10 seconds (previously 3-4 minutes)
- **New Image Detection**: Only processes new/changed files
- **Memory Usage**: Reduced memory footprint for large collections (17k+ images)

## [1.0.0] - 2025-09-17

### Added
- Initial release
- Local directory browsing with File System Access API
- PNG metadata extraction (InvokeAI format)
- Full-text search across image metadata
- Model and LoRA filtering
- Thumbnail support (WebP thumbnails)
- Responsive grid layout with pagination
- Image modal with detailed metadata view
- Basic caching system with IndexedDB
- Intermediate image filtering

### Features
- React 18 + TypeScript frontend
- Vite build system
- Browser-based file system access
- Client-side metadata parsing
- Responsive design for desktop and mobile