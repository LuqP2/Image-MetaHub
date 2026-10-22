import React, { useState } from 'react';
import { copyTextToClipboard } from '../../utils/imageUtils';
import { buttonClass } from './PromptVariables';
import { Copy, Pencil } from 'lucide-react';
export default function PromptPreview({ result, heading = 'Final prompt preview', channel, compact = false, onEditContent }: {
  onEditContent?: () => void;
  heading?: string;
  compact?: boolean;
  channel?: 'positive' | 'negative' | 'block';
  result: {
    positivePrompt: string;
    negativePrompt: string;
    errors: string[];
  };
}) {
  const [feedback, setFeedback] = useState('');
  const copyButtonClass = compact ? 'app-top-icon-button !h-6 !w-6 !p-1' : buttonClass;
  const copyLabel = channel === 'block' ? 'Copy block' : channel === 'negative' ? 'Copy negative' : 'Copy prompt';
  const copy = async (text: string) => { const response = await copyTextToClipboard(text); setFeedback(response.success ? 'Copied' : response.error || 'Copy failed'); };
  return <section className={`space-y-2 rounded-lg border border-gray-700 bg-gray-950/40 ${compact ? 'p-2' : 'p-3'}`} aria-label="Final prompt preview">
    {!compact && <h3 className="text-xs font-semibold uppercase text-gray-400">{heading}</h3>}

    {result.errors.length > 0 && <div role="alert" className="text-xs text-amber-400">
      {result.errors.join(' ')}
    </div>}

    <div className="flex flex-wrap gap-2">
      {channel ? <button type="button" className={copyButtonClass} aria-label={copyLabel} title={copyLabel} disabled={!!result.errors.length || !(channel === 'negative' ? result.negativePrompt : result.positivePrompt)} onClick={() => void copy(channel === 'negative' ? result.negativePrompt : result.positivePrompt)}>{compact ? <Copy size={13} /> : copyLabel}</button> : <>
      <button
        type="button"
        aria-label="Copy prompt" title="Copy prompt"
        disabled={!!result.errors.length || !result.positivePrompt}
        className={copyButtonClass}
        onClick={() => void copy(result.positivePrompt)}>{compact ? <Copy size={13} /> : 'Copy prompt'}</button>
      {result.negativePrompt && <button
        type="button"
        aria-label="Copy negative" title="Copy negative"
        disabled={!!result.errors.length || !result.negativePrompt}
        className={copyButtonClass}
        onClick={() => void copy(result.negativePrompt)}>{compact ? <Copy size={13} /> : 'Copy negative'}</button>}
      {result.negativePrompt && <button
        type="button"
        aria-label="Copy both" title="Copy both"
        disabled={!!result.errors.length || (!result.positivePrompt && !result.negativePrompt)}
        className={copyButtonClass}
        onClick={() => void copy(result.positivePrompt + (result.negativePrompt ? `\nNegative prompt: ${result.negativePrompt}` : ''))}>{compact ? <Copy size={13} /> : 'Copy both'}</button>}
      </>}
      <span role="status" className="self-center text-xs text-accent">
        {feedback}
      </span>
      {onEditContent && <button type="button" className="app-top-icon-button !ml-auto !h-6 !w-6 !p-1" aria-label="Edit content" title="Edit content" onClick={onEditContent}><Pencil size={13} /></button>}
    </div>

    {channel !== 'negative' && result.positivePrompt && <>{!compact && <p className="pt-2 text-xs text-gray-400">Prompt</p>}<pre className="whitespace-pre-wrap break-words text-sm leading-relaxed" data-prompt-text>{result.positivePrompt}</pre></>}
    {!['positive', 'block'].includes(channel || '') && result.negativePrompt && <><p className="pt-2 text-xs text-gray-400">Negative prompt</p><pre className="whitespace-pre-wrap break-words text-sm leading-relaxed" data-prompt-text>{result.negativePrompt}</pre></>}
    {!result.positivePrompt && !result.negativePrompt && <p className="text-xs text-gray-500">Add text or blocks to see your prompt here.</p>}

  </section>;
}
