# Architecture Decisions Log

This file documents significant architectural decisions, design choices, and important conclusions made during development. Each entry represents a completed feature or major change with its rationale and alternatives considered.

## Guidelines

### When to Add an Entry:
- ✅ New major features or architectural changes
- ✅ Significant refactoring or redesign decisions
- ✅ Technology stack changes
- ✅ Performance optimization decisions
- ✅ API design decisions
- ✅ Data structure or storage decisions

### When NOT to Add:
- ❌ Small bug fixes
- ❌ Minor UI improvements
- ❌ Code style changes
- ❌ Documentation updates
- ❌ Routine maintenance

### Entry Format:
```
## YYYY-MM-DD: [TYPE] - Brief Title

**Decision:** [What was implemented]

**Context:** [Why this was needed]

**Rationale:** [Why this approach was chosen]

**Alternatives Considered:** [Other options evaluated and why they were rejected]

**Impact:** [What this affects in the system]

**Testing:** [How this was validated]
```

---

## Recent Decisions

## 2025-09-20: FEATURE - Update Button for Incremental Indexing

**Decision:** Added "Update" button for incremental indexing of new images without full re-indexing.

**Context:** Users needed a way to index only newly added images without re-processing the entire collection, which was time-consuming for large image sets.

**Rationale:** Implemented `handleUpdateIndexing` function that:
- Checks for new PNG files not present in cache
- Processes only new images using existing `processDirectory` function
- Updates cache incrementally without affecting existing data
- Preserves current filters, search queries, and pagination state
- Shows progress only for new images being indexed

**Alternatives Considered:**
- Auto-update on folder change (rejected: violates user control, could be disruptive)
- Background indexing (rejected: adds complexity, potential performance issues)
- Manual cache refresh (rejected: less user-friendly than dedicated button)

**Impact:** 
- Improves user experience for large image collections
- Reduces indexing time for incremental updates
- Maintains all existing functionality and state
- UI layout: [Change Folder] [Update] in status area

**Testing:** Build successful, function integrated with existing cache and filtering systems.

## 2025-09-20: CONFIG - Dual Logging Architecture

**Decision:** Implemented dual logging system separating development scratch pad from architectural decisions.

**Context:** Need for better development tracking while maintaining clean Git history and preserving important architectural knowledge.

**Rationale:** Separates iterative development work (detailed, messy) from permanent architectural decisions (clean, summarized). This approach provides the best of both worlds: comprehensive development tracking without cluttering version control.

**Alternatives Considered:**
- Single versioned changelog (rejected: creates merge conflicts, too much detail in Git)
- No development logging (rejected: loses valuable iterative insights)
- Versioned development log with manual cleanup (rejected: error-prone, time-consuming)

**Impact:** Changes development workflow, affects how changes are tracked and documented, improves collaboration.

**Testing:** Workflow validated through implementation and initial usage.

## 2025-09-20: FIX - Clipboard Operations in ImageModal

**Decision:** Enhanced clipboard operations with focus management and robust prompt extraction.

**Context:** Right-click context menu in ImageModal was failing due to focus issues and incomplete prompt parsing from InvokeAI metadata.

**Rationale:** Added document focus verification before clipboard operations and comprehensive prompt extraction that handles different InvokeAI metadata formats (string, array, object).

**Alternatives Considered:**
- Browser-only focus handling (rejected: doesn't work in Electron)
- Simple prompt extraction (rejected: fails with complex InvokeAI metadata)

**Impact:** Right-click context menu now works reliably for copying prompts and metadata in both browser and Electron environments.

**Testing:** Verified clipboard operations work across different InvokeAI metadata formats and environments.

## 2025-09-20: CONFIG - Automated Release Workflow

**Decision:** Implemented GitHub Actions workflow for automatic building and publishing of cross-platform installers.

**Context:** Manual release process was time-consuming and error-prone for multi-platform distribution.

**Rationale:** GitHub Actions automatically builds Windows (.exe), macOS (.dmg), and Linux (.AppImage) installers on version tag creation, with automatic publishing to GitHub Releases.

**Alternatives Considered:**
- Manual builds (rejected: inconsistent and time-consuming)
- Third-party CI/CD (rejected: adds complexity and cost)
- Local build scripts (rejected: doesn't scale for multi-platform)

**Impact:** Streamlined release process, consistent cross-platform builds, automatic publishing.

**Testing:** Workflow configuration validated and tested with sample builds.

## 2025-09-20: FIX - File Path Handling in Context Menu

**Decision:** Improved file path handling in right-click context menu with better user feedback and directory context.

**Context:** Users reported that "Copy file path" only copied filenames and "Show in file explorer" didn't work properly due to File System Access API limitations.

**Rationale:** File System Access API only provides relative paths, not absolute paths. Added directory name context and improved messaging to help users understand file locations. Enhanced Electron integration for better file explorer functionality.

**Alternatives Considered:**
- Attempting to construct absolute paths (rejected: violates browser security model)
- Hiding the functionality in web version (rejected: reduces user experience)
- Complex path resolution workarounds (rejected: over-engineering for limited benefit)

**Impact:** Better user experience in right-click context menu, clearer feedback about file locations, improved cross-platform compatibility.

**Testing:** Verified improved messaging, clipboard functionality, and Electron file explorer integration.

## 2025-09-20: PERF - Performance Optimization with Caching System

**Decision:** Implemented useRef-based caching system and reduced excessive logging to fix infinite console logging loop and improve file discovery performance.

**Context:** File discovery was generating thousands of console.log messages and repeatedly calling expensive file operations without caching, causing severe performance degradation with large image collections.

**Rationale:** Added useRef-based caching to prevent repeated file discovery calls and removed excessive console.log statements. This approach provides immediate performance benefits while maintaining functionality and debugging capabilities when needed.

**Alternatives Considered:**
- No caching (rejected: causes repeated expensive operations)
- Local storage caching (rejected: overkill for session-based operations)
- Debounced logging (rejected: doesn't solve root performance issue)

**Impact:** Eliminates infinite logging loop, significantly improves file discovery performance, reduces console noise while preserving essential debugging information.

**Testing:** Verified with 17,000+ image collections, confirmed logging reduced from thousands to minimal messages, file discovery performance optimized with caching.

## 2025-09-20: SEC - Auto-Updater Security Fix

**Decision:** Disabled automatic downloads in auto-updater and implemented user-controlled update process.

**Context:** Auto-updater was downloading updates automatically without user consent, violating user control over their system and potentially causing unwanted interruptions.

**Rationale:** Added `autoUpdater.autoDownload = false` and replaced `checkForUpdatesAndNotify()` with `checkForUpdates()`. Implemented manual download trigger that only starts download when user explicitly chooses "Download Now" from dialog.

**Alternatives Considered:**
- Keep automatic downloads (rejected: violates user consent and control)
- Remove auto-updater entirely (rejected: users should have update option)
- Only notify without download option (rejected: reduces user experience)

**Impact:** Users now have complete control over update downloads, prevents unwanted automatic downloads, maintains update functionality with user consent.

**Testing:** Verified dialog appears correctly, download only starts on user confirmation, no automatic downloads occur.

## 2025-09-20: FIX - Environment Detection Consistency

**Decision:** Standardized environment detection logic across all services to use window.electronAPI check instead of window.process.type.

**Context:** File deletion functionality was incorrectly showing "only available in desktop version" even when running in Electron due to inconsistent environment detection patterns.

**Rationale:** Different files were using different methods to detect Electron environment:
- fileOperations.ts: `window.process && window.process.type` (broken)
- imageUtils.ts: `(window as any).electronAPI` (working)
Standardized on the working pattern that checks for electronAPI existence, which is more reliable and consistent with how the Electron API is exposed via preload.js.

**Alternatives Considered:**
- Keep inconsistent detection methods (rejected: leads to bugs and confusion)
- Use only window.process.type (rejected: doesn't work reliably in Electron)
- Complex environment detection with fallbacks (rejected: over-engineering)

**Impact:** Ensures consistent environment detection across all file operations, fixes delete functionality in Electron, improves code maintainability.

**Testing:** Verified Electron app detects environment correctly, delete functionality now works as expected.

---

## Recent Decisions

## 2025-09-23: FEATURE - Click-to-Edit Pagination

**Decision:** Implemented click-to-edit functionality for page numbers in pagination controls.

**Context:** Users needed a more intuitive way to jump to specific pages without using a separate input field.

**Rationale:** Added interactive page number editing with visual cues (cursor pointer, subtle hover background), keyboard support (Enter/Escape), and accessibility features. Users can click any page number to edit it directly inline.

**Alternatives Considered:**
- Separate jump-to-page input field (rejected: less intuitive, takes more space)
- Dropdown page selector (rejected: not suitable for large page counts)
- No direct page editing (rejected: poor UX for large collections)

**Impact:** Significantly improves navigation UX for large image collections, reduces clicks needed to reach specific pages.

**Testing:** Verified mouse and keyboard interaction, accessibility, error handling, and visual feedback.

## 2025-09-23: PERF - Smart Cache Cleanup System

**Decision:** Implemented intelligent cache cleanup instead of full reindexing when refreshing folders.

**Context:** Cache contained stale entries for deleted files, causing refresh operations to fail and requiring expensive full reindexing.

**Rationale:** Added `cleanStaleCacheEntries` method that compares cached files against actual directory contents and removes only stale entries, preserving valid cache data. This provides fast incremental updates while maintaining cache integrity.

**Alternatives Considered:**
- Full reindexing on every refresh (rejected: too slow for large collections)
- Time-based cache invalidation only (rejected: doesn't handle file deletions)
- Manual cache clearing (rejected: poor user experience)

**Impact:** Refresh operations now complete in seconds instead of minutes, new images appear immediately without full reindexing.

**Testing:** Verified with collections containing 17,000+ images, confirmed stale entries are removed while valid cache is preserved.

## 2025-09-23: FIX - Consistent PNG Filtering in File Detection

**Decision:** Standardized PNG filtering logic across all file detection operations.

**Context:** New images weren't appearing on refresh because file detection used different filtering logic than PNG counting, missing intermediate images that should be excluded.

**Rationale:** Applied consistent `!isIntermediateImage` filtering throughout the codebase, ensuring new file detection matches the same criteria used for initial indexing and PNG counting.

**Alternatives Considered:**
- Include all PNG files (rejected: would show intermediate/temporary images)
- Complex filtering rules (rejected: over-engineering, hard to maintain)

**Impact:** New images now appear correctly after refresh folder operations, maintains clean image display without intermediate files.

**Testing:** Added debug logging to verify directory vs cache file comparison, confirmed filtering consistency.

## 2025-09-23: UI - Modernized Pagination Jump-to-Page

**Decision:** Enhanced the jump-to-page input field with modern web conventions and accessibility.

**Context:** The existing page jump functionality was not user-friendly and lacked proper feedback.

**Rationale:** Redesigned the input field to be compact, added Enter key support, error feedback with visual shake animation, accessibility labels, and responsive design. Integrated visually with pagination controls.

**Alternatives Considered:**
- Large modal dialog (rejected: disruptive to workflow)
- Separate page navigation panel (rejected: takes too much space)
- No jump functionality (rejected: poor UX for large collections)

**Impact:** Users can now jump to any page quickly and intuitively with proper error feedback and accessibility support.

**Testing:** Verified in both browser and Electron environments, tested input validation and keyboard navigation.

---

## Recent Decisions