## 2024-05-18 - WCAG 2.5.3 Label in Name Insight
**Learning:** Adding an `aria-label` to a button that already has visible text (like the "Back" button) overrides the accessible name. This causes a WCAG 2.5.3 violation because voice control users who say "Click Back" won't be able to activate it if the `aria-label` is "Return to the stacked results".
**Action:** Only apply `aria-label` to icon-only buttons. If a button has visible text, rely on that text for the accessible name, or ensure the visible text is fully contained within the `aria-label`.
