## 2025-05-14 - Visual Keyboard Shortcut Hints
**Learning:** Using Tailwind's `peer` and `peer-focus` utilities provides a clean, CSS-only mechanism for toggling keyboard shortcut hints (`<kbd>`) based on input focus, avoiding redundant React state and keeping components lightweight.
**Action:** Favor peer utilities for simple focus-dependent UI elements in future UX enhancements.

**Learning:** Keyboard shortcut hints for global actions (like `/` for search) are highly beneficial for power users but should be hidden on mobile viewports (`hidden sm:inline-flex`) where hardware shortcuts are typically unavailable.
**Action:** Always include responsive visibility constraints for desktop-specific shortcut indicators.

## 2025-06-23 - Smooth Filter Bar Transitions
**Learning:** Unifying list-based UI elements (like filter chips) under a single AnimatePresence with the 'popLayout' mode and 'layout' prop ensures that additions, removals, and reordering feel fluid rather than jarring. This pattern is particularly effective for highly interactive bars where multiple filter types are mixed.
**Action:** Use a shared motion configuration and stable unique keys for all dynamic list items to maintain consistent animation behavior across the application.
