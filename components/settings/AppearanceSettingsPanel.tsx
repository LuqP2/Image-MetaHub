import React, { useEffect, useId, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { useSettingsStore } from '../../store/useSettingsStore';
import { themeOptions, type ThemeId } from '../../src/theme/themeRegistry';
import { SettingRow } from './SettingRow';
import { SettingsPanel } from './SettingsPanel';
import { SettingsSectionCard } from './SettingsSectionCard';
import { SettingSwitch } from './SettingSwitch';

const ThemeSwatch: React.FC<{ colors: readonly string[] }> = ({ colors }) => (
  <span
    aria-hidden="true"
    className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-xs font-bold"
    style={{ backgroundColor: colors[0], borderColor: colors[1], color: colors[2] }}
  >
    Aa
  </span>
);

const ThemeSelector: React.FC = () => {
  const theme = useSettingsStore((state) => state.theme);
  const setTheme = useSettingsStore((state) => state.setTheme);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const selected = themeOptions.find((option) => option.id === theme) ?? themeOptions[0];

  const openList = () => {
    setActiveIndex(Math.max(0, themeOptions.findIndex((option) => option.id === theme)));
    setOpen(true);
  };

  const choose = (id: ThemeId) => {
    setTheme(id);
    setOpen(false);
    triggerRef.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    listRef.current?.focus();
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  useEffect(() => {
    if (open) document.getElementById(`${listId}-${activeIndex}`)?.scrollIntoView?.({ block: 'nearest' });
  }, [activeIndex, listId, open]);

  const onListKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    } else if (event.key === 'Tab') {
      setOpen(false);
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((index) => (index + (event.key === 'ArrowDown' ? 1 : -1) + themeOptions.length) % themeOptions.length);
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      setActiveIndex(event.key === 'Home' ? 0 : themeOptions.length - 1);
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      choose(themeOptions[activeIndex].id);
    }
  };

  return (
    <div ref={rootRef} className="max-w-md">
      <button
        ref={triggerRef}
        type="button"
        aria-label="Theme"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => open ? setOpen(false) : openList()}
        onKeyDown={(event) => {
          if (!open && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
            event.preventDefault();
            openList();
          }
        }}
        className="flex w-full items-center gap-3 rounded-xl border border-gray-700 bg-gray-950/60 px-3 py-2 text-left text-gray-100 transition-colors hover:border-gray-600 hover:bg-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
      >
        <ThemeSwatch colors={selected.colors} />
        <span className="flex-1 font-medium">{selected.name}</span>
        <ChevronDown size={18} className={`text-gray-300 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label="Available themes"
          aria-activedescendant={`${listId}-${activeIndex}`}
          tabIndex={0}
          onKeyDown={onListKeyDown}
          className="mt-2 max-h-72 overflow-y-auto rounded-xl border border-gray-700 bg-gray-900 p-1 shadow-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
        >
          {themeOptions.map((option, index) => (
            <div
              key={option.id}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={theme === option.id}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => choose(option.id)}
              className={`flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-gray-100 ${index === activeIndex ? 'bg-gray-800' : 'hover:bg-gray-800'}`}
            >
              <ThemeSwatch colors={option.colors} />
              <span className="flex-1 font-medium">{option.name}</span>
              {theme === option.id && <Check size={18} className="text-gray-100" aria-hidden="true" />}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export const AppearanceSettingsPanel: React.FC = () => {
  const enableAnimations = useSettingsStore((state) => state.enableAnimations);
  const setEnableAnimations = useSettingsStore((state) => state.setEnableAnimations);
  const classicMode = useSettingsStore((state) => state.classicMode);
  const setClassicMode = useSettingsStore((state) => state.setClassicMode);

  return (
    <SettingsPanel title="Appearance" description="Choose the app theme and motion preferences.">
      <SettingsSectionCard title="Theme">
        <ThemeSelector />
      </SettingsSectionCard>

      <SettingsSectionCard title="Motion">
        <SettingRow
          label="Enable animations"
          description="Use small interface animations, including modal minimize and restore."
          control={<SettingSwitch checked={enableAnimations} onChange={setEnableAnimations} />}
        />
      </SettingsSectionCard>

      <SettingsSectionCard title="Navigation">
        <SettingRow
          label="Classic mode"
          description="Show the old Model View, Smart Library, Collections and Node View tabs. They open the unified Explore surface — no separate screens."
          control={<SettingSwitch checked={classicMode} onChange={setClassicMode} />}
        />
      </SettingsSectionCard>
    </SettingsPanel>
  );
};
