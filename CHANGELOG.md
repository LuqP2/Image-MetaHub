# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.9.2] - 2025-10-12

### Added
- **Draw Things Metadata Support**: Added complete support for Draw Things (iOS/Mac AI app) generated images with SD-like parameter parsing
- **Mobile AI Workflow Analysis**: BI Pro support for analyzing creative workflows from iOS/Mac Stable Diffusion apps
- **Device Model Detection**: Automatic extraction of device models (iPhone, iPad, iPod) for mobile workflow categorization
- **App Version Tracking**: Support for Draw Things app version extraction and mobile app identification
- **Mobile-Specific Tags**: Automatic tagging with 'Mobile AI', device types (iPhone, iPad, iOS), and generation quality indicators
- **SD Parameter Compatibility**: Full support for Stable Diffusion parameters (Prompt, Negative prompt, Steps, CFG scale, Seed, Size, Model)
- **iOS/macOS Integration**: Optimized parsing for Draw Things PNG metadata format with mobile device indicators
- **Adobe Firefly Metadata Support**: Added complete support for Adobe Firefly generated images with C2PA/EXIF metadata parsing
- **Firefly C2PA Manifest Parsing**: Comprehensive extraction of Content Credentials, edit history, and generation parameters
- **Creative Asset Analysis**: BI Pro support for analyzing edit actions and creative workflows from Firefly's C2PA data
- **AI Generated Tags**: Automatic tagging with 'AI Generated', 'Firefly', version tags, and content-based tags (Photography, Artwork, Illustration, 3D Render)
- **Edit History Tracking**: Parse and display complete edit history from C2PA actions for creative asset management
- **Regex Fallback Parsing**: Enhanced EXIF/C2PA parsing with regex fallback for description fields when structured data unavailable
- **Firefly Version Detection**: Support for Adobe Firefly version extraction and model identification
- **Niji Journey Metadata Support**: Added complete support for Niji Journey generated images with automatic metadata parsing from PNG parameters
- **Niji Journey Parameter Extraction**: Regex-based parsing for Niji Journey parameters (--niji, --v, --ar, --q, --s, --seed)
- **Anime Tag Support**: Automatic tagging of Niji Journey images with 'Anime' for filtering
- **Niji Version Detection**: Support for Niji Journey version extraction (--niji 5, --niji 6, etc.)
- **DreamStudio Metadata Support**: Added complete support for DreamStudio (Stability AI) generated images with automatic metadata parsing from PNG parameters
- **DreamStudio Parameter Extraction**: Comprehensive parsing of DreamStudio parameters including style presets, guidance scale, and model variants
- **Stability AI Format Detection**: Automatic detection of DreamStudio format with proper distinction from A1111 and Forge formats
- **Midjourney Metadata Support**: Added complete support for Midjourney-generated images with automatic metadata parsing from PNG parameters
- **Midjourney Parameter Extraction**: Regex-based parsing for Midjourney parameters (--v, --ar, --q, --s, --seed)
- **Aspect Ratio Processing**: Automatic dimension calculation from --ar parameters
- **Forge Metadata Support**: Added complete support for Forge (A1111-based) generated images with automatic metadata parsing
- **Forge Parameter Extraction**: Comprehensive parsing of Forge parameters including hires upscaling, denoising, and model information
- **Gradio Integration**: Support for Gradio-based Forge interfaces with automatic format detection
- **Easy Diffusion Sidecar JSON Support**: Added support for reading metadata from sidecar JSON files alongside PNG/JPEG images
- **Enhanced Easy Diffusion Parsing**: Improved detection and parsing with fallback to embedded metadata when JSON not available
- **Easy Diffusion Metadata Support**: Added complete support for Easy Diffusion-generated images with automatic metadata parsing from PNG parameters field
- **Enhanced Format Detection**: Improved automatic detection to distinguish Easy Diffusion from Automatic1111 based on metadata patterns
- **SwarmUI Metadata Support**: Added complete support for SwarmUI-generated images with automatic metadata parsing, model extraction, and LoRA detection
- **DALL-E 3 Metadata Support**: Added complete support for DALL-E 3 generated images with C2PA/EXIF metadata parsing
- **C2PA Manifest Parsing**: Offline parsing of Content Authenticity Initiative (C2PA) manifests for DALL-E images
- **EXIF Metadata Extraction**: Extraction of OpenAI DALL-E specific EXIF tags and generation metadata
- **AI Content Tagging**: Automatic tagging of AI-generated content for filtering and organization
- **Debug Logging**: Added comprehensive logging for JSON detection and parsing operations
- **Added Vitest:** Integrated the Vitest testing framework and configured it with a `jsdom` environment.
- **Added Unit Tests:** Created an initial test suite for the `automatic1111Parser`, demonstrating how to write effective unit tests for the application's parsers.
- **Added ESLint:** Set up ESLint with a modern `eslint.config.js` configuration, including rules for TypeScript and React.
- **Configured ESLint Rules:** Established a practical ESLint ruleset that flags potential issues without being overly disruptive, such as downgrading `no-explicit-any` to a warning.
- **Progressive Loading**: Removed blocking loading overlay after first batch of images, allowing immediate navigation while indexing continues in background
- **Indexing Progress Display**: Status bar now shows real-time indexing progress ("🔄 Indexing: 200 / 21727 files processed") instead of generic loading message
- **Newest Files First**: Files are now sorted by modification date (newest first) during indexing for better user experience with recent images
- **Indexing Safety Controls**: Disabled Add Folder, Reload Folder, and Delete/Rename buttons during indexing to prevent conflicts and data corruption
- **Incremental Filter Updates**: Fixed sidebar filters disappearing during refresh by updating filter options incrementally as images are processed

### Fixed
- **Context Menu Auto-Close**: Fixed ImageModal context menu not closing when clicking outside the menu - now closes when clicking anywhere within the modal except the menu itself
- **Refresh Filter Loss**: Fixed issue where sidebar filters would disappear during folder refresh operations

### Changed
- **Image Grid Virtualization**: Migrated the main image grid from `react-virtualized` Masonry to `react-window` FixedSizeGrid for improved performance and stability with large collections (20k+ images)
- **Dynamic Column Calculation**: Grid now adapts column count and cell size responsively to zoom and window size, eliminating layout bugs and overflows
- **Consistent Thumbnail Layout**: Fixed issues with overlapping, excessive spacing, and unpredictable cell heights during zoom in/out
- **Simplified Codebase**: Removed complex Masonry logic and cell measurement, making the grid code easier to maintain and debug
- **Performance**: Achieved smooth scrolling and instant rendering even with tens of thousands of images

### Technical Improvements
- **Enhanced ComfyUI Parser - Phase 1**: Aggressive payload detection with multiple decompression strategies (JSON, Base64, zlib/gzip) and regex fallback for robust metadata extraction
- **Parser Telemetry**: Local logging system for debugging with detection method tracking, unknown nodes count, and warnings (no external data exfiltration)
- **Intelligent Fallback Parsing**: Regex-based parameter extraction from text strings when structured parsing fails (Prompt, Steps, CFG, Sampler, Seed, Model)
- **Payload Detection**: Checks all PNG chunks for ComfyUI indicators (comfyui, workflow, nodes, class_type) and detects large JSON blocks via regex
- **Layered Decompression**: Try-catch layers for JSON.parse, Base64 decode, and zlib inflate with magic byte detection (\x78\x9c for zlib)
- **Enhanced ComfyUI Parser - Phase 2**: Advanced parameter extraction with multiple seed formats, model hash mapping, and comprehensive modifier detection
- **Advanced Seed Extraction**: Support for numeric, hex (0x), and derived seeds with approximateSeed flag for randomized seeds
- **Model Hash Mapping**: Automatic mapping of unknown models to "unknown (hash: xxxx)" format when model name unavailable
- **ControlNet/LoRA/VAE Detection**: Comprehensive extraction with weights, modules, and applied_to information from loader and apply nodes
- **Edit History Tracking**: Parse SaveImage and LoadImage nodes to reconstruct image generation workflow history
- **ComfyUI Version Detection**: Automatic extraction of ComfyUI version from workflow metadata
- **Enhanced ComfyUI Parser - Phase 3 (Testing & CLI)**: Comprehensive test suite with 13 test cases covering all parser features, CLI tooling for developers
- **Automated Testing**: Vitest test suite with fixtures for basic workflows, LoRA, ControlNet, hex seeds, model hashes, edit history, and version detection
- **Test Coverage**: 13/13 tests passing covering detection methods, error handling, telemetry, and advanced features
- **CLI Tooling**: New `imagemetahub-cli` command-line tool for parsing single files and batch indexing directories
- **Developer Documentation**: Added "Common Failure Modes" and "How to Add a New Node" sections to COMFYUI-PARSER-GUIDE.md with real-world examples
- **Modular Parser Architecture**: Extended parser factory to include Midjourney, Forge, Easy Diffusion, SwarmUI, and DALL-E format detection and parsing
- **Parameter Flag Detection**: Intelligent detection of Midjourney parameter flags for format identification
- **Extended Parser Architecture**: Added Forge parser to the modular parser factory with intelligent format detection
- **A1111 Compatibility**: Forge parser reuses A1111 parsing logic while adding Forge-specific features
- **Hires Parameter Support**: Extraction of high-resolution upscaling parameters (upscaler, upscale factor, steps, denoising)
- **Sidecar JSON Detection**: Automatic detection of .json files with same name as images (e.g., image.png + image.json)
- **Electron-Compatible File Reading**: Uses electronAPI.readFile for secure file access
- **Fallback Mechanism**: Falls back to embedded PNG metadata if sidecar JSON unavailable
- **Type-Safe JSON Parsing**: Proper TypeScript interfaces for Easy Diffusion JSON format
- **Parameter-based Parsing**: Added regex-based parsing for Easy Diffusion's text format (Prompt, Negative prompt, Steps, CFG scale, etc.)
- **Enhanced Metadata Detection**: Improved automatic format detection to recognize SwarmUI's sui_image_params structure
- **C2PA/EXIF Parsing**: Offline parsing of C2PA manifests and EXIF metadata for DALL-E images
- **File Processing Order**: Changed file processing order to sort by lastModified date descending (newest first) for better user experience
- **UI Safety During Indexing**: Added isIndexing prop to Header, DirectoryList, and ImageModal components to disable destructive operations during indexing
- **IPC Listener Management**: Added onIndexingProgress, onIndexingBatchResult, onIndexingError, and onIndexingComplete listeners to preload.js for real-time indexing feedback
- **Batch Processing Logic**: Modified handleBatchProcessed callback to remove loading overlay after first batch while continuing to add images progressively

### Changed
- **Progressive Loading Implementation**: Modified useImageLoader.ts to remove loading overlay after first batch and show images progressively during indexing
- **Status Bar Enhancement**: Updated StatusBar.tsx to display indexing progress with file counts when indexing is active
- **File Processing Order**: Changed file processing order to sort by lastModified date descending (newest first) for better user experience
- **UI Safety During Indexing**: Added isIndexing prop to Header, DirectoryList, and ImageModal components to disable destructive operations during indexing

## [0.9.1] - 2025-10-08

### Added
- **Right Sidebar Image Preview**: New collapsible sidebar that displays image preview and metadata when hovering over thumbnails in the grid
- **Enhanced Cache Management**: Added "Clear All Cache" button in Settings modal with confirmation dialog and automatic state reset
- **Improved ComfyUI Support**: Enhanced grouped workflow parsing with proper widget value extraction and custom node extractors

### Fixed
- **ComfyUI NaN Parsing**: Fixed "Unexpected token 'N', ...\"changed\": NaN..." JSON parsing errors for ComfyUI workflows with invalid numeric values
- **Cache Clearing**: Fixed cache clearing functionality to properly reset application state and reload the page
- **Grouped Workflows**: Fixed parsing of ComfyUI grouped workflow nodes (e.g., "workflow>Load Model - Flux") by using prompt.inputs data directly
- **Stack Overflow Fix**: Prevented infinite recursion in ImageModal when directory path is undefined
- **CLI Directory Loading**: Fixed command-line directory loading to properly initialize Directory objects

### Changed
- **Version Numbering**: Reset version to 0.9.x series, indicating pre-1.0 beta status

### Technical Improvements
- Enhanced ComfyUI traversal engine with better link following and custom extractors for complex nodes (ttN concat, CFGGuider)
- Improved error handling and validation in ImageModal to prevent crashes
- Better state management and cleanup for orphaned image references

## [1.9.0] - 2025-10-03

### Added
- Multiple Directory Support: Add and manage multiple image directories simultaneously
- New Settings Modal: Configure cache location and automatic update preferences
- Resizable Image Grid: Adjustable thumbnail sizes for better display on high-resolution screens
- Command-Line Directory Support: Specify startup directory via command-line arguments
- Exposed Development Server: Access dev server from local network devices

### Fixed
- Cross-platform path construction issues resolved
- Improved file operations reliability
- Fixed cached image loading problems

## [1.8.1] - 2025-09-30

### Added
- **Subfolder Scanning Control**: Added configurable subfolder scanning with checkbox in folder selector and toggle in header, allowing users to choose whether to scan subdirectories or limit to selected folder only


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
- **Enhanced Metadata Parsing**: Intelligent detection prioritizing ComfyUI workflow > InvokeAI metadata > A1111 parameters
- **Cross-Platform Compatibility**: Improved Electron/browser environment detection and path handling
- **Date Sorting Accuracy**: Uses file creation date (birthtime) instead of modification date for AI-generated images
- **Error Handling**: Comprehensive error handling for malformed metadata and file system operations
- **Console Optimization**: Cleaned up excessive logging for better performance and debugging experience

### Fixed
- **Cache Collision Bug**: Fixed cache system incorrectly treating folders with same names as identical entries, causing unnecessary re-indexing when switching between different folders with similar names
- **Refresh Re-indexing Bug**: Fixed refresh functionality re-indexing entire folders instead of only changed files due to timestamp inconsistency between initial indexing (creation time) and refresh (modification time)
- **Show in Folder Button**: Fixed "Show in Folder" button in image modal interface that was failing due to incorrect async handling and parameter passing
- **Advanced Filters Bug**: Fixed disconnected state between App.tsx and useImageStore preventing filter application
- **Filter Data Extraction**: Corrected sidebar reading from raw metadata instead of normalized IndexedImage properties
- **Range Filter Logic**: Fixed images with undefined steps/cfg being incorrectly included in range filters
- **Export Functionality**: Fixed images being exported to source folder instead of selected destination
- **Image Duplication**: Resolved critical bug causing double processing of files (36k instead of 18k images)
- **Syntax Errors**: Fixed critical syntax errors in electron.mjs preventing app startup
- **Format Detection**: Fixed ComfyUI images with A1111 parameters being incorrectly detected as A1111 format
- **Model Filter Issues**: Enhanced InvokeAI model extraction to work across multiple field names and formats

### Dependencies Updated
- **Tailwind CSS v4**: Updated PostCSS configuration and styling system
- **Zustand v5**: Migrated to latest version with improved TypeScript support
- **exifr Library**: Added for professional JPEG EXIF metadata extraction

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

## [1.7.5] - 2025-09-28

### Added
- **Automatic1111 Integration**: Parse PNG metadata from Automatic1111's "parameters" chunk with model, LoRA, and generation parameter extraction
- **Universal Metadata Parser**: Intelligent detection and parsing of different metadata formats based on PNG chunk keywords
- **Enhanced Model Filtering**: Improved model extraction and filtering that works across all supported AI image generation tools
- **Structured Metadata Display**: Redesigned ImageModal with organized fields for Models, LoRAs, Scheduler, Prompt, CFG Scale, Steps, Seed, and Dimensions
- **Export Functionality**: Added TXT and JSON export options for metadata with proper formatting
- **Context Menu**: Right-click image context menu for copy operations and file actions
- **Navigation Controls**: Keyboard shortcuts and UI controls for image navigation (arrow keys, fullscreen mode)
- **Improved File Operations**: Fixed "Show in Folder" functionality to use correct file paths instead of UUIDs

### Technical Improvements
- **Type-Safe Metadata Handling**: New TypeScript interfaces for Automatic1111Metadata and ComfyUIMetadata with proper type guards
- **Dynamic Metadata Extraction**: Re-extraction of models, LoRAs, and schedulers during cache reconstruction for data consistency
- **Backward Compatibility**: Maintained full compatibility with existing InvokeAI metadata and caching system
- **Cross-Format Filtering**: Unified filtering system that works seamlessly with images from different generation tools
- **Workflow Automation**: Improved GitHub Actions workflows with separate jobs for Windows, macOS, and Linux builds
- **Build System Optimization**: Cleaned up duplicate workflow configurations and ensured proper artifact generation

### Fixed
- **Model Filter Issues**: Resolved problem where InvokeAI model filters weren't working due to cache reconstruction using stale metadata
- **Cache Data Consistency**: Fixed cache loading to dynamically re-extract metadata fields instead of using potentially outdated cached values
- **File Path Handling**: Fixed "Show in Folder" and "Copy File Path" to use actual filenames instead of internal UUIDs
- **TypeScript Errors**: Added missing ImageModalProps interface definition
- **Workflow Conflicts**: Removed duplicate macOS and Linux build jobs from main workflow to prevent conflicts
- **UI Regression**: Restored enhanced ImageModal design with structured metadata fields and export functionality

## [1.7.4] - 2025-09-24

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

## [1.7.3] - 2025-09-23

### Added
- **Click-to-Edit Pagination**: Click any page number to jump directly to that page for instant navigation
- **Smart Cache Cleanup**: Automatic removal of stale cache entries without full reindexing for faster refresh operations
- **Enhanced Refresh Folder**: Improved incremental indexing that detects new images reliably without performance degradation

### UI Improvements
- **Modern Pagination UI**: Redesigned pagination controls with better error feedback, accessibility, and user experience
- **Complete README Overhaul**: Restructured documentation to emphasize offline-first desktop application with clearer feature organization
- **Streamlined Installation**: Simplified installation instructions focusing on desktop app usage

### Technical Improvements
- **Intelligent Cache Management**: Smart cleanup system that preserves valid cache while removing stale entries for deleted files
- **Consistent PNG Filtering**: Standardized filtering logic across all file detection operations to prevent refresh issues
- **Enhanced User Experience**: Improved navigation and feedback throughout the application

### Fixed
- **Refresh Folder Reliability**: Fixed inconsistent behavior where new images weren't appearing after folder refresh
- **Cache Stale Entry Handling**: Resolved issues with cache containing references to deleted files causing performance problems

## [1.7.2] - 2025-09-23

### Fixed
- **Refresh Folder Bug**: Fixed critical issue where clicking "Refresh Folder" would return 0 results on first click due to stale cache data
- **Cache Validation**: Improved cache validation logic to detect when cached data doesn't match current folder contents
- **Cache Fallback**: Added automatic fallback to full reindexing when cache reconstruction fails but PNG files exist

### Technical Improvements
- Enhanced cache management to prevent showing empty results when folder contents change
- Improved error handling for cache reconstruction failures
- Better user feedback during folder refresh operations
- Optimized refresh logic to use incremental updates when possible instead of full reindexing

## [1.7.1] - 2025-09-20

### Added
- **Fullscreen Viewing**: Added fullscreen functionality to ImageModal with dedicated button, ESC key support, and hover controls
- **Refresh Folder**: Added incremental indexing capability with "Update" button for processing only new images without re-indexing entire collections
- **Enhanced Image Viewing**: Improved image viewing experience with fullscreen mode and clean UI controls

### Technical
- Implemented fullscreen state management in ImageModal component
- Added keyboard event handling for ESC key to exit fullscreen
- Enhanced UI with hover-based controls for better user experience
- Added handleUpdateIndexing function for incremental image processing
- Maintained responsive layout and sidebar visibility in fullscreen mode
- Preserved existing filters and pagination state during incremental updates

## [1.7.0] - 2025-09-20

### Fixed
- **Performance Issue**: Fixed infinite console logging loop that was generating thousands of log entries during file discovery
- **Electron Detection**: Corrected Electron environment detection in `getAllFileHandles` function to properly use Electron APIs instead of browser APIs
- **Caching System**: Added caching mechanism to prevent repeated file discovery calls and improve performance

### Technical
- Enhanced file discovery performance with useRef-based caching
- Reduced excessive console logging in file reading operations
- Improved Electron API detection and usage patterns
- Maintained backward compatibility with browser File System Access API

## [1.6.1] - 2025-09-19

### Added
- **Privacy-First Auto-Updates**: Enhanced auto-updater with user choice controls and manual update checks
- **User Control**: Better update notifications with skip options and user preferences

### Fixed
- **Electron Compatibility**: Fixed "UnknownError: Internal error" when selecting directories in Electron app
- **Cross-Platform File Access**: Implemented proper file system handling for both browser and desktop environments
- **IPC Communication**: Added missing preload.js functions for directory listing and file reading

### Technical
- Enhanced Electron environment detection in `getAllFileHandles` function
- Added `listDirectoryFiles` and `readFile` IPC handlers
- Improved error handling for file system operations
- Maintained backward compatibility with browser File System Access API

## [1.6.0] - 2025-09-19

### Added
- **Enhanced Auto-Updater**: Manual update check functionality with user prompts
- **Show in Folder**: Added ability to show selected images in system file explorer
- **File Explorer Integration**: Cross-platform file explorer opening functionality

### Technical
- Integrated `showItemInFolder` functionality in Electron
- Enhanced UI integration for file operations
- Improved user experience for file management

## [1.5.3] - 2025-09-18

### Added
- **Advanced Filtering**: Steps range slider for precise filtering by inference steps
- **Range Filtering**: CFG Scale and Steps range filtering components
- **Enhanced Filtering UI**: Improved filtering interface with range controls

### Fixed
- **Documentation**: Clarified privacy policies and removed duplicate content in README
- **Board Filtering**: Removed unreliable board filtering due to inconsistent metadata

### Technical
- Implemented `StepsRangeSlider` component for advanced filtering
- Enhanced filtering system with range-based controls
- Improved documentation clarity and organization

## [1.5.2] - 2025-09-17

### Added
- **Board Filtering**: Added filtering by board/workspace information
- **Navigation Controls**: Enhanced image navigation and browsing controls

### Fixed
- **Board Metadata**: Removed board filtering due to unreliable metadata availability
- **Package Dependencies**: Updated and cleaned up package dependencies

### Technical
- Enhanced image browsing functionality
- Improved metadata handling for board information
- Updated dependency management

## [1.5.1] - 2025-09-17

### Added
- **File System Access API**: Enhanced browser compatibility with File System Access API
- **Electron Integration**: Improved Electron app integration and scripts
- **Scheduler Filtering**: Added scheduler type filtering (DPMSolverMultistepScheduler, etc.)
- **Metadata Export**: TXT and JSON export functionality for image metadata

### Fixed
- **Selection Behavior**: Fixed image selection and interaction behavior
- **Documentation**: Updated documentation for new features

### Technical
- Enhanced Window interface for File System Access API support
- Updated package.json with new Electron scripts
- Improved metadata extraction and filtering systems
- Enhanced caching mechanisms and LoRA extraction

## [1.5.0] - 2025-09-17

### Added
- **Multi-Selection**: Added Ctrl+click support for selecting multiple images similar to Windows Explorer
- **Bulk Operations**: Added ability to delete multiple selected images at once from the main grid
- **Selection Toolbar**: Added selection counter and bulk action toolbar when images are selected
- **Visual Feedback**: Selected images now show blue ring and checkmark overlay

### UI Improvements
- **Simplified Modal Controls**: Redesigned image modal with cleaner interface
- **Inline File Actions**: Rename and delete buttons now appear as small icons next to filename
- **Export Dropdown**: Combined TXT and JSON export into a single dropdown menu
- **Better Visual Hierarchy**: Improved spacing and visual organization of modal elements
- **Keyboard Navigation**: Enhanced keyboard shortcuts and dropdown interactions

### User Experience
- **Windows-like Selection**: Familiar multi-selection behavior matching Windows file explorer
- **Quick Actions**: Faster access to common file operations with simplified UI
- **Bulk Management**: Efficient handling of multiple images for organization workflows
- **Cleaner Interface**: Reduced visual clutter while maintaining all functionality

## [1.4.0] - 2025-09-17

### Added
- **File Management**: Added rename and delete functionality for image files (Electron app only)
- **Rename Files**: Click rename button in image modal to change filename with validation
- **Delete Files**: Delete images with confirmation dialog, files are moved to system trash/recycle bin
- **File Operations**: Added secure IPC communication between renderer and main process for file operations

### UI Improvements
- Added rename and delete buttons in image detail modal with clear icons and colors
- Rename dialog with inline text input and validation feedback
- Confirmation dialogs for destructive operations
- Disabled state management during operations to prevent conflicts

### Technical
- Created fileOperations service for handling file management
- Enhanced Electron IPC handlers with proper file path resolution
- Added proper error handling and user feedback for file operations
- File operations are desktop-only for security reasons

## [1.3.0] - 2025-09-17

### Added
- **Metadata Export**: Added export buttons in image modal to save metadata as TXT or JSON files
- **TXT Export**: Readable text format with organized sections for models, LoRAs, scheduler, and complete metadata
- **JSON Export**: Structured JSON format with export info, extracted data, and raw metadata

### UI Improvements
- Added export buttons with distinctive icons and colors in image detail modal
- Enhanced modal layout to accommodate new export functionality

## [1.2.0] - 2025-09-17

### Added
- **Scheduler Filtering**: Added new filter option to search images by scheduler type (DPMSolverMultistepScheduler, EulerDiscreteScheduler, etc.)

### UI Improvements
- Added scheduler dropdown filter alongside model and LoRA filters
- Enhanced filter extraction system to parse scheduler metadata from images
- Improved filter layout and accessibility

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