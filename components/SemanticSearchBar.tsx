import React from 'react';
import SearchBar from './SearchBar';
import { useSettingsStore } from '../store/useSettingsStore';
import { useSemanticStore } from '../store/useSemanticStore';

interface SemanticSearchBarProps {
  searchQuery: string;
  onSearchChange: (query: string) => void;
}

/** Idle delay before a typed visual query runs on its own. */
const VISUAL_SEARCH_DEBOUNCE_MS = 450;

/**
 * Wraps SearchBar with the visual-search wiring: the toggle is offered only when
 * the feature is enabled and the model is downloaded, and switching modes swaps
 * the text-search value for a separate visual query that runs on Enter or after
 * a short idle pause.
 */
const SemanticSearchBar: React.FC<SemanticSearchBarProps> = ({ searchQuery, onSearchChange }) => {
  const semanticEnabled = useSettingsStore((s) => s.semanticSearchEnabled);

  const modelInstalled = useSemanticStore((s) => s.modelInstalled);
  const queryRunning = useSemanticStore((s) => s.queryRunning);
  const queryActive = useSemanticStore((s) => s.queryActive);
  const queryNotice = useSemanticStore((s) => s.queryNotice);
  const queryResultCount = useSemanticStore((s) => s.queryResultCount);
  const queryTopScore = useSemanticStore((s) => s.queryTopScore);
  const runQuery = useSemanticStore((s) => s.runQuery);
  const clearQuery = useSemanticStore((s) => s.clearQuery);
  const refreshModelStatus = useSemanticStore((s) => s.refreshModelStatus);
  const openForLibrary = useSemanticStore((s) => s.openForLibrary);

  // Learn the model/index state as soon as the feature is on, so the toggle
  // shows and the first query has an open index — without needing Settings.
  React.useEffect(() => {
    if (!semanticEnabled) return;
    refreshModelStatus();
    openForLibrary();
  }, [semanticEnabled, refreshModelStatus, openForLibrary]);

  const [visualMode, setVisualMode] = React.useState(false);
  const [visualValue, setVisualValue] = React.useState('');
  const debounceRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const showVisualToggle = semanticEnabled && modelInstalled;

  const cancelDebounce = () => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
  };

  // If the feature is turned off (or the model removed) while visual mode is on,
  // fall back to text search so the input never gets stuck in a dead mode.
  React.useEffect(() => {
    if (!showVisualToggle && visualMode) {
      setVisualMode(false);
      cancelDebounce();
      if (queryActive) clearQuery();
    }
  }, [showVisualToggle, visualMode, queryActive, clearQuery]);

  React.useEffect(() => cancelDebounce, []);

  const submitNow = (value: string) => {
    cancelDebounce();
    runQuery(value);
  };

  const handleToggle = () => {
    const next = !visualMode;
    setVisualMode(next);
    if (next) {
      // Entering visual mode with text already typed: search it right away.
      if (visualValue.trim()) submitNow(visualValue);
    } else {
      cancelDebounce();
      if (queryActive) clearQuery();
    }
  };

  const handleVisualChange = (value: string) => {
    setVisualValue(value);
    cancelDebounce();
    if (value.trim() === '') {
      if (queryActive) clearQuery();
      return;
    }
    debounceRef.current = setTimeout(() => runQuery(value), VISUAL_SEARCH_DEBOUNCE_MS);
  };

  const notice = (() => {
    if (!visualMode) return null;
    if (queryRunning) return { text: 'Searching by image content…', tone: 'text-fuchsia-300' };
    if (queryNotice === 'no-index') {
      return { text: 'No images indexed yet — open Settings → Visual Search to build the index.', tone: 'text-amber-300' };
    }
    if (queryNotice === 'error') return { text: 'Visual search failed — check the console for details.', tone: 'text-red-400' };
    if (queryNotice === 'no-results') return { text: 'No visual matches.', tone: 'text-gray-400' };
    if (queryNotice === 'ok') {
      const best = queryTopScore != null ? ` · best ${queryTopScore.toFixed(2)}` : '';
      return { text: `${queryResultCount.toLocaleString()} visual matches${best}`, tone: 'text-gray-400' };
    }
    return { text: 'Press Enter to search by what the image shows.', tone: 'text-gray-500' };
  })();

  return (
    <div className="space-y-1.5">
      <SearchBar
        value={searchQuery}
        onChange={onSearchChange}
        showVisualToggle={showVisualToggle}
        visualMode={visualMode}
        onToggleVisualMode={handleToggle}
        visualValue={visualValue}
        onVisualChange={handleVisualChange}
        onVisualSubmit={() => submitNow(visualValue)}
        visualLoading={queryRunning}
      />
      {notice && (
        <p className={`px-1 text-xs ${notice.tone}`}>{notice.text}</p>
      )}
    </div>
  );
};

export default SemanticSearchBar;
