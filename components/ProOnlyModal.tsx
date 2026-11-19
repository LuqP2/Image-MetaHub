import { useTranslation } from '../i18n/useTranslation';
import React from 'react';
import { createPortal } from 'react-dom';
import { X, Crown, Sparkles, GitCompare, BarChart3, CheckCircle2, Download, Tag, Box, Image as ImageIcon, LucideIcon } from 'lucide-react';
import { ProFeature, CLUSTERING_FREE_TIER_LIMIT, SEMANTIC_FREE_TIER_LIMIT, useProModalStore } from '../hooks/useFeatureAccess';
import { TRIAL_DURATION_DAYS } from '../store/useLicenseStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { ProPlanCheckoutOptions } from './ProPlanSelector';

interface ProOnlyModalProps {
  isOpen: boolean;
  onClose: () => void;
  feature: ProFeature;
  isTrialActive: boolean;
  daysRemaining: number;
  canStartTrial: boolean;
  onStartTrial: () => Promise<boolean>;
  isExpired: boolean;
  isPro: boolean;
}

type FeatureCopy = {
  contextLine: string;
  headline: string;
  featureName: string;
  icon: LucideIcon;
  bullets: string[];
  alsoUnlocks: string;
  freeTierNote?: string;
};

const ProOnlyModal: React.FC<ProOnlyModalProps> = ({
  isOpen,
  onClose,
  feature,
  canStartTrial,
  onStartTrial,
}) => {
  const { t: tr } = useTranslation();
  const featureInfo: Record<ProFeature, FeatureCopy> = {
    canvas: {
      contextLine: tr('licensing.locked.canvas.context'),
      headline: tr('licensing.locked.canvas.headline'),
      featureName: tr('licensing.locked.canvas.name'), icon: Sparkles,
      bullets: [tr('licensing.locked.canvas.bulletBoards'), tr('licensing.locked.canvas.bulletInspect'), tr('licensing.locked.canvas.bulletLibrary')],
      alsoUnlocks: tr('licensing.locked.canvas.afterTrial'),
    },
    prompt_library_advanced: {
      contextLine: tr('licensing.locked.promptLibrary.context'),
      headline: tr('licensing.locked.promptLibrary.headline'),
      featureName: tr('licensing.locked.promptLibrary.name'), icon: Sparkles,
      bullets: [tr('licensing.locked.promptLibrary.bulletExtract'), tr('licensing.locked.promptLibrary.bulletCompose'), tr('licensing.locked.promptLibrary.bulletBulk')],
      alsoUnlocks: tr('licensing.locked.promptLibrary.afterTrial'),
    },
    model_manager: {
      contextLine: tr('licensing.locked.modelManager.context'),
      headline: tr('licensing.locked.modelManager.headline'),
      featureName: tr('licensing.locked.modelManager.name'),
      icon: Box,
      bullets: [
        tr('licensing.locked.modelManager.bulletBrowse'),
        tr('licensing.locked.modelManager.bulletCivitai'),
        tr('licensing.locked.modelManager.bulletInspector'),
      ],
      alsoUnlocks: tr('licensing.locked.alsoUnlocksCompareEditorComfy'),
    },
    comparison: {
      contextLine: tr('licensing.locked.comparison.context'),
      headline: tr('licensing.locked.comparison.headline'),
      featureName: tr('licensing.locked.comparison.name'),
      icon: GitCompare,
      bullets: [
        tr('licensing.locked.comparison.bulletModes'),
        tr('licensing.locked.comparison.bulletDiff'),
        tr('licensing.locked.comparison.bulletSync'),
      ],
      alsoUnlocks: tr('licensing.locked.alsoUnlocksComfyEditorMore'),
    },

    image_editor: {
      contextLine: tr('licensing.locked.imageEditor.context'),
      headline: tr('licensing.locked.imageEditor.headline'),
      featureName: tr('shell.editor'),
      icon: ImageIcon,
      bullets: [
        tr('licensing.locked.imageEditor.bulletSave'),
        tr('licensing.locked.imageEditor.bulletTools'),
        tr('licensing.locked.imageEditor.bulletIndexed'),
      ],
      alsoUnlocks: tr('licensing.locked.alsoUnlocksCompareComfyMore'),
    },

    file_management: {
      contextLine: tr('licensing.locked.fileManagement.context'),
      headline: tr('licensing.locked.fileManagement.headline'),
      featureName: tr('licensing.locked.fileManagement.name'),
      icon: Download,
      bullets: [
        tr('licensing.locked.fileManagement.bulletTravel'),
        tr('licensing.locked.fileManagement.bulletBatch'),
        tr('licensing.locked.fileManagement.bulletConflicts'),
      ],
      alsoUnlocks: tr('licensing.locked.alsoUnlocksCompareEditorMore'),
    },

    comfyui: {
      contextLine: tr('licensing.locked.comfyui.context'),
      headline: tr('licensing.locked.comfyui.headline'),
      featureName: tr('licensing.locked.comfyui.name'),
      icon: Sparkles,
      bullets: [
        tr('licensing.locked.comfyui.bulletWorkflow'),
        tr('licensing.locked.comfyui.bulletPreview'),
        tr('licensing.locked.comfyui.bulletOutput'),
      ],
      alsoUnlocks: tr('licensing.locked.alsoUnlocksCompareEditorMore'),
    },

    a1111: {
      contextLine: tr('licensing.locked.a1111.context'),
      headline: tr('licensing.locked.a1111.headline'),
      featureName: tr('licensing.locked.a1111.name'),
      icon: Sparkles,
      bullets: [
        tr('licensing.locked.a1111.bulletParams'),
        tr('licensing.locked.a1111.bulletQueue'),
        tr('licensing.locked.a1111.bulletIndexed'),
      ],
      alsoUnlocks: tr('licensing.locked.alsoUnlocksCompareEditorMore'),
    },

    analytics: {
      contextLine: tr('licensing.locked.analytics.context'),
      headline: tr('licensing.locked.analytics.headline'),
      featureName: tr('analytics.title'),
      icon: BarChart3,
      bullets: [
        tr('licensing.locked.analytics.bulletTop'),
        tr('licensing.locked.analytics.bulletHabits'),
        tr('licensing.locked.analytics.bulletTelemetry'),
      ],
      alsoUnlocks: tr('licensing.locked.alsoUnlocksCompareComfyMore'),
    },

    clustering: {
      contextLine: tr('licensing.locked.clustering.context'),
      headline: tr('licensing.locked.clustering.headline', { limit: CLUSTERING_FREE_TIER_LIMIT }),
      featureName: tr('licensing.locked.clustering.name'),
      icon: Sparkles,
      bullets: [
        tr('licensing.locked.clustering.bulletPrompts'),
        tr('licensing.locked.clustering.bulletTfidf'),
        tr('licensing.locked.clustering.bulletDuplicates'),
      ],
      alsoUnlocks: tr('licensing.locked.alsoUnlocksCompareEditorMore'),
      freeTierNote: tr('licensing.locked.clustering.freeTierNote', { limit: CLUSTERING_FREE_TIER_LIMIT }),
    },

    batch_export: {
      contextLine: tr('licensing.locked.batchExport.context'),
      headline: tr('licensing.locked.batchExport.headline'),
      featureName: tr('licensing.locked.batchExport.name'),
      icon: Download,
      bullets: [
        tr('licensing.locked.batchExport.bulletSelection'),
        tr('licensing.locked.batchExport.bulletFlattened'),
        tr('licensing.locked.batchExport.bulletZip'),
      ],
      alsoUnlocks: tr('licensing.locked.alsoUnlocksCompareEditorMore'),
      freeTierNote: tr('licensing.locked.batchExport.freeTierNote'),
    },

    bulk_tagging: {
      contextLine: tr('licensing.locked.bulkTagging.context'),
      headline: tr('licensing.locked.bulkTagging.headline'),
      featureName: tr('licensing.locked.bulkTagging.name'),
      icon: Tag,
      bullets: [
        tr('licensing.locked.bulkTagging.bulletApply'),
        tr('licensing.locked.bulkTagging.bulletAutocomplete'),
        tr('licensing.locked.bulkTagging.bulletFiltered'),
      ],
      alsoUnlocks: tr('licensing.locked.alsoUnlocksCompareComfyMore'),
    },

    semantic_search: {
      contextLine: tr('licensing.locked.visualSearch.context'),
      headline: tr('licensing.locked.visualSearch.headline'),
      featureName: tr('settings.navigation.visualSearch'),
      icon: Sparkles,
      bullets: [
        tr('licensing.locked.visualSearch.bulletContent'),
        tr('licensing.locked.visualSearch.bulletLocal'),
        tr('licensing.locked.visualSearch.bulletLimit', { limit: SEMANTIC_FREE_TIER_LIMIT }),
      ],
      alsoUnlocks: tr('licensing.locked.alsoUnlocksCompareComfyMore'),
      freeTierNote: tr('licensing.locked.visualSearch.freeTierNote', { limit: SEMANTIC_FREE_TIER_LIMIT }),
    },
  };

  const blockedAttemptsCopy: Record<ProFeature, (count: number) => string> = {
    canvas: (n) => tr('licensing.locked.attempts.canvas', { count: n }),
    prompt_library_advanced: (n) => tr('licensing.locked.attempts.promptLibrary', { count: n }),
    model_manager: (n) => tr('licensing.locked.attempts.modelManager', { count: n }),
    comparison: (n) => tr('licensing.locked.attempts.comparison', { count: n }),
    image_editor: (n) => tr('licensing.locked.attempts.imageEditor', { count: n }),
    file_management: (n) => tr('licensing.locked.attempts.fileManagement', { count: n }),
    comfyui: (n) => tr('licensing.locked.attempts.comfyui', { count: n }),
    a1111: (n) => tr('licensing.locked.attempts.a1111', { count: n }),
    analytics: (n) => tr('licensing.locked.attempts.analytics', { count: n }),
    clustering: (n) => tr('licensing.locked.attempts.clustering', { count: n }),
    batch_export: (n) => tr('licensing.locked.attempts.batchExport', { count: n }),
    bulk_tagging: (n) => tr('licensing.locked.attempts.bulkTagging', { count: n }),
    semantic_search: (n) => tr('licensing.locked.attempts.visualSearch', { count: n }),
  };

  const creatorAttributionToken = useSettingsStore((state) => state.creatorAttributionToken);
  const blockedAttempts = useProModalStore((state) => state.blockedAttempts[feature] ?? 0);

  if (!isOpen) return null;

  const info = featureInfo[feature] ?? {
    contextLine: tr('licensing.locked.fallback.context'),
    headline: tr('licensing.locked.fallback.headline'),
    featureName: tr('licensing.proFeatureTitle'),
    icon: Sparkles,
    bullets: [tr('licensing.locked.fallback.bullet')],
    alsoUnlocks: tr('licensing.locked.fallback.alsoUnlocks'),
  };
  const Icon = info.icon;

  const showBlockedAttemptsLine = !canStartTrial && blockedAttempts >= 3;
  const contextLine = showBlockedAttemptsLine
    ? (blockedAttemptsCopy[feature]?.(blockedAttempts) ?? info.contextLine)
    : info.contextLine;

  const modalContent = (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
      <div className="flex max-h-[calc(100vh-2rem)] w-full max-w-lg flex-col rounded-xl border border-gray-700 bg-gray-900 shadow-2xl">
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-gray-700 p-6">
          <div className="p-2 bg-purple-600/20 rounded-lg">
            <Crown className="w-6 h-6 text-purple-400" />
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-800 rounded-lg transition-colors"
            title={tr('comparison.close')}
            aria-label={tr('licensing.locked.closeModal')}
          >
            <X className="w-5 h-5 text-gray-400" />
          </button>
        </div>

        {/* Content */}
        <div className="min-h-0 space-y-6 overflow-y-auto p-6">
          {/* Feature Info */}
          <div>
            <div className="inline-flex p-2.5 bg-purple-600/10 rounded-full mb-3">
              <Icon className="w-6 h-6 text-purple-400" />
            </div>
            <p className="text-gray-400 text-sm italic mb-1">{contextLine}</p>
            <h3 className="text-2xl font-bold text-white mb-1">{info.headline}</h3>
            <p className="text-gray-500 text-sm">{info.featureName} · Pro</p>
          </div>

          {/* Bullets */}
          <ul className="space-y-2">
            {info.bullets.map((bullet, index) => (
              <li key={index} className="flex items-start gap-2 text-gray-300">
                <CheckCircle2 className="text-green-400 w-4 h-4 mt-0.5 shrink-0" />
                <span>{bullet}</span>
              </li>
            ))}
          </ul>

          {info.freeTierNote && (
            <p className="text-gray-400 text-sm">{info.freeTierNote}</p>
          )}

          <p className="text-gray-500 text-sm italic">{info.alsoUnlocks}</p>

          {/* CTA */}
          <div className="space-y-3">
            {canStartTrial ? (
              <>
                <button
                  onClick={() => {
                    void onStartTrial();
                  }}
                  className="w-full inline-flex items-center justify-center gap-2 bg-purple-600 hover:bg-purple-700 text-white font-semibold py-3 px-6 rounded-lg transition-colors"
                >
                  <Crown className="w-5 h-5" />
                  {tr('licensing.locked.startTrial', { days: TRIAL_DURATION_DAYS })}
                </button>
                <p className="text-center text-xs text-gray-400">{tr('licensing.locked.noCardNoAccount')}</p>
                <div className="border-t border-gray-800 pt-3">
                  <p className="mb-2 text-center text-xs text-gray-400">{tr('licensing.locked.orChoosePlanNow')}</p>
                  <ProPlanCheckoutOptions
                    token={creatorAttributionToken}
                    ctx="lockedfeature"
                    feature={feature}
                    compact
                  />
                </div>
              </>
            ) : (
              <>
                <ProPlanCheckoutOptions
                  token={creatorAttributionToken}
                  ctx="lockedfeature"
                  feature={feature}
                />
                <p className="text-center text-xs text-gray-500">
                  {tr('licensing.locked.refundOpenSource')}</p>
              </>
            )}
            {creatorAttributionToken ? (
              <p className="text-center text-xs text-gray-500">{tr('licensing.attributionCheckout')}</p>
            ) : null}
            <button
              onClick={onClose}
              className="w-full inline-flex items-center justify-center gap-2 bg-gray-800 hover:bg-gray-700 text-gray-200 font-semibold py-2.5 px-6 rounded-lg transition-colors border border-gray-700"
            >
              <X className="w-4 h-4" />
              {tr('comparison.close')}</button>
          </div>
        </div>
      </div>
    </div>
  );

  if (typeof document === 'undefined') {
    return modalContent;
  }

  return createPortal(modalContent, document.body);
};

export default ProOnlyModal;
