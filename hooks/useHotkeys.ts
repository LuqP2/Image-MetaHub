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
    setShouldOpenModal,
    shouldOpenModal,
    selectedImages,
    clearImageSelection,
    setPreviewImage,
    previewImage,
    directories,
    handleNavigateNext,
    handleNavigatePrevious,
    selectAllImages,
  } = useImageStore();

  const { handleDeleteSelectedImages } = useImageSelection();
  const { handleSelectFolder, handleLoadFromStorage } = useImageLoader();
  const { toggleViewMode, theme, setTheme, keymap } = useSettingsStore();

  const focusArea = (area: 'sidebar' | 'grid' | 'preview') => {
    const element = document.querySelector<HTMLElement>(`[data-area='${area}']`);
    if (element) {
      element.focus();
    }
  };

  useEffect(() => {
    // Register all actions with the hotkey manager
    hotkeyManager.registerAction('openCommandPalette', () => setIsCommandPaletteOpen(true));
    hotkeyManager.registerAction('openQuickSettings', () => setIsSettingsModalOpen(true));
    hotkeyManager.registerAction('openKeyboardShortcuts', () => setIsHotkeyHelpOpen(true));
    hotkeyManager.registerAction('focusSidebar', () => focusArea('sidebar'));
    hotkeyManager.registerAction('focusImageGrid', () => focusArea('grid'));
    hotkeyManager.registerAction('focusPreviewPane', () => focusArea('preview'));
    hotkeyManager.registerAction('focusSearch', () => {
      const searchInput = document.querySelector<HTMLInputElement>('[data-testid="search-input"]');
      if (searchInput) {
        searchInput.focus();
        searchInput.select();
      }
    });
    hotkeyManager.registerAction('quickSearch', () => {
        const searchInput = document.querySelector<HTMLInputElement>('[data-testid="search-input"]');
        if (searchInput) {
          searchInput.focus();
          searchInput.select();
        }
    });
    hotkeyManager.registerAction('toggleAdvancedFilters', () => {
      const advancedFilterButton = document.querySelector<HTMLButtonElement>('button:has(span:contains("Advanced Filters"))');
      if (advancedFilterButton) {
        advancedFilterButton.click();
      }
    });
    hotkeyManager.registerAction('addFolder', () => {
      handleSelectFolder();
    });
    hotkeyManager.registerAction('rescanFolders', () => {
      handleLoadFromStorage().catch((error) => {
        console.error('Error rescanning folders:', error);
      });
    });
    hotkeyManager.registerAction('selectAll', selectAllImages);
    hotkeyManager.registerAction('deleteSelected', () => {
      handleDeleteSelectedImages().catch((error) => {
        console.error('Error deleting selected images:', error);
      });
    });
    hotkeyManager.registerAction('toggleQuickPreview', () => {
      if (selectedImage) {
        setPreviewImage(previewImage?.id === selectedImage.id ? null : selectedImage);
      }
    });
    hotkeyManager.registerAction('openFullscreen', () => {
      if (selectedImage) {
        if (shouldOpenModal) {
          // Modal já está aberto, apenas fechar
          setShouldOpenModal(false);
        } else {
          // Modal está fechado, abrir
          setShouldOpenModal(true);
        }
      }
    });
    hotkeyManager.registerAction('toggleListGridView', toggleViewMode);
    hotkeyManager.registerAction('navigatePrevious', handleNavigatePrevious);
    hotkeyManager.registerAction('navigateNext', handleNavigateNext);
    hotkeyManager.registerAction('closeModalsOrClearSelection', () => {
      if (isCommandPaletteOpen) setIsCommandPaletteOpen(false);
      else if (isHotkeyHelpOpen) setIsHotkeyHelpOpen(false);
      else if (isSettingsModalOpen) setIsSettingsModalOpen(false);
      else if (shouldOpenModal) setShouldOpenModal(false);
      else if (previewImage) setPreviewImage(null);
      else if (selectedImage) setSelectedImage(null);
      else if (selectedImages.size > 0) clearImageSelection();
    });

    // Bind all registered actions initially
    hotkeyManager.bindAllActions();

    // Set scope based on focused element
    const handleFocusChange = () => {
      const activeElement = document.activeElement;
      if (activeElement) {
        const previewPane = document.querySelector('[data-area="preview"]');
        if (previewPane && previewPane.contains(activeElement)) {
          hotkeyManager.setScope('preview');
        } else if (selectedImage) {
          hotkeyManager.setScope('preview');
        } else {
          hotkeyManager.setScope('global');
        }
      }
    };

    document.addEventListener('focusin', handleFocusChange);
    handleFocusChange();

    // Subscribe to keymap changes and re-bind hotkeys
    const unsubscribe = useSettingsStore.subscribe((state) => {
      if (state.keymap) {
        hotkeyManager.bindAllActions();
      }
    });

    return () => {
      hotkeyManager.clearActions();
      document.removeEventListener('focusin', handleFocusChange);
      unsubscribe();
    };
  }, [
    handleSelectFolder,
    handleLoadFromStorage,
    selectAllImages,
    handleDeleteSelectedImages,
    previewImage,
    setPreviewImage,
    setSelectedImage,
    handleNavigatePrevious,
    handleNavigateNext,
    isCommandPaletteOpen,
    isHotkeyHelpOpen,
    isSettingsModalOpen,
    selectedImages,
    clearImageSelection,
    toggleViewMode,
    setIsCommandPaletteOpen,
    setIsHotkeyHelpOpen,
    setIsSettingsModalOpen,
  ]);

  // Separate effect to handle scope changes based on selectedImage
  useEffect(() => {
    const activeElement = document.activeElement;
    const previewPane = document.querySelector('[data-area="preview"]');
    
    // Only change scope if we're not in the preview pane
    if (!previewPane || !previewPane.contains(activeElement)) {
      if (selectedImage) {
        hotkeyManager.setScope('preview');
      } else {
        hotkeyManager.setScope('global');
      }
    }
  }, [selectedImage]);

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