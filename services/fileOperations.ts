// File operations service for Electron environment
import { IndexedImage } from '../types';

// Check if we're running in Electron
const isElectron = typeof window !== 'undefined' && window.process && window.process.type;

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
        // Use Electron's trash functionality
        const result = await window.electronAPI.trashFile(image.handle.name);
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
      // Ensure the new name has .png extension
      if (!newName.toLowerCase().endsWith('.png')) {
        newName += '.png';
      }

      if (isElectron && window.electronAPI) {
        // Use Electron's file rename functionality
        const result = await window.electronAPI.renameFile(image.handle.name, newName);
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
        console.log('Setting current directory for file operations');
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
    // Remove .png extension for validation
    const nameWithoutExt = filename.replace(/\.png$/i, '');
    
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