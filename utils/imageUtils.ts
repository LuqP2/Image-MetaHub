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
 * @param image - The IndexedImage object containing the file path
 * @returns Promise with operation result
 */
export const showInExplorer = async (image: IndexedImage): Promise<OperationResult> => {
  try {
    // Check if running in Electron
    if (typeof window !== 'undefined' && (window as any).electronAPI && (window as any).electronAPI.showItemInFolder) {
      // Electron: use shell.showItemInFolder()
      const result = await (window as any).electronAPI.showItemInFolder(image.id);
      return result;
    } else {
      // Web: show alert with path
      alert(`File location: ${image.id}\n\nIn web version, you can copy this path to open in your file explorer.`);
      return { success: true };
    }
  } catch (error) {
    console.error('Failed to show in explorer:', error);
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
    await navigator.clipboard.writeText(image.id);
    return { success: true };
  } catch (error) {
    console.error('Failed to copy file path:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred'
    };
  }
};