import { formatMessage } from './messages.mjs';
import type { Translate } from './useTranslation';
import { modelKindLabel } from '../services/modelLibrary/modelKinds';
import type { ModelSourceKind } from '../services/modelLibrary/types';

/** Translate human labels only; classification, stored kinds and search text stay stable. */
export function modelKindText(kind: ModelSourceKind, t: Translate): string {
  const keys = { auto: 'modelLibrary.kindAuto', diffusion: 'modelLibrary.kindDiffusion', textEncoder: 'modelLibrary.kindEncoder', upscaler: 'modelLibrary.kindUpscaler', other: 'modelLibrary.kindOther' } as const;
  return Object.hasOwn(keys, kind) ? t(keys[kind as keyof typeof keys]) : modelKindLabel(kind);
}

const errorKeys = ['modelLibrary.copyTriggersFailed', 'modelLibrary.copyTriggerFailed', 'modelLibrary.copyLoraFailed', 'modelLibrary.copyShaFailed'] as const;

export function translateModelMessage(message: string, t: Translate): string {
  for (const key of errorKeys) {
    if (message === key || message === formatMessage('en', key)) return t(key);
  }
  return message;
}
