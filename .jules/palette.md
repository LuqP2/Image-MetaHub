## 2024-05-14 - DirectoryList Icon Buttons Missing ARIA Labels
**Learning:** Several interactive icon-only buttons in the DirectoryList component (toggle subfolders, refresh, exclude/include, clear selection) lack `aria-label` attributes, affecting screen reader accessibility.
**Action:** Add descriptive `aria-label` attributes to all icon-only buttons in DirectoryList to ensure they meet the WCAG 2.5.3 Label in Name standard.

## 2026-05-21 - Modal Close Icon Buttons Missing ARIA Labels
**Learning:** Several modal components (TransferImagesModal, RenameImageModal, ProOnlyModal) lack `aria-label` attributes on their "Close" icon-only buttons, affecting screen reader accessibility. Although they have a `title` attribute, `aria-label` is standard for screen readers.
**Action:** Always add descriptive `aria-label` attributes to icon-only buttons, especially "Close" buttons in modals, to ensure they meet the WCAG 2.5.3 Label in Name standard.

## 2024-06-02 - ImageModal Zoom Controls & Overlay Icons Missing ARIA Labels & Disabled Reasons
**Learning:** Icon-only buttons within the image viewer overlay (like zoom controls, full screen toggle, sidebar toggle) were missing `aria-label` attributes. Additionally, the zoom buttons became disabled at zoom limits but didn't provide a contextual reason in their tooltips.
**Action:** When implementing or updating disabled states for interactive elements, dynamically update the `title` and `aria-label` to briefly explain why the element is disabled (e.g., "Zoom In (Maximum reached)"). Always include `aria-hidden="true"` on purely decorative SVGs within these buttons.

## 2024-05-24 - ImageEditorWorkspace Icon Buttons Missing ARIA Labels
**Learning:** Several icon-only buttons in the ImageEditorWorkspace component (such as Back, Undo, Redo, Flatten, Copy, and Close Inspector) lacked `aria-label` attributes, relying only on `title` attributes for tooltips.
**Action:** Always add descriptive `aria-label` attributes to all icon-only buttons, even when `title` is present, to ensure they meet the WCAG 2.5.3 Label in Name standard and are accessible to screen readers.
