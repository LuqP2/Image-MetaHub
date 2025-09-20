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
        // Direct path provided
        fullPath = imageOrPath;
      } else {
        // IndexedImage provided - construct path
        let directoryPath = localStorage.getItem('invokeai-electron-directory-path');

        // Try sessionStorage as fallback if localStorage is null
        if (!directoryPath) {
          directoryPath = sessionStorage.getItem('invokeai-electron-directory-path');
          console.log('🔄 Using sessionStorage fallback for directory path:', directoryPath);
        }

        console.log('🔍 Show in explorer - directory path:', directoryPath);
        console.log('🔍 Show in explorer - image.id:', imageOrPath.id);

        fullPath = directoryPath ? `${directoryPath}\\${imageOrPath.id}` : imageOrPath.id;
      }
      
      console.log('🔍 Show in explorer - full path:', fullPath);

      const result = await (window as any).electronAPI.showItemInFolder(fullPath);
      console.log('📂 Show in explorer API result:', result);

      if (result.success) {
        console.log('✅ File opened in file explorer:', fullPath);
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
          console.log('📋 File path copied to clipboard for reference');
        } catch (clipboardError) {
          console.log('❌ Could not copy path to clipboard, but path shown in alert');
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
          console.log('📋 File path copied to clipboard for reference');
        } catch (clipboardError) {
          console.log('❌ Could not copy path to clipboard, but path shown in alert');
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

    console.log('🔍 Copy filepath - Image object:', {
      id: image.id,
      name: image.name,
      directoryName: image.directoryName
    });

    if (isElectron) {
      // In Electron, construct full path from directory + relative path
      let directoryPath = localStorage.getItem('invokeai-electron-directory-path');

      // Try sessionStorage as fallback if localStorage is null
      if (!directoryPath) {
        directoryPath = sessionStorage.getItem('invokeai-electron-directory-path');
        console.log('🔄 Using sessionStorage fallback for directory path:', directoryPath);
      }

      console.log('📋 Directory path from storage:', directoryPath);
      console.log('📋 Image ID:', image.id);

      pathToCopy = directoryPath ? `${directoryPath}\\${image.id}` : image.id;
      console.log('📋 Electron full path to copy:', pathToCopy);
    } else {
      // In browser, use relative path
      pathToCopy = image.id;
      console.log('📋 Browser relative path to copy:', pathToCopy);
    }

    await navigator.clipboard.writeText(pathToCopy);

    // Show confirmation messages
    if (isElectron) {
      console.log('✅ Full file path copied to clipboard:', pathToCopy);
    } else {
      console.log('✅ Relative file path copied to clipboard:', pathToCopy);
      // Show additional context if we have directory name
      if (image.directoryName) {
        console.log('📁 File is located in directory:', image.directoryName);
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