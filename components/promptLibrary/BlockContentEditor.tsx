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
  const [settings, setSettings] = useState<string | null>(null);
  const [feedback, setFeedback] = useState('');
  const settingsId = useId();
  const change = (variable: PromptVariable, patch: Partial<PromptVariable>) => { onVariableChange({ ...variable, ...patch }); setFeedback(''); };
  return <div className="space-y-4">
    <label className="block text-xs">Block text<textarea aria-label="Block text" rows={rows} className={fieldClass} readOnly={disabled} value={text} onChange={event => { onTextChange(event.target.value); setFeedback(''); }} onContextMenu={onContextMenu} /></label>
    <section aria-label="Block fields" className="space-y-3">
      {variables.length > 0 ? <><h3 className="text-xs font-semibold">Fields · {variables.length}</h3><p className="text-xs text-gray-400">Add possible values. Dragging the saved block to a node picks one at random for each field.</p></> : <p className="text-xs text-gray-400">Write <code>{'{{color}}'}</code> in the block text to make that part changeable.</p>}
      {variables.map(variable => <fieldset key={variable.name} disabled={disabled} className="space-y-3 rounded-lg border border-gray-700 p-3">
        <div className="flex items-center justify-between gap-2"><h4 className="text-xs font-semibold">{variable.name} <code className="ml-1 font-normal text-gray-400">{'{{' + variable.name + '}}'}</code></h4><button type="button" aria-label={`Field settings for ${variable.name}`} aria-expanded={settings === variable.name} aria-controls={`${settingsId}-${variable.name}`} className="app-top-icon-button shrink-0" onClick={() => setSettings(settings === variable.name ? null : variable.name)}><Settings2 size={16} /></button></div>
        <SuggestedValues variable={variable} onChange={options => change(variable, { options })} />
        {settings === variable.name && <div id={`${settingsId}-${variable.name}`} className="space-y-3 border-t border-gray-700 pt-3 text-xs">
          <h4 className="font-semibold">Advanced settings · {variable.name}</h4>
          <label className="block">Default value (optional)<input aria-label={`Default value for ${variable.name}`} className={fieldClass} value={variable.defaultValue} onChange={event => change(variable, { defaultValue: event.target.value })} /></label>
          <p className="text-gray-400">Used when this field has no suggested values.</p>
          <label className="block">Display label (optional)<input aria-label={`Display label for ${variable.name}`} className={fieldClass} value={variable.label} onChange={event => change(variable, { label: event.target.value })} /></label>
          <label className="flex items-center gap-2"><input type="checkbox" className="accent-[rgb(var(--accent))]" checked={variable.required} onChange={event => change(variable, { required: event.target.checked })} />Require {variable.name} when sending to a node</label>
          <p className="text-gray-400">To stop using this field, remove {'{{' + variable.name + '}}'} from the block text.</p>
        </div>}
      </fieldset>)}
    </section>
    <section aria-label="Block preview" className="space-y-3 rounded-lg border border-gray-700 bg-gray-950/40 p-3">
      <h3 className="text-xs font-semibold">Preview</h3>
      <pre className="whitespace-pre-wrap break-words text-sm leading-relaxed" data-prompt-text>{text || 'Write block text to see the preview.'}</pre>
      <div className="flex items-center gap-2"><button type="button" className={buttonClass} disabled={!text.trim()} onClick={async () => { const response = await copyTextToClipboard(text); setFeedback(response.success ? 'Copied' : response.error || 'Copy failed'); }}>Copy block</button>{feedback && <span role="status" className="text-xs text-accent">{feedback}</span>}</div>
    </section>
  </div>;
}
