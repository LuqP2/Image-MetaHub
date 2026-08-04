import React from 'react';
import SearchBar from './SearchBar';
import { useSettingsStore } from '../store/useSettingsStore';
import { useSemanticStore } from '../store/useSemanticStore';

interface SemanticSearchBarProps {
  searchQuery: string;
  onSearchChange: (query: string) => void;
}

/**
 * Wraps SearchBar with the visual-search wiring: the toggle is offered only when
 * the feature is enabled and the model is downloaded, and switching modes swaps
 * the text-search value for a separate visual query that runs on Enter.
 */
const SemanticSearchBar: React.FC<SemanticSearchBarProps> = ({ searchQuery, onSearchChange }) => {
  const semanticEnabled = useSettingsStore((s) => s.semanticSearchEnabled);

  const modelInstalled = useSemanticStore((s) => s.modelInstalled);
  const queryRunning = useSemanticStore((s) => s.queryRunning);
  const queryActive = useSemanticStore((s) => s.queryActive);
  const runQuery = useSemanticStore((s) => s.runQuery);
  const clearQuery = useSemanticStore((s) => s.clearQuery);

  const [visualMode, setVisualMode] = React.useState(false);
  const [visualValue, setVisualValue] = React.useState('');

  const showVisualToggle = semanticEnabled && modelInstalled;

  // If the feature is turned off (or the model removed) while visual mode is on,
  // fall back to text search so the input never gets stuck in a dead mode.
  React.useEffect(() => {
    if (!showVisualToggle && visualMode) {
      setVisualMode(false);
      if (queryActive) clearQuery();
    }
  }, [showVisualToggle, visualMode, queryActive, clearQuery]);

  const handleToggle = () => {
    const next = !visualMode;
    setVisualMode(next);
    if (!next && queryActive) {
      clearQuery();
    }
  };

  const handleVisualChange = (value: string) => {
    setVisualValue(value);
    // Emptying the box clears the ranking rather than leaving stale results up.
    if (value.trim() === '' && queryActive) {
      clearQuery();
    }
  };

  return (
    <SearchBar
      value={searchQuery}
      onChange={onSearchChange}
      showVisualToggle={showVisualToggle}
      visualMode={visualMode}
      onToggleVisualMode={handleToggle}
      visualValue={visualValue}
      onVisualChange={handleVisualChange}
      onVisualSubmit={() => runQuery(visualValue)}
      visualLoading={queryRunning}
    />
  );
};

export default SemanticSearchBar;
