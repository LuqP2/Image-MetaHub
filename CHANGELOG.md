# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.7.2] - 2025-09-20

### Fixed
- **Critical Search Bug**: Fixed complete search functionality failure where no images were being found
- **Dimension Filter Accuracy**: Fixed dimension filtering to find ALL images (was only finding partial matches)
- **Search Performance**: Optimized search operations with 3-5x performance improvement
- **Date Sorting in Electron**: Fixed date sorting that wasn't working due to missing file modification dates
- **Electron Header Buttons**: Fixed missing "Change Folder" and "Update" buttons in Electron app header
- **Drag Sensitivity**: Improved image drag sensitivity with proper bounds checking

### Performance
- **Search Optimization**: Removed excessive logging that was slowing down filter operations
- **Unified Extraction Logic**: Created consistent helper functions for data extraction across components
- **Filter Pre-processing**: Optimized lowercase conversions to run once instead of per-image
- **Memory Efficiency**: Reduced memory usage in filter operations

### Technical
- **Search Logic Unification**: Standardized search implementation across all search types
- **Environment Detection**: Improved Electron vs browser compatibility
- **Error Handling**: Enhanced error handling for file operations
- **Code Consistency**: Unified data extraction patterns across components

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