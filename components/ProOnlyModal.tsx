import React from 'react';
import { X, Crown, Sparkles, GitCompare, BarChart3, CheckCircle2, Download } from 'lucide-react';
import { ProFeature } from '../hooks/useFeatureAccess';
import { TRIAL_DURATION_DAYS } from '../store/useLicenseStore';

interface ProOnlyModalProps {
  isOpen: boolean;
  onClose: () => void;
  feature: ProFeature;
  isTrialActive: boolean;
  daysRemaining: number;
  canStartTrial: boolean;
  onStartTrial: () => void;
  isExpired: boolean;
  isPro: boolean;
}

const featureInfo = {
  a1111: {
    name: 'A1111 Integration',
    icon: Sparkles,
    description: 'Generate image variations and copy parameters to Automatic1111',
    benefits: [
      'One-click generation of variations',
      'Automatic parameter copying',
      'Real-time generation progress',
      'Batch generation support',
    ],
  },
  comfyui: {
    name: 'ComfyUI Integration',
    icon: Sparkles,
    description: 'Generate variations or copy workflows to ComfyUI',
    benefits: [
      'Quick generation from metadata',
      'Real-time WebSocket progress tracking',
      'Workflow copy for manual editing',
      'Automatic metadata-rich saves',
    ],
  },
  comparison: {
    name: 'Image Comparison',
    icon: GitCompare,
    description: 'Side-by-side comparison of images with metadata diff',
    benefits: [
      'Compare two images side-by-side',
      'Synchronized zoom and pan',
      'Metadata differences highlighted',
      'Quick image swapping',
    ],
  },
  analytics: {
    name: 'Analytics Dashboard',
    icon: BarChart3,
    description: 'Detailed insights and statistics about your image collection',
    benefits: [
      'Generation trends over time',
      'Model and LoRA usage stats',
      'Creative habit analysis',
      'Dimension and parameter insights',
    ],
  },
  clustering: {
    name: 'Unlimited Clustering',
    icon: Sparkles,
    description: 'Analyze your entire image library for duplicate groups and prompt similarities',
    benefits: [
      'Process unlimited images',
      'Find all duplicate variations',
      'Organize massive libraries efficiently',
      'Save hours of manual sorting',
    ],
  },
  batch_export: {
    name: 'Batch Export',
    icon: Download,
    description: 'Export multiple images at once to a folder or ZIP archive',
    benefits: [
      'Export selected or filtered images',
      'Automatic filename conflict resolution',
      'Flattened output for easy sharing',
      'ZIP creation for quick backups',
    ],
  },
};

const ProOnlyModal: React.FC<ProOnlyModalProps> = ({
  isOpen,
  onClose,
  feature,
  isTrialActive,
  daysRemaining,
  canStartTrial,
  onStartTrial,
  isExpired,
  isPro,
}) => {
  if (!isOpen) return null;

  const info = featureInfo[feature] ?? {
    name: 'Pro Feature',
    icon: Sparkles,
    description: 'Unlock additional features with Pro access',
    benefits: ['Pro-only functionality'],
  };
  const Icon = info.icon;

  const trialCopy = (() => {
    if (canStartTrial) {
      return `This is a Pro feature. Would you like to start your ${TRIAL_DURATION_DAYS}-day trial now to test it?`;
    }
    if (isTrialActive) {
      return `Trial active: ${daysRemaining} ${daysRemaining === 1 ? 'day' : 'days'} remaining.`;
    }
    if (isExpired) {
      return 'Your trial has ended. Activate a license to continue using Pro features.';
    }
    if (isPro) {
      return 'You are already on Pro. Thank you for supporting the project!';
    }
    return 'This is a Pro feature. Activate the trial or a license to continue.';
  })();
  const showBatchExportLimitNote = feature === 'batch_export' && !isPro && !isTrialActive;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
      <div className="bg-gray-900 rounded-xl shadow-2xl w-full max-w-lg mx-4 border border-gray-700">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-700">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-purple-600/20 rounded-lg">
              <Crown className="w-6 h-6 text-purple-400" />
            </div>
            <h2 className="text-xl font-bold text-white">Pro Feature</h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-800 rounded-lg transition-colors"
            title="Close"
          >
            <X className="w-5 h-5 text-gray-400" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          {/* Feature Info */}
          <div className="text-center">
            <div className="inline-flex p-4 bg-purple-600/10 rounded-full mb-4">
              <Icon className="w-12 h-12 text-purple-400" />
            </div>
            <h3 className="text-2xl font-bold text-white mb-2">{info.name}</h3>
            <p className="text-gray-400 mb-4">{info.description}</p>
          </div>

          {/* Trial / License prompt */}
          <div className="bg-gray-800/70 border border-gray-700 rounded-lg p-4 space-y-2">
            <p className="text-gray-100 font-semibold">This is a Pro feature.</p>
            <p className="text-gray-300 text-sm">{trialCopy}</p>
            {showBatchExportLimitNote && (
              <p className="text-gray-400 text-sm">Free users can export 1 image at a time.</p>
            )}
          </div>

          {/* Benefits */}
          <div>
            <h4 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">
              What you unlock:
            </h4>
            <ul className="space-y-2">
              {info.benefits.map((benefit, index) => (
                <li key={index} className="flex items-start gap-2 text-gray-300">
                  <CheckCircle2 className="text-green-400 w-4 h-4 mt-0.5" />
                  <span>{benefit}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* CTA */}
          <div className="space-y-3">
            {canStartTrial && (
              <button
                onClick={() => {
                  onStartTrial();
                  onClose();
                }}
                className="w-full inline-flex items-center justify-center gap-2 bg-purple-600 hover:bg-purple-700 text-white font-semibold py-3 px-6 rounded-lg transition-colors"
              >
                <Crown className="w-5 h-5" />
                Start {TRIAL_DURATION_DAYS}-day trial
              </button>
            )}
            <a
              href="https://lucasphere4660.gumroad.com/l/qmjima"
              target="_blank"
              rel="noopener noreferrer"
              className="w-full inline-flex items-center justify-center gap-2 bg-purple-500/20 hover:bg-purple-500/30 text-purple-200 font-semibold py-3 px-6 rounded-lg transition-colors border border-purple-500/40"
            >
              <Crown className="w-5 h-5" />
              Buy Pro license
            </a>
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
};

export default ProOnlyModal;
