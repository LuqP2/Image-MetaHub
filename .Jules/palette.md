## 2025-05-14 - Visual Keyboard Shortcut Hints
**Learning:** Using Tailwind's `peer` and `peer-focus` utilities provides a clean, CSS-only mechanism for toggling keyboard shortcut hints (`<kbd>`) based on input focus, avoiding redundant React state and keeping components lightweight.
**Action:** Favor peer utilities for simple focus-dependent UI elements in future UX enhancements.

**Learning:** Keyboard shortcut hints for global actions (like `/` for search) are highly beneficial for power users but should be hidden on mobile viewports (`hidden sm:inline-flex`) where hardware shortcuts are typically unavailable.
**Action:** Always include responsive visibility constraints for desktop-specific shortcut indicators.

## 2026-06-23 - Keyboard Accessibility for Custom Buttons
**Learning:** Custom interactive elements with `role="button"` and `tabIndex={0}` are reachable by keyboard navigation, but they do not automatically handle `Enter` or `Space` keystrokes like native `<button>` elements do.
**Action:** When creating custom buttons using `<div>` or `<span>`, always remember to attach an `onKeyDown` listener that checks for `event.key === 'Enter' || event.key === ' '`, calls `event.preventDefault()` to stop page scrolling, and triggers the same click handler.

## 2025-07-01 - Standardized Tactile Feedback Scales
**Learning:** Consistent tactile feedback via `whileTap` scales enhances the "physicality" of the UI. For this design system, scaling factors should be tailored to the element size: 0.85 for small/icon-only buttons, 0.97 for standard action buttons, and 0.99 for large collapsible headers. This gradation ensures that feedback feels significant on small targets while remaining subtle on large ones.
**Action:** Apply the size-appropriate `whileTap` scale (0.85/0.97/0.99) to all new interactive elements to maintain a coherent tactile language.
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

## 2026-06-27 - Enhancing Hidden Interactive Elements
**Learning:** Buttons that only appear on hover (e.g., metadata copy buttons) are inaccessible to keyboard users. Using `group-focus-within:opacity-100` or `focus-visible` is critical to reveal these elements during navigation.
**Action:** Always pair `group-hover` visibility with `focus-within` or `focus-visible` states and provide a clear focus ring for keyboard users.

## 2025-06-28 - Keyboard Parity for Interactive List Items
**Learning:** Facet filters and list items often use `div` elements for layout flexibility, but they must implement `role="button"`, `tabIndex={0}`, and `onKeyDown` handlers to be accessible. Adding `framer-motion`'s `whileTap` provides the tactile feedback users expect from native interactive elements.
**Action:** When converting static list items to interactive ones, ensure full keyboard parity and use micro-interactions (like subtle scaling) to signal interactivity.

## 2026-07-02 - Refined Tactile Feedback for Desktop Controls
**Learning:** While 0.85 scale is suitable for very small/nested icons, a more conservative 0.9 scale is better for prominent header and window controls on desktop. It provides clear physical feedback without feeling overly "squishy." Additionally, always pair these interactions with clear focus indicators (e.g., `focus-visible:ring-2`) to maintain accessibility standards when modifying custom interactive elements.
**Action:** Use 0.9 scale for primary modal/window controls and ensure focus-visible rings are present.
