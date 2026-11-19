import { useTranslation } from '../../i18n/useTranslation';
import { translatePromptMessage } from '../../i18n/promptMessages';
import React, { useState } from 'react';
import { copyTextToClipboard } from '../../utils/imageUtils';
import { buttonClass } from './PromptVariables';
import { Copy, Pencil } from 'lucide-react';
export default function PromptPreview({ result, heading, channel, compact = false, onEditContent }: {
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
  const { t } = useTranslation();
  const [feedback, setFeedback] = useState('');
  const copyButtonClass = compact ? 'app-top-icon-button !h-6 !w-6 !p-1' : buttonClass;
  const copyLabel = channel === 'block' ? t('promptLibrary.copyBlock') : channel === 'negative' ? t('promptLibrary.copyNegative') : t('promptLibrary.copyPrompt');
  const copy = async (text: string) => { const response = await copyTextToClipboard(text); setFeedback(response.success ? 'promptLibrary.copiedBare' : response.error || 'promptLibrary.copyFailedBare'); };
  return <section className={`space-y-2 rounded-lg border border-gray-700 bg-gray-950/40 ${compact ? 'p-2' : 'p-3'}`} aria-label={t('promptLibrary.finalPreview')}>
    {!compact && <h3 className="text-xs font-semibold uppercase text-gray-400">{heading ?? t('promptLibrary.finalPreview')}</h3>}

    {result.errors.length > 0 && <div role="alert" className="text-xs text-amber-400">
      {result.errors.map(message => translatePromptMessage(message, t)).join(' ')}
    </div>}

    <div className="flex flex-wrap gap-2">
      {channel ? <button type="button" className={copyButtonClass} aria-label={copyLabel} title={copyLabel} disabled={!!result.errors.length || !(channel === 'negative' ? result.negativePrompt : result.positivePrompt)} onClick={() => void copy(channel === 'negative' ? result.negativePrompt : result.positivePrompt)}>{compact ? <Copy size={13} /> : copyLabel}</button> : <>
      <button
        type="button"
        aria-label={t('promptLibrary.copyPrompt')} title={t('promptLibrary.copyPrompt')}
        disabled={!!result.errors.length || !result.positivePrompt}
        className={copyButtonClass}
        onClick={() => void copy(result.positivePrompt)}>{compact ? <Copy size={13} /> : t('promptLibrary.copyPrompt')}</button>
      {result.negativePrompt && <button
        type="button"
        aria-label={t('promptLibrary.copyNegative')} title={t('promptLibrary.copyNegative')}
        disabled={!!result.errors.length || !result.negativePrompt}
        className={copyButtonClass}
        onClick={() => void copy(result.negativePrompt)}>{compact ? <Copy size={13} /> : t('promptLibrary.copyNegative')}</button>}
      {result.negativePrompt && <button
        type="button"
        aria-label={t('promptLibrary.copyBoth')} title={t('promptLibrary.copyBoth')}
        disabled={!!result.errors.length || (!result.positivePrompt && !result.negativePrompt)}
        className={copyButtonClass}
        onClick={() => void copy(result.positivePrompt + (result.negativePrompt ? `\nNegative prompt: ${result.negativePrompt}` : ''))}>{compact ? <Copy size={13} /> : t('promptLibrary.copyBoth')}</button>}
      </>}
      <span role="status" className="self-center text-xs text-accent">
        {translatePromptMessage(feedback, t)}
      </span>
      {onEditContent && <button type="button" className="app-top-icon-button !ml-auto !h-6 !w-6 !p-1" aria-label={t('promptLibrary.editContent')} title={t('promptLibrary.editContent')} onClick={onEditContent}><Pencil size={13} /></button>}
    </div>

    {channel !== 'negative' && result.positivePrompt && <>{!compact && <p className="pt-2 text-xs text-gray-400">{t('promptLibrary.promptType')}</p>}<pre className="whitespace-pre-wrap break-words text-sm leading-relaxed" data-prompt-text>{result.positivePrompt}</pre></>}
    {!['positive', 'block'].includes(channel || '') && result.negativePrompt && <><p className="pt-2 text-xs text-gray-400">{t('promptLibrary.negativePrompt')}</p><pre className="whitespace-pre-wrap break-words text-sm leading-relaxed" data-prompt-text>{result.negativePrompt}</pre></>}
    {!result.positivePrompt && !result.negativePrompt && <p className="text-xs text-gray-500">{t('promptLibrary.previewEmpty')}</p>}

  </section>;
}
