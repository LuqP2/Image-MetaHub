import React, { forwardRef, useEffect, useId, useMemo, useState } from 'react';
import type { TagInfo } from '../types';
import { getTagSearchToken, getTagSuggestions, replaceLastCsvToken, type TagInputMode } from '../utils/tagSuggestions';

interface TagInputComboboxProps {
  value: string;
  onValueChange: (value: string) => void;
  onSubmit: (value: string) => void | Promise<void>;
  recentTags: string[];
  availableTags: TagInfo[];
  excludedTags?: string[];
  suggestionLimit: number;
  mode?: TagInputMode;
  placeholder?: string;
  disabled?: boolean;
  wrapperClassName?: string;
  inputClassName?: string;
  dropdownClassName?: string;
  optionClassName?: string;
  activeOptionClassName?: string;
  metaClassName?: string;
  trailingContent?: React.ReactNode;
  onEscape?: () => void;
}

const defaultOptionClassName =
  'w-full text-left px-3 py-2 text-sm text-gray-300 hover:bg-gray-700 hover:text-white flex justify-between items-center';

const TagInputCombobox = forwardRef<HTMLInputElement, TagInputComboboxProps>(({
  value,
  onValueChange,
  onSubmit,
  recentTags,
  availableTags,
  excludedTags = [],
  suggestionLimit,
  mode = 'single',
  placeholder = 'Add tag...',
  disabled = false,
  wrapperClassName = 'relative',
  inputClassName = '',
  dropdownClassName = 'absolute z-10 mt-1 w-full overflow-hidden rounded-lg border border-gray-700 bg-gray-800 shadow-xl',
  optionClassName = defaultOptionClassName,
  activeOptionClassName = 'bg-gray-700 text-white',
  metaClassName = 'text-xs text-gray-500',
  trailingContent,
  onEscape,
}, ref) => {
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [isSuggestionSelectionActive, setIsSuggestionSelectionActive] = useState(false);
  const listboxId = useId();
  const searchToken = getTagSearchToken(value, mode);
  const suggestions = useMemo(
    () => getTagSuggestions({
      query: searchToken,
      recentTags,
      availableTags,
      excludedTags,
      limit: suggestionLimit,
    }),
    [availableTags, excludedTags, recentTags, searchToken, suggestionLimit],
  );

  useEffect(() => {
    if (isOpen && suggestions.length === 0) {
      setIsOpen(false);
      setActiveIndex(0);
    }
  }, [isOpen, suggestions.length]);

  const closeSuggestions = () => {
    setIsOpen(false);
    setActiveIndex(0);
    setIsSuggestionSelectionActive(false);
  };

  const openSuggestions = (nextIndex = 0) => {
    if (suggestions.length === 0) {
      closeSuggestions();
      return;
    }

    setIsOpen(true);
    setActiveIndex(Math.min(Math.max(nextIndex, 0), suggestions.length - 1));
  };

  const applySuggestion = (tagName: string) => {
    if (mode === 'csv') {
      onValueChange(replaceLastCsvToken(value, tagName));
      closeSuggestions();
      return;
    }

    void onSubmit(tagName);
    closeSuggestions();
  };

  return (
    <div className={wrapperClassName}>
      <input
        ref={ref}
        type="text"
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        autoComplete="off"
        aria-autocomplete="list"
        aria-expanded={isOpen}
        aria-controls={isOpen ? listboxId : undefined}
        onChange={(event) => {
          const nextValue = event.target.value;
          const nextSearchToken = getTagSearchToken(nextValue, mode);
          const nextSuggestions = getTagSuggestions({
            query: nextSearchToken,
            recentTags,
            availableTags,
            excludedTags,
            limit: suggestionLimit,
          });

          onValueChange(nextValue);
          if (nextSearchToken && nextSuggestions.length > 0) {
            setIsOpen(true);
            setActiveIndex(0);
            setIsSuggestionSelectionActive(false);
          } else {
            closeSuggestions();
          }
        }}
        onFocus={() => {
          if (searchToken && suggestions.length > 0) {
            openSuggestions(0);
            setIsSuggestionSelectionActive(false);
          }
        }}
        onBlur={() => {
          closeSuggestions();
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            setIsSuggestionSelectionActive(true);
            if (!isOpen || !isSuggestionSelectionActive) {
              openSuggestions(0);
              return;
            }

            openSuggestions(activeIndex + 1);
            return;
          }

          if (event.key === 'ArrowUp') {
            event.preventDefault();
            setIsSuggestionSelectionActive(true);
            if (!isOpen) {
              openSuggestions(suggestions.length - 1);
              return;
            }

            if (!isSuggestionSelectionActive) {
              openSuggestions(suggestions.length - 1);
              return;
            }

            openSuggestions(activeIndex - 1);
            return;
          }

          if (event.key === 'Enter') {
            if (isOpen && isSuggestionSelectionActive && suggestions[activeIndex]) {
              event.preventDefault();
              applySuggestion(suggestions[activeIndex].name);
              return;
            }

            if (value.trim()) {
              event.preventDefault();
              void onSubmit(value);
            }
            return;
          }

          if (event.key === 'Escape') {
            if (isOpen) {
              event.preventDefault();
              closeSuggestions();
              return;
            }

            onEscape?.();
          }
        }}
        className={inputClassName}
      />

      {trailingContent}

      {isOpen && suggestions.length > 0 && (
        <div id={listboxId} role="listbox" className={dropdownClassName}>
          {suggestions.map((suggestion, index) => {
            const isActive = index === activeIndex;
            return (
              <button
                type="button"
                role="option"
                aria-selected={isActive}
                key={suggestion.name}
                onPointerDown={(event) => {
                  event.preventDefault();
                }}
                onClick={() => applySuggestion(suggestion.name)}
                className={`${optionClassName} ${isActive ? activeOptionClassName : ''}`.trim()}
              >
                <span>{suggestion.name}</span>
                <span className={metaClassName}>{suggestion.count}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
});

TagInputCombobox.displayName = 'TagInputCombobox';

export default TagInputCombobox;
