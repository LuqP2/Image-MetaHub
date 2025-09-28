# Local Image Browser for InvokeAI v1.7.6

## [1.7.6] - 2025-09-28

### Fixed
- **Critical Performance Issue**: Eliminated console logging spam that was generating 40,000+ messages and severely impacting UI responsiveness
- **Image Duplication Bug**: Fixed critical bug where processDirectory was calling getFileHandlesRecursive redundantly, causing 36,884 images to be processed instead of the actual 18,452 files
- **Syntax Errors**: Resolved critical syntax errors in electron.mjs that were preventing the application from starting
- **File Processing**: Corrected image counting logic to prevent double-processing of files

### Technical Improvements
- **Automated Release Workflow**: Added complete automated release system with multi-platform builds (Windows, macOS, Linux)
- **GitHub Actions**: Enhanced CI/CD pipeline for automatic installer generation and release publishing
- **Error Handling**: Improved error handling in file operations and metadata extraction
- **Performance Optimization**: Reduced memory usage and improved startup time

## Downloads

Choose the appropriate installer for your operating system:

###  Windows
- **Installer**: `LocalImageBrowser-InvokeAI-Setup-1.7.6.exe`
- **Format**: NSIS installer with desktop and start menu shortcuts
- **Size**: ~85MB

###  macOS
- **Intel Macs**: `LocalImageBrowser-InvokeAI-1.7.6.dmg`
- **Apple Silicon**: `LocalImageBrowser-InvokeAI-1.7.6-arm64.dmg`
- **Format**: DMG packages with proper entitlements
- **Requirements**: macOS 10.15+

###  Linux
- **Universal**: `LocalImageBrowser-InvokeAI-1.7.6.AppImage`
- **Format**: Portable AppImage (no installation required)
- **Dependencies**: None (fully self-contained)

## What's New in v1.7.6

### Fixed
- **Critical Performance Issue**: Eliminated console logging spam that was generating 40,000+ messages and severely impacting UI responsiveness
- **Image Duplication Bug**: Fixed critical bug where processDirectory was calling getFileHandlesRecursive redundantly, causing 36,884 images to be processed instead of the actual 18,452 files
- **Syntax Errors**: Resolved critical syntax errors in electron.mjs that were preventing the application from starting
- **File Processing**: Corrected image counting logic to prevent double-processing of files

### Technical Improvements
- **Automated Release Workflow**: Added complete automated release system with multi-platform builds (Windows, macOS, Linux)
- **GitHub Actions**: Enhanced CI/CD pipeline for automatic installer generation and release publishing
- **Error Handling**: Improved error handling in file operations and metadata extraction
- **Performance Optimization**: Reduced memory usage and improved startup time

## System Requirements

- **OS**: Windows 10+, macOS 10.15+, Ubuntu 18.04+ (or equivalent)
- **RAM**: 4GB minimum, 8GB recommended
- **Storage**: 100MB for application + space for your image collections

## Documentation

- [README](https://github.com/LuqP2/local-image-browser-for-invokeai/blob/main/README.md)
- [Architecture](https://github.com/LuqP2/local-image-browser-for-invokeai/blob/main/ARCHITECTURE.md)
- [Changelog](https://github.com/LuqP2/local-image-browser-for-invokeai/blob/CHANGELOG.md)

## Known Issues

- Safari, Firefox, and Brave browsers don't support the File System Access API on macOS
- Use Chrome, Vivaldi, Edge, or the Desktop App for full functionality

## Feedback

Found a bug or have a feature request? [Open an issue](https://github.com/LuqP2/local-image-browser-for-invokeai/issues)!

---

*Released on 2025-09-28*