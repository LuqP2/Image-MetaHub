import React from 'react';
import type { PromptVariable } from '../../types';
export const fieldClass = 'w-full rounded-md border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100 focus:border-accent focus:outline-none';
export const buttonClass = 'app-top-pill px-3 py-2 text-xs disabled:opacity-40 disabled:cursor-not-allowed';
export function VariableDefinitions({ variables, onChange, disabled = false }: {
  variables: PromptVariable[];
  onChange: (value: PromptVariable[]) => void;
  disabled?: boolean;
}) {
  const change = (index: number, patch: Partial<PromptVariable>) => onChange(variables.map((v, i) => i === index ? { ...v, ...patch } : v));
  return <div className="space-y-3">
    <p className="text-xs text-gray-400">{"Use "}{'{{variable}}'}{" in your text. Values are inserted literally."}</p>
    {variables.map((v, i) => <fieldset
      key={i}
      disabled={disabled}
      className="space-y-2 rounded-lg border border-gray-700 p-3">

      <div className="grid grid-cols-2 gap-2">
        <label className="text-xs">{"Name"}<input
            aria-label={`Variable ${i + 1} name`}
            className={fieldClass}
            value={v.name}
            onChange={(e) => change(i, { name: e.target.value })} />
        </label>
        <label className="text-xs">{"Label"}<input
            className={fieldClass}
            value={v.label}
            onChange={(e) => change(i, { label: e.target.value })} />
        </label>
      </div>

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

      <label className="block text-xs">{"Default value"}<input
          className={fieldClass}
          value={v.defaultValue}
          onChange={(e) => change(i, { defaultValue: e.target.value })} />
      </label>

      <div className="flex items-center justify-between">
        <label className="text-xs">
          <input
            type="checkbox"
            checked={v.required}
            onChange={(e) => change(i, { required: e.target.checked })} />{"Required"}</label>
        <button
          type="button"
          className={buttonClass}
          onClick={() => onChange(variables.filter((_, index) => i !== index))}>{"Remove variable"}</button>
      </div>

    </fieldset>)}
    <button
      type="button"
      disabled={disabled}
      className={buttonClass}
      onClick={() => { let number = 1; while (variables.some((v) => v.name === `variable_${number}`)) number++; onChange([...variables, { name: `variable_${number}`, label: '', type: 'text', required: true, defaultValue: '', options: [] }]); }}>{"Add variable"}</button>
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
