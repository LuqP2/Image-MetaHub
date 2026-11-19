import { translatePromptMessage } from '../../i18n/promptMessages';
import { useTranslation } from '../../i18n/useTranslation';
import React, { useId, useState } from 'react';
import type { PromptVariable } from '../../types';
import { copyTextToClipboard } from '../../utils/imageUtils';
export const fieldClass = 'w-full rounded-md border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100 focus:border-accent focus:outline-none';
export const buttonClass = 'app-top-pill px-3 py-2 text-xs disabled:opacity-40 disabled:cursor-not-allowed';
export function SuggestedValues({ variable, onChange }: { variable: PromptVariable; onChange: (options: string[]) => void }) {
  const { t } = useTranslation();
  return <label className="block space-y-1 text-xs">
    <span>{t('promptLibrary.suggestionsOptional')}</span>
    <textarea aria-label={t('promptLibrary.suggestionsFor', { variable: variable.name })} className={fieldClass} rows={3}
      placeholder={t('promptLibrary.suggestionsPlaceholder')} value={variable.options.join('\n')}
      onChange={event => onChange(event.target.value.split('\n'))} />
    <span className="block text-gray-400">{t('promptLibrary.suggestionsHelp')}</span>
  </label>;
}
export function FieldExample() {
  const { t } = useTranslation();
  return <div className="space-y-2 rounded-lg bg-gray-950/40 p-3 text-xs text-gray-400">
    <p>{t('promptLibrary.fieldExplanation')}</p>
    <p>{t('promptLibrary.exampleWrite', { example: 'portrait of {{subject}}, soft light' })}</p>
    <p>{t('promptLibrary.exampleResult', { field: 'subject', value: 'cat', example: 'portrait of cat, soft light' })}</p>
    <p>{t('promptLibrary.exampleHelp', { field: 'subject' })}</p>
  </div>;
}
export function VariableDefinitions({ variables, onChange, disabled = false }: {
  variables: PromptVariable[];
  onChange: (value: PromptVariable[]) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const [copyStatus, setCopyStatus] = useState('');
  const change = (index: number, patch: Partial<PromptVariable>) => onChange(variables.map((v, i) => i === index ? { ...v, ...patch } : v));
  return <div className="space-y-3">
    <FieldExample />
    {copyStatus && <p role="status" className="text-xs text-accent">{translatePromptMessage(copyStatus, t)}</p>}
    {variables.map((v, i) => <fieldset
      key={i}
      disabled={disabled}
      className="space-y-2 rounded-lg border border-gray-700 p-3">

      <div className="grid grid-cols-2 gap-2">
        <label className="text-xs">{t('promptLibrary.fieldName')}<input
            aria-label={t('promptLibrary.variableName', { index: i + 1 })}
            className={fieldClass}
            value={v.name}
            onChange={(e) => change(i, { name: e.target.value })} />
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-2"><code className="text-xs text-accent">{'{{' + v.name + '}}'}</code><button type="button" className={buttonClass} disabled={disabled || !v.name.trim()} onClick={async () => { const response = await copyTextToClipboard('{{' + v.name + '}}'); setCopyStatus(response.success ? 'promptLibrary.placeholderCopied' : response.error || 'promptLibrary.placeholderFailed'); }}>{t('promptLibrary.copyPlaceholder')}</button></div>
      <SuggestedValues variable={v} onChange={options => change(i, { options })} />
      <details className="space-y-2 text-xs text-gray-400"><summary className="cursor-pointer">{t('promptLibrary.advancedSettings')}</summary>
        <label className="block text-xs">{t('promptLibrary.defaultValue')}<input
            className={fieldClass}
            value={v.defaultValue}
            onChange={(e) => change(i, { defaultValue: e.target.value })} />
        </label>
        <label className="block text-xs">{t('promptLibrary.displayLabel')}<input
            className={fieldClass}
            value={v.label}
            onChange={(e) => change(i, { label: e.target.value })} />
        </label>

        <label className="text-xs">
          <input
            type="checkbox"
            checked={v.required}
            onChange={(e) => change(i, { required: e.target.checked })} />{t('promptLibrary.requireValue')}</label>
      </details>
      <div className="flex justify-end">
        <button
          type="button"
          className={buttonClass}
          onClick={() => onChange(variables.filter((_, index) => i !== index))}>{t('promptLibrary.removeField')}</button>
      </div>

    </fieldset>)}
    <button
      type="button"
      disabled={disabled}
      className={buttonClass}
      onClick={() => { let number = 1; const name = () => number === 1 ? 'subject' : `subject_${number}`; while (variables.some(v => v.name === name())) number++; onChange([...variables, { name: name(), label: '', type: 'text', required: true, defaultValue: '', options: [] }]); }}>{t('promptLibrary.addField')}</button>
  </div>;
}
export function VariableValues({ variables, values, onChange }: {
  variables: PromptVariable[];
  values: Record<string, string>;
  onChange: (values: Record<string, string>) => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  return <div className="space-y-2">
    {variables.map(v => {
      const options = [...new Set(v.options.filter(option => option.trim()))];
      const label = v.label || v.name;
      const inputId = `${id}-${v.name}`;
      return <div key={v.name} className="space-y-1">
        <label htmlFor={inputId} className="block text-xs">{label}{v.required ? ' *' : ''}</label>
        <div className="flex items-center gap-2">
          <input id={inputId} list={options.length ? `${inputId}-suggestions` : undefined} className={fieldClass}
            placeholder={options.length ? t('promptLibrary.typeChoose') : t('promptLibrary.typeValue')}
            value={Object.prototype.hasOwnProperty.call(values, v.name) ? values[v.name] : v.defaultValue}
            onChange={event => onChange({ ...values, [v.name]: event.target.value })} />
          {!!options.length && <button type="button" className={buttonClass + ' shrink-0'} aria-label={t('promptLibrary.randomizeNamed', { label })}
            title={t('promptLibrary.randomSuggested')}
            onClick={() => onChange({ ...values, [v.name]: options[Math.floor(Math.random() * options.length)] })}>{t('promptLibrary.randomize')}</button>}
        </div>
        {!!options.length && <datalist id={`${inputId}-suggestions`}>{options.map(option => <option key={option} value={option} />)}</datalist>}
      </div>;
    })}
  </div>;
}
