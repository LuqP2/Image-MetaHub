import React, { useState } from 'react';
import type { PromptVariable } from '../../types';
import { copyTextToClipboard } from '../../utils/imageUtils';
export const fieldClass = 'w-full rounded-md border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100 focus:border-accent focus:outline-none';
export const buttonClass = 'app-top-pill px-3 py-2 text-xs disabled:opacity-40 disabled:cursor-not-allowed';
export function FieldExample() {
  return <div className="space-y-2 rounded-lg bg-gray-950/40 p-3 text-xs text-gray-400">
    <p>A field is a piece of text you can change each time you use a saved prompt or block.</p>
    <p>For example, write <code className="text-gray-200">{'portrait of {{subject}}, soft light'}</code>.</p>
    <p>With <strong>subject</strong> filled as <strong>cat</strong>, the final text is <code className="text-gray-200">portrait of cat, soft light</code>.</p>
    <p>Name the field <strong>subject</strong>, copy its placeholder into your text, then fill its value in the preview or saved-item details. The saved text keeps the placeholder.</p>
  </div>;
}
export function VariableDefinitions({ variables, onChange, disabled = false }: {
  variables: PromptVariable[];
  onChange: (value: PromptVariable[]) => void;
  disabled?: boolean;
}) {
  const [copyStatus, setCopyStatus] = useState('');
  const change = (index: number, patch: Partial<PromptVariable>) => onChange(variables.map((v, i) => i === index ? { ...v, ...patch } : v));
  return <div className="space-y-3">
    <FieldExample />
    {copyStatus && <p role="status" className="text-xs text-accent">{copyStatus}</p>}
    {variables.map((v, i) => <fieldset
      key={i}
      disabled={disabled}
      className="space-y-2 rounded-lg border border-gray-700 p-3">

      <div className="grid grid-cols-2 gap-2">
        <label className="text-xs">Field name<input
            aria-label={`Variable ${i + 1} name`}
            className={fieldClass}
            value={v.name}
            onChange={(e) => change(i, { name: e.target.value })} />
        </label>
        <label className="text-xs">Default text (optional)<input
            className={fieldClass}
            value={v.defaultValue}
            onChange={(e) => change(i, { defaultValue: e.target.value })} />
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-2"><code className="text-xs text-accent">{'{{' + v.name + '}}'}</code><button type="button" className={buttonClass} disabled={disabled || !v.name.trim()} onClick={async () => { const response = await copyTextToClipboard('{{' + v.name + '}}'); setCopyStatus(response.success ? 'Placeholder copied. Paste it where this field should appear in your text.' : response.error || 'Could not copy placeholder.'); }}>Copy placeholder</button></div>
      <details className="space-y-2 text-xs text-gray-400"><summary className="cursor-pointer">Field options</summary>
        <label className="block text-xs">Display label (optional)<input
            className={fieldClass}
            value={v.label}
            onChange={(e) => change(i, { label: e.target.value })} />
        </label>

      <select
        aria-label={`Variable ${i + 1} type`}
        className={fieldClass}
        value={v.type}
        onChange={(e) => change(i, { type: e.target.value as 'text' | 'select' })}>
        <option value="text">{"Text"}</option>
        <option value="select">{"Options"}</option>
      </select>

      {v.type === 'select' && <label className="block text-xs">{"Options (one per line)"}<textarea
          className={fieldClass}
          value={v.options.join('\n')}
          onChange={(e) => change(i, { options: e.target.value.split('\n') })} />
      </label>}

        <label className="text-xs">
          <input
            type="checkbox"
            checked={v.required}
            onChange={(e) => change(i, { required: e.target.checked })} />Require a value before copying or sending</label>
      </details>
      <div className="flex justify-end">
        <button
          type="button"
          className={buttonClass}
          onClick={() => onChange(variables.filter((_, index) => i !== index))}>Remove field</button>
      </div>

    </fieldset>)}
    <button
      type="button"
      disabled={disabled}
      className={buttonClass}
      onClick={() => { let number = 1; const name = () => number === 1 ? 'subject' : `subject_${number}`; while (variables.some(v => v.name === name())) number++; onChange([...variables, { name: name(), label: '', type: 'text', required: true, defaultValue: '', options: [] }]); }}>Add field</button>
  </div>;
}
export function VariableValues({ variables, values, onChange }: {
  variables: PromptVariable[];
  values: Record<string, string>;
  onChange: (values: Record<string, string>) => void;
}) {
  return <div className="space-y-2">
    {variables.map((v) => <label key={v.name} className="block text-xs">
      {v.label || v.name}
      {v.required ? ' *' : ''}
      {v.type === 'select' ? <select
        className={fieldClass}
        value={values[v.name] ?? v.defaultValue}
        onChange={(e) => onChange({ ...values, [v.name]: e.target.value })}>
        <option value="">{"Choose…"}</option>
        {v.options.map((option) => <option key={option}>
          {option}
        </option>)}
      </select> : <input
        className={fieldClass}
        value={values[v.name] ?? v.defaultValue}
        onChange={(e) => onChange({ ...values, [v.name]: e.target.value })} />}
    </label>)}
  </div>;
}
