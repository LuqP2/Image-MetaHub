# Local Image Browser for InvokeAI v1.7.4

## [1.7.4] - 2025-09-24

### Fixed
- **Critical macOS Electron Bug**: Fixed "zero images found" issue on macOS by implementing robust Electron detection and cross-platform path joining
- **IPC Handler Bug**: Fixed critical bug where `listDirectoryFiles` handler wasn't returning success object, causing "Cannot read properties of undefined" errors
- **Excessive Console Logging**: Reduced thousands of repetitive "reading file" messages to essential diagnostic logs only
- **Cross-Platform Path Handling**: Fixed Windows-style path joining (`\`) that broke file access on macOS and Linux

### Added
- **macOS Auto-Updater Configuration**: Added proper entitlements, hardened runtime, and platform-specific error handling for macOS auto-updates
- **Robust Error Handling**: Enhanced validation in frontend to prevent crashes when IPC calls fail
- **Cross-Platform Build Verification**: Comprehensive testing and validation of build configuration for Windows, macOS, and Linux

### Technical Improvements
- **Electron Detection**: More robust detection using multiple checks (`window.electronAPI` + method existence)
- **Path Joining**: Cross-platform compatible path construction using `/` separator
- **Build System**: Verified and corrected electron-builder configuration for all 3 platforms
- **Code Quality**: Improved error handling and validation throughout the application

### Platforms
- **Windows**: NSIS installer with desktop/start menu shortcuts
- **macOS**: DMG packages for Intel and Apple Silicon with proper entitlements
- **Linux**: AppImage for portable distribution

## 📦 Downloads

Choose the appropriate installer for your operating system:

### 🪟 Windows
- **Installer**: `LocalImageBrowser-InvokeAI-Setup-1.7.4.exe`
- **Format**: NSIS installer with desktop and start menu shortcuts
- **Size**: ~50MB

### 🍎 macOS
- **Intel Macs**: `LocalImageBrowser-InvokeAI-1.7.4.dmg`
- **Apple Silicon**: `LocalImageBrowser-InvokeAI-1.7.4-arm64.dmg`
- **Format**: DMG packages with proper entitlements
- **Requirements**: macOS 10.15+

### 🐧 Linux
- **Universal**: `LocalImageBrowser-InvokeAI-1.7.4.AppImage`
- **Format**: Portable AppImage (no installation required)
- **Dependencies**: None (fully self-contained)

## 🚀 What's New in v1.7.4

### Fixed
- **Critical macOS Electron Bug**: Fixed "zero images found" issue on macOS by implementing robust Electron detection and cross-platform path joining
- **IPC Handler Bug**: Fixed critical bug where `listDirectoryFiles` handler wasn't returning success object, causing "Cannot read properties of undefined" errors
- **Excessive Console Logging**: Reduced thousands of repetitive "reading file" messages to essential diagnostic logs only
- **Cross-Platform Path Handling**: Fixed Windows-style path joining (`\`) that broke file access on macOS and Linux

### Added
- **macOS Auto-Updater Configuration**: Added proper entitlements, hardened runtime, and platform-specific error handling for macOS auto-updates
- **Robust Error Handling**: Enhanced validation in frontend to prevent crashes when IPC calls fail
- **Cross-Platform Build Verification**: Comprehensive testing and validation of build configuration for Windows, macOS, and Linux

### Technical Improvements
- **Electron Detection**: More robust detection using multiple checks (`window.electronAPI` + method existence)
- **Path Joining**: Cross-platform compatible path construction using `/` separator
- **Build System**: Verified and corrected electron-builder configuration for all 3 platforms
- **Code Quality**: Improved error handling and validation throughout the application

### Platforms
- **Windows**: NSIS installer with desktop/start menu shortcuts
- **macOS**: DMG packages for Intel and Apple Silicon with proper entitlements
- **Linux**: AppImage for portable distribution

## 🔧 System Requirements

- **OS**: Windows 10+, macOS 10.15+, Ubuntu 18.04+ (or equivalent)
- **RAM**: 4GB minimum, 8GB recommended
- **Storage**: 100MB for application + space for your image collections

## 📖 Documentation

- [README](https://github.com/LuqP2/local-image-browser-for-invokeai/blob/main/README.md)
- [Architecture](https://github.com/LuqP2/local-image-browser-for-invokeai/blob/main/ARCHITECTURE.md)
- [Changelog](https://github.com/LuqP2/local-image-browser-for-invokeai/blob/CHANGELOG.md)

## 🐛 Known Issues

- Safari, Firefox, and Brave browsers don't support the File System Access API on macOS
- Use Chrome, Vivaldi, Edge, or the Desktop App for full functionality

## 🙏 Feedback

Found a bug or have a feature request? [Open an issue](https://github.com/LuqP2/local-image-browser-for-invokeai/issues)!

---

*Released on 2025-09-24*