import { useState, useEffect, useCallback, useLayoutEffect, useRef } from 'react';
import { type IndexedImage } from '../types';
import { copyImageToClipboard, showInExplorer } from '../utils/imageUtils';
import { A1111ApiClient } from '../services/a1111ApiClient';
import { useSettingsStore } from '../store/useSettingsStore';
import { formatMetadataForA1111 } from '../utils/a1111Formatter';
import { useA1111ProgressContext } from '../contexts/A1111ProgressContext';
import { useFeatureAccess } from './useFeatureAccess';
import {
  getClipboardErrorMessage,
  getNormalizedMetadata,
  hasPromptMetadata,
  NO_METADATA_MESSAGE,
} from '../utils/imageMetadata';

interface ContextMenuState {
  x: number;
  y: number;
  anchorX: number;
  anchorY: number;
  visible: boolean;
  horizontalDirection: 'left' | 'right';
  verticalDirection: 'up' | 'down';
  image?: IndexedImage;
  directoryPath?: string;
}

const CONTEXT_MENU_MARGIN = 8;
const OPEN_BATCH_EXPORT_EVENT = 'imagemetahub:open-batch-export';

const showNotification = (message: string) => {
  const notification = document.createElement('div');
  notification.className = 'fixed top-4 right-4 bg-green-600 text-white px-4 py-2 rounded-lg shadow-lg z-50';
  notification.textContent = message;
  document.body.appendChild(notification);
  setTimeout(() => {
    if (document.body.contains(notification)) {
      document.body.removeChild(notification);
    }
  }, 2000);
};

export const useContextMenu = () => {
  const contextMenuRef = useRef<HTMLDivElement | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState>({
    x: 0,
    y: 0,
    anchorX: 0,
    anchorY: 0,
    visible: false,
    horizontalDirection: 'right',
    verticalDirection: 'down',
  });

  const { startPolling, stopPolling } = useA1111ProgressContext();
  const { canUseA1111, showProModal } = useFeatureAccess();

  const hideContextMenu = useCallback(() => {
    setContextMenu((prev) => ({ ...prev, visible: false }));
  }, []);

  useLayoutEffect(() => {
    if (!contextMenu.visible || !contextMenuRef.current) {
      return;
    }

    const repositionMenu = () => {
      const menuElement = contextMenuRef.current;
      if (!menuElement) {
        return;
      }

      const rect = menuElement.getBoundingClientRect();
      const maxX = Math.max(CONTEXT_MENU_MARGIN, window.innerWidth - rect.width - CONTEXT_MENU_MARGIN);
      const maxY = Math.max(CONTEXT_MENU_MARGIN, window.innerHeight - rect.height - CONTEXT_MENU_MARGIN);

      let nextX = contextMenu.anchorX;
      let nextY = contextMenu.anchorY;
      let horizontalDirection: 'left' | 'right' = 'right';
      let verticalDirection: 'up' | 'down' = 'down';

      if (nextX + rect.width > window.innerWidth - CONTEXT_MENU_MARGIN) {
        nextX = contextMenu.anchorX - rect.width;
        horizontalDirection = 'left';
      }

      if (nextY + rect.height > window.innerHeight - CONTEXT_MENU_MARGIN) {
        nextY = contextMenu.anchorY - rect.height;
        verticalDirection = 'up';
      }

      nextX = Math.min(Math.max(CONTEXT_MENU_MARGIN, nextX), maxX);
      nextY = Math.min(Math.max(CONTEXT_MENU_MARGIN, nextY), maxY);

      setContextMenu((prev) => {
        if (
          prev.x === nextX &&
          prev.y === nextY &&
          prev.horizontalDirection === horizontalDirection &&
          prev.verticalDirection === verticalDirection
        ) {
          return prev;
        }

        return {
          ...prev,
          x: nextX,
          y: nextY,
          horizontalDirection,
          verticalDirection,
        };
      });
    };

    repositionMenu();
    window.addEventListener('resize', repositionMenu);

    return () => {
      window.removeEventListener('resize', repositionMenu);
    };
  }, [contextMenu.anchorX, contextMenu.anchorY, contextMenu.visible]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (contextMenu.visible) {
        const target = event.target as HTMLElement;
        if (!target.closest('.context-menu-class')) {
          hideContextMenu();
        }
      }
    };

    document.addEventListener('click', handleClickOutside);
    return () => {
      document.removeEventListener('click', handleClickOutside);
    };
  }, [contextMenu.visible, hideContextMenu]);


  const showContextMenu = (e: React.MouseEvent, image: IndexedImage, directoryPath?: string) => {
    e.preventDefault();
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      anchorX: e.clientX,
      anchorY: e.clientY,
      visible: true,
      horizontalDirection: 'right',
      verticalDirection: 'down',
      image,
      directoryPath
    });
  };

  const copyToClipboardElectron = (text: string, label: string) => {
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(() => {
        showNotification(`${label} copied to clipboard!`);
      }).catch(err => {
        console.error('Failed to copy to clipboard:', err);
        alert(`Failed to copy ${label} to clipboard`);
      });
    } else {
      const textArea = document.createElement('textarea');
      textArea.value = text;
      textArea.style.position = 'fixed';
      textArea.style.left = '-999999px';
      textArea.style.top = '-999999px';
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      try {
        document.execCommand('copy');
        showNotification(`${label} copied to clipboard!`);
      } catch (err) {
        console.error('Fallback copy failed:', err);
        alert(`Failed to copy ${label} to clipboard`);
      }
      document.body.removeChild(textArea);
    }
    hideContextMenu();
  };

  const copyPrompt = () => {
    const prompt = contextMenu.image?.prompt || (contextMenu.image ? getNormalizedMetadata(contextMenu.image)?.prompt : undefined);
    if (!prompt) return;
    copyToClipboardElectron(prompt, 'Prompt');
  };

  const copyNegativePrompt = () => {
    const negativePrompt =
      contextMenu.image?.negativePrompt ||
      (contextMenu.image ? getNormalizedMetadata(contextMenu.image)?.negativePrompt : undefined);
    if (!negativePrompt) return;
    copyToClipboardElectron(negativePrompt, 'Negative Prompt');
  };

  const copySeed = () => {
    const seed = contextMenu.image?.seed || (contextMenu.image ? getNormalizedMetadata(contextMenu.image)?.seed : undefined);
    if (!seed) return;
    copyToClipboardElectron(String(seed), 'Seed');
  };

  const copyImage = async () => {
    if (!contextMenu.image) return;
    hideContextMenu();
    const result = await copyImageToClipboard(contextMenu.image, contextMenu.directoryPath);
    if (result.success) {
      showNotification('Image copied to clipboard!');
    } else {
      alert(`Failed to copy image to clipboard: ${result.error}`);
    }
  };

  const copyModel = () => {
    const model = contextMenu.image?.models?.[0] || (contextMenu.image ? getNormalizedMetadata(contextMenu.image)?.model : undefined);
    if (!model) return;
    copyToClipboardElectron(model, 'Model');
  };

  const showInFolder = () => {
    if (!contextMenu.image || !contextMenu.directoryPath) {
      alert('Cannot determine file location: directory path is missing.');
      return;
    }
    hideContextMenu();
    showInExplorer(`${contextMenu.directoryPath}/${contextMenu.image.name}`);
  };

  const exportImage = () => {
    if (!contextMenu.image) return;
    hideContextMenu();

    window.dispatchEvent(new CustomEvent(OPEN_BATCH_EXPORT_EVENT, {
      detail: {
        imageIds: [contextMenu.image.id],
        preferredSource: 'selected',
      },
    }));
  };

  const copyMetadataToA1111 = async () => {
    if (!contextMenu.image) return;

    if (!canUseA1111) {
      showProModal('a1111');
      hideContextMenu();
      return;
    }

    const metadata = getNormalizedMetadata(contextMenu.image);
    if (!hasPromptMetadata(metadata)) {
      alert(NO_METADATA_MESSAGE);
      hideContextMenu();
      return;
    }

    hideContextMenu();

    try {
      // Format metadata to A1111 string
      const formattedText = formatMetadataForA1111(metadata);

      // Copy to clipboard
      await navigator.clipboard.writeText(formattedText);

      showNotification('Copied! Paste into A1111 prompt box and click the Blue Arrow.');
    } catch (error: unknown) {
      alert(getClipboardErrorMessage(error));
    }
  };

  const quickGenerateInA1111 = async () => {
    if (!contextMenu.image) return;

    if (!canUseA1111) {
      showProModal('a1111');
      hideContextMenu();
      return;
    }

    const metadata = getNormalizedMetadata(contextMenu.image);
    if (!hasPromptMetadata(metadata)) {
      alert(NO_METADATA_MESSAGE);
      hideContextMenu();
      return;
    }

    // Get settings from store
    const { a1111ServerUrl } = useSettingsStore.getState();

    if (!a1111ServerUrl) {
      alert('A1111 server URL not configured. Please check Settings.');
      hideContextMenu();
      return;
    }

    hideContextMenu();

    try {
      const client = new A1111ApiClient({ serverUrl: a1111ServerUrl });

      // Start progress polling
      startPolling(a1111ServerUrl, 1);

      // ALWAYS start generation (autoStart: true)
      const result = await client.sendToTxt2Img(metadata, {
        autoStart: true
      });

      // Stop progress polling
      stopPolling();

      if (result.success) {
        showNotification('Generated successfully!');
      } else {
        alert(result.error || 'Generation failed');
      }
    } catch (error: unknown) {
      // Stop progress polling on error
      stopPolling();
      alert(`Error: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const copyRawMetadata = () => {
    if (!contextMenu.image || !contextMenu.image.metadata) return;
    const metadataString = JSON.stringify(contextMenu.image.metadata, null, 2);
    copyToClipboardElectron(metadataString, 'Raw Metadata');
  };

  const addTag = () => {
    if (!contextMenu.image) return;
    hideContextMenu();
    // Signal to open tag modal
    return 'open-tag-modal';
  };

  return {
    contextMenu,
    contextMenuRef,
    showContextMenu,
    hideContextMenu,
    copyPrompt,
    copyNegativePrompt,
    copySeed,
    copyImage,
    copyModel,
    showInFolder,
    exportImage,
    copyMetadataToA1111,
    quickGenerateInA1111,
    copyRawMetadata,
    addTag
  };
};
