import { useState } from 'react';
import { type IndexedImage } from '../types';
import { copyImageToClipboard, showInExplorer, copyFilePathToClipboard } from '../utils/imageUtils';

interface ContextMenuState {
  x: number;
  y: number;
  visible: boolean;
  image?: IndexedImage;
  directoryPath?: string;
}

export const useContextMenu = () => {
  const [contextMenu, setContextMenu] = useState<ContextMenuState>({
    x: 0,
    y: 0,
    visible: false
  });

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

  const hideContextMenu = () => {
    setContextMenu({ x: 0, y: 0, visible: false });
  };

  const copyToClipboardElectron = (text: string, label: string) => {
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(() => {
        const notification = document.createElement('div');
        notification.className = 'fixed top-4 right-4 bg-green-600 text-white px-4 py-2 rounded shadow-lg z-50';
        notification.textContent = `${label} copied to clipboard!`;
        document.body.appendChild(notification);
        setTimeout(() => document.body.removeChild(notification), 2000);
      }).catch(err => {
        console.error('Failed to copy to clipboard:', err);
        alert(`Failed to copy ${label} to clipboard`);
      });
    } else {
      // Fallback for older browsers or non-secure contexts
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
        const notification = document.createElement('div');
        notification.className = 'fixed top-4 right-4 bg-green-600 text-white px-4 py-2 rounded shadow-lg z-50';
        notification.textContent = `${label} copied to clipboard!`;
        document.body.appendChild(notification);
        setTimeout(() => document.body.removeChild(notification), 2000);
      } catch (err) {
        console.error('Fallback copy failed:', err);
        alert(`Failed to copy ${label} to clipboard`);
      }
      document.body.removeChild(textArea);
    }
    hideContextMenu();
  };

  const copyPrompt = () => {
    if (!contextMenu.image?.metadata?.prompt) return;
    copyToClipboardElectron(contextMenu.image.metadata.prompt, 'Prompt');
  };

  const copyNegativePrompt = () => {
    if (!contextMenu.image?.metadata?.negativePrompt) return;
    copyToClipboardElectron(contextMenu.image.metadata.negativePrompt, 'Negative Prompt');
  };

  const copySeed = () => {
    if (!contextMenu.image?.metadata?.seed) return;
    copyToClipboardElectron(String(contextMenu.image.metadata.seed), 'Seed');
  };

  const copyImage = async () => {
    if (!contextMenu.image) return;
    hideContextMenu();
    const result = await copyImageToClipboard(contextMenu.image);
    if (result.success) {
      const notification = document.createElement('div');
      notification.className = 'fixed top-4 right-4 bg-green-600 text-white px-4 py-2 rounded shadow-lg z-50';
      notification.textContent = 'Image copied to clipboard!';
      document.body.appendChild(notification);
      setTimeout(() => document.body.removeChild(notification), 2000);
    } else {
      alert(`Failed to copy image to clipboard: ${result.error}`);
    }
  };

  const copyModel = () => {
    const model = contextMenu.image?.models?.[0] || contextMenu.image?.metadata?.model;
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
      const destPathResult = await window.electronAPI.joinPaths(destDir, contextMenu.image.name);
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

    } catch (error) {
      console.error('Export error:', error);
      alert(`An unexpected error occurred during export: ${error.message}`);
    }
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
    exportImage
  };
};