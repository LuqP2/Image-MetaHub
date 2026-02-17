import { useState, useEffect, useCallback } from 'react';
import { type IndexedImage } from '../types';
import { copyImageToClipboard, showInExplorer, copyFilePathToClipboard } from '../utils/imageUtils';
import { A1111ApiClient } from '../services/a1111ApiClient';
import { useSettingsStore } from '../store/useSettingsStore';
import { formatMetadataForA1111 } from '../utils/a1111Formatter';
import { useA1111ProgressContext } from '../contexts/A1111ProgressContext';
import { useFeatureAccess } from './useFeatureAccess';

interface ContextMenuState {
  x: number;
  y: number;
  visible: boolean;
  image?: IndexedImage;
  directoryPath?: string;
}

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
  const [contextMenu, setContextMenu] = useState<ContextMenuState>({
    x: 0,
    y: 0,
    visible: false
  });

  const { startPolling, stopPolling } = useA1111ProgressContext();
  const { canUseA1111, showProModal } = useFeatureAccess();

  const hideContextMenu = useCallback(() => {
    setContextMenu((prev) => ({ ...prev, visible: false }));
  }, []);

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
      visible: true,
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
    const prompt = contextMenu.image?.prompt || (contextMenu.image?.metadata as any)?.prompt;
    if (!prompt) return;
    copyToClipboardElectron(prompt, 'Prompt');
  };

  const copyNegativePrompt = () => {
    const negativePrompt = contextMenu.image?.negativePrompt || (contextMenu.image?.metadata as any)?.negativePrompt;
    if (!negativePrompt) return;
    copyToClipboardElectron(negativePrompt, 'Negative Prompt');
  };

  const copySeed = () => {
    const seed = contextMenu.image?.seed || (contextMenu.image?.metadata as any)?.seed;
    if (!seed) return;
    copyToClipboardElectron(String(seed), 'Seed');
  };

  const copyImage = async () => {
    if (!contextMenu.image) return;
    hideContextMenu();
    const result = await copyImageToClipboard(contextMenu.image);
    if (result.success) {
      showNotification('Image copied to clipboard!');
    } else {
      alert(`Failed to copy image to clipboard: ${result.error}`);
    }
  };

  const copyModel = () => {
    const model = contextMenu.image?.models?.[0] || (contextMenu.image?.metadata as any)?.model;
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

  const exportImage = async () => {
    if (!contextMenu.image || !contextMenu.directoryPath) return;
    hideContextMenu();

    if (!window.electronAPI) {
      alert('Export feature is only available in the desktop app version.');
      return;
    }

    try {
      // 1. Ask user for destination directory
      const destResult = await window.electronAPI.showDirectoryDialog();
      if (destResult.canceled || !destResult.path) {
        return; // User cancelled
      }
      const destDir = destResult.path;

      // Get safe paths using joinPaths
      const sourcePathResult = await window.electronAPI.joinPaths(contextMenu.directoryPath, contextMenu.image.name);
      if (!sourcePathResult.success || !sourcePathResult.path) {
        throw new Error(`Failed to construct source path: ${sourcePathResult.error}`);
      }

      // Fix: Extract just the filename from the relative path to flatten the export structure
      // image.name might be "subfolder/image.png", we just want "image.png" for the destination
      const fileName = contextMenu.image.name.split(/[/\\]/).pop() || contextMenu.image.name;
      
      const destPathResult = await window.electronAPI.joinPaths(destDir, fileName);
      if (!destPathResult.success || !destPathResult.path) {
        throw new Error(`Failed to construct destination path: ${destPathResult.error}`);
      }

      const sourcePath = sourcePathResult.path;
      const destPath = destPathResult.path;

      // 2. Read the source file
      const readResult = await window.electronAPI.readFile(sourcePath);
      if (!readResult.success || !readResult.data) {
        alert(`Failed to read original file: ${readResult.error}`);
        return;
      }

      // 3. Write the new file
      const writeResult = await window.electronAPI.writeFile(destPath, readResult.data);
      if (!writeResult.success) {
        alert(`Failed to export image: ${writeResult.error}`);
        return;
      }

      // 4. Success!
      alert(`Image exported successfully to: ${destPath}`);

    } catch (error: any) {
      console.error('Export error:', error);
      alert(`An unexpected error occurred during export: ${error.message}`);
    }
  };

  const copyMetadataToA1111 = async () => {
    if (!contextMenu.image) return;

    if (!canUseA1111) {
      showProModal('a1111');
      hideContextMenu();
      return;
    }

    const metadata = contextMenu.image.metadata?.normalizedMetadata;
    if (!metadata || !metadata.prompt) {
      alert('No metadata available for this image');
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
    } catch (error: any) {
      const errorMessage = error.message?.includes('clipboard')
        ? 'Clipboard access denied. Please use HTTPS or localhost.'
        : `Error: ${error.message}`;
      alert(errorMessage);
    }
  };

  const quickGenerateInA1111 = async () => {
    if (!contextMenu.image) return;

    if (!canUseA1111) {
      showProModal('a1111');
      hideContextMenu();
      return;
    }

    const metadata = contextMenu.image.metadata?.normalizedMetadata;
    if (!metadata || !metadata.prompt) {
      alert('No metadata available for this image');
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
    } catch (error: any) {
      // Stop progress polling on error
      stopPolling();
      alert(`Error: ${error.message}`);
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
