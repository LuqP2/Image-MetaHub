## 2025-05-15 - Layout transitions and focus accessibility

**Learning:** For filtering systems with variable numbers of items (like filter chips), using `framer-motion` with `mode="popLayout"` on `AnimatePresence` and the `layout` prop on children provides a high-quality "reordering" feel when items are removed. Additionally, explicitly adding `focus-visible` to custom interactive elements (like icon-only buttons or star ratings) is critical for keyboard-only curation workflows.

**Action:** Always wrap dynamically added/removed UI lists in layout-aware animation containers and ensure every interactive `<button>` has a distinct `focus-visible` ring.
