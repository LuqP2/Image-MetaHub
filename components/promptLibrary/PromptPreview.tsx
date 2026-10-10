import React, { useState } from 'react';
import { copyTextToClipboard } from '../../utils/imageUtils';
import { buttonClass } from './PromptVariables';
export default function PromptPreview({ result, heading = 'Final prompt preview' }: {
  heading?: string;
  result: {
    positivePrompt: string;
    negativePrompt: string;
    errors: string[];
  };
}) {
  const [feedback, setFeedback] = useState('');
  const copy = async (text: string) => { const response = await copyTextToClipboard(text); setFeedback(response.success ? 'Copied' : response.error || 'Copy failed'); };
  return <section className="space-y-2 rounded-lg border border-gray-700 bg-gray-950/40 p-3" aria-label="Final prompt preview">
    <h3 className="text-xs font-semibold uppercase text-gray-400">{heading}</h3>

    {result.errors.length > 0 && <div role="alert" className="text-xs text-amber-400">
      {result.errors.join(' ')}
    </div>}

    <div className="flex flex-wrap gap-2">
      <button
        type="button"
        disabled={!!result.errors.length || !result.positivePrompt}
        className={buttonClass}
        onClick={() => void copy(result.positivePrompt)}>{"Copy Positive"}</button>
      <button
        type="button"
        disabled={!!result.errors.length || !result.negativePrompt}
        className={buttonClass}
        onClick={() => void copy(result.negativePrompt)}>{"Copy Negative"}</button>
      <button
        type="button"
        disabled={!!result.errors.length || (!result.positivePrompt && !result.negativePrompt)}
        className={buttonClass}
        onClick={() => void copy(result.positivePrompt + (result.negativePrompt ? `\nNegative prompt: ${result.negativePrompt}` : ''))}>{"Copy both"}</button>
      <span role="status" className="self-center text-xs text-accent">
        {feedback}
      </span>
    </div>

    {result.positivePrompt && <><p className="pt-2 text-xs text-gray-400">Positive prompt</p><pre className="whitespace-pre-wrap break-words text-sm leading-relaxed" data-prompt-text>{result.positivePrompt}</pre></>}
    {result.negativePrompt && <><p className="pt-2 text-xs text-gray-400">Negative prompt</p><pre className="whitespace-pre-wrap break-words text-sm leading-relaxed" data-prompt-text>{result.negativePrompt}</pre></>}
    {!result.positivePrompt && !result.negativePrompt && <p className="text-xs text-gray-500">Add text or blocks to see your prompt here.</p>}

  </section>;
}
