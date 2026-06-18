## 2024-05-14 - DirectoryList Icon Buttons Missing ARIA Labels
**Learning:** Several interactive icon-only buttons in the DirectoryList component (toggle subfolders, refresh, exclude/include, clear selection) lack `aria-label` attributes, affecting screen reader accessibility.
**Action:** Add descriptive `aria-label` attributes to all icon-only buttons in DirectoryList to ensure they meet the WCAG 2.5.3 Label in Name standard.

## 2026-05-21 - Modal Close Icon Buttons Missing ARIA Labels
**Learning:** Several modal components (TransferImagesModal, RenameImageModal, ProOnlyModal) lack `aria-label` attributes on their "Close" icon-only buttons, affecting screen reader accessibility. Although they have a `title` attribute, `aria-label` is standard for screen readers.
**Action:** Always add descriptive `aria-label` attributes to icon-only buttons, especially "Close" buttons in modals, to ensure they meet the WCAG 2.5.3 Label in Name standard.

## 2024-06-02 - ImageModal Zoom Controls & Overlay Icons Missing ARIA Labels & Disabled Reasons
**Learning:** Icon-only buttons within the image viewer overlay (like zoom controls, full screen toggle, sidebar toggle) were missing `aria-label` attributes. Additionally, the zoom buttons became disabled at zoom limits but didn't provide a contextual reason in their tooltips.
**Action:** When implementing or updating disabled states for interactive elements, dynamically update the `title` and `aria-label` to briefly explain why the element is disabled (e.g., "Zoom In (Maximum reached)"). Always include `aria-hidden="true"` on purely decorative SVGs within these buttons.

## 2024-05-20 - Descriptive Titles on Disabled States
**Learning:** Icon-only buttons that change state (like Undo/Redo) can cause confusion when disabled without explanation. Adding dynamic `title` attributes that explain *why* an action is disabled (e.g. "Nothing to undo" instead of just "Undo") provides immediate, helpful feedback to users.
**Action:** When implementing interactive elements with disabled states, especially icon-only buttons, provide dynamic `title` attributes explaining the disabled reason to improve clarity.
## 2024-05-15 - ComparisonOverlayView Icon Buttons Missing ARIA Labels
**Learning:** Icon-only buttons for zooming, resetting zoom, and pausing/resuming the flicker mode in the `ComparisonOverlayView` were missing `aria-label` attributes.
**Action:** Added descriptive `aria-label` attributes to these icon-only buttons to improve screen reader accessibility. Also added `aria-hidden="true"` to the decorative SVGs to prevent redundant announcements by screen readers.

## 2024-05-22 - Centralizing File System Operations
**Learning:** Micro-UX features involving file paths (like "Copy File Path") often require different logic for Electron vs. Web. Implementing this logic multiple times in hooks (`useContextMenu`) and components (`ImageModal`) leads to bugs, inconsistent separators, and high maintenance.
**Action:** Always centralize filesystem-adjacent UX utilities (path construction, clipboard interaction) in `utils/imageUtils.ts` or dedicated service files. Ensure they handle the environment check internally to keep UI components clean and focused on presentation.
## 2025-06-17 - Keyboard Focus States for Custom UI Controls
**Learning:** Custom UI controls like `SettingSwitch` (which uses a `button` with `role="switch"`) and complex sidebar navigation items can easily lose visible focus states when styled with Tailwind if not explicitly configured, making keyboard navigation difficult or invisible.
**Action:** When implementing or modifying custom interactive elements (especially switches, toggles, or navigation pills), always verify that `focus-visible` classes are present to ensure they are accessible via the Tab key without relying on browser default outlines that may be suppressed by global CSS resets.
