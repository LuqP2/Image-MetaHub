## 2025-06-17 - Keyboard Focus States for Custom UI Controls
**Learning:** Custom UI controls like `SettingSwitch` (which uses a `button` with `role="switch"`) and complex sidebar navigation items can easily lose visible focus states when styled with Tailwind if not explicitly configured, making keyboard navigation difficult or invisible.
**Action:** When implementing or modifying custom interactive elements (especially switches, toggles, or navigation pills), always verify that `focus-visible` classes are present to ensure they are accessible via the Tab key without relying on browser default outlines that may be suppressed by global CSS resets.

## 2025-06-18 - Rich Empty States for Filtered Views
**Learning:** In complex data-heavy applications, a blank screen when filters return no results is a dead-end that can frustrate users. A "Rich Empty State" that provides explicit feedback on why no results were found (e.g., active filters) and includes a high-visibility "Clear all filters" button provides an immediate recovery path.
**Action:** Always implement descriptive empty states with actionable recovery buttons for searchable or filterable lists. Ensure the "Clear All" action is also discoverable near the active filter indicators to reduce travel distance for mouse users.
