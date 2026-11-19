import { formatMessage } from './messages.mjs';
import type { Translate } from './useTranslation';
import { modelKindLabel } from '../services/modelLibrary/modelKinds';
import type { ModelSourceKind } from '../services/modelLibrary/types';

/** Translate human labels only; classification, stored kinds and search text stay stable. */
export function modelKindText(kind: ModelSourceKind, t: Translate): string {
  const keys = { auto: 'modelLibrary.kindAuto', diffusion: 'modelLibrary.kindDiffusion', textEncoder: 'modelLibrary.kindEncoder', upscaler: 'modelLibrary.kindUpscaler', other: 'modelLibrary.kindOther' } as const;
  return Object.hasOwn(keys, kind) ? t(keys[kind as keyof typeof keys]) : modelKindLabel(kind);
}

const errorKeys = ['modelLibrary.copyTriggersFailed', 'modelLibrary.copyTriggerFailed', 'modelLibrary.copyLoraFailed', 'modelLibrary.copyShaFailed', 'modelLibrary.actionFailed', 'modelLibrary.revealFailed', 'modelLibrary.baseNotProvided', 'modelLibrary.sameFamily', 'modelLibrary.otherBase', 'modelLibrary.sourceExists', 'modelLibrary.copyPathFailed'] as const;

export function translateModelMessage(message: string, t: Translate): string {
  for (const key of errorKeys) {
    if (message === key || message === formatMessage('en', key)) return t(key);
  }
  const patterns = [
    [/^([\s\S]+): check stopped\.$/, 'modelLibrary.checkStoppedNamed'],
    [/^([\s\S]+): check failed\.$/, 'modelLibrary.checkFailedNamed'],
    [/^([\s\S]+): new updates available — see the provider links on this model\.$/, 'modelLibrary.updatesNamed'],
    [/^([\s\S]+): new versions available — see the Civitai links on this model\.$/, 'modelLibrary.versionsNamed'],
    [/^([\s\S]+): no unread new updates\.$/, 'modelLibrary.noUpdatesNamed'],
    [/^([\s\S]+): no unread new versions\.$/, 'modelLibrary.noVersionsNamed'],
  ] as const;
  for (const [pattern, key] of patterns) {
    const match = pattern.exec(message);
    if (match) return t(key, { name: match[1] });
  }
  return message;
}
