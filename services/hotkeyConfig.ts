import { Keymap } from '../types';

export interface HotkeyDefinition {
  id: string;
  name: string;
  scope: 'global' | 'preview';
  defaultKey: string;
}

export const hotkeyConfig: HotkeyDefinition[] = [
  // Global Scope
  { id: 'openCommandPalette', name: 'Open Command Palette', scope: 'global', defaultKey: 'ctrl+k, cmd+k' },
  { id: 'openQuickSettings', name: 'Open Quick Settings', scope: 'global', defaultKey: 'ctrl+., cmd+.' },
  { id: 'openKeyboardShortcuts', name: 'Open Keyboard Shortcuts', scope: 'global', defaultKey: 'f1' },
  { id: 'focusSidebar', name: 'Focus Sidebar', scope: 'global', defaultKey: 'ctrl+1, cmd+1' },
  { id: 'focusImageGrid', name: 'Focus Image Grid', scope: 'global', defaultKey: 'ctrl+2, cmd+2' },
  { id: 'focusPreviewPane', name: 'Focus Preview Pane', scope: 'global', defaultKey: 'ctrl+3, cmd+3' },
  { id: 'focusSearch', name: 'Focus Search', scope: 'global', defaultKey: 'ctrl+f, cmd+f' },
  { id: 'quickSearch', name: 'Quick Search', scope: 'global', defaultKey: '/' },
  { id: 'toggleAdvancedFilters', name: 'Toggle Advanced Filters', scope: 'global', defaultKey: 'ctrl+shift+f, cmd+shift+f' },
  { id: 'addFolder', name: 'Add Folder', scope: 'global', defaultKey: 'ctrl+o, cmd+o' },
  { id: 'rescanFolders', name: 'Rescan Folders', scope: 'global', defaultKey: 'ctrl+shift+r, cmd+shift+r' },
  { id: 'selectAll', name: 'Select All', scope: 'global', defaultKey: 'ctrl+a, cmd+a' },
  { id: 'toggleQuickPreview', name: 'Toggle Quick Preview', scope: 'global', defaultKey: 'space' },
  { id: 'openFullscreen', name: 'Open Fullscreen', scope: 'preview', defaultKey: 'enter' },
  { id: 'toggleListGridView', name: 'Toggle List/Grid View', scope: 'global', defaultKey: 'ctrl+l, cmd+l' },
  { id: 'closeModalsOrClearSelection', name: 'Close Modals / Clear Selection', scope: 'global', defaultKey: 'esc' },
  { id: 'closeModalsOrClearSelection', name: 'Close Modals / Clear Selection', scope: 'preview', defaultKey: 'esc' },
  { id: 'deleteSelected', name: 'Delete Selected / Image', scope: 'global', defaultKey: 'delete' },

  // Preview Scope
  { id: 'toggleImageFullscreen', name: 'Toggle Image Fullscreen', scope: 'preview', defaultKey: 'alt+enter' },
  { id: 'navigatePrevious', name: 'Previous Image', scope: 'preview', defaultKey: 'left' },
  { id: 'navigateNext', name: 'Next Image', scope: 'preview', defaultKey: 'right' },
  { id: 'navigateToFirstPage', name: 'First Page', scope: 'global', defaultKey: 'home' },
  { id: 'navigateToLastPage', name: 'Last Page', scope: 'global', defaultKey: 'end' },
  { id: 'navigatePreviousPage', name: 'Previous Page', scope: 'global', defaultKey: 'pageup' },
  { id: 'navigateNextPage', name: 'Next Page', scope: 'global', defaultKey: 'pagedown' },
];

export const getDefaultKeymap = (): Keymap => {
  const keymap: Keymap = { version: '1.0' };
  hotkeyConfig.forEach(hotkey => {
    if (!keymap[hotkey.scope]) {
      keymap[hotkey.scope] = {};
    }
    (keymap[hotkey.scope] as Record<string, string>)[hotkey.id] = hotkey.defaultKey;
  });
  return keymap;
};