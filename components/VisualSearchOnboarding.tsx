import React from 'react';
import { Sparkles, X } from 'lucide-react';
import { useSettingsStore } from '../store/useSettingsStore';
import { useSemanticStore } from '../store/useSemanticStore';
import { OPEN_VISUAL_SEARCH_SETTINGS_EVENT } from './SemanticSearchBar';

/**
 * One-time intro card for visual search, shown above the library grid the first
 * time it hasn't been set up yet. Dismissible; never returns once seen. "Set up"
 * opens Settings, where the master switch, model download, and index build are
 * each a separate explicit action — the feature defaults off, so this card is
 * what makes it discoverable at all rather than gating on it being on already.
 */
const VisualSearchOnboarding: React.FC<{ hasImages: boolean }> = ({ hasImages }) => {
  const enabled = useSettingsStore((s) => s.semanticSearchEnabled);
  const seen = useSettingsStore((s) => s.hasSeenVisualSearchOnboarding);
  const markSeen = useSettingsStore((s) => s.setHasSeenVisualSearchOnboarding);
  const modelInstalled = useSemanticStore((s) => s.modelInstalled);
  const refreshModelStatus = useSemanticStore((s) => s.refreshModelStatus);

  // Only worth checking install status once the feature is on — no IPC call
  // while it's off, matching "off means nothing runs".
  React.useEffect(() => {
    if (enabled && !seen) refreshModelStatus();
  }, [enabled, seen, refreshModelStatus]);

  // Hide once the user has dismissed it, or once they've actually finished
  // setup (on + model installed) — but not merely because the switch is off,
  // or a feature that defaults off would never be discoverable.
  if (seen || !hasImages) {
    return null;
  }
  if (enabled && modelInstalled) {
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
          <div className="font-medium text-indigo-50">Find Similar — Local Visual Search</div>
          <div className="text-indigo-200/80">
            Select any image to find visually related files, even without prompts or metadata. After an explicit model download, processing stays on your machine.
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
