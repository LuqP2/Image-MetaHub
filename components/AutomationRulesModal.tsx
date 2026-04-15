import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Copy, Play, Plus, Power, Trash2, X } from 'lucide-react';
import type {
  AutomationConditionField,
  AutomationConditionOperator,
  AutomationConditionRow,
  AutomationRule,
  SmartCollection,
  TagInfo,
} from '../types';
import { useImageStore } from '../store/useImageStore';
import { useSettingsStore } from '../store/useSettingsStore';
import TagInputCombobox from './TagInputCombobox';
import {
  CONDITION_FIELD_LABELS,
  OPERATOR_LABELS,
  TEXT_CONDITION_FIELDS,
  conditionRowsToCriteria,
  createDefaultConditionRow,
  filterCriteriaToConditionRows,
  getConditionFieldOptions,
  getConditionValueOptions,
  getDefaultOperatorForField,
  getOperatorsForField,
  isConditionRowComplete,
  normalizeConditionRow,
  ruleToConditionRows,
} from '../utils/automationRuleRows';

interface AutomationRulesModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialCollectionId?: string | null;
  initialRuleName?: string;
}

type PreviewState = {
  matchCount: number;
  changeCount: number;
  tagChangeCount: number;
  collectionChangeCount: number;
};

const emptyPreview: PreviewState = {
  matchCount: 0,
  changeCount: 0,
  tagChangeCount: 0,
  collectionChangeCount: 0,
};

const createId = () =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `rule-${Date.now()}-${Math.random().toString(36).slice(2)}`;

const inputClassName =
  'w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100 outline-none transition-colors focus:border-blue-500 focus:ring-1 focus:ring-blue-500';
const compactInputClassName =
  'h-9 w-full rounded-lg border border-gray-700 bg-gray-800 px-2.5 text-sm text-gray-100 outline-none transition-colors focus:border-blue-500 focus:ring-1 focus:ring-blue-500';
const labelClassName = 'mb-1 block text-xs font-medium uppercase tracking-wide text-gray-400';

const createDraftRule = (): AutomationRule => ({
  id: createId(),
  name: 'New Rule',
  enabled: true,
  criteria: {
    matchMode: 'all',
    textConditions: [],
    conditionRows: [],
    filters: { tagMatchMode: 'any', favoriteFilterMode: 'neutral', advancedFilters: {} },
  },
  actions: { addTags: [], addToCollectionIds: [] },
  runOnNewImages: true,
  createdAt: Date.now(),
  updatedAt: Date.now(),
  lastAppliedAt: null,
  lastMatchCount: 0,
  lastChangeCount: 0,
});

const describeCriteria = (rule: AutomationRule): string => {
  const rows = ruleToConditionRows(rule);
  if (rows.length === 0) return 'No conditions yet';
  return `${rows.length} condition${rows.length === 1 ? '' : 's'} (${rule.criteria.matchMode})`;
};

const describeActions = (rule: AutomationRule, collectionNames: Map<string, string>): string => {
  const parts: string[] = [];
  if (rule.actions.addTags.length > 0) parts.push(`tags: ${rule.actions.addTags.join(', ')}`);
  if (rule.actions.addToCollectionIds.length > 0) {
    parts.push(`collections: ${rule.actions.addToCollectionIds.map((id) => collectionNames.get(id) ?? id).join(', ')}`);
  }
  return parts.length > 0 ? parts.join(' | ') : 'No actions yet';
};

const hasActions = (rule: AutomationRule): boolean =>
  rule.actions.addTags.length > 0 || rule.actions.addToCollectionIds.length > 0;

const hasValidRows = (rows: AutomationConditionRow[]): boolean =>
  rows.some((row) => isConditionRowComplete(normalizeConditionRow(row)));

const buildRuleFromRows = (rule: AutomationRule, rows: AutomationConditionRow[]): AutomationRule => ({
  ...rule,
  criteria: conditionRowsToCriteria(rows, rule.criteria.matchMode),
  updatedAt: Date.now(),
});

export default function AutomationRulesModal({
  isOpen,
  onClose,
  initialCollectionId = null,
  initialRuleName,
}: AutomationRulesModalProps) {
  const images = useImageStore((state) => state.images);
  const automationRules = useImageStore((state) => state.automationRules);
  const collections = useImageStore((state) => state.collections);
  const availableTags = useImageStore((state) => state.availableTags);
  const availableAutoTags = useImageStore((state) => state.availableAutoTags);
  const recentTags = useImageStore((state) => state.recentTags);
  const availableModels = useImageStore((state) => state.availableModels);
  const availableLoras = useImageStore((state) => state.availableLoras);
  const availableSamplers = useImageStore((state) => state.availableSamplers);
  const availableSchedulers = useImageStore((state) => state.availableSchedulers);
  const availableGenerators = useImageStore((state) => state.availableGenerators);
  const availableGpuDevices = useImageStore((state) => state.availableGpuDevices);
  const availableDimensions = useImageStore((state) => state.availableDimensions);
  const selectedModels = useImageStore((state) => state.selectedModels);
  const excludedModels = useImageStore((state) => state.excludedModels);
  const selectedLoras = useImageStore((state) => state.selectedLoras);
  const excludedLoras = useImageStore((state) => state.excludedLoras);
  const selectedSamplers = useImageStore((state) => state.selectedSamplers);
  const excludedSamplers = useImageStore((state) => state.excludedSamplers);
  const selectedSchedulers = useImageStore((state) => state.selectedSchedulers);
  const excludedSchedulers = useImageStore((state) => state.excludedSchedulers);
  const selectedGenerators = useImageStore((state) => state.selectedGenerators);
  const excludedGenerators = useImageStore((state) => state.excludedGenerators);
  const selectedGpuDevices = useImageStore((state) => state.selectedGpuDevices);
  const excludedGpuDevices = useImageStore((state) => state.excludedGpuDevices);
  const selectedTags = useImageStore((state) => state.selectedTags);
  const excludedTags = useImageStore((state) => state.excludedTags);
  const selectedTagsMatchMode = useImageStore((state) => state.selectedTagsMatchMode);
  const selectedAutoTags = useImageStore((state) => state.selectedAutoTags);
  const excludedAutoTags = useImageStore((state) => state.excludedAutoTags);
  const favoriteFilterMode = useImageStore((state) => state.favoriteFilterMode);
  const selectedRatings = useImageStore((state) => state.selectedRatings);
  const searchQuery = useImageStore((state) => state.searchQuery);
  const advancedFilters = useImageStore((state) => state.advancedFilters);
  const createAutomationRule = useImageStore((state) => state.createAutomationRule);
  const updateAutomationRule = useImageStore((state) => state.updateAutomationRule);
  const deleteAutomationRuleById = useImageStore((state) => state.deleteAutomationRuleById);
  const previewAutomationRule = useImageStore((state) => state.previewAutomationRule);
  const applyAutomationRuleNow = useImageStore((state) => state.applyAutomationRuleNow);
  const tagSuggestionLimit = useSettingsStore((state) => state.tagSuggestionLimit);

  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [draft, setDraft] = useState<AutomationRule>(() => createDraftRule());
  const [rows, setRows] = useState<AutomationConditionRow[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [preview, setPreview] = useState<PreviewState>(emptyPreview);
  const [isApplying, setIsApplying] = useState(false);
  const didInitializeForOpenRef = useRef(false);

  const collectionNames = useMemo(
    () => new Map(collections.map((collection) => [collection.id, collection.name])),
    [collections],
  );

  const valueSource = useMemo(() => ({
    images,
    availableModels,
    availableLoras,
    availableSamplers,
    availableSchedulers,
    availableGenerators,
    availableGpuDevices,
    availableDimensions,
    availableTags,
    availableAutoTags,
  }), [
    availableAutoTags,
    availableDimensions,
    availableGenerators,
    availableGpuDevices,
    availableLoras,
    availableModels,
    availableSamplers,
    availableSchedulers,
    availableTags,
    images,
  ]);

  const loadRuleForEditing = (rule: AutomationRule | null) => {
    const nextRule = rule ?? createDraftRule();
    setEditingRuleId(rule?.id ?? null);
    setDraft(nextRule);
    setRows(rule ? ruleToConditionRows(rule) : []);
    setTagInput('');
  };

  useEffect(() => {
    if (!isOpen) {
      didInitializeForOpenRef.current = false;
      return;
    }
    if (didInitializeForOpenRef.current) return;
    didInitializeForOpenRef.current = true;
    if (initialCollectionId) {
      const nextRule = createDraftRule();
      nextRule.name = initialRuleName ?? 'New Collection Rule';
      nextRule.actions.addToCollectionIds = [initialCollectionId];
      setEditingRuleId(null);
      setDraft(nextRule);
      setRows([]);
      setTagInput('');
      return;
    }
    loadRuleForEditing(automationRules[0] ?? null);
  }, [automationRules, initialCollectionId, initialRuleName, isOpen]);

  const ruleForPreview = useMemo(() => buildRuleFromRows(draft, rows), [draft, rows]);

  useEffect(() => {
    if (!isOpen) return;
    const timeoutId = window.setTimeout(() => {
      setPreview(previewAutomationRule(ruleForPreview));
    }, 250);
    return () => window.clearTimeout(timeoutId);
  }, [isOpen, previewAutomationRule, ruleForPreview]);

  if (!isOpen) return null;

  const isExistingRule = editingRuleId !== null && automationRules.some((rule) => rule.id === editingRuleId);
  const activeRuleCount = automationRules.filter((rule) => rule.enabled).length;
  const canSave = draft.name.trim().length > 0 && hasValidRows(rows) && hasActions(draft);

  const updateDraft = (updates: Partial<AutomationRule>) => {
    setDraft((current) => ({ ...current, ...updates, updatedAt: Date.now() }));
  };

  const addConditionRow = () => {
    setRows((current) => [...current, createDefaultConditionRow()]);
  };

  const updateConditionRow = (rowId: string, updates: Partial<AutomationConditionRow>) => {
    setRows((current) =>
      current.map((row) => {
        if (row.id !== rowId) return row;
        const fieldChanged = updates.field && updates.field !== row.field;
        const nextField = updates.field ?? row.field;
        return normalizeConditionRow({
          ...row,
          ...updates,
          operator: fieldChanged ? getDefaultOperatorForField(nextField) : updates.operator ?? row.operator,
          value: fieldChanged ? '' : updates.value ?? row.value,
          valueEnd: fieldChanged ? '' : updates.valueEnd ?? row.valueEnd,
          groupMode: fieldChanged ? undefined : updates.groupMode ?? row.groupMode,
        });
      }),
    );
  };

  const removeConditionRow = (rowId: string) => {
    setRows((current) => current.filter((row) => row.id !== rowId));
  };

  const importCurrentFilters = () => {
    const importedRows = filterCriteriaToConditionRows({
      searchQuery,
      models: selectedModels,
      excludedModels,
      loras: selectedLoras,
      excludedLoras,
      samplers: selectedSamplers,
      excludedSamplers,
      schedulers: selectedSchedulers,
      excludedSchedulers,
      generators: selectedGenerators,
      excludedGenerators,
      gpuDevices: selectedGpuDevices,
      excludedGpuDevices,
      tags: selectedTags,
      excludedTags,
      tagMatchMode: selectedTagsMatchMode,
      autoTags: selectedAutoTags,
      excludedAutoTags,
      favoriteFilterMode,
      ratings: selectedRatings,
      advancedFilters,
    });
    setRows(importedRows.length > 0 ? importedRows : [createDefaultConditionRow()]);
  };

  const handleSave = async (): Promise<AutomationRule | null> => {
    if (!canSave) return null;
    const preparedRule = {
      ...buildRuleFromRows(draft, rows),
      name: draft.name.trim(),
    };
    const savedRule = isExistingRule
      ? await updateAutomationRule(editingRuleId as string, preparedRule)
      : await createAutomationRule(preparedRule);
    if (savedRule) loadRuleForEditing(savedRule);
    return savedRule;
  };

  const handleApply = async () => {
    setIsApplying(true);
    try {
      const savedRule = isExistingRule ? await handleSave() : await handleSave();
      const ruleId = savedRule?.id ?? editingRuleId;
      if (!ruleId) return;
      const result = await applyAutomationRuleNow(ruleId);
      if (result) setPreview(result);
    } finally {
      setIsApplying(false);
    }
  };

  const handleDuplicate = (rule: AutomationRule) => {
    const copy = {
      ...rule,
      id: createId(),
      name: `${rule.name} Copy`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      lastAppliedAt: null,
      lastMatchCount: 0,
      lastChangeCount: 0,
    };
    setEditingRuleId(null);
    setDraft(copy);
    setRows(ruleToConditionRows(rule));
  };

  const handleDelete = async (ruleId: string) => {
    const confirmed = window.confirm('Delete this rule? Existing tags and collection membership will stay in place.');
    if (!confirmed) return;
    await deleteAutomationRuleById(ruleId);
    const nextRule = automationRules.find((rule) => rule.id !== ruleId) ?? null;
    loadRuleForEditing(nextRule);
  };

  const addTagsFromInput = (value: string) => {
    const tags = Array.from(new Set(
      value
        .split(',')
        .map((tag) => tag.trim().toLowerCase())
        .filter(Boolean),
    ));
    if (tags.length === 0) return;
    updateDraft({
      actions: {
        ...draft.actions,
        addTags: Array.from(new Set([...draft.actions.addTags, ...tags])),
      },
    });
    setTagInput('');
  };

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-black/75 px-4 backdrop-blur-sm"
      onClick={onClose}
      onKeyDown={(event) => {
        if (event.key === 'Escape') onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Automation rules"
        className="flex h-[86vh] w-full max-w-6xl overflow-hidden rounded-xl border border-gray-700 bg-gray-900 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <aside className="flex w-80 flex-shrink-0 flex-col border-r border-gray-800 bg-gray-950/50">
          <div className="border-b border-gray-800 p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-white">Rules</h2>
                <p className="mt-1 text-xs text-gray-500">{activeRuleCount} active of {automationRules.length}</p>
              </div>
              <button
                type="button"
                onClick={() => loadRuleForEditing(null)}
                className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-blue-500"
              >
                <Plus className="h-4 w-4" />
                New Rule
              </button>
            </div>
          </div>

          <div className="flex-1 space-y-2 overflow-y-auto p-3">
            {automationRules.length === 0 ? (
              <div className="rounded-lg border border-dashed border-gray-700 px-3 py-8 text-center text-sm text-gray-500">
                No rules yet.
              </div>
            ) : (
              automationRules.map((rule) => {
                const isActive = editingRuleId === rule.id;
                return (
                  <button
                    key={rule.id}
                    type="button"
                    onClick={() => loadRuleForEditing(rule)}
                    className={`w-full rounded-lg border p-3 text-left transition-colors ${
                      isActive ? 'border-blue-500/50 bg-blue-500/10' : 'border-gray-800 bg-gray-900/60 hover:border-gray-700'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-gray-100">{rule.name}</div>
                        <div className="mt-1 text-xs text-gray-500">{describeCriteria(rule)}</div>
                      </div>
                      <span className={`rounded-full border px-2 py-0.5 text-[11px] ${
                        rule.enabled ? 'border-emerald-700/50 bg-emerald-950/50 text-emerald-300' : 'border-gray-700 bg-gray-950 text-gray-500'
                      }`}>
                        {rule.enabled ? 'On' : 'Off'}
                      </span>
                    </div>
                    <div className="mt-2 truncate text-xs text-gray-400" title={describeActions(rule, collectionNames)}>
                      {describeActions(rule, collectionNames)}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </aside>

        <section className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center justify-between gap-3 border-b border-gray-800 px-5 py-4">
            <div>
              <h2 className="text-lg font-semibold text-white">{isExistingRule ? 'Edit Rule' : 'New Rule'}</h2>
            </div>
            <button type="button" onClick={onClose} className="rounded-lg p-2 text-gray-400 hover:bg-gray-800 hover:text-white">
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
              <div className="space-y-5">
                <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_170px_180px]">
                  <label>
                    <span className={labelClassName}>Name</span>
                    <input value={draft.name} onChange={(event) => updateDraft({ name: event.target.value })} className={inputClassName} placeholder="Rule name" />
                  </label>
                  <label>
                    <span className={labelClassName}>Match</span>
                    <select
                      value={draft.criteria.matchMode}
                      onChange={(event) => updateDraft({ criteria: conditionRowsToCriteria(rows, event.target.value === 'any' ? 'any' : 'all') })}
                      className={inputClassName}
                    >
                      <option value="all">All conditions</option>
                      <option value="any">Any condition</option>
                    </select>
                  </label>
                  <label className="flex items-end gap-2 rounded-lg border border-gray-800 bg-gray-950/30 px-3 py-2">
                    <input type="checkbox" checked={draft.enabled} onChange={(event) => updateDraft({ enabled: event.target.checked })} className="mb-1 h-4 w-4 rounded border-gray-600 bg-gray-800 text-blue-500 focus:ring-blue-500" />
                    <span className="pb-0.5 text-sm text-gray-200">Enabled</span>
                  </label>
                </div>

                <WhenBuilder
                  rows={rows}
                  valueSource={valueSource}
                  onAdd={addConditionRow}
                  onImport={importCurrentFilters}
                  onUpdate={updateConditionRow}
                  onRemove={removeConditionRow}
                />

                <ThenActions
                  draft={draft}
                  tagInput={tagInput}
                  setTagInput={setTagInput}
                  addTagsFromInput={addTagsFromInput}
                  updateDraft={updateDraft}
                  collections={collections}
                  recentTags={recentTags}
                  availableTags={availableTags}
                  tagSuggestionLimit={tagSuggestionLimit}
                />
              </div>

              <PreviewPanel
                preview={preview}
                canSave={canSave}
                isExistingRule={isExistingRule}
                isApplying={isApplying}
                draft={draft}
                editingRuleId={editingRuleId}
                onSave={handleSave}
                onApply={handleApply}
                onDuplicate={handleDuplicate}
                onDelete={handleDelete}
                updateAutomationRule={updateAutomationRule}
                setDraft={setDraft}
              />
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

interface WhenBuilderProps {
  rows: AutomationConditionRow[];
  valueSource: Parameters<typeof getConditionValueOptions>[1];
  onAdd: () => void;
  onImport: () => void;
  onUpdate: (rowId: string, updates: Partial<AutomationConditionRow>) => void;
  onRemove: (rowId: string) => void;
}

const WhenBuilder: React.FC<WhenBuilderProps> = ({ rows, valueSource, onAdd, onImport, onUpdate, onRemove }) => (
  <section className="rounded-xl border border-gray-800 bg-gray-950/30 p-4">
    <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
      <div>
        <h3 className="text-sm font-semibold text-gray-100">When</h3>
      </div>
      <div className="flex items-center gap-2">
        <button type="button" onClick={onImport} className="rounded-lg border border-gray-700 px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-800">
          Import current sidebar filters
        </button>
        <button type="button" onClick={onAdd} className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-500">
          <Plus className="h-3.5 w-3.5" />
          Add condition
        </button>
      </div>
    </div>

    {rows.length === 0 ? (
      <button
        type="button"
        onClick={onAdd}
        className="flex w-full flex-col items-center justify-center rounded-xl border border-dashed border-gray-700 bg-gray-900/40 px-4 py-10 text-center text-gray-400 transition-colors hover:border-blue-600/50 hover:bg-blue-950/20 hover:text-blue-200"
      >
        <Plus className="mb-2 h-6 w-6" />
        <span className="text-sm font-medium">No conditions yet</span>
        <span className="mt-1 text-xs text-gray-500">Add your first condition</span>
      </button>
    ) : (
      <div className="space-y-2">
        {rows.map((row) => (
          <ConditionRowEditor
            key={row.id}
            row={row}
            valueSource={valueSource}
            onUpdate={(updates) => onUpdate(row.id, updates)}
            onRemove={() => onRemove(row.id)}
          />
        ))}
      </div>
    )}
  </section>
);

interface ConditionRowEditorProps {
  row: AutomationConditionRow;
  valueSource: Parameters<typeof getConditionValueOptions>[1];
  onUpdate: (updates: Partial<AutomationConditionRow>) => void;
  onRemove: () => void;
}

const ConditionRowEditor: React.FC<ConditionRowEditorProps> = ({ row, valueSource, onUpdate, onRemove }) => {
  const fieldOptions = getConditionFieldOptions();
  const operatorOptions = getOperatorsForField(row.field);
  const isText = TEXT_CONDITION_FIELDS.includes(row.field);
  const valueOptions = isText ? [] : getConditionValueOptions(row.field, valueSource);
  const isBoolean = row.field === 'favorite' || row.field === 'telemetry' || row.field === 'verifiedTelemetry';
  const isBetween = row.operator === 'between';
  const valueContainerClassName = `min-w-0 md:col-span-2 ${isBetween ? 'grid gap-2 sm:grid-cols-2' : ''}`.trim();

  return (
    <div className="grid gap-2 rounded-lg border border-gray-800 bg-gray-900/50 p-2 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_40px]">
      <select
        aria-label="Condition field"
        value={row.field}
        onChange={(event) => onUpdate({ field: event.target.value as AutomationConditionField })}
        className={compactInputClassName}
      >
        {fieldOptions.map((field) => <option key={field.value} value={field.value}>{field.label}</option>)}
      </select>
      <select
        aria-label="Condition operator"
        value={row.operator}
        onChange={(event) => onUpdate({ operator: event.target.value as AutomationConditionOperator })}
        className={compactInputClassName}
      >
        {operatorOptions.map((operator) => <option key={operator} value={operator}>{OPERATOR_LABELS[operator]}</option>)}
      </select>

      <button type="button" onClick={onRemove} className="h-9 rounded-lg border border-gray-700 text-gray-400 hover:bg-gray-800 hover:text-rose-300" title="Remove condition">
        <X className="mx-auto h-4 w-4" />
      </button>

      <div className={valueContainerClassName}>
        {isBoolean ? (
          <div className="flex h-9 w-full items-center rounded-lg border border-gray-700 bg-gray-800 px-3 text-sm text-gray-300">
            {row.field === 'telemetry' ? 'present' : row.field === 'verifiedTelemetry' ? 'true' : 'favorite'}
          </div>
        ) : isText ? (
          <input
            aria-label={`${CONDITION_FIELD_LABELS[row.field]} value`}
            value={row.value}
            onChange={(event) => onUpdate({ value: event.target.value })}
            className={compactInputClassName}
            placeholder="Type here..."
          />
        ) : valueOptions.length > 0 && !['steps', 'cfg'].includes(row.field) ? (
          <select
            aria-label={`${CONDITION_FIELD_LABELS[row.field]} value`}
            value={row.value}
            onChange={(event) => onUpdate({ value: event.target.value })}
            className={compactInputClassName}
          >
            <option value="">Choose...</option>
            {valueOptions.map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
        ) : (
          <input
            aria-label={`${CONDITION_FIELD_LABELS[row.field]} value`}
            type="number"
            value={row.value}
            onChange={(event) => onUpdate({ value: event.target.value })}
            className={compactInputClassName}
            placeholder="Value"
          />
        )}

        {isBetween && (
          <input
            aria-label={`${CONDITION_FIELD_LABELS[row.field]} end value`}
            type="number"
            value={row.valueEnd ?? ''}
            onChange={(event) => onUpdate({ valueEnd: event.target.value })}
            className={compactInputClassName}
            placeholder="To"
          />
        )}
      </div>
    </div>
  );
};

interface ThenActionsProps {
  draft: AutomationRule;
  tagInput: string;
  setTagInput: (value: string) => void;
  addTagsFromInput: (value: string) => void;
  updateDraft: (updates: Partial<AutomationRule>) => void;
  collections: SmartCollection[];
  recentTags: string[];
  availableTags: TagInfo[];
  tagSuggestionLimit: number;
}

const ThenActions: React.FC<ThenActionsProps> = ({
  draft,
  tagInput,
  setTagInput,
  addTagsFromInput,
  updateDraft,
  collections,
  recentTags,
  availableTags,
  tagSuggestionLimit,
}) => (
  <section className="rounded-xl border border-gray-800 bg-gray-950/30 p-4">
    <h3 className="text-sm font-semibold text-gray-100">Then</h3>

    <div className="mt-4 space-y-4">
      <div>
        <span className={labelClassName}>Add tag</span>
        <TagInputCombobox
          value={tagInput}
          onValueChange={setTagInput}
          onSubmit={addTagsFromInput}
          recentTags={recentTags}
          availableTags={availableTags}
          excludedTags={draft.actions.addTags}
          suggestionLimit={tagSuggestionLimit}
          mode="single"
          placeholder="Add tag..."
          wrapperClassName="relative"
          inputClassName={`${inputClassName} pr-14`}
          trailingContent={
            <button
              type="button"
              onClick={() => addTagsFromInput(tagInput)}
              className="absolute right-1.5 top-1.5 rounded-md bg-blue-600 px-2 py-1 text-xs font-medium text-white hover:bg-blue-500"
            >
              Add
            </button>
          }
        />
        {draft.actions.addTags.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {draft.actions.addTags.map((tag) => (
              <button
                key={tag}
                type="button"
                onClick={() => updateDraft({
                  actions: {
                    ...draft.actions,
                    addTags: draft.actions.addTags.filter((value) => value !== tag),
                  },
                })}
                className="rounded-full border border-blue-700/40 bg-blue-950/40 px-2 py-1 text-xs text-blue-200 hover:border-rose-500/50 hover:text-rose-200"
              >
                {tag} x
              </button>
            ))}
          </div>
        )}
      </div>

      <div>
        <span className={labelClassName}>Add to collection</span>
        <div className="max-h-40 space-y-2 overflow-y-auto rounded-lg border border-gray-800 bg-gray-950/40 p-2">
          {collections.length === 0 ? (
            <div className="px-2 py-3 text-center text-xs text-gray-500">No collections yet.</div>
          ) : (
            collections.map((collection) => {
              const checked = draft.actions.addToCollectionIds.includes(collection.id);
              return (
                <label key={collection.id} className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 text-sm text-gray-200 hover:bg-gray-800/50">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(event) => updateDraft({
                      actions: {
                        ...draft.actions,
                        addToCollectionIds: event.target.checked
                          ? [...draft.actions.addToCollectionIds, collection.id]
                          : draft.actions.addToCollectionIds.filter((id) => id !== collection.id),
                      },
                    })}
                    className="h-4 w-4 rounded border-gray-600 bg-gray-800 text-blue-500 focus:ring-blue-500"
                  />
                  <span className="truncate">{collection.name}</span>
                </label>
              );
            })
          )}
        </div>
      </div>

      <label className="flex items-start gap-3 rounded-lg border border-gray-800 bg-gray-950/40 px-3 py-3">
        <input
          type="checkbox"
          checked={draft.runOnNewImages}
          onChange={(event) => updateDraft({ runOnNewImages: event.target.checked })}
          className="mt-0.5 h-4 w-4 rounded border-gray-600 bg-gray-800 text-blue-500 focus:ring-blue-500"
        />
        <span>
          <span className="block text-sm text-gray-200">Run on new or updated images</span>
        </span>
      </label>
    </div>
  </section>
);

interface PreviewPanelProps {
  preview: PreviewState;
  canSave: boolean;
  isExistingRule: boolean;
  isApplying: boolean;
  draft: AutomationRule;
  editingRuleId: string | null;
  onSave: () => Promise<AutomationRule | null>;
  onApply: () => Promise<void>;
  onDuplicate: (rule: AutomationRule) => void;
  onDelete: (ruleId: string) => Promise<void>;
  updateAutomationRule: (ruleId: string, updates: Partial<Omit<AutomationRule, 'id' | 'createdAt'>>) => Promise<AutomationRule | null>;
  setDraft: (rule: AutomationRule) => void;
}

const PreviewPanel: React.FC<PreviewPanelProps> = ({
  preview,
  canSave,
  isExistingRule,
  isApplying,
  draft,
  editingRuleId,
  onSave,
  onApply,
  onDuplicate,
  onDelete,
  updateAutomationRule,
  setDraft,
}) => (
  <aside className="space-y-3">
    <div className="rounded-lg border border-gray-800 bg-gray-950/50 p-4">
      <h3 className="text-sm font-semibold text-gray-100">Preview</h3>
      <div className="mt-3 grid grid-cols-2 gap-2 text-center">
        <div className="rounded-lg border border-gray-800 bg-gray-900 px-3 py-3">
          <div className="text-lg font-semibold text-white">{preview.matchCount}</div>
          <div className="text-[11px] uppercase tracking-wide text-gray-500">matches</div>
        </div>
        <div className="rounded-lg border border-gray-800 bg-gray-900 px-3 py-3">
          <div className="text-lg font-semibold text-white">{preview.changeCount}</div>
          <div className="text-[11px] uppercase tracking-wide text-gray-500">changes</div>
        </div>
      </div>
      <p className="mt-3 text-xs text-gray-500">
        {preview.tagChangeCount} tag additions, {preview.collectionChangeCount} collection additions.
      </p>
    </div>

    <div className="space-y-2">
      <button
        type="button"
        onClick={() => void onSave()}
        disabled={!canSave}
        className="w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
      >
        Save Rule
      </button>
      <button
        type="button"
        onClick={() => void onApply()}
        disabled={isApplying || !canSave}
        className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-emerald-700/50 bg-emerald-950/40 px-4 py-2 text-sm font-semibold text-emerald-200 transition-colors hover:bg-emerald-900/40 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Play className="h-4 w-4" />
        {isApplying ? 'Applying...' : 'Apply Now'}
      </button>

      {isExistingRule && editingRuleId && (
        <>
          <button
            type="button"
            onClick={() => {
              void updateAutomationRule(editingRuleId, { enabled: !draft.enabled }).then((rule) => {
                if (rule) setDraft(rule);
              });
            }}
            className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-gray-700 px-4 py-2 text-sm text-gray-200 transition-colors hover:bg-gray-800"
          >
            <Power className="h-4 w-4" />
            {draft.enabled ? 'Disable Rule' : 'Enable Rule'}
          </button>
          <button
            type="button"
            onClick={() => onDuplicate(draft)}
            className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-gray-700 px-4 py-2 text-sm text-gray-200 transition-colors hover:bg-gray-800"
          >
            <Copy className="h-4 w-4" />
            Duplicate
          </button>
          <button
            type="button"
            onClick={() => void onDelete(editingRuleId)}
            className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-rose-900/50 px-4 py-2 text-sm text-rose-200 transition-colors hover:bg-rose-950/40"
          >
            <Trash2 className="h-4 w-4" />
            Delete
          </button>
        </>
      )}
    </div>
  </aside>
);
