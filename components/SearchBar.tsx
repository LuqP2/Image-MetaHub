
import React from 'react';

interface SearchBarProps {
  value: string;
  onChange: (query: string) => void;
}

const SearchBar: React.FC<SearchBarProps> = ({
  value,
  onChange
}) => {
  const handleClear = () => onChange('');

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
  }, [onChange]);

  return (
    <div className="relative w-full group">
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Search by prompt, model, etc..."
        aria-label="Search"
        className="peer w-full bg-gray-800/50 backdrop-blur-sm text-gray-200 placeholder-gray-400 py-3 pl-10 pr-10 rounded-xl border border-gray-700/50 focus:outline-none focus:border-blue-500/50 focus:ring-2 focus:ring-blue-500/20 transition-all duration-300 shadow-sm hover:bg-gray-800/70"
        data-testid="search-input"
      />
      <div className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 transition-colors duration-300 group-focus-within:text-blue-500">
        <svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
      </div>

      {!value && (
        <div className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 transition-opacity duration-200 peer-focus:opacity-0">
          <kbd className="hidden h-5 items-center rounded border border-gray-700/50 bg-gray-900/50 px-1.5 font-sans text-[10px] font-medium text-gray-500 sm:inline-flex">
            /
          </kbd>
        </div>
      )}
      
      {value && (
        <button
          onClick={handleClear}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white transition-colors p-1 rounded-full hover:bg-gray-700/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          aria-label="Clear search"
          title="Clear search"
        >
          <svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      )}
    </div>
  );
};

export default SearchBar;
