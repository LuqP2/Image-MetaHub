import React, { useEffect, useRef, useState } from 'react';
import { useComfyTextFeedback } from '../../hooks/useComfyTextFeedback';
import type { ComfyUITextResult } from '../../types';
import { buttonClass, fieldClass } from '../promptLibrary/PromptVariables';
let sessionSeparator: ', ' | ' ' | '\n' = ', ';

export default function ComfyUITextActions({ positive = '', negative = '', errors = [], active, sourceChannel }: {
  positive?: string; negative?: string; errors?: string[]; active: boolean; sourceChannel?: 'positive' | 'negative';
}) {
  const [result, setResult] = useState<ComfyUITextResult>({ success: false, targets: [], message: 'Select a text node in ComfyUI.' });
  const [token, setToken] = useState('');
  const [channel, setChannel] = useState<'positive' | 'negative'>('positive');
  const [separator, setSeparator] = useState<', ' | ' ' | '\n'>(sessionSeparator);
  const feedback = useComfyTextFeedback();
  const [busy, setBusy] = useState(false);
  const applying = useRef(false);
  useEffect(() => {
    if (!active) return;
    let disposed = false, timer: ReturnType<typeof setTimeout>;
    const query = async () => {
      try {
        if (!applying.current) {
          const next = await window.electronAPI?.comfyUIViewTextTargets?.() || { success: false, targets: [], message: 'Direct editing requires the embedded desktop Workspace. Copy text instead.' };
          if (!disposed && !applying.current) {
            setResult(next);
            setToken(current => next.targets.some(t => t.token === current) ? current : next.targets.length === 1 ? next.targets[0].token : '');
          }
        }
      } catch { if (!disposed) setResult({ success: false, targets: [], message: 'ComfyUI is unavailable. Copy text instead.' }); }
      if (!disposed) timer = setTimeout(query, 500);
    };
    void query();
    return () => { disposed = true; clearTimeout(timer); };
  }, [active]);
  const text = (sourceChannel || channel) === 'positive' ? positive : negative;
  const apply = async (mode: 'append' | 'replace') => {
    if (applying.current || !active || !token || !text.trim() || errors.length) return;
    applying.current = true; setBusy(true);
    try {
      const response = await window.electronAPI?.comfyUIViewApplyText({ token, text, mode, separator });
      feedback.report(response, mode, text, result.targets.find(target => target.token === token));
      setToken('');
      if (!response?.success) setResult(response || { success: false, targets: [] });
    } catch { feedback.report(undefined, mode, text); setToken(''); }
    finally { applying.current = false; setBusy(false); }
  };
  const target = result.targets.find(t => t.token === token);
  return <section aria-label="Apply text to ComfyUI" className="space-y-2 rounded-lg border border-purple-500/25 bg-purple-500/5 p-3 text-xs">
    <h4 className="font-semibold">Apply to ComfyUI</h4>
    {result.targets.length ? <>
      <p className="break-words">{result.targets[0].nodeTitle} · #{result.targets[0].nodeId}</p>
      {result.targets.length === 1 ? <p className="text-gray-400">Field: {result.targets[0].field}</p> : <select aria-label="Destination field" className={fieldClass} value={token} onChange={e => setToken(e.target.value)}>
        <option value="" disabled>Choose a field</option>{result.targets.map(t => <option key={t.token} value={t.token}>{t.field} — {t.preview || 'Empty'}</option>)}
      </select>}
      {result.targets.length > 1 && target && <p className="line-clamp-2 whitespace-pre-wrap break-words text-gray-400">{target.preview || 'Empty field'}</p>}
    </> : <p className="text-gray-400">{result.message}</p>}
    <div className="flex gap-2">
      {!sourceChannel && negative && <select aria-label="Text channel" className={fieldClass} value={channel} onChange={e => setChannel(e.target.value as typeof channel)}><option value="positive">Prompt</option><option value="negative">Negative</option></select>}
      <details className="min-w-0 flex-1"><summary className="cursor-pointer text-gray-400">Append separator</summary><select aria-label="Append separator" className={fieldClass} value={separator} onChange={e => { sessionSeparator = e.target.value as typeof separator; setSeparator(sessionSeparator); }}><option value=", ">Comma</option><option value=" ">Space</option><option value={'\n'}>New line</option></select></details>
    </div>
    <div className="flex gap-2">{(['append', 'replace'] as const).map(mode => <button key={mode} className={buttonClass} disabled={!active || busy || !token || !text.trim() || !!errors.length} onClick={() => void apply(mode)}>{mode === 'append' ? 'Append to field' : 'Replace field'}</button>)}</div>
    {!!errors.length && <p className="text-amber-300 light:text-amber-800">Fill valid template values before applying.</p>}
    {feedback.toast}
  </section>;
}
