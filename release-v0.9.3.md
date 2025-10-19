# Release v0.9.3

## 🐛 Critical Fixes

### Multiple Folders/Subfolders Selection Bug
- **Fixed**: Images not displaying when multiple folders/subfolders were selected
- **Root Cause**: Overly restrictive filtering logic in `useImageStore.ts` that failed to properly aggregate images from all selected directories
- **Impact**: Users can now select and view images from multiple folders and subfolders simultaneously

### Sidebar Scroll Issue
- **Fixed**: DirectoryList occupying entire sidebar height when many subfolders were expanded
- **Root Cause**: DirectoryList had its own scroll container outside the main sidebar scroll area
- **Solution**: Moved DirectoryList inside the unified sidebar scroll container
- **Impact**: Filters are now always accessible by scrolling, even with many folders/subfolders

## ✨ UI Improvements

### Consistent Directory List Design
- DirectoryList now follows the same collapsible design pattern as filter sections
- Added expand/collapse button (matching Models, LoRAs, Schedulers sections)
- Added folder count badge showing number of loaded directories
- Consistent hover states and visual styling

### Better Navigation
- Single unified scrollbar for the entire sidebar
- Improved scrolling behavior between folders and filters
- More intuitive navigation experience

## 📝 Technical Details

**Files Changed:**
- `store/useImageStore.ts` - Simplified and corrected filtering logic for multi-directory support
- `components/DirectoryList.tsx` - Redesigned to match filter section pattern, removed separate scroll
- `components/Sidebar.tsx` - Moved DirectoryList into unified scroll container
- `CHANGELOG.md` - Updated with v0.9.3 changes
- `package.json` - Version bump to 0.9.3

## 🚀 Installation

Download the appropriate installer for your platform:
- **Windows**: `ImageMetaHub-Setup-0.9.3.exe`
- **macOS**: `ImageMetaHub-0.9.3.dmg`
- **Linux**: `ImageMetaHub-0.9.3.AppImage`

## 📦 What's Next?

This is a critical bug fix release addressing issues reported in v0.9.2. If you encounter any issues, please report them on our GitHub issues page.

---

**Full Changelog**: https://github.com/LuqP2/Image-MetaHub/compare/v0.9.2...v0.9.3
