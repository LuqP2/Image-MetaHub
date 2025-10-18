import { useEffect, useMemo } from 'react';
import toast from 'react-hot-toast';
import hotkeyManager from '../services/hotkeyManager';
import { useImageStore } from '../store/useImageStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useFavoritesStore } from '../store/useFavoritesStore';
import { useImageSelection } from './useImageSelection';
import { useImageLoader } from './useImageLoader';
import { useAppStore } from '../store/useAppStore';

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
  const { toggleFavorite } = useFavoritesStore();

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
        setSelectedImage(selectedImage);
      }
    });
    hotkeyManager.registerAction('toggleFavorite', () => {
      const { selectedImage } = useImageStore.getState();
      if (selectedImage) {
        const { isFavorite, toggleFavorite } = useFavoritesStore.getState();
        const { setView } = useAppStore.getState();
        const isAdding = !isFavorite(selectedImage.id);

        toggleFavorite(selectedImage).then(() => {
          toast.custom((t) => (
            <div
              className={`${
                t.visible ? 'animate-enter' : 'animate-leave'
              } max-w-md w-full bg-gray-700 shadow-lg rounded-lg pointer-events-auto flex ring-1 ring-black ring-opacity-5`}
            >
              <div className="flex-1 w-0 p-4">
                <p className="text-sm font-medium text-gray-100">
                  {isAdding ? 'Added to favorites' : 'Removed from favorites'}
                </p>
              </div>
              <div className="flex border-l border-gray-600">
                {isAdding && (
                  <button
                    onClick={() => {
                      setView('favorites');
                      toast.dismiss(t.id);
                    }}
                    className="w-full border-transparent rounded-none p-4 text-sm font-medium text-blue-400 hover:text-blue-300"
                  >
                    View
                  </button>
                )}
                <button
                  onClick={() => {
                    toggleFavorite(selectedImage);
                    toast.dismiss(t.id);
                  }}
                  className="w-full border-transparent rounded-none rounded-r-lg p-4 text-sm font-medium text-gray-400 hover:text-gray-300"
                >
                  Undo
                </button>
              </div>
            </div>
          ), { duration: 5000 });
        });
      }
    });
    hotkeyManager.registerAction('toggleListGridView', toggleViewMode);
    hotkeyManager.registerAction('navigatePrevious', handleNavigatePrevious);
    hotkeyManager.registerAction('navigateNext', handleNavigateNext);
    hotkeyManager.registerAction('closeModalsOrClearSelection', () => {
      if (isCommandPaletteOpen) setIsCommandPaletteOpen(false);
      else if (isHotkeyHelpOpen) setIsHotkeyHelpOpen(false);
      else if (isSettingsModalOpen) setIsSettingsModalOpen(false);
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
        } else {
          hotkeyManager.setScope('global');
        }
      }
    };

    document.addEventListener('focusin', handleFocusChange);

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
    clearImageSelection,
    toggleViewMode,
    setIsCommandPaletteOpen,
    setIsHotkeyHelpOpen,
    setIsSettingsModalOpen,
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