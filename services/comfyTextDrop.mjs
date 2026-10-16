/** Installed once per embedded document; ordinary image/workflow drops pass through. */
export function installComfyTextDrop(runtime, expectedOrigin) {
  if (window.location.origin !== expectedOrigin || window.__imhTextDropInstalled) return;
  window.__imhTextDropInstalled = true;
  const mime = 'application/x-imagemetahub-prompt-text';
  const accepts = event => Array.from(event.dataTransfer?.types || []).includes(mime);
  let dismissMenu = () => {};
  const report = result => {
    const status = document.createElement('div');
    status.setAttribute('role', result.success ? 'status' : 'alert');
    status.textContent = result.message || 'Could not add text to this node.';
    status.style.cssText = 'position:fixed;bottom:24px;left:24px;z-index:2147483647;max-width:420px;padding:12px 16px;border-radius:8px;background:#18181b;color:#fafafa;border:1px solid #71717a;font:13px sans-serif;pointer-events:none';
    document.body.append(status);
    setTimeout(() => status.remove(), 4000);
  };
  document.addEventListener('dragover', event => {
    if (!accepts(event)) return;
    event.preventDefault(); event.stopImmediatePropagation();
    event.dataTransfer.dropEffect = 'copy';
  }, true);
  document.addEventListener('drop', event => {
    if (!accepts(event)) return;
    event.preventDefault(); event.stopImmediatePropagation();
    const text = event.dataTransfer.getData(mime);
    dismissMenu();
    const position = { x: event.clientX, y: event.clientY };
    if (!event.shiftKey) { report(runtime('drop', { text, ...position }, expectedOrigin)); return; }
    const result = runtime('dropQuery', position, expectedOrigin);
    if (!result.success || result.targets.length !== 1) { report(result); return; }
    const target = result.targets[0];
    const menu = document.createElement('div');
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', 'Add or replace node text');
    menu.style.cssText = 'position:fixed;z-index:2147483647;min-width:200px;padding:4px;border:1px solid #71717a;border-radius:8px;background:#18181b;color:#fafafa;font:13px sans-serif;box-shadow:0 8px 24px #0008';
    menu.style.left = Math.max(8, Math.min(event.clientX, window.innerWidth - 224)) + 'px';
    menu.style.top = Math.max(8, Math.min(event.clientY, window.innerHeight - 110)) + 'px';
    const outside = event => { if (!menu.contains(event.target)) dismissMenu(); };
    const escape = event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); dismissMenu(); } };
    const expiry = setTimeout(() => dismissMenu(), 30000);
    dismissMenu = () => {
      menu.remove(); clearTimeout(expiry);
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('keydown', escape, true);
      dismissMenu = () => {};
    };
    for (const mode of ['append', 'replace']) {
      const button = document.createElement('button');
      button.type = 'button'; button.setAttribute('role', 'menuitem');
      button.textContent = mode === 'append' ? 'Add to node' : 'Replace node text';
      button.title = target.nodeTitle + ' · ' + target.field;
      button.style.cssText = 'display:block;width:100%;padding:10px;text-align:left;background:transparent;color:inherit;border:0;cursor:pointer';
      button.addEventListener('click', () => {
        dismissMenu();
        report(runtime('applyDrop', { token: target.token, text, mode, separator: ', ' }, expectedOrigin));
      });
      menu.append(button);
    }
    document.body.append(menu);
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', escape, true);
    menu.querySelector('button').focus();
  }, true);
}
