
import React from 'react';
import { Sparkles } from 'lucide-react';

interface SearchBarProps {
  value: string;
  onChange: (query: string) => void;
  /** Whether the visual-search toggle is offered (feature on + model ready). */
  showVisualToggle?: boolean;
  visualMode?: boolean;
  onToggleVisualMode?: () => void;
  /** Visual-mode query text (separate from the text-search value). */
  visualValue?: string;
  onVisualChange?: (query: string) => void;
  /** Fired on Enter in visual mode; running a query is deliberately explicit. */
  onVisualSubmit?: () => void;
  visualLoading?: boolean;
}

const SearchBar: React.FC<SearchBarProps> = ({
  value,
  onChange,
  showVisualToggle = false,
  visualMode = false,
  onToggleVisualMode,
  visualValue = '',
  onVisualChange,
  onVisualSubmit,
  visualLoading = false,
}) => {
  const handleClear = () => {
    if (visualMode) {
      onVisualChange?.('');
    } else {
      onChange('');
    }
  };

  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        const isModalOpen = document.querySelector('.fixed.inset-0');
        if (!isModalOpen) {
          handleClear();
        }
      }
    };
    // Use capture phase so we evaluate the DOM *before* React 18 synchronously unmounts any modals
    window.addEventListener('keydown', handleKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', handleKeyDown, { capture: true });
  }, [onChange, onVisualChange, visualMode]);

  const currentValue = visualMode ? visualValue : value;

  const handleInputChange = (next: string) => {
    if (visualMode) {
      onVisualChange?.(next);
    } else {
      onChange(next);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (visualMode && e.key === 'Enter') {
      e.preventDefault();
      onVisualSubmit?.();
    }
  };

  return (
    <div className="relative w-full group">
      <input
        type="text"
        value={currentValue}
        onChange={(e) => handleInputChange(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={visualMode ? 'Describe what the image shows… (press Enter)' : 'Search by prompt, model, etc...'}
        aria-label={visualMode ? 'Visual search' : 'Search'}
        className={`peer w-full bg-gray-800/50 backdrop-blur-sm text-gray-200 placeholder-gray-400 py-3 pl-10 ${showVisualToggle ? 'pr-20' : 'pr-10'} rounded-xl border transition-all duration-300 shadow-sm hover:bg-gray-800/70 focus:outline-none focus:ring-2 ${
          visualMode
            ? 'border-indigo-500/50 focus:border-indigo-500/60 focus:ring-indigo-500/20'
            : 'border-gray-700/50 focus:border-blue-500/50 focus:ring-blue-500/20'
        }`}
        data-testid="search-input"
      />
      <div className={`absolute left-3 top-1/2 -translate-y-1/2 transition-colors duration-300 ${visualMode ? 'text-indigo-400' : 'text-gray-400 group-focus-within:text-blue-500'}`}>
        {visualMode ? (
          <Sparkles aria-hidden="true" className={`h-5 w-5 ${visualLoading ? 'animate-pulse' : ''}`} />
        ) : (
          <svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        )}
      </div>

      {/* A sibling of the `peer` input (not nested under the right-3 controls
          div below), so the `peer-focus:opacity-0` Tailwind selector — which
          only matches a sibling of the focused peer — actually applies and the
          hint fades out while typing. */}
      {!currentValue && (
        <div
          className={`pointer-events-none absolute top-1/2 -translate-y-1/2 transition-opacity duration-200 peer-focus:opacity-0 ${
            showVisualToggle ? 'right-11' : 'right-4'
          }`}
        >
          <kbd className="hidden h-5 items-center rounded border border-gray-700/50 bg-gray-900/50 px-1.5 font-sans text-[10px] font-medium text-gray-500 sm:inline-flex">
            /
          </kbd>
        </div>
      )}

      <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1">
        {currentValue && (
          <button
            onClick={handleClear}
            className="text-gray-400 hover:text-white transition-colors p-1 rounded-full hover:bg-gray-700/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            aria-label="Clear search"
            title="Clear search"
          >
            <svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
        {showVisualToggle && (
          <button
            onClick={onToggleVisualMode}
            className={`p-1 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
              visualMode ? 'text-indigo-400 bg-indigo-500/10' : 'text-gray-400 hover:text-indigo-300 hover:bg-gray-700/50'
            }`}
            aria-label="Toggle visual search"
            aria-pressed={visualMode}
            title={visualMode ? 'Visual search on — searching by image content' : 'Visual search: find images by what they show'}
          >
            <Sparkles className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
};

export default SearchBar;
