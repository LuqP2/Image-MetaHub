import React, { useRef, useState } from 'react';
import type { ComfyUITextTarget } from '../types';
import { useComfyTextFeedback } from './useComfyTextFeedback';
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
  const feedback = useComfyTextFeedback();
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const write = async (target: ComfyUITextTarget, text: string, mode: 'append' | 'replace' | 'replaceSelection') => {
    const result = await window.electronAPI?.comfyUIViewApplyText?.({ token: target.token, text, mode, separator: ', ' });
    setPending(null); setToken('');
    feedback.report(result, mode, text, target);
  };
  const send = async (text: string, mode: 'append' | 'replace' | 'replaceSelection' = 'append') => {
    if (!text.trim() || inFlight.current) return;
    inFlight.current = true; setBusy(true); setPending(null); setToken('');
    try {
      if (mode === 'replaceSelection') {
        if (!selectionTarget) { feedback.report({ success: false, code: 'selection', targets: [], message: 'Select text inside a node field first.' }, mode, text); return; }
        await write(selectionTarget, text, mode); setSelectionTarget(null); return;
      }
      const result = await window.electronAPI?.comfyUIViewTextTargets?.();
      if (!result?.success || !result.targets.length) {
        feedback.report(result, mode, text, undefined, true);
      } else if (result.targets.length === 1) await write(result.targets[0], text, mode);
      else { setPending({ text, targets: result.targets, mode }); }
    } catch { feedback.report(undefined, mode, text); }
    finally { inFlight.current = false; setBusy(false); }
  };
  const confirm = async () => {
    const target = pending?.targets.find(entry => entry.token === token);
    if (!pending || !target || inFlight.current) return;
    inFlight.current = true; setBusy(true);
    try { await write(target, pending.text, pending.mode); }
    catch { feedback.report(undefined, pending.mode, pending.text); setPending(null); }
    finally { inFlight.current = false; setBusy(false); }
  };
  const panel = <>
    {feedback.toast}
    {pending && <section aria-label="Choose selected node field" className="space-y-2 rounded-lg border border-accent/30 p-3 text-xs">
      <p>{pending.targets[0].nodeTitle} · #{pending.targets[0].nodeId}</p>
      <select aria-label="Send destination field" className={fieldClass} value={token} onChange={e => setToken(e.target.value)}><option value="" disabled>Choose a field</option>{pending.targets.map(target => <option key={target.token} value={target.token}>{target.field} — {target.preview || 'Empty'}</option>)}</select>
      <div className="flex gap-2"><button className={buttonClass} disabled={busy || !token} onClick={() => void confirm()}>{pending.mode === 'replace' ? 'Replace selected field' : 'Add to selected field'}</button><button className={buttonClass} disabled={busy} onClick={() => { setPending(null); }}>Cancel</button></div>
    </section>}
  </>;
  return { send, panel, busy, refreshSelection, hasSelection: !!selectionTarget };
}
