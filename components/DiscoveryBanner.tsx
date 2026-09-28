import React from 'react';
import { X, type LucideIcon } from 'lucide-react';

interface DiscoveryBannerProps {
  icon: LucideIcon;
  title: string;
  description: React.ReactNode;
  actionLabel: string;
  onAction: () => void;
  onDismiss: () => void;
  dismissLabel: string;
}

const DiscoveryBanner: React.FC<DiscoveryBannerProps> = ({
  icon: Icon,
  title,
  description,
  actionLabel,
  onAction,
  onDismiss,
  dismissLabel,
}) => (
  <div className="mx-5 mb-2 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-indigo-500/30 bg-indigo-500/10 px-4 py-3 text-sm text-indigo-100">
    <div className="flex min-w-0 items-start gap-3">
      <Icon className="mt-0.5 h-5 w-5 flex-shrink-0 text-indigo-400" />
      <div className="min-w-0">
        <div className="font-medium text-indigo-50">{title}</div>
        <div className="text-indigo-200/80">{description}</div>
      </div>
    </div>
    <div className="flex flex-shrink-0 items-center gap-2">
      <button
        type="button"
        onClick={onAction}
        className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-indigo-500"
      >
        {actionLabel}
      </button>
      <button
        type="button"
        onClick={onDismiss}
        className="rounded-full p-1 text-indigo-300 transition-colors hover:bg-indigo-500/20 hover:text-white"
        aria-label={dismissLabel}
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  </div>
);

export default DiscoveryBanner;
