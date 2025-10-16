import { useEffect, useMemo } from 'react';
import hotkeyManager from '../services/hotkeyManager';
import { useImageStore } from '../store/useImageStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useImageSelection } from './useImageSelection';
import { useImageLoader } from './useImageLoader';

interface HotkeyProps {
  isCommandPaletteOpen: boolean;
  setIsCommandPaletteOpen: (isOpen: boolean) => void;
  isHotkeyHelpOpen: boolean;
  setIsHotkeyHelpOpen: (isOpen: boolean) => void;
  isSettingsModalOpen: boolean;
  setIsSettingsModalOpen: (isOpen: boolean) => void;
}

export const useHotkeys = ({
  isCommandPaletteOpen,
  setIsCommandPaletteOpen,
  isHotkeyHelpOpen,
  setIsHotkeyHelpOpen,
  isSettingsModalOpen,
  setIsSettingsModalOpen,
}: HotkeyProps) => {
  const {
    selectedImage,
    setSelectedImage,
    selectedImages,
    clearSelection,
    setPreviewImage,
    previewImage,
    directories,
    handleNavigateNext,
    handleNavigatePrevious,
    selectAllImages,
  } = useImageStore();

  const { handleDeleteSelectedImages } = useImageSelection();
  const { handleSelectFolder, handleLoadFromStorage } = useImageLoader();
  const { toggleViewMode, theme, setTheme } = useSettingsStore();

  const focusArea = (area: 'sidebar' | 'grid' | 'preview') => {
    const element = document.querySelector<HTMLElement>(`[data-area='${area}']`);
    if (element) {
      element.focus();
    }
  };

  useEffect(() => {
    hotkeyManager.init();

    // Global
    hotkeyManager.on('ctrl+k, cmd+k', 'Open Command Palette', () => setIsCommandPaletteOpen(true));
    hotkeyManager.on('ctrl+., cmd+.', 'Open Quick Settings', () => setIsSettingsModalOpen(true));
    hotkeyManager.on('f1', 'Open Keyboard Shortcuts', () => setIsHotkeyHelpOpen(true));

    // Navigation / Focus
    hotkeyManager.on('ctrl+1, cmd+1', 'Focus Sidebar', () => focusArea('sidebar'));
    hotkeyManager.on('ctrl+2, cmd+2', 'Focus Image Grid', () => focusArea('grid'));
    hotkeyManager.on('ctrl+3, cmd+3', 'Focus Preview Pane', () => focusArea('preview'));

    // Search
    const focusSearch = () => {
      const searchInput = document.querySelector<HTMLInputElement>('[data-testid="search-input"]');
      if (searchInput) {
        searchInput.focus();
        searchInput.select();
      }
    };
    hotkeyManager.on('ctrl+f, cmd+f', 'Focus Search', focusSearch);
    hotkeyManager.on('/', 'Quick Search', focusSearch);
    hotkeyManager.on('ctrl+shift+f, cmd+shift+f', 'Toggle Advanced Filters', () => {
      const advancedFilterButton = document.querySelector<HTMLButtonElement>('button:has(span:contains("Advanced Filters"))');
      if (advancedFilterButton) {
        advancedFilterButton.click();
      }
    });

    // File / Folder
    hotkeyManager.on('ctrl+o, cmd+o', 'Add Folder', handleSelectFolder);
    hotkeyManager.on('ctrl+shift+r, cmd+shift+r', 'Rescan Folders', handleLoadFromStorage);

    // Selection & Actions
    hotkeyManager.on('ctrl+a, cmd+a', 'Select All', selectAllImages);
    hotkeyManager.on('delete', 'Delete Selected', handleDeleteSelectedImages);
    hotkeyManager.on('space', 'Toggle Quick Preview', (e) => {
        e.preventDefault();
        if (selectedImage) {
            setPreviewImage(previewImage?.id === selectedImage.id ? null : selectedImage);
        }
    });
    hotkeyManager.on('enter', 'Open Fullscreen', () => {
      if (selectedImage) {
        setSelectedImage(selectedImage);
      }
    });

    // View
    hotkeyManager.on('ctrl+l, cmd+l', 'Toggle List/Grid View', toggleViewMode);

    // Scoped Navigation in Preview
    hotkeyManager.on('left', 'preview', handleNavigatePrevious);
    hotkeyManager.on('right', 'preview', handleNavigateNext);

    // General
    hotkeyManager.on('esc', 'Close Modals / Clear Selection', () => {
      if (isCommandPaletteOpen) setIsCommandPaletteOpen(false);
      else if (isHotkeyHelpOpen) setIsHotkeyHelpOpen(false);
      else if (isSettingsModalOpen) setIsSettingsModalOpen(false);
      else if (previewImage) setPreviewImage(null);
      else if (selectedImage) setSelectedImage(null);
      else if (selectedImages.size > 0) clearSelection();
    });

    // Set scope based on focused element
    const handleFocusChange = () => {
      const activeElement = document.activeElement;
      if (activeElement) {
        const previewPane = document.querySelector('[data-area="preview"]');
        if (previewPane && previewPane.contains(activeElement)) {
          hotkeyManager.setScope('preview');
        } else {
          hotkeyManager.setScope('all');
        }
      }
    };

    document.addEventListener('focusin', handleFocusChange);

    return () => {
      hotkeyManager.unbindAll();
      document.removeEventListener('focusin', handleFocusChange);
    };
  }, [
    handleSelectFolder,
    handleLoadFromStorage,
    selectAllImages,
    handleDeleteSelectedImages,
    selectedImage,
    previewImage,
    setPreviewImage,
    setSelectedImage,
    handleNavigatePrevious,
    handleNavigateNext,
    isCommandPaletteOpen,
    isHotkeyHelpOpen,
    isSettingsModalOpen,
    selectedImages,
    clearSelection,
    toggleViewMode
  ]);

  const commands = useMemo(() => [
    { id: 'toggle-theme', name: 'Toggle Theme', description: 'Switch between light and dark mode', action: () => {
      const newTheme = theme === 'dark' ? 'light' : 'dark';
      setTheme(newTheme);
    }},
    { id: 'add-folder', name: 'Add Folder', description: 'Open a new folder', hotkey: 'Ctrl+O', action: handleSelectFolder },
    { id: 'toggle-view', name: 'Toggle List/Grid View', description: 'Switch between list and grid view', hotkey: 'Ctrl+L', action: toggleViewMode },
    ...directories.map(dir => ({
      id: `open-folder-${dir.id}`,
      name: `Go to Folder: ${dir.name}`,
      description: `Focus on the ${dir.name} folder`,
      action: () => {
        useImageStore.getState().toggleDirectoryVisibility(dir.id);
      }
    }))
  ], [directories, handleSelectFolder, toggleViewMode, theme, setTheme]);

  return { commands, registeredHotkeys: hotkeyManager.getRegisteredHotkeys() };
};