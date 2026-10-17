import React, { useState } from 'react';
import { copyTextToClipboard } from '../../utils/imageUtils';
import type { compilePrompt } from '../../services/promptLibrary/core.mjs';
import { buttonClass, fieldClass } from './PromptVariables';

export default function CompositionResult({ result, renderActions }: {
  result: ReturnType<typeof compilePrompt>;
  renderActions?: (channel: 'positive' | 'negative') => React.ReactNode;
}) {
  const [channel, setChannel] = useState<'positive' | 'negative'>('positive');
  const [expanded, setExpanded] = useState(false);
  const [feedback, setFeedback] = useState('');
  const effectiveChannel = !result.positivePrompt ? 'negative' : !result.negativePrompt ? 'positive' : channel;
  const text = effectiveChannel === 'negative' ? result.negativePrompt : result.positivePrompt;
  return <footer aria-label="Composition actions" className="max-h-[45%] shrink-0 space-y-2 overflow-y-auto border-t border-gray-700 bg-gray-900 p-3">
    <section aria-label="Composition result" className="space-y-2">
      <div className="flex items-center gap-2"><h4 className="mr-auto text-xs font-semibold">Result</h4>{result.positivePrompt && result.negativePrompt && <select aria-label="Result channel" className={fieldClass + ' !w-auto !py-1 !text-xs'} value={effectiveChannel} onChange={e => { setChannel(e.target.value as typeof channel); setFeedback(''); }}><option value="positive">Prompt</option><option value="negative">Negative</option></select>}<button type="button" className="text-[11px] text-gray-400 hover:text-accent" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? 'Collapse result' : 'Expand result'}</button></div>
      <pre className={`whitespace-pre-wrap break-words text-xs leading-relaxed ${expanded ? 'max-h-48 overflow-y-auto' : 'line-clamp-3'}`} data-prompt-text>{text || 'Add text or blocks to see your prompt here.'}</pre>
      {!!result.errors.length && <p role="alert" className="text-xs text-amber-600 dark:text-amber-300">{result.errors.join(' ')}</p>}
      <div className="flex items-center gap-2"><button type="button" className={buttonClass + ' !py-1'} disabled={!!result.errors.length || !text.trim()} onClick={async () => { const response = await copyTextToClipboard(text); setFeedback(response.success ? 'Copied' : response.error || 'Copy failed'); }}>{effectiveChannel === 'negative' ? 'Copy negative' : 'Copy prompt'}</button>{feedback && <span role="status" className="text-xs text-accent">{feedback}</span>}</div>
    </section>
    {renderActions?.(effectiveChannel)}
  </footer>;
}
