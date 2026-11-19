import { useTranslation } from '../../i18n/useTranslation';
import { translatePromptMessage } from '../../i18n/promptMessages';
import React, { useId, useState } from 'react';
import { Settings2 } from 'lucide-react';
import type { PromptVariable } from '../../types';
import { copyTextToClipboard } from '../../utils/imageUtils';
import { buttonClass, fieldClass, SuggestedValues } from './PromptVariables';

export default function BlockContentEditor({ text, variables, disabled, rows = 6, onTextChange, onVariableChange, onContextMenu }: {
  text: string;
  variables: PromptVariable[];
  disabled: boolean;
  rows?: number;
  onTextChange: (text: string) => void;
  onVariableChange: (variable: PromptVariable) => void;
  onContextMenu: (event: React.MouseEvent<HTMLTextAreaElement>) => void;
}) {
  const { t } = useTranslation();
  const [settings, setSettings] = useState<string | null>(null);
  const [feedback, setFeedback] = useState('');
  const settingsId = useId();
  const change = (variable: PromptVariable, patch: Partial<PromptVariable>) => { onVariableChange({ ...variable, ...patch }); setFeedback(''); };
  return <div className="space-y-4">
    <label className="block text-xs">{t('promptLibrary.blockText')}<textarea aria-label={t('promptLibrary.blockText')} rows={rows} className={fieldClass} readOnly={disabled} value={text} onChange={event => { onTextChange(event.target.value); setFeedback(''); }} onContextMenu={onContextMenu} /></label>
    <section aria-label={t('promptLibrary.blockFields')} className="space-y-3">
      {variables.length > 0 ? <><h3 className="text-xs font-semibold">{t('promptLibrary.fieldsCount', { count: variables.length })}</h3><p className="text-xs text-gray-400">{t('promptLibrary.possibleValuesHelp')}</p></> : <p className="text-xs text-gray-400">{t('promptLibrary.writePlaceholder', { placeholder: '{{color}}' })}</p>}
      {variables.map(variable => <fieldset key={variable.name} disabled={disabled} className="space-y-3 rounded-lg border border-gray-700 p-3">
        <div className="flex items-center justify-between gap-2"><h4 className="text-xs font-semibold">{variable.name} <code className="ml-1 font-normal text-gray-400">{'{{' + variable.name + '}}'}</code></h4><button type="button" aria-label={t('promptLibrary.fieldSettings', { variable: variable.name })} aria-expanded={settings === variable.name} aria-controls={`${settingsId}-${variable.name}`} className="app-top-icon-button shrink-0" onClick={() => setSettings(settings === variable.name ? null : variable.name)}><Settings2 size={16} /></button></div>
        <SuggestedValues variable={variable} onChange={options => change(variable, { options })} />
        {settings === variable.name && <div id={`${settingsId}-${variable.name}`} className="space-y-3 border-t border-gray-700 pt-3 text-xs">
          <h4 className="font-semibold">{t('promptLibrary.advancedField', { variable: variable.name })}</h4>
          <label className="block">{t('promptLibrary.defaultValue')}<input aria-label={t('promptLibrary.defaultFor', { variable: variable.name })} className={fieldClass} value={variable.defaultValue} onChange={event => change(variable, { defaultValue: event.target.value })} /></label>
          <p className="text-gray-400">{t('promptLibrary.noSuggestionsHelp')}</p>
          <label className="block">{t('promptLibrary.displayLabel')}<input aria-label={t('promptLibrary.labelFor', { variable: variable.name })} className={fieldClass} value={variable.label} onChange={event => change(variable, { label: event.target.value })} /></label>
          <label className="flex items-center gap-2"><input type="checkbox" className="accent-[rgb(var(--accent))]" checked={variable.required} onChange={event => change(variable, { required: event.target.checked })} />{t('promptLibrary.requireField', { variable: variable.name })}</label>
          <p className="text-gray-400">{t('promptLibrary.removePlaceholder', { placeholder: '{{' + variable.name + '}}' })}</p>
        </div>}
      </fieldset>)}
    </section>
    <section aria-label={t('promptLibrary.blockPreview')} className="space-y-3 rounded-lg border border-gray-700 bg-gray-950/40 p-3">
      <h3 className="text-xs font-semibold">{t('promptLibrary.preview')}</h3>
      <pre className="whitespace-pre-wrap break-words text-sm leading-relaxed" data-prompt-text>{text || t('promptLibrary.blockPreviewEmpty')}</pre>
      <div className="flex items-center gap-2"><button type="button" className={buttonClass} disabled={!text.trim()} onClick={async () => { const response = await copyTextToClipboard(text); setFeedback(response.success ? 'promptLibrary.copiedBare' : response.error || 'promptLibrary.copyFailedBare'); }}>{t('promptLibrary.copyBlock')}</button>{feedback && <span role="status" className="text-xs text-accent">{translatePromptMessage(feedback, t)}</span>}</div>
    </section>
  </div>;
}
