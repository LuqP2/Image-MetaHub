## 2025-05-14 - Visual Keyboard Shortcut Hints
**Learning:** Using Tailwind's `peer` and `peer-focus` utilities provides a clean, CSS-only mechanism for toggling keyboard shortcut hints (`<kbd>`) based on input focus, avoiding redundant React state and keeping components lightweight.
**Action:** Favor peer utilities for simple focus-dependent UI elements in future UX enhancements.

**Learning:** Keyboard shortcut hints for global actions (like `/` for search) are highly beneficial for power users but should be hidden on mobile viewports (`hidden sm:inline-flex`) where hardware shortcuts are typically unavailable.
**Action:** Always include responsive visibility constraints for desktop-specific shortcut indicators.

## 2026-06-23 - Keyboard Accessibility for Custom Buttons
**Learning:** Custom interactive elements with `role="button"` and `tabIndex={0}` are reachable by keyboard navigation, but they do not automatically handle `Enter` or `Space` keystrokes like native `<button>` elements do.
**Action:** When creating custom buttons using `<div>` or `<span>`, always remember to attach an `onKeyDown` listener that checks for `event.key === 'Enter' || event.key === ' '`, calls `event.preventDefault()` to stop page scrolling, and triggers the same click handler.
## 2025-06-23 - Smooth Filter Bar Transitions
**Learning:** Unifying list-based UI elements (like filter chips) under a single AnimatePresence with the 'popLayout' mode and 'layout' prop ensures that additions, removals, and reordering feel fluid rather than jarring. This pattern is particularly effective for highly interactive bars where multiple filter types are mixed.
**Action:** Use a shared motion configuration and stable unique keys for all dynamic list items to maintain consistent animation behavior across the application.

## 2025-06-24 - Async Clipboard Feedback
**Learning:** Asynchronous UI feedback for operations like `navigator.clipboard.writeText` must await the Promise resolution. Providing immediate visual confirmation (like a "Copied!" checkmark) without checking for success can mislead users if the operation fails due to permissions or browser restrictions.
**Action:** Always await clipboard operations and use their success/failure to drive visual feedback states.

## 2025-06-25 - Localized Metadata Feedback
**Learning:** Replaying global "Toast" notifications for high-frequency actions like "Copy Prompt" on grid items can be intrusive. Transitioning the action button itself to a "Success" state (e.g., CheckCircle icon + green background) for 2000ms provides superior localized context and delight without cluttering the global notification stack.
**Action:** Use localized button state changes for quick metadata actions instead of global toasts.
## 2025-06-25 - Localized Feedback for Frequent Actions
**Learning:** For frequent, low-stakes actions like 'Copy to Clipboard', localized inline feedback (changing the button icon/color) is superior to global Toast notifications. It maintains the user's focus on the interaction point and reduces visual noise in the periphery.
**Action:** Prefer localized button state changes over global toasts for actions performed repeatedly within a grid or list.
