import React, { useRef, useState } from 'react';
import type { ComfyUITextTarget } from '../types';
import { copyTextToClipboard } from '../utils/imageUtils';
import { buttonClass, fieldClass } from '../components/promptLibrary/PromptVariables';

/** One-shot lookup/write. Multiple fields require an explicit destination. */
export function useSendToComfyUINode() {
  const [pending, setPending] = useState<{ text: string; targets: ComfyUITextTarget[]; mode: 'append' | 'replace' | 'replaceSelection' } | null>(null);
  const [selectionTarget, setSelectionTarget] = useState<ComfyUITextTarget | null>(null);
  const selectionRequest = useRef(0);
  const refreshSelection = async () => {
    const request = ++selectionRequest.current;
    setSelectionTarget(null);
    try {
      const result = await window.electronAPI?.comfyUIViewTextTargets?.();
      if (request === selectionRequest.current) setSelectionTarget(result?.success ? result.targets.find(target => target.hasSelection) || null : null);
    } catch { if (request === selectionRequest.current) setSelectionTarget(null); }
  };
  const [token, setToken] = useState('');
  const [status, setStatus] = useState('');
  const [fallback, setFallback] = useState('');
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const write = async (target: ComfyUITextTarget, text: string, mode: 'append' | 'replace' | 'replaceSelection') => {
    const result = await window.electronAPI?.comfyUIViewApplyText?.({ token: target.token, text, mode, separator: ', ' });
    setPending(null); setToken('');
    setStatus(result?.message || (result?.success ? 'Added to selected node.' : 'Direct editing is unavailable. Copy the text instead.'));
    setFallback(result?.success ? '' : text);
  };
  const send = async (text: string, mode: 'append' | 'replace' | 'replaceSelection' = 'append') => {
    if (!text.trim() || inFlight.current) return;
    inFlight.current = true; setBusy(true); setStatus('Sending…'); setFallback(''); setPending(null); setToken('');
    try {
      if (mode === 'replaceSelection') {
        if (!selectionTarget) { setStatus('Select text inside a node field first.'); return; }
        await write(selectionTarget, text, mode); setSelectionTarget(null); return;
      }
      const result = await window.electronAPI?.comfyUIViewTextTargets?.();
      if (!result?.success || !result.targets.length) {
        setStatus(result?.message || 'Select a compatible text node in the embedded ComfyUI Workspace.'); setFallback(text);
      } else if (result.targets.length === 1) await write(result.targets[0], text, mode);
      else { setPending({ text, targets: result.targets, mode }); setStatus('Choose the destination field.'); }
    } catch { setStatus('Could not send text. Copy it or select the node again.'); setFallback(text); }
    finally { inFlight.current = false; setBusy(false); }
  };
  const confirm = async () => {
    const target = pending?.targets.find(entry => entry.token === token);
    if (!pending || !target || inFlight.current) return;
    inFlight.current = true; setBusy(true);
    try { await write(target, pending.text, pending.mode); }
    catch { setStatus('Could not send text. Select the node again.'); setFallback(pending.text); setPending(null); }
    finally { inFlight.current = false; setBusy(false); }
  };
  const panel = <>
    {status && <p role="status" className="break-words text-xs text-gray-400">{status}</p>}
    {pending && <section aria-label="Choose selected node field" className="space-y-2 rounded-lg border border-accent/30 p-3 text-xs">
      <p>{pending.targets[0].nodeTitle} · #{pending.targets[0].nodeId}</p>
      <select aria-label="Send destination field" className={fieldClass} value={token} onChange={e => setToken(e.target.value)}><option value="" disabled>Choose a field</option>{pending.targets.map(target => <option key={target.token} value={target.token}>{target.field} — {target.preview || 'Empty'}</option>)}</select>
      <div className="flex gap-2"><button className={buttonClass} disabled={busy || !token} onClick={() => void confirm()}>{pending.mode === 'replace' ? 'Replace selected field' : 'Add to selected field'}</button><button className={buttonClass} disabled={busy} onClick={() => { setPending(null); setStatus(''); }}>Cancel</button></div>
    </section>}
    {fallback && <button className={buttonClass} onClick={async () => { const result = await copyTextToClipboard(fallback); setStatus(result.success ? 'Copied.' : result.error || 'Copy failed.'); }}>Copy text instead</button>}
  </>;
  return { send, panel, busy, refreshSelection, hasSelection: !!selectionTarget };
}
