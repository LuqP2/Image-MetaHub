import { type IndexedImage } from '../types';

// Utility functions for image operations

export interface OperationResult {
  success: boolean;
  error?: string;
}

/**
 * Copies an image to the clipboard using the Clipboard API
 * @param image - The IndexedImage object containing the file handle
 * @returns Promise with operation result
 */
export const copyImageToClipboard = async (image: IndexedImage): Promise<OperationResult> => {
  try {
    // Check if running in Electron and use native clipboard API if available
    if (typeof window !== 'undefined' && window.electronAPI && window.electronAPI.copyImageToClipboard) {
      // Construct the full path based on whether the image object has a direct path or needs construction
      // In IndexedImage, 'id' is often the file path, or 'name' if combined with directory
      const fullPath = image.id;
      
      // If we are in Electron, image.id should be the full path for local files
      const result = await window.electronAPI.copyImageToClipboard(fullPath);
      
      if (result.success) {
        return { success: true };
      }
      
      console.warn('Native clipboard copy failed, falling back to web API:', result.error);
      // Fallback to web API if native fails (though native should be preferred)
    }

    // Web API fallback (or if native failed)
    // Ensure document has focus before clipboard operation (browser requirement)
    if (typeof document !== 'undefined' && (document.hidden || !document.hasFocus())) {
      window.focus();
      // Short delay to allow focus to take effect
      await new Promise(resolve => setTimeout(resolve, 50));
    }

    const file = await image.handle.getFile();
    const blob = new Blob([file], { type: file.type });
    await navigator.clipboard.write([new ClipboardItem({ [file.type]: blob })]);
    return { success: true };
  } catch (error) {
    console.error('Failed to copy image to clipboard:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred'
    };
  }
};

/**
 * Shows the image file in the system's file explorer
 * @param imageOrPath - The IndexedImage object or full file path string
 * @returns Promise with operation result
 */
export const showInExplorer = async (imageOrPath: IndexedImage | string): Promise<OperationResult> => {
  try {
    // Check if running in Electron
    if (typeof window !== 'undefined' && (window as any).electronAPI && (window as any).electronAPI.showItemInFolder) {
      // Electron: use shell.showItemInFolder()
      let fullPath: string;
      
      if (typeof imageOrPath === 'string') {
        // Direct path provided - use it as-is
        fullPath = imageOrPath;
      } else {
        // IndexedImage provided - construct path
        let directoryPath = localStorage.getItem('invokeai-electron-directory-path');

        // Try sessionStorage as fallback if localStorage is null
        if (!directoryPath) {
          directoryPath = sessionStorage.getItem('invokeai-electron-directory-path');
        }

        fullPath = directoryPath ? `${directoryPath}\\${imageOrPath.name}` : imageOrPath.name;
      }
      
      const result = await (window as any).electronAPI.showItemInFolder(fullPath);

      if (result.success) {
        // File opened successfully
      } else {
        console.error('❌ Failed to open file in explorer:', result.error);
      }
      return result;
    } else {
      // Web: show helpful message with path
      if (typeof imageOrPath === 'string') {
        const message = `File location: ${imageOrPath}\n\n` +
          `In the web version, you can:\n` +
          `1. Copy this path\n` +
          `2. Navigate to the file location\n\n` +
          `For full file explorer integration, use the desktop app.`;

        alert(message);

        // Also copy the path to clipboard for convenience
        try {
          await navigator.clipboard.writeText(imageOrPath);
        } catch (clipboardError) {
          // Ignore clipboard errors
        }

        return { success: true };
      } else {
        const directoryContext = imageOrPath.directoryName ? `\nDirectory: ${imageOrPath.directoryName}` : '';
        const message = `File location: ${imageOrPath.id}${directoryContext}\n\n` +
          `In the web version, you can:\n` +
          `1. Copy this relative path\n` +
          `2. Navigate to your selected folder${imageOrPath.directoryName ? ` (${imageOrPath.directoryName})` : ''}\n` +
          `3. Find the file using this path\n\n` +
          `For full file explorer integration, use the desktop app.`;

        alert(message);

        // Also copy the path to clipboard for convenience
        try {
          await navigator.clipboard.writeText(imageOrPath.id);
        } catch (clipboardError) {
          // Ignore clipboard errors
        }

        return { success: true };
      }
    }
  } catch (error) {
    console.error('❌ Failed to show in explorer:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred'
    };
  }
};

/**
 * Copies the file path to clipboard
 * @param image - The IndexedImage object containing the file path
 * @returns Promise with operation result
 */
export const copyFilePathToClipboard = async (image: IndexedImage): Promise<OperationResult> => {
  try {
    // Ensure document has focus before clipboard operation
    if (document.hidden || !document.hasFocus()) {
      window.focus();
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    // Determine the path to copy based on environment
    const isElectron = typeof window !== 'undefined' && (window as any).electronAPI;
    let pathToCopy: string;

    if (isElectron) {
      // In Electron, construct full path from directory + relative path
      let directoryPath = localStorage.getItem('invokeai-electron-directory-path');

      // Try sessionStorage as fallback if localStorage is null
      if (!directoryPath) {
        directoryPath = sessionStorage.getItem('invokeai-electron-directory-path');
      }

      pathToCopy = directoryPath ? `${directoryPath}\\${image.name}` : image.name;
    } else {
      // In browser, use relative path
      pathToCopy = image.id;
    }

    await navigator.clipboard.writeText(pathToCopy);

    // Show confirmation messages
    if (isElectron) {
      // Electron handles its own confirmation
    } else {
      // Show additional context if we have directory name
      if (image.directoryName) {
        // Browser-specific handling
      }
    }

    return { success: true };
  } catch (error) {
    console.error('❌ Failed to copy file path:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred'
    };
  }
};