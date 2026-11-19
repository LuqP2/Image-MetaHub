import type { AutomationConditionField, AutomationConditionOperator } from '../types';
import type { Translate } from './useTranslation';

export function automationFieldLabels(t: Translate): Record<AutomationConditionField, string> {
  return {
    search: t('librarySearch.search'),
    prompt: t('libraryGallery.prompt'),
    negativePrompt: t('libraryGallery.negativePrompt'),
    filename: t('libraryGallery.filename'),
    metadata: t('comparison.metadata'),
    model: t('librarySearch.checkpoint'),
    lora: "LoRA",
    sampler: t('librarySearch.sampler'),
    scheduler: t('librarySearch.scheduler'),
    generator: t('librarySearch.generator'),
    gpu: "GPU",
    tag: t('automation.field.manualTag'),
    autoTag: t('automation.field.autoTag'),
    dimension: t('librarySearch.dimensions'),
    date: t('librarySearch.date'),
    generationMode: t('librarySearch.generationMode'),
    mediaType: t('librarySearch.mediaType'),
    favorite: t('canvas.favorite'),
    rating: t('librarySearch.rating'),
    steps: t('libraryGallery.steps'),
    cfg: "CFG",
    generationTimeMs: t('automation.field.generationTimeMs'),
    stepsPerSecond: t('automation.field.stepsPerSecond'),
    vramPeakMb: t('automation.field.vramPeakMb'),
    telemetry: t('automation.field.telemetry'),
    verifiedTelemetry: t('automation.field.verifiedTelemetry'),
  };
}

export function automationOperatorLabels(t: Translate): Record<AutomationConditionOperator, string> {
  return {
    contains: t('automation.operator.contains'),
    not_contains: t('automation.operator.notContains'),
    equals: t('automation.operator.equals'),
    not_equals: t('automation.operator.notEquals'),
    includes: t('automation.operator.includes'),
    not_includes: t('automation.operator.notIncludes'),
    is: t('automation.operator.is'),
    is_not: t('automation.operator.isNot'),
    at_least: t('automation.operator.atLeast'),
    at_most: t('automation.operator.atMost'),
    between: t('automation.operator.between'),
  };
}
