// File operations service for Electron environment
import { IndexedImage } from '../types';
import { SUPPORTED_MEDIA_EXTENSIONS } from '../utils/mediaTypes.js';
import { getRelativeImagePath } from '../utils/imagePaths';

// Check if we're running in Electron
const isElectron = typeof window !== 'undefined' && (window as any).electronAPI;
const SUPPORTED_MEDIA_EXTENSION_REGEX = new RegExp(
  `(${SUPPORTED_MEDIA_EXTENSIONS.map((ext) => ext.replace('.', '\\.')).join('|')})$`,
  'i'
);

export interface FileOperationsResult {
  success: boolean;
  error?: string;
}

export class FileOperations {

  static async deleteFiles(images: IndexedImage[]): Promise<FileOperationsResult[]> {
    if (!isElectron || !window.electronAPI) {
      return images.map(() => ({
        success: false,
        error: 'File deletion is only available in the desktop app version',
      }));
    }

    const attempts = await Promise.all(images.map(async (image) => {
      try {
        if (!image.directoryId) {
          return {
            result: { success: false, error: 'Image is missing directory information.' },
          };
        }
        const joinResult = await window.electronAPI!.joinPaths(image.directoryId, image.name);
        if (!joinResult.success || !joinResult.path) {
          return {
            result: { success: false, error: `Failed to construct file path: ${joinResult.error}` },
          };
        }
        const trashResult = await window.electronAPI!.trashFile(joinResult.path);
        return {
          result: trashResult.success
            ? { success: true }
            : {
                success: trashResult.primaryDeleted === true,
                error: trashResult.error || 'Could not move the file to the Recycle Bin. The file was preserved.',
              },
          token: trashResult.permanentDeleteToken,
          primaryDeleted: trashResult.primaryDeleted === true,
        };
      } catch (error) {
        return {
          result: {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown delete error',
          },
        };
      }
    }));

    const tokenAttempts = attempts.filter(
      (attempt): attempt is typeof attempt & { token: string } => Boolean(attempt.token),
    );
    if (tokenAttempts.length > 0 && window.electronAPI.confirmPermanentDelete) {
      let permanentResult;
      try {
        permanentResult = await window.electronAPI.confirmPermanentDelete({
          tokens: tokenAttempts.map((attempt) => attempt.token),
        });
      } catch (error) {
        permanentResult = {
          success: false,
          cancelled: false,
          deletedTokens: [],
          failedTokens: tokenAttempts.map((attempt) => attempt.token),
          error: error instanceof Error ? error.message : 'Permanent deletion failed',
        };
      }
      const deletedTokens = new Set(permanentResult.deletedTokens);
      for (const attempt of tokenAttempts) {
        if (deletedTokens.has(attempt.token) || attempt.primaryDeleted) {
          attempt.result = { success: true };
        } else if (permanentResult.cancelled) {
          attempt.result = {
            success: false,
            error: 'Could not move the file to the Recycle Bin. Permanent deletion was cancelled; the file was preserved.',
          };
        } else {
          attempt.result = {
            success: false,
            error: permanentResult.error || 'Permanent deletion failed; the file was preserved.',
          };
        }
      }
    }

    return attempts.map((attempt) => attempt.result);
  }

  /**
   * Delete file to trash/recycle bin
   */
  static async deleteFile(image: IndexedImage): Promise<FileOperationsResult> {
    try {
      return (await FileOperations.deleteFiles([image]))[0];
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

        const originalRelativePath = getRelativeImagePath(image);
        const originalNameParts = originalRelativePath.split('/');
        const originalFilename = originalNameParts[originalNameParts.length - 1];
        const originalExtension = originalFilename.includes('.') ? originalFilename.split('.').pop() : '';

        if (originalExtension && !newName.toLowerCase().endsWith(`.${originalExtension}`)) {
          newName += `.${originalExtension}`;
        }

        const pathParts = originalRelativePath.split('/');
        pathParts.pop(); // remove old filename
        const newRelativePath = [...pathParts, newName].join('/');

        const oldPathResult = await window.electronAPI.joinPaths(image.directoryId, originalRelativePath);
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
    const nameWithoutExt = filename.replace(SUPPORTED_MEDIA_EXTENSION_REGEX, '');
    
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
