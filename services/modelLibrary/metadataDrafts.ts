import { getModelLocalMetadataId } from './presentation';
import { normalizeModelLocalMetadata } from './localMetadataStorage';
import type { ModelInspectorItem, ModelLocalMetadata } from './types';

export interface MetadataDraftValues { name: string; notes: string; tags: string; triggers: string; strength: string }
const fields: (keyof MetadataDraftValues)[] = ['name', 'notes', 'tags', 'triggers', 'strength'];
export interface MetadataDraft {
  values: MetadataDraftValues;
  base: MetadataDraftValues;
  latest: MetadataDraftValues;
  editing: boolean;
  saving: boolean;
  error: string;
  identityConflict?: { fields: (keyof MetadataDraftValues)[]; alternative: MetadataDraftValues };
}
export const metadataDraftValues = (metadata?: ModelLocalMetadata): MetadataDraftValues => ({
  name: metadata?.displayName ?? '', notes: metadata?.notes ?? '', tags: metadata?.tags.join(', ') ?? '',
  triggers: metadata?.triggerWords?.join(', ') ?? '', strength: String(metadata?.defaultStrength ?? 1),
});
export const changedDraftFields = (draft: MetadataDraft) => fields.filter((field) => draft.values[field] !== draft.base[field]);
export const conflictingDraftFields = (draft: MetadataDraft) => changedDraftFields(draft)
  .filter((field) => draft.latest[field] !== draft.base[field] && draft.latest[field] !== draft.values[field]);
const sameValues = (a: MetadataDraftValues, b: MetadataDraftValues) => fields.every((field) => a[field] === b[field]);

/** One instance per renderer: deliberately in-memory, with no disk or IPC draft persistence. */
export class ModelMetadataDraftStore {
  private entries = new Map<string, MetadataDraft>();
  private locationKeys = new Map<string, string>();
  private aliases = new Map<string, string>();
  private listeners = new Set<() => void>();
  private revision = 0;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getRevision = () => this.revision;
  private publish() { this.revision += 1; for (const listener of this.listeners) listener(); }
  private resolveKey(key: string) {
    // Saves may still refer to an old identity after a hash was assigned.
    while (this.aliases.has(key)) key = this.aliases.get(key)!;
    return key;
  }
  ensure(item: ModelInspectorItem): string {
    const key = getModelLocalMetadataId(item.location);
    this.aliases.delete(key);
    const previousKey = this.locationKeys.get(item.location.id);
    const previous = previousKey ? this.entries.get(previousKey) : undefined;
    if (!this.entries.has(key)) {
      const values = metadataDraftValues(item.localMetadata);
      this.entries.set(key, previous ?? { values, base: values, latest: values, editing: false, saving: false, error: '' });
    } else if (previous && previousKey !== key && changedDraftFields(previous).length) {
      const target = this.entries.get(key)!;
      const targetDirty = new Set(changedDraftFields(target));
      const values = { ...target.values }, base = { ...target.base }, alternative = { ...values };
      const collisions: (keyof MetadataDraftValues)[] = [];
      for (const field of changedDraftFields(previous)) {
        if (targetDirty.has(field) && target.values[field] !== previous.values[field]) { collisions.push(field); alternative[field] = previous.values[field]; }
        else { values[field] = previous.values[field]; alternative[field] = previous.values[field]; if (!targetDirty.has(field)) base[field] = previous.base[field]; }
      }
      this.entries.set(key, { ...target, values, base, editing: target.editing || previous.editing, saving: target.saving || previous.saving,
        identityConflict: collisions.length ? { fields: collisions, alternative } : target.identityConflict });
    }
    if (previousKey && previousKey !== key) {
      // Preserve aliases for every physical copy and any in-flight save.
      for (const [locationId, identity] of this.locationKeys) if (identity === previousKey) this.locationKeys.set(locationId, key);
      this.entries.delete(previousKey);
      this.aliases.set(previousKey, key);
    }
    this.locationKeys.set(item.location.id, key);
    return key;
  }
  get(key: string) { return this.entries.get(this.resolveKey(key))!; }
  sync(key: string, metadata?: ModelLocalMetadata) {
    key = this.resolveKey(key);
    const draft = this.get(key), latest = metadataDraftValues(metadata);
    if (sameValues(draft.latest, latest)) return;
    const dirty = changedDraftFields(draft);
    const values = { ...latest }, base = { ...latest };
    for (const field of dirty) { values[field] = draft.values[field]; base[field] = draft.base[field]; }
    this.entries.set(key, { ...draft, values, base, latest }); this.publish();
  }
  edit(key: string) { const draft = this.get(key); this.entries.set(this.resolveKey(key), { ...draft, editing: true }); this.publish(); }
  change(key: string, field: keyof MetadataDraftValues, value: string) {
    const draft = this.get(key);
    if (draft.saving) return;
    this.entries.set(this.resolveKey(key), { ...draft, values: { ...draft.values, [field]: value }, error: '' }); this.publish();
  }
  discard(key: string) {
    const draft = this.get(key);
    if (draft.saving) return;
    this.entries.set(this.resolveKey(key), { ...draft, values: draft.latest, base: draft.latest, editing: false, error: '', identityConflict: undefined }); this.publish();
  }
  resolveIdentityConflict(key: string, useAlternative: boolean) {
    const draft = this.get(key);
    if (draft.saving || !draft.identityConflict) return;
    const values = { ...draft.values };
    if (useAlternative) for (const field of draft.identityConflict.fields) values[field] = draft.identityConflict.alternative[field];
    this.entries.set(this.resolveKey(key), { ...draft, values, identityConflict: undefined }); this.publish();
  }
  close(key: string) { const draft = this.get(key); this.entries.set(this.resolveKey(key), { ...draft, editing: false }); this.publish(); }
  async save(key: string, execute: (patch: Partial<ModelLocalMetadata>) => Promise<unknown>, overwrite = false) {
    const draft = this.get(key);
    if (draft.saving || draft.identityConflict || !changedDraftFields(draft).length || !overwrite && conflictingDraftFields(draft).length) return;
    const changes = changedDraftFields(draft);
    const patch: Partial<ModelLocalMetadata> = {};
    for (const field of changes) {
      switch (field) {
        case 'name': patch.displayName = draft.values.name; break;
        case 'notes': patch.notes = draft.values.notes; break;
        case 'tags': patch.tags = draft.values.tags.split(','); break;
        case 'triggers': patch.triggerWords = draft.values.triggers.split(','); break;
        case 'strength': patch.defaultStrength = Number(draft.values.strength); break;
      }
    }
    this.entries.set(this.resolveKey(key), { ...draft, saving: true, error: '' }); this.publish();
    try {
      await execute(patch);
      const current = this.get(key);
      const latest = { ...current.latest }, values = { ...current.values }, base = { ...current.base };
      const normalized = metadataDraftValues(normalizeModelLocalMetadata({ id: this.resolveKey(key), ...patch }));
      for (const field of changes) {
        latest[field] = normalized[field]; base[field] = normalized[field];
        if (current.values[field] === draft.values[field]) values[field] = normalized[field];
      }
      const saved = { ...current, values, base, latest, saving: false, error: '' };
      this.entries.set(this.resolveKey(key), { ...saved, editing: changedDraftFields(saved).length > 0 || Boolean(saved.identityConflict) });
    } catch (error) {
      const current = this.get(key);
      this.entries.set(this.resolveKey(key), { ...current, saving: false, error: (error as Error).message });
    }
    this.publish();
  }
}
export const modelMetadataDrafts = new ModelMetadataDraftStore();
