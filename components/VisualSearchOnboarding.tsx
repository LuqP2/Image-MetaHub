import React from 'react';
import { Sparkles } from 'lucide-react';
import { useSettingsStore } from '../store/useSettingsStore';
import { useSemanticStore } from '../store/useSemanticStore';
import { OPEN_VISUAL_SEARCH_SETTINGS_EVENT } from './SemanticSearchBar';
import DiscoveryBanner from './DiscoveryBanner';

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
    <DiscoveryBanner
      icon={Sparkles}
      title="Find Similar — Local Visual Search"
      description="Select any image to find visually related files, even without prompts or metadata."
      actionLabel="Set up"
      onAction={setUp}
      onDismiss={dismiss}
      dismissLabel="Dismiss Find Similar setup"
    />
  );
};

export default VisualSearchOnboarding;
