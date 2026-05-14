## 2024-05-14 - DirectoryList Icon Buttons Missing ARIA Labels
**Learning:** Several interactive icon-only buttons in the DirectoryList component (toggle subfolders, refresh, exclude/include, clear selection) lack `aria-label` attributes, affecting screen reader accessibility.
**Action:** Add descriptive `aria-label` attributes to all icon-only buttons in DirectoryList to ensure they meet the WCAG 2.5.3 Label in Name standard.
