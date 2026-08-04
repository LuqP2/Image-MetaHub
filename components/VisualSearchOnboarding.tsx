import React from 'react';
import { Sparkles, X } from 'lucide-react';
import { useSettingsStore } from '../store/useSettingsStore';
import { useSemanticStore } from '../store/useSemanticStore';
import { OPEN_VISUAL_SEARCH_SETTINGS_EVENT } from './SemanticSearchBar';

/**
 * One-time intro card for visual search, shown above the library grid the first
 * time the feature is available but not set up. Dismissible; never returns once
 * seen. "Set up" opens Settings (the model download stays an explicit action).
 */
const VisualSearchOnboarding: React.FC<{ hasImages: boolean }> = ({ hasImages }) => {
  const enabled = useSettingsStore((s) => s.semanticSearchEnabled);
  const seen = useSettingsStore((s) => s.hasSeenVisualSearchOnboarding);
  const markSeen = useSettingsStore((s) => s.setHasSeenVisualSearchOnboarding);
  const modelInstalled = useSemanticStore((s) => s.modelInstalled);
  const refreshModelStatus = useSemanticStore((s) => s.refreshModelStatus);

  // Learn whether the model is already installed, so a set-up user never sees this.
  React.useEffect(() => {
    if (enabled && !seen) refreshModelStatus();
  }, [enabled, seen, refreshModelStatus]);

  if (seen || !enabled || modelInstalled || !hasImages) {
    return null;
  }

  const dismiss = () => markSeen(true);

  const setUp = () => {
    markSeen(true);
    window.dispatchEvent(new CustomEvent(OPEN_VISUAL_SEARCH_SETTINGS_EVENT));
  };

  return (
    <div className="mx-5 mb-2 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-indigo-500/30 bg-indigo-500/10 px-4 py-3 text-sm text-indigo-100">
      <div className="flex min-w-0 items-start gap-3">
        <Sparkles className="mt-0.5 h-5 w-5 flex-shrink-0 text-indigo-400" />
        <div className="min-w-0">
          <div className="font-medium text-indigo-50">Search by what your images show</div>
          <div className="text-indigo-200/80">
            Find images by their content — even screenshots and downloads with no prompt. Runs on your machine; nothing is uploaded.
          </div>
        </div>
      </div>
      <div className="flex flex-shrink-0 items-center gap-2">
        <button
          type="button"
          onClick={setUp}
          className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-indigo-500"
        >
          Set up
        </button>
        <button
          type="button"
          onClick={dismiss}
          className="rounded-lg border border-indigo-400/40 px-3 py-1.5 text-xs font-medium text-indigo-100 transition-colors hover:bg-indigo-500/20"
        >
          Not now
        </button>
        <button
          type="button"
          onClick={dismiss}
          className="rounded-full p-1 text-indigo-300 transition-colors hover:bg-indigo-500/20 hover:text-white"
          aria-label="Dismiss"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
};

export default VisualSearchOnboarding;
