import React, { useEffect, useMemo, useState } from 'react';
import { Copy, Play, Plus, Power, SlidersHorizontal, Trash2, X } from 'lucide-react';
import type {
  AdvancedFilters,
  AutomationRule,
  AutomationRuleCriteria,
  AutomationRuleFilterCriteria,
  AutomationTextCondition,
  AutomationTextField,
  AutomationTextOperator,
  ImageRating,
  SmartCollection,
  TagInfo,
} from '../types';
import { useImageStore } from '../store/useImageStore';
import { useSettingsStore } from '../store/useSettingsStore';
import TagInputCombobox from './TagInputCombobox';

interface AutomationRulesModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const TEXT_FIELDS: Array<{ value: AutomationTextField; label: string }> = [
  { value: 'prompt', label: 'Prompt' },
  { value: 'negativePrompt', label: 'Negative prompt' },
  { value: 'filename', label: 'Filename' },
  { value: 'metadata', label: 'Metadata' },
];

const TEXT_OPERATORS: Array<{ value: AutomationTextOperator; label: string }> = [
  { value: 'contains', label: 'contains' },
  { value: 'not_contains', label: 'does not contain' },
  { value: 'equals', label: 'equals' },
  { value: 'not_equals', label: 'does not equal' },
];

const createId = () =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `rule-${Date.now()}-${Math.random().toString(36).slice(2)}`;

const csvToList = (value: string, lower = false): string[] =>
  Array.from(
    new Set(
      value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
        .map((item) => lower ? item.toLowerCase() : item),
    ),
  );

const listToCsv = (value: string[] | undefined): string => (value ?? []).join(', ');

const emptyCriteria = (): AutomationRuleCriteria => ({
  matchMode: 'all',
  textConditions: [{ id: createId(), field: 'prompt', operator: 'contains', value: '' }],
  filters: {
    tagMatchMode: 'any',
    favoriteFilterMode: 'neutral',
    advancedFilters: {},
  },
});

const createDraftRule = (): AutomationRule => ({
  id: createId(),
  name: 'New Rule',
  enabled: true,
  criteria: emptyCriteria(),
  actions: { addTags: [], addToCollectionIds: [] },
  runOnNewImages: true,
  createdAt: Date.now(),
  updatedAt: Date.now(),
  lastAppliedAt: null,
  lastMatchCount: 0,
  lastChangeCount: 0,
});

const describeCriteria = (criteria: AutomationRuleCriteria): string => {
  const parts: string[] = [];
  const textCount = criteria.textConditions.filter((condition) => condition.value.trim()).length;
  if (textCount > 0) parts.push(`${textCount} text`);

  const filters = criteria.filters;
  const filterCount = [
    filters.searchQuery,
    ...(filters.models ?? []),
    ...(filters.excludedModels ?? []),
    ...(filters.loras ?? []),
    ...(filters.excludedLoras ?? []),
    ...(filters.samplers ?? []),
    ...(filters.excludedSamplers ?? []),
    ...(filters.schedulers ?? []),
    ...(filters.excludedSchedulers ?? []),
    ...(filters.tags ?? []),
    ...(filters.excludedTags ?? []),
    ...(filters.autoTags ?? []),
    ...(filters.excludedAutoTags ?? []),
  ].filter(Boolean).length;
  if (filterCount > 0) parts.push(`${filterCount} filters`);
  if (filters.favoriteFilterMode && filters.favoriteFilterMode !== 'neutral') parts.push('favorite');
  if (filters.ratings?.length) parts.push('rating');
  if (filters.advancedFilters && Object.keys(filters.advancedFilters).length > 0) parts.push('advanced');

  return parts.length > 0 ? parts.join(' + ') : 'No criteria yet';
};

const describeActions = (rule: AutomationRule, collectionNames: Map<string, string>): string => {
  const parts: string[] = [];
  if (rule.actions.addTags.length > 0) {
    parts.push(`tags: ${rule.actions.addTags.join(', ')}`);
  }
  if (rule.actions.addToCollectionIds.length > 0) {
    parts.push(`collections: ${rule.actions.addToCollectionIds.map((id) => collectionNames.get(id) ?? id).join(', ')}`);
  }
  return parts.length > 0 ? parts.join(' | ') : 'No actions yet';
};

const inputClassName =
  'w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100 outline-none transition-colors focus:border-blue-500 focus:ring-1 focus:ring-blue-500';
const labelClassName = 'mb-1 block text-xs font-medium uppercase tracking-wide text-gray-400';

const AutomationRulesModal: React.FC<AutomationRulesModalProps> = ({ isOpen, onClose }) => {
  const images = useImageStore((state) => state.images);
  const automationRules = useImageStore((state) => state.automationRules);
  const collections = useImageStore((state) => state.collections);
  const availableTags = useImageStore((state) => state.availableTags);
  const recentTags = useImageStore((state) => state.recentTags);
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
  const [tagInput, setTagInput] = useState('');
  const [preview, setPreview] = useState({ matchCount: 0, changeCount: 0, tagChangeCount: 0, collectionChangeCount: 0 });
  const [isApplying, setIsApplying] = useState(false);

  const collectionNames = useMemo(
    () => new Map(collections.map((collection) => [collection.id, collection.name])),
    [collections],
  );

  useEffect(() => {
    if (!isOpen) return;
    if (automationRules.length > 0) {
      const first = automationRules[0];
      setEditingRuleId(first.id);
      setDraft({ ...first, criteria: { ...first.criteria, filters: { ...first.criteria.filters } } });
      return;
    }
    setEditingRuleId(null);
    setDraft(createDraftRule());
  }, [automationRules, isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const timeoutId = window.setTimeout(() => {
      setPreview(previewAutomationRule(draft));
    }, 250);
    return () => window.clearTimeout(timeoutId);
  }, [draft, images, isOpen, previewAutomationRule]);

  if (!isOpen) {
    return null;
  }

  const isExistingRule = editingRuleId !== null && automationRules.some((rule) => rule.id === editingRuleId);
  const activeRuleCount = automationRules.filter((rule) => rule.enabled).length;

  const updateDraft = (updates: Partial<AutomationRule>) => {
    setDraft((current) => ({ ...current, ...updates, updatedAt: Date.now() }));
  };

  const updateCriteria = (updates: Partial<AutomationRuleCriteria>) => {
    setDraft((current) => ({
      ...current,
      criteria: { ...current.criteria, ...updates },
      updatedAt: Date.now(),
    }));
  };

  const updateFilters = (updates: Partial<AutomationRuleFilterCriteria>) => {
    setDraft((current) => ({
      ...current,
      criteria: {
        ...current.criteria,
        filters: { ...current.criteria.filters, ...updates },
      },
      updatedAt: Date.now(),
    }));
  };

  const updateTextCondition = (conditionId: string, updates: Partial<AutomationTextCondition>) => {
    updateCriteria({
      textConditions: draft.criteria.textConditions.map((condition) =>
        condition.id === conditionId ? { ...condition, ...updates } : condition,
      ),
    });
  };

  const addTextCondition = () => {
    updateCriteria({
      textConditions: [
        ...draft.criteria.textConditions,
        { id: createId(), field: 'prompt', operator: 'contains', value: '' },
      ],
    });
  };

  const removeTextCondition = (conditionId: string) => {
    updateCriteria({
      textConditions: draft.criteria.textConditions.filter((condition) => condition.id !== conditionId),
    });
  };

  const useCurrentFilters = () => {
    updateCriteria({
      filters: {
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
      },
    });
  };

  const handleSave = async (): Promise<AutomationRule | null> => {
    const preparedRule = {
      ...draft,
      name: draft.name.trim() || 'Untitled Rule',
      criteria: {
        ...draft.criteria,
        textConditions: draft.criteria.textConditions.filter((condition) => condition.value.trim()),
      },
    };
    const savedRule = isExistingRule
      ? await updateAutomationRule(editingRuleId as string, preparedRule)
      : await createAutomationRule(preparedRule);
    if (savedRule) {
      setEditingRuleId(savedRule.id);
      setDraft(savedRule);
    }
    return savedRule;
  };

  const handleApply = async () => {
    setIsApplying(true);
    try {
      const savedRule = isExistingRule ? draft : await handleSave();
      const ruleId = isExistingRule ? editingRuleId : savedRule?.id;
      if (!ruleId) return;
      const result = await applyAutomationRuleNow(ruleId);
      if (result) setPreview(result);
    } finally {
      setIsApplying(false);
    }
  };

  const handleDuplicate = (rule: AutomationRule) => {
    setEditingRuleId(null);
    setDraft({
      ...rule,
      id: createId(),
      name: `${rule.name} Copy`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      lastAppliedAt: null,
      lastMatchCount: 0,
      lastChangeCount: 0,
    });
  };

  const handleDelete = async (ruleId: string) => {
    const confirmed = window.confirm('Delete this rule? Existing tags and collection membership will stay in place.');
    if (!confirmed) return;
    await deleteAutomationRuleById(ruleId);
  };

  const addTagsFromInput = (value: string) => {
    const tags = csvToList(value, true);
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
                onClick={() => {
                  setEditingRuleId(null);
                  setDraft(createDraftRule());
                }}
                className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-blue-500"
              >
                <Plus className="h-4 w-4" />
                New
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
                  <div
                    key={rule.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => {
                      setEditingRuleId(rule.id);
                      setDraft({ ...rule, criteria: { ...rule.criteria, filters: { ...rule.criteria.filters } } });
                    }}
                    className={`rounded-lg border p-3 text-left transition-colors ${
                      isActive ? 'border-blue-500/50 bg-blue-500/10' : 'border-gray-800 bg-gray-900/60 hover:border-gray-700'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-gray-100">{rule.name}</div>
                        <div className="mt-1 text-xs text-gray-500">{describeCriteria(rule.criteria)}</div>
                      </div>
                      <span className={`rounded-full border px-2 py-0.5 text-[11px] ${
                        rule.enabled
                          ? 'border-emerald-700/50 bg-emerald-950/50 text-emerald-300'
                          : 'border-gray-700 bg-gray-950 text-gray-500'
                      }`}>
                        {rule.enabled ? 'On' : 'Off'}
                      </span>
                    </div>
                    <div className="mt-2 truncate text-xs text-gray-400" title={describeActions(rule, collectionNames)}>
                      {describeActions(rule, collectionNames)}
                    </div>
                    <div className="mt-3 flex items-center justify-between text-[11px] text-gray-500">
                      <span>{rule.lastMatchCount ?? 0} matches</span>
                      <span>{rule.lastChangeCount ?? 0} changes</span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </aside>

        <section className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center justify-between gap-3 border-b border-gray-800 px-5 py-4">
            <div>
              <h2 className="text-lg font-semibold text-white">{isExistingRule ? 'Edit Rule' : 'New Rule'}</h2>
              <p className="mt-1 text-xs text-gray-500">Rules add tags or collection membership without removing existing curation.</p>
            </div>
            <button type="button" onClick={onClose} className="rounded-lg p-2 text-gray-400 hover:bg-gray-800 hover:text-white">
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
              <div className="space-y-5">
                <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_160px_180px]">
                  <label>
                    <span className={labelClassName}>Name</span>
                    <input
                      value={draft.name}
                      onChange={(event) => updateDraft({ name: event.target.value })}
                      className={inputClassName}
                      placeholder="Rule name"
                    />
                  </label>
                  <label>
                    <span className={labelClassName}>Match</span>
                    <select
                      value={draft.criteria.matchMode}
                      onChange={(event) => updateCriteria({ matchMode: event.target.value === 'any' ? 'any' : 'all' })}
                      className={inputClassName}
                    >
                      <option value="all">All conditions</option>
                      <option value="any">Any condition</option>
                    </select>
                  </label>
                  <label className="flex items-end gap-2 rounded-lg border border-gray-800 bg-gray-950/30 px-3 py-2">
                    <input
                      type="checkbox"
                      checked={draft.enabled}
                      onChange={(event) => updateDraft({ enabled: event.target.checked })}
                      className="mb-1 h-4 w-4 rounded border-gray-600 bg-gray-800 text-blue-500 focus:ring-blue-500"
                    />
                    <span className="pb-0.5 text-sm text-gray-200">Enabled</span>
                  </label>
                </div>

                <div>
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <h3 className="text-sm font-semibold text-gray-100">Text conditions</h3>
                    <button type="button" onClick={addTextCondition} className="rounded-lg border border-gray-700 px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-800">
                      Add condition
                    </button>
                  </div>

                  <div className="space-y-2">
                    {draft.criteria.textConditions.map((condition) => (
                      <div key={condition.id} className="grid gap-2 md:grid-cols-[160px_170px_minmax(0,1fr)_40px]">
                        <select value={condition.field} onChange={(event) => updateTextCondition(condition.id, { field: event.target.value as AutomationTextField })} className={inputClassName}>
                          {TEXT_FIELDS.map((field) => <option key={field.value} value={field.value}>{field.label}</option>)}
                        </select>
                        <select value={condition.operator} onChange={(event) => updateTextCondition(condition.id, { operator: event.target.value as AutomationTextOperator })} className={inputClassName}>
                          {TEXT_OPERATORS.map((operator) => <option key={operator.value} value={operator.value}>{operator.label}</option>)}
                        </select>
                        <input
                          value={condition.value}
                          onChange={(event) => updateTextCondition(condition.id, { value: event.target.value })}
                          className={inputClassName}
                          placeholder="cat, dog, CyberRealistic..."
                        />
                        <button type="button" onClick={() => removeTextCondition(condition.id)} className="rounded-lg border border-gray-700 text-gray-400 hover:bg-gray-800 hover:text-rose-300" title="Remove condition">
                          <X className="mx-auto h-4 w-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>

                <RuleFilterEditor
                  draft={draft}
                  updateFilters={updateFilters}
                  useCurrentFilters={useCurrentFilters}
                />

                <RuleActionsEditor
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

              <RulePreviewPanel
                preview={preview}
                isExistingRule={isExistingRule}
                isApplying={isApplying}
                draft={draft}
                editingRuleId={editingRuleId}
                handleSave={handleSave}
                handleApply={handleApply}
                handleDuplicate={handleDuplicate}
                handleDelete={handleDelete}
                updateAutomationRule={updateAutomationRule}
                setDraft={setDraft}
              />
            </div>
          </div>
        </section>
      </div>
    </div>
  );
};

interface RuleFilterEditorProps {
  draft: AutomationRule;
  updateFilters: (updates: Partial<AutomationRuleFilterCriteria>) => void;
  useCurrentFilters: () => void;
}

const RuleFilterEditor: React.FC<RuleFilterEditorProps> = ({ draft, updateFilters, useCurrentFilters }) => {
  const textFilters: Array<[string, keyof AutomationRuleFilterCriteria, boolean]> = [
    ['Checkpoints', 'models', false],
    ['Exclude checkpoints', 'excludedModels', false],
    ['LoRAs', 'loras', false],
    ['Exclude LoRAs', 'excludedLoras', false],
    ['Manual tags', 'tags', true],
    ['Exclude manual tags', 'excludedTags', true],
    ['Auto-tags', 'autoTags', false],
    ['Exclude auto-tags', 'excludedAutoTags', false],
    ['Samplers', 'samplers', false],
    ['Schedulers', 'schedulers', false],
  ];

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-gray-100">Filter criteria</h3>
        <button
          type="button"
          onClick={useCurrentFilters}
          className="inline-flex items-center gap-2 rounded-lg border border-blue-700/50 bg-blue-950/30 px-3 py-1.5 text-xs text-blue-200 hover:bg-blue-900/40"
        >
          <SlidersHorizontal className="h-3.5 w-3.5" />
          Use Current Filters
        </button>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        {textFilters.map(([label, key, lower]) => (
          <label key={String(key)}>
            <span className={labelClassName}>{label}</span>
            <input
              value={listToCsv(draft.criteria.filters[key] as string[])}
              onChange={(event) => updateFilters({ [key]: csvToList(event.target.value, lower) })}
              className={inputClassName}
              placeholder="Comma separated"
            />
          </label>
        ))}
      </div>

      <div className="mt-3 grid gap-3 md:grid-cols-3">
        <label>
          <span className={labelClassName}>Search query</span>
          <input
            value={draft.criteria.filters.searchQuery ?? ''}
            onChange={(event) => updateFilters({ searchQuery: event.target.value })}
            className={inputClassName}
          />
        </label>
        <label>
          <span className={labelClassName}>Favorite</span>
          <select
            value={draft.criteria.filters.favoriteFilterMode ?? 'neutral'}
            onChange={(event) => updateFilters({ favoriteFilterMode: event.target.value as 'neutral' | 'include' | 'exclude' })}
            className={inputClassName}
          >
            <option value="neutral">Ignore</option>
            <option value="include">Only favorites</option>
            <option value="exclude">Exclude favorites</option>
          </select>
        </label>
        <label>
          <span className={labelClassName}>Ratings</span>
          <input
            value={(draft.criteria.filters.ratings ?? []).join(', ')}
            onChange={(event) => updateFilters({
              ratings: csvToList(event.target.value)
                .map((value) => Number(value))
                .filter((value): value is ImageRating => [1, 2, 3, 4, 5].includes(value)),
            })}
            className={inputClassName}
            placeholder="1, 2, 3..."
          />
        </label>
      </div>

      {draft.criteria.filters.advancedFilters && Object.keys(draft.criteria.filters.advancedFilters as AdvancedFilters).length > 0 && (
        <p className="mt-3 rounded-lg border border-gray-800 bg-gray-950/40 px-3 py-2 text-xs text-gray-400">
          Advanced filters captured from the sidebar: {Object.keys(draft.criteria.filters.advancedFilters).join(', ')}
        </p>
      )}
    </div>
  );
};

interface RuleActionsEditorProps {
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

const RuleActionsEditor: React.FC<RuleActionsEditorProps> = ({
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
  <div>
    <h3 className="mb-2 text-sm font-semibold text-gray-100">Actions</h3>
    <div className="space-y-3">
      <div>
        <span className={labelClassName}>Add tags</span>
        <TagInputCombobox
          value={tagInput}
          onValueChange={setTagInput}
          onSubmit={addTagsFromInput}
          recentTags={recentTags}
          availableTags={availableTags}
          excludedTags={draft.actions.addTags}
          suggestionLimit={tagSuggestionLimit}
          mode="csv"
          placeholder="animal, realistic..."
          wrapperClassName="relative"
          inputClassName={inputClassName}
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
        <span className={labelClassName}>Add to collections</span>
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
          <span className="mt-1 block text-xs text-gray-500">Manual apply is always available from this modal.</span>
        </span>
      </label>
    </div>
  </div>
);

interface RulePreviewPanelProps {
  preview: { matchCount: number; changeCount: number; tagChangeCount: number; collectionChangeCount: number };
  isExistingRule: boolean;
  isApplying: boolean;
  draft: AutomationRule;
  editingRuleId: string | null;
  handleSave: () => Promise<AutomationRule | null>;
  handleApply: () => Promise<void>;
  handleDuplicate: (rule: AutomationRule) => void;
  handleDelete: (ruleId: string) => Promise<void>;
  updateAutomationRule: (ruleId: string, updates: Partial<Omit<AutomationRule, 'id' | 'createdAt'>>) => Promise<AutomationRule | null>;
  setDraft: (rule: AutomationRule) => void;
}

const RulePreviewPanel: React.FC<RulePreviewPanelProps> = ({
  preview,
  isExistingRule,
  isApplying,
  draft,
  editingRuleId,
  handleSave,
  handleApply,
  handleDuplicate,
  handleDelete,
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
        onClick={() => void handleSave()}
        disabled={!draft.name.trim()}
        className="w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
      >
        Save Rule
      </button>
      <button
        type="button"
        onClick={() => void handleApply()}
        disabled={isApplying || !draft.name.trim()}
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
            onClick={() => handleDuplicate(draft)}
            className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-gray-700 px-4 py-2 text-sm text-gray-200 transition-colors hover:bg-gray-800"
          >
            <Copy className="h-4 w-4" />
            Duplicate
          </button>
          <button
            type="button"
            onClick={() => void handleDelete(editingRuleId)}
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

export default AutomationRulesModal;
