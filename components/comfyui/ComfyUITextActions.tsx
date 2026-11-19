import { comfyTextMessage } from '../../i18n/comfyTextMessages';
import { useTranslation } from '../../i18n/useTranslation';
import React, { useEffect, useRef, useState } from 'react';
import { useComfyTextFeedback } from '../../hooks/useComfyTextFeedback';
import type { ComfyUITextResult } from '../../types';
import { buttonClass, fieldClass } from '../promptLibrary/PromptVariables';
import ComfyTextDrag from './ComfyTextDrag';
let sessionSeparator: ', ' | ' ' | '\n' = ', ';

export default function ComfyUITextActions({ positive = '', negative = '', errors = [], active, sourceChannel, compact = false }: {
  positive?: string; negative?: string; errors?: string[]; active: boolean; sourceChannel?: 'positive' | 'negative'; compact?: boolean;
}) {
  const { t: tr } = useTranslation();

  const [result, setResult] = useState<ComfyUITextResult>({ success: false, targets: [], message: tr('integrations.selectTextNode') });
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
          const next = await window.electronAPI?.comfyUIViewTextTargets?.() || { success: false, targets: [], message: tr('integrations.directEditDesktopOnly') };
          if (!disposed && !applying.current) {
            setResult(next);
            setToken(current => next.targets.some(t => t.token === current) ? current : next.targets.length === 1 ? next.targets[0].token : '');
          }
        }
      } catch { if (!disposed) setResult({ success: false, targets: [], message: tr('integrations.comfyUnavailableCopy') }); }
      if (!disposed) timer = setTimeout(query, 500);
    };
    void query();
    return () => { disposed = true; clearTimeout(timer); };
  }, [active, tr]);
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
  if (compact) return <section aria-label={tr('integrations.applyTextToComfy')} className="space-y-2 border-t border-gray-700 pt-2 text-xs">
    {result.targets.length ? <>
      <p className="truncate text-gray-400" title={`${result.targets[0].nodeTitle} · #${result.targets[0].nodeId}`}>ComfyUI · {result.targets[0].nodeTitle} · {target?.field || tr('integrations.chooseField')}</p>
      {result.targets.length > 1 && <select aria-label={tr('integrations.destinationField')} className={fieldClass + ' !py-1 !text-xs'} value={token} onChange={e => setToken(e.target.value)}><option value="" disabled>{tr('integrations.chooseField')}</option>{result.targets.map(t => <option key={t.token} value={t.token}>{t.field} — {t.preview || tr('integrations.emptyFieldPreview')}</option>)}</select>}
    </> : <p className="text-gray-400">{comfyTextMessage(result, tr)}</p>}
    <div className="flex flex-wrap items-center gap-2"><ComfyTextDrag text={text} disabled={!active || busy || !text.trim() || !!errors.length} />{result.targets.length > 0 && <><button type="button" className={buttonClass + ' !border-accent/30 !py-1'} disabled={!active || busy || !token || !text.trim() || !!errors.length} onClick={() => void apply('append')}>{tr('integrations.addToNode')}</button><button type="button" className={buttonClass + ' !py-1'} disabled={!active || busy || !token || !text.trim() || !!errors.length} onClick={() => void apply('replace')}>{tr('integrations.replaceField')}</button></>}</div>
    {result.targets.length > 0 && <details><summary className="cursor-pointer text-[11px] text-gray-400">{tr('integrations.appendSeparator')}</summary><select aria-label={tr('integrations.appendSeparator')} className={fieldClass + ' !py-1 !text-xs'} value={separator} onChange={e => { sessionSeparator = e.target.value as typeof separator; setSeparator(sessionSeparator); }}><option value=", ">{tr('integrations.separatorComma')}</option><option value=" ">{tr('integrations.separatorSpace')}</option><option value={'\n'}>{tr('integrations.separatorNewLine')}</option></select></details>}
    {feedback.toast}
  </section>;
  return <section aria-label={tr('integrations.applyTextToComfy')} className="space-y-2 rounded-lg border border-purple-500/25 bg-purple-500/5 p-3 text-xs">
    <h4 className="font-semibold">{tr('integrations.applyToComfy')}</h4>
    <ComfyTextDrag text={text} disabled={!active || busy || !!errors.length} />
    {result.targets.length ? <>
      <p className="break-words">{result.targets[0].nodeTitle} · #{result.targets[0].nodeId}</p>
      {result.targets.length === 1 ? <p className="text-gray-400">{tr('integrations.fieldNamed', { field: result.targets[0].field })}</p> : <select aria-label={tr('integrations.destinationField')} className={fieldClass} value={token} onChange={e => setToken(e.target.value)}>
        <option value="" disabled>{tr('integrations.chooseField')}</option>{result.targets.map(t => <option key={t.token} value={t.token}>{t.field} — {t.preview || tr('integrations.emptyFieldPreview')}</option>)}
      </select>}
      {result.targets.length > 1 && target && <p className="line-clamp-2 whitespace-pre-wrap break-words text-gray-400">{target.preview || tr('integrations.emptyField')}</p>}
    </> : <p className="text-gray-400">{comfyTextMessage(result, tr)}</p>}
    <div className="flex gap-2">
      {!sourceChannel && negative && <select aria-label={tr('integrations.textChannel')} className={fieldClass} value={channel} onChange={e => setChannel(e.target.value as typeof channel)}><option value="positive">{tr('libraryGallery.prompt')}</option><option value="negative">{tr('integrations.negativeChannel')}</option></select>}
      <details className="min-w-0 flex-1"><summary className="cursor-pointer text-gray-400">{tr('integrations.appendSeparator')}</summary><select aria-label={tr('integrations.appendSeparator')} className={fieldClass} value={separator} onChange={e => { sessionSeparator = e.target.value as typeof separator; setSeparator(sessionSeparator); }}><option value=", ">{tr('integrations.separatorComma')}</option><option value=" ">{tr('integrations.separatorSpace')}</option><option value={'\n'}>{tr('integrations.separatorNewLine')}</option></select></details>
    </div>
    <div className="flex gap-2">{(['append', 'replace'] as const).map(mode => <button key={mode} className={buttonClass} disabled={!active || busy || !token || !text.trim() || !!errors.length} onClick={() => void apply(mode)}>{mode === 'append' ? tr('integrations.appendToField') : tr('integrations.replaceField')}</button>)}</div>
    {!!errors.length && <p className="text-amber-300 light:text-amber-800">{tr('integrations.fillBeforeApply')}</p>}
    {feedback.toast}
  </section>;
}
