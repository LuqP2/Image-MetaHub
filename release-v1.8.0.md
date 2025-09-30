# Image MetaHub v1.8.0

## [1.8.0] - 2025-09-30

### Major Architectural Changes
- **Complete Application Refactoring**: Migrated from monolithic App.tsx to modular architecture with Zustand state management, custom hooks, and component modularization for improved maintainability and LLM-friendliness
- **Parser Modularization**: Split monolithic fileIndexer.ts into modular parsers (InvokeAI, A1111, ComfyUI) with factory pattern for automatic format detection
- **State Management Migration**: All component state migrated to centralized Zustand store (useImageStore.ts) for better predictability and debugging

### New Features
- **Automatic1111 Support**: Full PNG and JPEG metadata parsing with model, LoRA, and generation parameter extraction
- **ComfyUI Support (Partial)**: Workflow detection and basic metadata parsing for ComfyUI-generated images
- **JPEG File Support**: Added support for .jpg/.jpeg files with EXIF metadata extraction using exifr library
- **Advanced Filters**: Range filters for Steps, CFG Scale, Dimensions, and Date with real-time UI updates
- **Right-Click Context Menu**: Copy Prompt, Copy Negative Prompt, Copy Seed, Copy Model options in ImageModal
- **Copy to Clipboard**: Copy actual image files to clipboard for use in other applications
- **File Operations**: "Show in Folder" and "Export Image" functionality with proper cross-platform path handling
- **Multi-Format Support**: Unified filtering system working seamlessly across InvokeAI, A1111, and ComfyUI formats

### Performance Improvements
- **🚀 Record Performance**: Successfully indexed 18,000 images in 3.5 minutes (~85 images/second)
- **Async Pool Concurrency**: 10 simultaneous file operations with memory safety controls
- **Throttled Progress Updates**: UI updates at 5Hz (200ms intervals) to prevent interface freezing
- **Optimized File Processing**: Eliminated duplicate file processing and improved batch reading
- **Memory Management**: File handles instead of blob storage for better memory efficiency

### Technical Improvements
- **Modular Architecture**: Separated concerns with dedicated hooks (useImageLoader, useImageFilters, useImageSelection)
- **Component Modularization**: UI elements broken into focused components (Header, StatusBar, ActionToolbar, etc.)
- **Factory Pattern**: Automatic parser selection based on metadata format detection
- **Cross-Platform Compatibility**: Enhanced browser and Electron environment detection
- **Error Handling**: Improved error boundaries and user-friendly error messages

## Downloads

Choose the appropriate installer for your operating system:

###  Windows
- **Installer**: `ImageMetaHub-Setup-1.8.0.exe`
- **Format**: NSIS installer with desktop and start menu shortcuts
- **Size**: ~85MB

###  macOS
- **Intel Macs**: `ImageMetaHub-1.8.0.dmg`
- **Apple Silicon**: `ImageMetaHub-1.8.0-arm64.dmg`
- **Format**: DMG packages with proper entitlements
- **Requirements**: macOS 10.15+

###  Linux
- **Universal**: `ImageMetaHub-1.8.0.AppImage`
- **Format**: Portable AppImage (no installation required)
- **Dependencies**: None (fully self-contained)

## What's New in v1.8.0

### Major Architectural Changes
- **Complete Application Refactoring**: Migrated from monolithic App.tsx to modular architecture with Zustand state management, custom hooks, and component modularization for improved maintainability and LLM-friendliness
- **Parser Modularization**: Split monolithic fileIndexer.ts into modular parsers (InvokeAI, A1111, ComfyUI) with factory pattern for automatic format detection
- **State Management Migration**: All component state migrated to centralized Zustand store (useImageStore.ts) for better predictability and debugging

### New Features
- **Automatic1111 Support**: Full PNG and JPEG metadata parsing with model, LoRA, and generation parameter extraction
- **ComfyUI Support (Partial)**: Workflow detection and basic metadata parsing for ComfyUI-generated images
- **JPEG File Support**: Added support for .jpg/.jpeg files with EXIF metadata extraction using exifr library
- **Advanced Filters**: Range filters for Steps, CFG Scale, Dimensions, and Date with real-time UI updates
- **Right-Click Context Menu**: Copy Prompt, Copy Negative Prompt, Copy Seed, Copy Model options in ImageModal
- **Copy to Clipboard**: Copy actual image files to clipboard for use in other applications
- **File Operations**: "Show in Folder" and "Export Image" functionality with proper cross-platform path handling
- **Multi-Format Support**: Unified filtering system working seamlessly across InvokeAI, A1111, and ComfyUI formats

### Performance Improvements
- **🚀 Record Performance**: Successfully indexed 18,000 images in 3.5 minutes (~85 images/second)
- **Async Pool Concurrency**: 10 simultaneous file operations with memory safety controls
- **Throttled Progress Updates**: UI updates at 5Hz (200ms intervals) to prevent interface freezing
- **Optimized File Processing**: Eliminated duplicate file processing and improved batch reading
- **Memory Management**: File handles instead of blob storage for better memory efficiency

### Technical Improvements
- **Modular Architecture**: Separated concerns with dedicated hooks (useImageLoader, useImageFilters, useImageSelection)
- **Component Modularization**: UI elements broken into focused components (Header, StatusBar, ActionToolbar, etc.)
- **Factory Pattern**: Automatic parser selection based on metadata format detection
- **Cross-Platform Compatibility**: Enhanced browser and Electron environment detection
- **Error Handling**: Improved error boundaries and user-friendly error messages