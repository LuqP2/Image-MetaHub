# Prompt Library

The library has two tabs, Prompts and Blocks, with virtualized list/grid views. Opening an item shows read-only details and copy actions; **Edit** explicitly enters the editor. **Save** returns to details; **Cancel** guards unsaved changes. Legacy saved prompts remain literal positive/negative text. Creating a composition or a template is an explicit action.

Filters open in a separate scrollable side panel and do not push the item list down. The browser shows real model/category/tag information only, without a repetitive item-type or unknown-model footer. Prompts without titles show their content excerpt without a placeholder title, including in details. Favorites use a heart. **Select** opens bulk selection controls; clicking anywhere on a card selects or deselects it in both list and grid views. The checkbox also works, and the favorite action remains independent. The library tools menu contains Random and Import / Export; each item's actions menu contains duplication, deletion and duplicate analysis.

## Editing and composition

- Prompts have a title, positive and negative text, notes, tags, favorite state, model/generator/LoRA/sampler/scheduler labels and an optional linked image.
- Blocks hold reusable text, category and variable definitions. Select prompt text in the ImageModal or Library details sidebar, right-click, then choose **Save Selection as Block**. The captured selection survives opening the menu and preserves its whitespace.
- Compose uses the full editor workspace, with an independently scrollable expanded result beside it on desktop and an explicit result toggle on narrow windows. **Add block** opens a searchable picker with images, categories and text excerpts. Block text is collapsed initially; the empty negative channel is collapsed. Reorder with the drag handle or arrow buttons, toggle parts and choose comma, space or newline separators.
- Each block instance saves its own text and variable definitions. Editing or deleting the original never silently changes a saved composition. **Update this block** replaces only the selected instance after confirmation. The comparison uses content, since imported blocks receive new IDs and revisions.
- **Template fields** separates field definitions in the editor from temporary field filling in details. Templates expand `{{name}}` once, literally. Definitions support text or a list of options, default values and required fields. Missing definitions or values prevent copying an invalid result. Plain prompts keep braces literally.
- The final preview can copy positive, negative or both channels. Filling template fields is temporary; it does not change saved defaults. **Create copy as text** saves the current expanded result as an ordinary prompt.

## Organization and portability

Search checks title, positive/negative text, notes, tags, category and model metadata. Quoted phrases and terms combine with AND. Tags and models combine with OR within their respective filter groups; groups combine with AND. Filters include type, category, favorites and saved/updated/source dates. Unknown source dates remain unknown.

Bulk actions add/remove tags, set favorites and set block categories. Exact duplicate detection compares literal text in both channels; similar detection uses a conservative text similarity score in a worker. Duplicates are suggestions, never automatic merges. Deliberate duplication is allowed.

Organization uses removable tag chips and suggestions. Generation parameters are optional and collapsed in the editor. Selected-text extraction initially asks for a title and block text; organization and template fields are optional collapsed sections, with a saved confirmation. Import and export use separate tabs; export has explicit scope and format choices, including selected items, filtered items and the entire library.

JSON uses `format: image-metahub-prompt-library` and `schemaVersion: 1`. It preserves editor fields, structure, disabled parts and block snapshots. IDs are remapped on import, equivalent items can be skipped, and imports never overwrite existing items. Local source paths and preview links are removed from exported JSON. Exported compositions include their reusable source blocks when those blocks still exist; orphan snapshots remain usable.

`styles.csv` uses `name,prompt,negative_prompt`. It supports quoted commas, quotes, newlines, BOM and negative-only styles. A `{prompt}` placeholder becomes a required `{{prompt}}` template field. CSV cannot preserve tags, notes, composition structure or image links. Templates with other variables require JSON or resolved CSV. Resolved CSV uses saved defaults, not session field values.

Previews link to files rather than copying images into the prompt catalog. Desktop uses validated original/stable file references; missing files can be relinked. Browser file links last only for the current session. Returning from another app section restores an unsaved draft within that session; reloading requires saving first.

## Entitlements and storage

Free includes basic editing, organization of individual items, search, filters, favorite/duplicate, preview/copy, import/export and exact duplicate detection. Pro and active trials enable block creation/extraction/content editing, composition/template structure editing, bulk organization and similar duplicate analysis. After expiry, existing advanced items remain readable, their template fields fillable, metadata editable, and final text copyable/exportable.

Desktop persists in the existing provenance catalog (schema 8). Browser persists prompts and blocks in the dedicated prompt IndexedDB database (version 3). Mutations validate before writing; desktop batches are transactional. Updates require the revision read by the editor, so concurrent changes produce a conflict rather than overwriting a draft. Cache reset preserves the catalog and dedicated browser database.

## Verification

Focused Vitest tests use synthetic metadata, DOM and temporary databases. They cover migration, negative-only content, snapshots after edit/delete/reopen, transactional failures, revision conflicts, field filling on Free, extraction from both real surfaces, CSV/JSON, search, draft recovery and preview lifecycle.

For a packaged Windows directory build:

```powershell
node scripts/runPackagedSavedPromptSmoke.mjs "path/to/Image MetaHub.exe"
node scripts/runPackagedSavedPromptSmoke.mjs "path/to/Image MetaHub.exe" --node-runtime
```

Both runners create temporary profiles. The first exercises the main-process bootstrap; the second exercises the packaged ASAR and Electron Node/SQLite runtime and does not validate bootstrap or renderer behavior. They report coverage explicitly.

Manual acceptance should check layout/scrolling at the app's usual window sizes, selected-text context menus in ImageModal and Details, positive/negative composition ordering, template form readability, image relinking, and Free/expired-trial presentation. Automated visual acceptance is not part of these tests.
