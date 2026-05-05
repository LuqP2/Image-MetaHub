# Palette's Journal

No critical learnings yet.

## 2024-05-18 - SearchBar Accessibility (Placeholder vs Label)
**Learning:** Found an accessibility issue where an input relied exclusively on its placeholder for descriptive context. Screen readers often don't announce placeholders reliably as labels, or they disappear once the user starts typing. Additionally, inline decorative SVGs were unhidden.
**Action:** Always add an explicit `aria-label` to inputs that don't have a linked `<label>`. Mark decorative icons (like search magnifiers or clear 'X's) with `aria-hidden="true"`.
