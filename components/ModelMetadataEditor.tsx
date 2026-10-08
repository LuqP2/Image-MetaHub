import React, { useEffect, useSyncExternalStore } from 'react';
import type { ModelInspectorItem } from '../services/modelLibrary/types';
import { changedDraftFields, conflictingDraftFields, modelMetadataDrafts } from '../services/modelLibrary/metadataDrafts';
import type { MetadataDraftValues } from '../services/modelLibrary/metadataDrafts';
import { getDefaultLoraSyntax } from '../services/modelLibrary/presentation';
import { executeModelCommand, modelButton, modelInput } from './ModelManagerPanels';

export default function ModelMetadataEditor({ item }: { item: ModelInspectorItem }) {
  useSyncExternalStore(modelMetadataDrafts.subscribe, modelMetadataDrafts.getRevision, modelMetadataDrafts.getRevision);
  const key = modelMetadataDrafts.ensure(item);
  useEffect(() => { modelMetadataDrafts.sync(key, item.localMetadata); }, [key, item.localMetadata]);
  const draft = modelMetadataDrafts.get(key);
  const dirty = changedDraftFields(draft).length > 0;
  const conflicts = conflictingDraftFields(draft);
  const save = (overwrite = false) => { void modelMetadataDrafts.save(key, (patch) => executeModelCommand({ type: 'saveLocal', locationId: item.location.id, patch }), overwrite); };
  const field = (label: string, name: keyof MetadataDraftValues, type?: string) => <label className="block text-xs text-gray-400">{label}<input className={modelInput} type={type ?? 'text'} min={type === 'number' ? -10 : undefined} max={type === 'number' ? 10 : undefined} step={type === 'number' ? 0.05 : undefined} disabled={draft.saving} value={draft.values[name]} onChange={(event) => modelMetadataDrafts.change(key, name, event.target.value)} /></label>;
  return <section className="space-y-3 rounded-lg border border-gray-800 p-3" aria-label="Your metadata">
    <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-medium">Your metadata</h3>{dirty && <span className="text-xs text-amber-300">Unsaved changes</span>}{!draft.editing && <button className={modelButton} onClick={() => modelMetadataDrafts.edit(key)}>Edit</button>}</div>
    {draft.editing ? <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); save(); }}>
      {field('Display name', 'name')}{field('Tags, separated by commas', 'tags')}
      {item.location.sourceKind === 'lora' && <>{field('Trigger words override', 'triggers')}{field('Default strength', 'strength', 'number')}<button type="button" className={modelButton} onClick={() => { void window.electronAPI?.copyTextToClipboard(getDefaultLoraSyntax(item.location, item.localMetadata)); }}>Copy LoRA syntax</button></>}
      <label className="block text-xs text-gray-400">Notes<textarea rows={3} className={modelInput} disabled={draft.saving} value={draft.values.notes} onChange={(event) => modelMetadataDrafts.change(key, 'notes', event.target.value)} /></label>
      {draft.identityConflict && <div role="alert" className="space-y-2 text-xs text-amber-300"><p>Two local drafts belong to the same model after identification. Choose which values to keep for: {draft.identityConflict.fields.join(', ')}.</p><button type="button" className={modelButton} disabled={draft.saving} onClick={() => modelMetadataDrafts.resolveIdentityConflict(key, false)}>Keep current draft</button><button type="button" className={modelButton} disabled={draft.saving} onClick={() => modelMetadataDrafts.resolveIdentityConflict(key, true)}>Use draft from this file</button></div>}
      {conflicts.length > 0 && <div role="alert" className="space-y-2 text-xs text-amber-300"><p>These fields changed in another window: {conflicts.map((name) => ({ name: 'Display name', notes: 'Notes', tags: 'Tags', triggers: 'Trigger words', strength: 'Default strength' })[name]).join(', ')}. Reload saved values or save your local changes.</p><button type="button" className={modelButton} disabled={draft.saving} onClick={() => modelMetadataDrafts.discard(key)}>Reload saved values</button><button type="button" className={modelButton} disabled={draft.saving} onClick={() => save(true)}>Save local changes</button></div>}
      {draft.error && <p role="alert" className="text-xs text-red-400">{draft.error}</p>}
      <div className="flex flex-wrap gap-2"><button className={modelButton} disabled={draft.saving || !dirty || conflicts.length > 0 || Boolean(draft.identityConflict)}>{draft.saving ? 'Saving…' : 'Save'}</button><button type="button" className={modelButton} disabled={draft.saving} onClick={() => modelMetadataDrafts.discard(key)}>Discard</button><button type="button" className={modelButton} onClick={() => modelMetadataDrafts.close(key)}>Close editor</button></div>
    </form> : <div className="space-y-1 text-xs text-gray-400"><p>Display name: {item.localMetadata?.displayName || 'Default'}</p><p>Tags: {item.localMetadata?.tags.join(', ') || 'None'}</p>{item.location.sourceKind === 'lora' && <><p>Trigger words: {item.localMetadata?.triggerWords?.join(', ') || 'Default'}</p><p>Default strength: {item.localMetadata?.defaultStrength ?? 1}</p></>}<p className="whitespace-pre-wrap break-words">{item.localMetadata?.notes || 'No notes.'}</p>{draft.error && <p role="alert" className="text-red-400">{draft.error}</p>}</div>}
  </section>;
}
