import React from 'react';
import { X, Crown, Sparkles, GitCompare, BarChart3 } from 'lucide-react';
import { ProFeature } from '../hooks/useFeatureAccess';

interface ProOnlyModalProps {
  isOpen: boolean;
  onClose: () => void;
  feature: ProFeature;
  isTrialActive: boolean;
  daysRemaining: number;
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
};

const ProOnlyModal: React.FC<ProOnlyModalProps> = ({
  isOpen,
  onClose,
  feature,
  isTrialActive,
  daysRemaining,
}) => {
  if (!isOpen) return null;

  const info = featureInfo[feature];
  const Icon = info.icon;

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

          {/* Trial Status */}
          {isTrialActive && (
            <div className="bg-blue-600/10 border border-blue-600/30 rounded-lg p-4">
              <p className="text-blue-400 text-center font-medium">
                ⏰ Trial Active: {daysRemaining} {daysRemaining === 1 ? 'day' : 'days'} remaining
              </p>
            </div>
          )}

          {!isTrialActive && (
            <div className="bg-red-600/10 border border-red-600/30 rounded-lg p-4">
              <p className="text-red-400 text-center font-medium">
                🔒 Your trial has ended. Upgrade to Pro to unlock this feature.
              </p>
            </div>
          )}

          {/* Benefits */}
          <div>
            <h4 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">
              What You Get:
            </h4>
            <ul className="space-y-2">
              {info.benefits.map((benefit, index) => (
                <li key={index} className="flex items-start gap-2 text-gray-300">
                  <span className="text-green-400 mt-1">✓</span>
                  <span>{benefit}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* CTA */}
          <div className="space-y-3">
            <button
              disabled
              className="w-full bg-purple-600 hover:bg-purple-700 disabled:bg-gray-700 disabled:cursor-not-allowed text-white font-semibold py-3 px-6 rounded-lg transition-colors flex items-center justify-center gap-2"
              title="Payment integration coming soon"
            >
              <Crown className="w-5 h-5" />
              Upgrade to Pro (Coming Soon)
            </button>
            <p className="text-xs text-gray-500 text-center">
              Payment integration will be available in the next update
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ProOnlyModal;
