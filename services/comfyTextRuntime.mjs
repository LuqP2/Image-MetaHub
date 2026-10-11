/**
 * Runs inside the configured ComfyUI page. No host APIs and no arbitrary scripts.
 * Tokens bind a field to the exact page/workflow/graph/value seen by the user.
 */
export function comfyTextRuntime(operation, payload = {}, expectedOrigin) {
  const fail = (code, message) => ({ success: false, code, message, targets: [] });
  if (expectedOrigin && window.location.origin !== expectedOrigin) return fail('unavailable', 'ComfyUI navigated away from the configured server.');
  const app = window.app || window.comfyApp || window.ComfyApp?.instance;
  const canvas = app?.canvas;
  const graph = canvas?.graph;
  const root = app?.rootGraph || app?.graph;
  if (!canvas || !graph || !root) return fail('unavailable', 'ComfyUI is not ready. Copy text instead.');
  if (operation === 'selection') {
    const element = document.activeElement;
    const nodes = graph._nodes || Object.values(canvas.selected_nodes || {});
    const belongsToNode = nodes.some(node => (node.widgets || []).some(widget => widget.inputEl === element || widget.element === element));
    if (!belongsToNode || typeof element?.value !== 'string' || !Number.isInteger(element.selectionStart) || !Number.isInteger(element.selectionEnd))
      return fail('selection', 'Select text inside a node field.');
    const text = element.value.slice(element.selectionStart, element.selectionEnd);
    if (!text.trim() || text !== payload.text) return fail('selection', 'The text selection changed.');
    return { success: true, text, targets: [] };
  }
  if (typeof graph.beforeChange !== 'function' || typeof graph.afterChange !== 'function')
    return fail('unsupported', 'This frontend does not expose supported undoable text editing. Copy text instead.');
  const key = '__imhTextTargets';
  let state = window[key];
  if (!state || state.root !== root || state.graph !== graph || state.workflow !== app.workflowManager?.activeWorkflow) {
    state = window[key] = { root, graph, workflow: app.workflowManager?.activeWorkflow, targets: new Map() };
  }
  const selected = Object.values(canvas.selected_nodes || {});
  if (selected.length !== 1) return fail('selection', selected.length ? 'Select just one node.' : 'Select a text node in ComfyUI.');
  const node = selected[0];
  const compatible = (widget) => {
    const type = String(widget.type || '').toLowerCase();
    const input = node.inputs?.find((entry) => entry.name === widget.name);
    return typeof widget.value === 'string' && ['text', 'string', 'customtext'].includes(type)
      && !widget.disabled && !widget.computedDisabled && !widget.options?.readOnly && !widget.options?.readonly
      && !widget.inputEl?.readOnly && input?.link == null;
  };
  const widgets = (node.widgets || []).filter(compatible);
  if (!widgets.length) return fail('unsupported', 'The selected node has no editable text field. Copy text instead.');
  const lookup = (widget) => {
    for (const [token, entry] of state.targets) {
      if (entry.node === node && entry.widget === widget && entry.value === widget.value) return token;
    }
    const token = crypto.randomUUID();
    state.targets.set(token, { node, widget, value: widget.value });
    return token;
  };
  if (operation === 'query') {
    const tokens = new Set();
    const targets = widgets.map((widget) => {
      const token = lookup(widget); tokens.add(token);
      return { token, nodeId: String(node.id), nodeTitle: node.title || node.type || String(node.id), field: widget.name, preview: widget.value.slice(0, 100) };
    });
    for (const token of state.targets.keys()) if (!tokens.has(token)) state.targets.delete(token);
    return { success: true, targets };
  }
  if (operation !== 'apply' || !['append', 'replace'].includes(payload.mode)
    || typeof payload.text !== 'string' || !payload.text.trim()
    || ![', ', ' ', '\n'].includes(payload.separator)) return fail('invalid', 'Invalid text operation.');
  const entry = state.targets.get(payload.token);
  if (!entry || entry.node !== node || !widgets.includes(entry.widget) || entry.value !== entry.widget.value)
    return fail('conflict', 'The destination changed. Review the selected field and try again.');
  const widget = entry.widget;
  const before = widget.value;
  const after = payload.mode === 'replace' || !before.length ? payload.text : before + payload.separator + payload.text;
  if (before === after) return { success: true, targets: [], message: 'The field already contains this text.' };
  // DOM widgets invoke their callback from the value setter; ordinary widgets do not.
  let owner = widget, setter = false;
  while (owner) {
    if (Object.getOwnPropertyDescriptor(owner, 'value')?.set) { setter = true; break; }
    owner = Object.getPrototypeOf(owner);
  }
  graph.beforeChange();
  try {
    widget.value = after;
    if (!setter) widget.callback?.(after, canvas, node);
    if (widget.value !== after) throw new Error('The widget did not accept the text.');
    canvas.setDirty?.(true, true);
    state.targets.clear();
    return { success: true, targets: [], message: 'Updated ' + (node.title || node.type) + ' · ' + widget.name };
  } catch {
    try {
      widget.value = before;
      if (!setter) widget.callback?.(before, canvas, node);
    } catch {
      // A custom widget may also reject rollback; report the update failure below.
    }
    return fail('unsupported', 'The widget could not be updated. Copy text instead.');
  } finally {
    graph.afterChange();
  }
}
