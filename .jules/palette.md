## 2024-05-14 - DirectoryList Icon Buttons Missing ARIA Labels
**Learning:** Several interactive icon-only buttons in the DirectoryList component (toggle subfolders, refresh, exclude/include, clear selection) lack `aria-label` attributes, affecting screen reader accessibility.
**Action:** Add descriptive `aria-label` attributes to all icon-only buttons in DirectoryList to ensure they meet the WCAG 2.5.3 Label in Name standard.

## 2026-05-21 - Modal Close Icon Buttons Missing ARIA Labels
**Learning:** Several modal components (TransferImagesModal, RenameImageModal, ProOnlyModal) lack `aria-label` attributes on their "Close" icon-only buttons, affecting screen reader accessibility. Although they have a `title` attribute, `aria-label` is standard for screen readers.
**Action:** Always add descriptive `aria-label` attributes to icon-only buttons, especially "Close" buttons in modals, to ensure they meet the WCAG 2.5.3 Label in Name standard.
