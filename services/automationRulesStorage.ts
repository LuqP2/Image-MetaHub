/// <reference lib="dom" />

import type {
  AdvancedFilters,
  AutomationRule,
  AutomationRuleAction,
  AutomationRuleCriteria,
  AutomationRuleFilterCriteria,
  AutomationTextCondition,
  AutomationTextField,
  AutomationTextOperator,
  ImageRating,
} from '../types';
import {
  openPreferencesDatabase,
  PREFERENCES_STORE_NAMES,
} from './preferencesDb';
import { isConditionRowComplete, normalizeConditionRow } from '../utils/automationRuleRows';

const STORE_NAME = PREFERENCES_STORE_NAMES.automationRules;

const inMemoryRules = new Map<string, AutomationRule>();
let isPersistenceDisabled = false;

const TEXT_FIELDS: AutomationTextField[] = ['prompt', 'negativePrompt', 'filename', 'metadata', 'search'];
const TEXT_OPERATORS: AutomationTextOperator[] = ['contains', 'not_contains', 'equals', 'not_equals'];
const RATINGS = new Set<ImageRating>([1, 2, 3, 4, 5]);

function disablePersistence(error?: unknown) {
  if (isPersistenceDisabled) {
    return;
  }

  console.error(
    'IndexedDB open error for automation rules storage. Automation rule persistence will be disabled for this session.',
    error,
  );
  isPersistenceDisabled = true;
}

async function openDatabase(): Promise<IDBDatabase | null> {
  return openPreferencesDatabase({
    context: 'automation rules storage',
    disablePersistence,
  });
}

const normalizeStringList = (values: unknown): string[] => {
  if (!Array.isArray(values)) {
    return [];
  }

  return Array.from(
    new Set(
      values
        .map((value) => (typeof value === 'string' ? value.trim() : ''))
        .filter(Boolean),
    ),
  );
};

const normalizeTagList = (values: unknown): string[] =>
  normalizeStringList(values).map((value) => value.toLowerCase());

const normalizeRatings = (values: unknown): ImageRating[] => {
  if (!Array.isArray(values)) {
    return [];
  }

  return Array.from(new Set(values))
    .filter((value): value is ImageRating => typeof value === 'number' && RATINGS.has(value as ImageRating))
    .sort((a, b) => a - b);
};

const normalizeAdvancedFilters = (filters: unknown): AdvancedFilters => {
  if (!filters || typeof filters !== 'object') {
    return {};
  }

  return filters as AdvancedFilters;
};

export function normalizeAutomationRuleCriteria(criteria: Partial<AutomationRuleCriteria> | undefined): AutomationRuleCriteria {
  const filters = (criteria?.filters ?? {}) as Partial<AutomationRuleFilterCriteria>;

  const textConditions = Array.isArray(criteria?.textConditions)
    ? criteria.textConditions
        .map((condition, index): AutomationTextCondition | null => {
          if (!condition || typeof condition !== 'object') {
            return null;
          }

          const field = TEXT_FIELDS.includes(condition.field) ? condition.field : 'prompt';
          const operator = TEXT_OPERATORS.includes(condition.operator) ? condition.operator : 'contains';
          const value = typeof condition.value === 'string' ? condition.value.trim() : '';
          if (!value) {
            return null;
          }

          return {
            id: typeof condition.id === 'string' && condition.id ? condition.id : `condition-${index}`,
            field,
            operator,
            value,
          };
        })
        .filter((condition): condition is AutomationTextCondition => Boolean(condition))
    : [];

  const conditionRows = Array.isArray(criteria?.conditionRows)
    ? criteria.conditionRows
        .map((row) => normalizeConditionRow(row))
        .filter(isConditionRowComplete)
    : [];

  return {
    matchMode: criteria?.matchMode === 'any' ? 'any' : 'all',
    textConditions,
    conditionRows,
    filters: {
      searchQuery: typeof filters.searchQuery === 'string' ? filters.searchQuery.trim() : '',
      models: normalizeStringList(filters.models),
      excludedModels: normalizeStringList(filters.excludedModels),
      loras: normalizeStringList(filters.loras),
      excludedLoras: normalizeStringList(filters.excludedLoras),
      samplers: normalizeStringList(filters.samplers),
      excludedSamplers: normalizeStringList(filters.excludedSamplers),
      schedulers: normalizeStringList(filters.schedulers),
      excludedSchedulers: normalizeStringList(filters.excludedSchedulers),
      generators: normalizeStringList(filters.generators),
      excludedGenerators: normalizeStringList(filters.excludedGenerators),
      gpuDevices: normalizeStringList(filters.gpuDevices),
      excludedGpuDevices: normalizeStringList(filters.excludedGpuDevices),
      tags: normalizeTagList(filters.tags),
      excludedTags: normalizeTagList(filters.excludedTags),
      tagMatchMode: filters.tagMatchMode === 'all' ? 'all' : 'any',
      autoTags: normalizeStringList(filters.autoTags),
      excludedAutoTags: normalizeStringList(filters.excludedAutoTags),
      favoriteFilterMode:
        filters.favoriteFilterMode === 'include' || filters.favoriteFilterMode === 'exclude'
          ? filters.favoriteFilterMode
          : 'neutral',
      ratings: normalizeRatings(filters.ratings),
      advancedFilters: normalizeAdvancedFilters(filters.advancedFilters),
    },
  };
}

export function normalizeAutomationRuleActions(actions: Partial<AutomationRuleAction> | undefined): AutomationRuleAction {
  return {
    addTags: normalizeTagList(actions?.addTags),
    addToCollectionIds: normalizeStringList(actions?.addToCollectionIds),
  };
}

export function normalizeAutomationRule(
  rule: Partial<AutomationRule> & Pick<AutomationRule, 'id' | 'name' | 'createdAt' | 'updatedAt'>,
): AutomationRule {
  return {
    id: rule.id,
    name: rule.name.trim() || 'Untitled Rule',
    enabled: rule.enabled !== false,
    criteria: normalizeAutomationRuleCriteria(rule.criteria),
    actions: normalizeAutomationRuleActions(rule.actions),
    runOnNewImages: rule.runOnNewImages !== false,
    createdAt: rule.createdAt,
    updatedAt: rule.updatedAt,
    lastAppliedAt: rule.lastAppliedAt ?? null,
    lastMatchCount: Number.isFinite(rule.lastMatchCount) ? Math.max(0, Number(rule.lastMatchCount)) : 0,
    lastChangeCount: Number.isFinite(rule.lastChangeCount) ? Math.max(0, Number(rule.lastChangeCount)) : 0,
  };
}

const sortRules = (rules: AutomationRule[]): AutomationRule[] =>
  [...rules].sort((a, b) => {
    const dateDelta = a.createdAt - b.createdAt;
    if (dateDelta !== 0) {
      return dateDelta;
    }
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  });

export async function getAllAutomationRules(): Promise<AutomationRule[]> {
  if (isPersistenceDisabled) {
    return sortRules(Array.from(inMemoryRules.values()));
  }

  const db = await openDatabase();
  if (!db) {
    return sortRules(Array.from(inMemoryRules.values()));
  }

  return new Promise((resolve) => {
    const transaction = db.transaction(STORE_NAME, 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.getAll();

    const close = () => {
      try {
        db.close();
      } catch (error) {
        console.warn('Failed to close automation rules storage after load', error);
      }
    };

    transaction.oncomplete = close;
    transaction.onabort = close;
    transaction.onerror = close;

    request.onsuccess = () => {
      const rules = ((request.result || []) as AutomationRule[]).map((rule) => normalizeAutomationRule(rule));
      inMemoryRules.clear();
      rules.forEach((rule) => inMemoryRules.set(rule.id, rule));
      resolve(sortRules(rules));
    };

    request.onerror = () => {
      console.error('Failed to load automation rules', request.error);
      resolve(sortRules(Array.from(inMemoryRules.values())));
    };
  });
}

export async function saveAutomationRule(rule: AutomationRule): Promise<void> {
  const normalizedRule = normalizeAutomationRule({
    ...rule,
    updatedAt: Date.now(),
  });
  inMemoryRules.set(normalizedRule.id, normalizedRule);

  if (isPersistenceDisabled) {
    return;
  }

  const db = await openDatabase();
  if (!db) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.put(normalizedRule);

    const close = () => {
      try {
        db.close();
      } catch (error) {
        console.warn('Failed to close automation rules storage after save', error);
      }
    };

    transaction.oncomplete = () => {
      close();
      resolve();
    };
    transaction.onabort = () => {
      close();
      reject(transaction.error);
    };
    transaction.onerror = () => {
      close();
      reject(transaction.error);
    };

    request.onerror = () => {
      console.error('Failed to save automation rule', request.error);
      reject(request.error);
    };
  }).catch((error) => {
    console.error('IndexedDB save error for automation rule:', error);
    disablePersistence(error);
  });
}

export async function deleteAutomationRule(ruleId: string): Promise<void> {
  inMemoryRules.delete(ruleId);

  if (isPersistenceDisabled) {
    return;
  }

  const db = await openDatabase();
  if (!db) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.delete(ruleId);

    const close = () => {
      try {
        db.close();
      } catch (error) {
        console.warn('Failed to close automation rules storage after delete', error);
      }
    };

    transaction.oncomplete = () => {
      close();
      resolve();
    };
    transaction.onabort = () => {
      close();
      reject(transaction.error);
    };
    transaction.onerror = () => {
      close();
      reject(transaction.error);
    };

    request.onerror = () => {
      console.error('Failed to delete automation rule', request.error);
      reject(request.error);
    };
  }).catch((error) => {
    console.error('IndexedDB delete error for automation rule:', error);
    disablePersistence(error);
  });
}
