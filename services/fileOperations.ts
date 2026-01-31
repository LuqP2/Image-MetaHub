// File operations service for Electron environment
import { IndexedImage } from '../types';

// Check if we're running in Electron
const isElectron = typeof window !== 'undefined' && (window as any).electronAPI;

export interface FileOperationsResult {
  success: boolean;
  error?: string;
}

export class FileOperations {
  
  /**
   * Delete file to trash/recycle bin
   */
  static async deleteFile(image: IndexedImage): Promise<FileOperationsResult> {
    try {
      if (isElectron && window.electronAPI) {
        if (!image.directoryId) {
          return { success: false, error: 'Image is missing directory information.' };
        }
        // Use Electron's trash functionality
        const joinResult = await window.electronAPI.joinPaths(image.directoryId, image.name);
        if (!joinResult.success || !joinResult.path) {
          return { success: false, error: `Failed to construct file path: ${joinResult.error}` };
        }
        const result = await window.electronAPI.trashFile(joinResult.path);
        return { success: result.success, error: result.error };
      } else {
        // For browser environment, we can't delete files
        // File System Access API doesn't support delete operations
        return {
          success: false,
          error: 'File deletion is only available in the desktop app version'
        };
      }
    } catch (error) {
      console.error('Error deleting file:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      };
    }
  }

  /**
   * Rename file
   */
  static async renameFile(image: IndexedImage, newName: string): Promise<FileOperationsResult> {
    try {
      if (isElectron && window.electronAPI) {
        if (!image.directoryId) {
          return { success: false, error: 'Image is missing directory information.' };
        }

        const originalNameParts = image.name.split('/');
        const originalFilename = originalNameParts[originalNameParts.length - 1];
        const originalExtension = originalFilename.includes('.') ? originalFilename.split('.').pop() : '';

        if (originalExtension && !newName.toLowerCase().endsWith(`.${originalExtension}`)) {
          newName += `.${originalExtension}`;
        }

        const pathParts = image.name.split('/');
        pathParts.pop(); // remove old filename
        const newRelativePath = [...pathParts, newName].join('/');

        const oldPathResult = await window.electronAPI.joinPaths(image.directoryId, image.name);
        const newPathResult = await window.electronAPI.joinPaths(image.directoryId, newRelativePath);

        if (!oldPathResult.success || !oldPathResult.path) {
          return { success: false, error: `Failed to construct old file path: ${oldPathResult.error}` };
        }
        if (!newPathResult.success || !newPathResult.path) {
          return { success: false, error: `Failed to construct new file path: ${newPathResult.error}` };
        }

        const result = await window.electronAPI.renameFile(oldPathResult.path, newPathResult.path);
        return { success: result.success, error: result.error };
      } else {
        // For browser environment, we can't rename files directly
        // File System Access API doesn't support rename operations
        return {
          success: false,
          error: 'File renaming is only available in the desktop app version'
        };
      }
    } catch (error) {
      console.error('Error renaming file:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      };
    }
  }

  /**
   * Set current directory for file operations
   */
  static async setCurrentDirectory(directoryHandle?: FileSystemDirectoryHandle): Promise<void> {
    if (isElectron && window.electronAPI && directoryHandle) {
      try {
        // In Electron environment with File System Access API, we need to get the path
        // Since FileSystemDirectoryHandle doesn't expose path directly, 
        // we'll need to handle this differently
        // console.log('Setting current directory for file operations');
        // For now, we'll rely on the app to manage this
      } catch (error) {
        console.error('Error setting current directory:', error);
      }
    }
  }

  /**
   * Validate filename
   */
  static validateFilename(filename: string): { valid: boolean; error?: string } {
    // Remove common image extension for validation
    const nameWithoutExt = filename.replace(/\.(png|jpg|jpeg|webp|mp4|webm|mkv|mov|avi)$/i, '');
    
    if (!nameWithoutExt.trim()) {
      return { valid: false, error: 'Filename cannot be empty' };
    }

    // Check for invalid characters
    const invalidChars = /[<>:"/\\|?*]/;
    if (invalidChars.test(nameWithoutExt)) {
      return { valid: false, error: 'Filename contains invalid characters: < > : " / \\ | ? *' };
    }

    // Check length (Windows limit is 255, but we'll be conservative)
    if (nameWithoutExt.length > 200) {
      return { valid: false, error: 'Filename is too long (max 200 characters)' };
    }

    return { valid: true };
  }
}
