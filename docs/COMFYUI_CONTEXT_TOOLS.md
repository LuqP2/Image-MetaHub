# ComfyUI Workspace context tools

The right panel has Image, Prompts and Models tabs. Its existing width and collapse preference are preserved; clicking a collapsed tab expands that tab. Switching tabs keeps the embedded canvas session and each visited panel mounted. Prompts and Models initialize on first use.

Image keeps thumbnail, metadata, navigation, copy/generate and queue actions. Save prompt uses the existing saved-prompt workflow; Use in composer opens a temporary Workspace composition. Select text inside either prompt channel and right-click to save the literal selection as a block.

Prompts opens the saved-prompt list. The navigation order is Prompts, Blocks, Compose; Compose is optional and its draft survives library navigation. Opening a saved prompt allows selecting literal text and sending it through the right-click Send to selected node action. Blocks offer Add to selected node directly from their cards; a block's details distinguish sending to the selected node from editing the saved block. Templates with unresolved required values open their fields instead of sending invalid text. Optional composition actions are grouped under Use in Compose. Block creation/editing has its own draft context and does not replace the composition.

Prompts use a main Prompt field. Add negative reveals an optional negative section; saved negative content is shown automatically. Blocks are channel-independent text fragments. Existing negative values, compositions and styles.csv imports remain compatible.

Selecting text in a native node textarea offers Save selection as prompt and Save selection as block in the embedded view's context menu. These save immediately without a form, title or channel question, preserve literal whitespace and show a brief confirmation without switching tabs. Only selections belonging to a node widget are accepted; search boxes and other frontend inputs are excluded. Custom widgets without a recognizable DOM text field keep the standard editing menu. Block saving retains the advanced-library entitlement.

The inline block picker stays open after insertion, supports search/categories/favorites and keeps the composition visible below it. Each insertion keeps a frozen snapshot. Empty free-text placeholders are not inserted when starting from a block. Workspace insertion requests are idempotent, including under React StrictMode.

Final text expands inside the editor, alongside template values. Copy and Append to field / Replace field live in a fixed footer. An optional negative source is offered only when negative text exists. A single destination field is shown as a label; multiple fields require an explicit choice. Title, tags, notes and optional metadata are revealed through Save to library. Workspace drafts and template preview values remain session-only and isolated from full-library drafts. Replacing or discarding modified drafts requires confirmation; failures preserve them. Filters expand above the library instead of replacing its list.

Models reads the existing Model Manager catalog and preserves its entitlement checks. Search by name/trigger words, filter type/base model/favorites, copy filenames or trigger words, add trigger words to a composition, and open the full Model Inspector in its existing window. This does not imply availability in the connected ComfyUI installation. This feature does not create model loaders, alter loader selections or initiate downloads.

## Apply to a selected node

Select exactly one node in the embedded ComfyUI canvas. Direct sending appends text with a comma separator to a single compatible field immediately; multiple fields require an explicit destination choice. It performs a fresh lookup per action and retains the same stale-target validation and clipboard fallback as the composer. In a composition's fixed footer or a model's trigger words, the destination lists compatible text widgets. A single field is selected automatically; multiple fields require a choice. Positive and negative are source channels; no target channel is inferred from node titles.

Append adds literal text to the end with comma, space or newline separators; an empty target receives text without a leading separator. Replace updates only the displayed field. Empty text or invalid template values cannot be applied. Each write revalidates the page, graph, selected node, widget and observed value. Stale targets produce a conflict rather than overwriting recent edits.

The adapter uses the currently displayed graph and text widgets, skips connected/read-only inputs and combo widgets, updates the widget value through its setter, and brackets the operation with the graph's history notifications. DOM setters already invoke callbacks; ordinary widgets receive a single explicit callback. Unsupported runtimes retain clipboard actions. Desktop IPC accepts only the primary Image MetaHub window and the configured ComfyUI origin. Reload/navigation invalidates page-local targets.

No queue/run command is issued. ComfyUI's own autoqueue-on-change preference may react to changes normally. Direct editing requires the embedded Electron view; external browsers retain clipboard use.

Dialogs covering the canvas temporarily hide the native embedded view and restore it after dismissal; inline block picking leaves the canvas visible.

## Validation and manual acceptance

Automated tests use synthetic catalogs and graphs. They cover literal writes, callback behavior, history brackets, stale targets, recreated nodes, displayed-graph changes, selection ambiguity, unsupported widgets, draft isolation and the Prompts → Models → composition flow, single insertion in StrictMode, continuous block picking and block editing without losing a composition.

Before declaring frontend compatibility verified, run the packaged application with a synthetic workflow:

1. Record the ComfyUI frontend version. Select a CLIP Text Encode node and apply a saved prompt with Append and Replace.
2. Confirm its textarea and serialized workflow both contain the text. Undo and redo each operation; each click must be one history step.
3. Try two text fields, multiple selected nodes, a connected text input, a read-only field and a custom text node. Unsupported destinations must retain Copy.
4. Change the destination text, workflow or selected node before applying; stale destinations must not write. Repeat inside a supported subgraph.
5. Start a Workspace composition, add a block and LoRA trigger words, switch tabs and app sections, and resume. Keep a separate full-library draft open and confirm neither overwrites the other.
6. Save a selection from Image and verify exact whitespace. Check a Free/expired-trial profile against the existing entitlement rules.
7. At 1366×768 and a larger size, manually check resizing, collapsed tabs, keyboard focus, scrolling and dialogs over the native canvas.

Synthetic tests and a renderer build do not prove packaged visual acceptance or compatibility with a user's ComfyUI installation.
