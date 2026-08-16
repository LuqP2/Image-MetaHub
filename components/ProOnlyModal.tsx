import React from 'react';
import { createPortal } from 'react-dom';
import { X, Crown, Sparkles, GitCompare, BarChart3, CheckCircle2, Download, Tag, Image as ImageIcon, LucideIcon } from 'lucide-react';
import { ProFeature, CLUSTERING_FREE_TIER_LIMIT, SEMANTIC_FREE_TIER_LIMIT, useProModalStore } from '../hooks/useFeatureAccess';
import { TRIAL_DURATION_DAYS } from '../store/useLicenseStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { buildProLicenseUrl } from '../utils/creatorAttribution';

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

const featureInfo: Record<ProFeature, FeatureCopy> = {
  comparison: {
    contextLine: "Looks like you're comparing generations.",
    headline: 'Compare 2–4 images, pixel and parameter',
    featureName: 'Compare View',
    icon: GitCompare,
    bullets: [
      'Diff map, edge overlay, flicker, loupe and slider',
      'Token-level prompt diff, plus seed, CFG, sampler and LoRA changes highlighted',
      'Zoom and pan locked across every panel — no lining them up by hand',
    ],
    alsoUnlocks: 'Pro also unlocks ComfyUI generation, the image editor, and 6 more.',
  },

  image_editor: {
    contextLine: 'Editing this one?',
    headline: 'Edit and keep the workflow inside the file',
    featureName: 'Image Editor',
    icon: ImageIcon,
    bullets: [
      'Save As or Overwrite with prompt, seed and workflow intact',
      'Adjust, crop, transform, resize, enhance, annotate',
      'Edits return to your library already indexed — no re-scan',
    ],
    alsoUnlocks: 'Pro also unlocks Compare View, ComfyUI generation, and 6 more.',
  },

  file_management: {
    contextLine: 'Moving this somewhere else?',
    headline: 'Move files without losing what the app knows about them',
    featureName: 'File Management',
    icon: Download,
    bullets: [
      "Tags, favorites and notes travel with the file — move it in Explorer and they're gone",
      'Copy or move dozens between indexed folders in one action, nothing to re-tag afterwards',
      'Filename conflicts resolved automatically',
    ],
    alsoUnlocks: 'Pro also unlocks Compare View, the image editor, and 6 more.',
  },

  comfyui: {
    contextLine: 'Want to regenerate this from its own workflow?',
    headline: 'Send any image back to ComfyUI',
    featureName: 'ComfyUI Integration',
    icon: Sparkles,
    bullets: [
      'Workflow pulled straight from the image and queued — no rebuilding the graph by hand',
      'Step-by-step preview in the embedded workspace',
      'Output saved with full metadata and indexed on arrival',
    ],
    alsoUnlocks: 'Pro also unlocks Compare View, the image editor, and 6 more.',
  },

  a1111: {
    contextLine: 'Want another round from these parameters?',
    headline: 'Regenerate with every parameter already filled in',
    featureName: 'Automatic1111 Integration',
    icon: Sparkles,
    bullets: [
      'Prompt, seed, sampler, CFG and dimensions pulled from this image — nothing retyped',
      'Queue a batch and track progress without switching windows',
      'New outputs indexed next to the original',
    ],
    alsoUnlocks: 'Pro also unlocks Compare View, the image editor, and 6 more.',
  },

  analytics: {
    contextLine: 'Curious what your library actually looks like?',
    headline: 'See which models and settings you really use',
    featureName: 'Analytics Explorer',
    icon: BarChart3,
    bullets: [
      'Top checkpoints, LoRAs and samplers, ranked over any period',
      'Generation habits by day and hour, and output volume over time',
      'Generation time and VRAM by GPU, from verified telemetry — no spreadsheet needed',
    ],
    alsoUnlocks: 'Pro also unlocks Compare View, ComfyUI generation, and 6 more.',
  },

  clustering: {
    contextLine: 'Library bigger than the free limit?',
    headline: 'Cluster your entire library, not the first 300 images',
    featureName: 'Unlimited Clustering',
    icon: Sparkles,
    bullets: [
      'Prompt-similarity clustering across every indexed image',
      'TF-IDF auto-tags computed over the full set, not a sample',
      'Duplicate and near-variation groups surfaced in one pass',
    ],
    alsoUnlocks: 'Pro also unlocks Compare View, the image editor, and 6 more.',
    freeTierNote: `Free clusters up to ${CLUSTERING_FREE_TIER_LIMIT} images.`,
  },

  batch_export: {
    contextLine: 'Exporting more than one?',
    headline: 'Export the whole selection in one pass',
    featureName: 'Batch Export',
    icon: Download,
    bullets: [
      'Export a selection or an entire filtered result set',
      'Flattened output with filename conflicts resolved automatically',
      'ZIP straight out of the app — nothing to zip afterwards',
    ],
    alsoUnlocks: 'Pro also unlocks Compare View, the image editor, and 6 more.',
    freeTierNote: 'Free exports one image at a time.',
  },

  bulk_tagging: {
    contextLine: 'Tagging more than one?',
    headline: 'Tag hundreds of images in a single action',
    featureName: 'Bulk Tagging',
    icon: Tag,
    bullets: [
      'Apply or remove tags across an entire selection at once',
      'Autocomplete from tags already in your library, so naming stays consistent',
      'Works on filtered results — no clicking through images one by one',
    ],
    alsoUnlocks: 'Pro also unlocks Compare View, ComfyUI generation, and 6 more.',
  },

  semantic_search: {
    contextLine: 'Searching your whole library?',
    headline: 'Search every image by what it shows',
    featureName: 'Visual Search',
    icon: Sparkles,
    bullets: [
      'Find images by their content — even screenshots and downloads with no prompt',
      'Runs entirely on your machine; nothing is ever uploaded',
      'Free indexes your 2,000 newest images — Pro indexes the whole library',
    ],
    alsoUnlocks: 'Pro also unlocks Compare View, ComfyUI generation, and 6 more.',
    freeTierNote: `Free indexes your ${SEMANTIC_FREE_TIER_LIMIT.toLocaleString()} most recent images.`,
  },
};

const blockedAttemptsCopy: Record<ProFeature, (count: number) => string> = {
  comparison: (n) => `You've tried to compare images ${n} times.`,
  image_editor: (n) => `You've tried to edit an image ${n} times.`,
  file_management: (n) => `You've tried to move or copy files ${n} times.`,
  comfyui: (n) => `You've tried to send images to ComfyUI ${n} times.`,
  a1111: (n) => `You've tried to generate with Automatic1111 ${n} times.`,
  analytics: (n) => `You've opened Analytics ${n} times.`,
  clustering: (n) => `You've hit the clustering limit ${n} times.`,
  batch_export: (n) => `You've tried to export in bulk ${n} times.`,
  bulk_tagging: (n) => `You've tried to tag in bulk ${n} times.`,
  semantic_search: (n) => `You've reached the visual search limit ${n} times.`,
};

const ProOnlyModal: React.FC<ProOnlyModalProps> = ({
  isOpen,
  onClose,
  feature,
  canStartTrial,
  onStartTrial,
}) => {
  const creatorAttributionToken = useSettingsStore((state) => state.creatorAttributionToken);
  const blockedAttempts = useProModalStore((state) => state.blockedAttempts[feature] ?? 0);
  const proLicenseUrl = buildProLicenseUrl(creatorAttributionToken, 'lockedfeature', feature);

  if (!isOpen) return null;

  const info = featureInfo[feature] ?? {
    contextLine: 'Unlock this feature.',
    headline: 'Unlock Pro',
    featureName: 'Pro Feature',
    icon: Sparkles,
    bullets: ['Pro-only functionality'],
    alsoUnlocks: 'Pro unlocks every feature in the app.',
  };
  const Icon = info.icon;

  const showBlockedAttemptsLine = !canStartTrial && blockedAttempts >= 3;
  const contextLine = showBlockedAttemptsLine
    ? (blockedAttemptsCopy[feature]?.(blockedAttempts) ?? info.contextLine)
    : info.contextLine;

  const modalContent = (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/80 backdrop-blur-sm">
      <div className="bg-gray-900 rounded-xl shadow-2xl w-full max-w-lg mx-4 border border-gray-700">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-700">
          <div className="p-2 bg-purple-600/20 rounded-lg">
            <Crown className="w-6 h-6 text-purple-400" />
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-800 rounded-lg transition-colors"
            title="Close"
            aria-label="Close pro feature modal"
          >
            <X className="w-5 h-5 text-gray-400" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
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
                  Start {TRIAL_DURATION_DAYS}-day trial
                </button>
                <p className="text-center text-xs text-gray-400">No card, no account.</p>
                <a
                  href={proLicenseUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block text-center text-xs text-gray-500 hover:text-gray-400 underline"
                >
                  Or get the lifetime license now — $39
                </a>
              </>
            ) : (
              <>
                <p className="text-center text-xs text-gray-400">
                  $39 · one-time, no subscription · includes every Pro feature and all future updates
                </p>
                <a
                  href={proLicenseUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full inline-flex items-center justify-center gap-2 bg-purple-600 hover:bg-purple-700 text-white font-semibold py-3 px-6 rounded-lg transition-colors"
                >
                  <Crown className="w-5 h-5" />
                  Get Lifetime License — $39
                </a>
                <p className="text-center text-xs text-gray-500">
                  14-day refund, no questions asked · Open source, MPL 2.0
                </p>
              </>
            )}
            {creatorAttributionToken ? (
              <p className="text-center text-xs text-gray-500">Creator attribution will be included at checkout.</p>
            ) : null}
            <button
              onClick={onClose}
              className="w-full inline-flex items-center justify-center gap-2 bg-gray-800 hover:bg-gray-700 text-gray-200 font-semibold py-2.5 px-6 rounded-lg transition-colors border border-gray-700"
            >
              <X className="w-4 h-4" />
              Close
            </button>
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
