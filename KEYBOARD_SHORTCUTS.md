# Keyboard Shortcuts

This document lists all keyboard shortcuts available in Image MetaHub.

## Global Shortcuts

These shortcuts work anywhere in the application:

| Shortcut | Action | Description |
|----------|--------|-------------|
| `Ctrl/Cmd+K` | Open Command Palette | Quick access to all commands |
| `Ctrl/Cmd+.` | Open Quick Settings | Access application settings |
| `F1` | Open Keyboard Shortcuts Help | Show this help dialog |
| `Ctrl/Cmd+O` | Add Folder | Open folder picker to add images |
| `Ctrl/Cmd+Shift+R` | Rescan Folders | Re-index all folders |
| `Ctrl/Cmd+L` | Toggle List/Grid View | Switch between view modes |
| `Ctrl/Cmd+F` | Focus Search | Jump to search input |
| `/` | Quick Search | Alternative search activation |
| `Ctrl/Cmd+Shift+F` | Toggle Advanced Filters | Show/hide advanced filtering |
| `Ctrl/Cmd+A` | Select All | Select all visible images |
| `Delete` | Delete Selected | Move selected images to trash |
| `Space` | Toggle Quick Preview | Show/hide preview pane |
| `Enter` | Open Fullscreen | Open focused image in modal |
| `Esc` | Close/Clear | Close modals or clear selection |

## Grid Navigation

These shortcuts work when browsing the image grid:

| Shortcut | Action | Description |
|----------|--------|-------------|
| `Arrow Keys` | Navigate Images | Move focus between images |
| `Enter` | Open Image Modal | Open focused image in modal with metadata panel |
| `Alt+Enter` | Open Image Fullscreen | Open focused image with metadata panel hidden (fullscreen view) |
| `PageDown` | Next Page | Go to next page of results |
| `PageUp` | Previous Page | Go to previous page |
| `Home` | First Page | Jump to first page |
| `End` | Last Page | Jump to last page |

## Image Modal

These shortcuts work when viewing an image in the modal:

| Shortcut | Action | Description |
|----------|--------|-------------|
| `←/→` | Previous/Next Image | Navigate through images |
| `Enter` | Close Modal | Close modal and return to grid |
| `Alt+Enter` | Toggle Image Fullscreen | Hide/show metadata panel for fullscreen image viewing |
| `Esc` | Exit or Close | Exit image fullscreen mode or close modal |
| `Ctrl/Cmd+C` | Copy Image | Copy image to clipboard |

**Note**: "Fullscreen" in this context means viewing the image without the metadata panel, not system fullscreen (F11).

## Command Palette

These shortcuts work within the command palette (opened with `Ctrl/Cmd+K`):

| Shortcut | Action | Description |
|----------|--------|-------------|
| `↑/↓` | Navigate Commands | Move through command list |
| `Enter` | Execute Command | Run the selected command |
| `Esc` | Close Palette | Cancel and close |

## Focus Areas

Switch focus between different areas of the app:

| Shortcut | Action | Description |
|----------|--------|-------------|
| `Ctrl/Cmd+1` | Focus Sidebar | Jump to folder sidebar |
| `Ctrl/Cmd+2` | Focus Image Grid | Jump to image grid |
| `Ctrl/Cmd+3` | Focus Preview Pane | Jump to preview sidebar |

## Platform-Specific Notes

### Windows/Linux
- Use `Ctrl` for all shortcuts
- Numpad keys work same as regular number keys (Issue #48 fixed)
- `Alt+Enter` for fullscreen uses borderless maximize

### macOS
- Use `Cmd` (⌘) instead of `Ctrl`
- Native fullscreen animation with `Alt+Enter`
- Menu bar remains accessible in fullscreen

## Fixed Issues

- ✅ Issue #48: Numpad keys now work correctly on Linux
- ✅ Issue #21: Enter key now opens images without requiring grid focus
- ✅ Issue #26: Alt+Enter now properly closes modal when entering fullscreen
- ✅ Issue #24: Exit fullscreen button works after Alt+Enter (see previous fixes)
- ✅ Issue #25: Titlebar handled correctly in fullscreen (see previous fixes)
- ✅ Issue #15: Delete key now works reliably across all contexts

## Customization

Keyboard shortcuts can be customized in Settings > Keyboard Shortcuts. Changes are saved automatically and apply immediately.

## Technical Implementation

The keyboard system uses multiple layers for maximum compatibility:

1. **hotkeys-js** - Global shortcut manager with numpad support
2. **Component listeners** - Context-specific handlers (modal, grid, palette)
3. **Event coordination** - Prevents conflicts using stopPropagation and capture phase
4. **Cross-platform** - Unified behavior across Windows, Linux, and macOS
