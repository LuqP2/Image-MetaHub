/**
 * Complete Cache Reset Utility for Image MetaHub
 * Use this to clear ALL caches and data when testing new versions
 */

/// <reference lib="dom" />

import { useImageStore } from '../store/useImageStore';
import { useSettingsStore } from '../store/useSettingsStore';

export async function resetAllCaches(): Promise<void> {
  console.log('🧹 Starting complete cache reset...');

  let needsRestart = false;

  try {
    // 1. Delete all cache files/folders from AppData/Roaming
    console.log('📁 Deleting cache files from AppData/Roaming...');

    if (window.electronAPI) {
      try {
        const deleteResult = await window.electronAPI.deleteCacheFolder();
        if (deleteResult?.success) {
          console.log('✅ Cache files deleted successfully');
          needsRestart = deleteResult.needsRestart || false;
        } else {
          console.warn('⚠️ Could not delete cache folder:', deleteResult?.error);
        }
      } catch (error) {
        console.error('❌ Error deleting cache folder:', error);
      }
    } else {
      console.warn('⚠️ Electron API not available - skipping folder deletion');
    }

  } catch (error) {
    console.error('❌ Error clearing disk-based caches:', error);
  }

  try {
    // 2. Clear ALL IndexedDB databases (legacy/fallback)
    console.log('📦 Clearing ALL IndexedDB databases...');
    
    // Get all database names
    const databases = await indexedDB.databases();
    console.log(`Found ${databases.length} IndexedDB databases to delete`);
    
    // Delete each database
    for (const db of databases) {
      if (db.name) {
        console.log(`🗑️ Deleting database: ${db.name}`);
        const deleteRequest = indexedDB.deleteDatabase(db.name);
        
        await new Promise<void>((resolve, reject) => {
          deleteRequest.onsuccess = () => {
            console.log(`✅ Deleted database: ${db.name}`);
            resolve();
          };
          deleteRequest.onerror = () => {
            console.error(`❌ Failed to delete database ${db.name}:`, deleteRequest.error);
            reject(deleteRequest.error);
          };
          deleteRequest.onblocked = () => {
            console.warn(`⚠️ Delete blocked for database ${db.name}, retrying...`);
            // Continue anyway
            resolve();
          };
        });
      }
    }

  } catch (error) {
    console.error('❌ Error clearing IndexedDB:', error);
  }

  try {
    // 3. Clear localStorage items
    console.log('💾 Clearing localStorage...');
    const keysToRemove = [
      'image-metahub-sort-order',
      'image-metahub-items-per-page',
      'image-metahub-electron-directory-path',
      'image-metahub-directory-name',
      'image-metahub-directories', // CRITICAL: List of loaded directories (Electron)
      'image-metahub-settings', // Zustand persist storage
      'image-metahub-scan-subfolders',
      'invokeai-advanced-expanded'
    ];

    keysToRemove.forEach(key => {
      if (localStorage.getItem(key)) {
        localStorage.removeItem(key);
        console.log(`🗑️ Removed localStorage key: ${key}`);
      }
    });

    // Also clear any keys that match patterns (for dynamic directory caches)
    const allKeys = Object.keys(localStorage);
    allKeys.forEach(key => {
      if (key.startsWith('image-metahub-') || key.startsWith('invokeai-')) {
        localStorage.removeItem(key);
        console.log(`🗑️ Removed localStorage key (pattern match): ${key}`);
      }
    });

    console.log('✅ localStorage cleared');

  } catch (error) {
    console.error('❌ Error clearing localStorage:', error);
  }

  try {
    // 4. Clear sessionStorage if any
    console.log('🔄 Clearing sessionStorage...');
    sessionStorage.clear();
    console.log('✅ sessionStorage cleared');

  } catch (error) {
    console.error('❌ Error clearing sessionStorage:', error);
  }

  try {
    // 5. Reset Zustand stores
    console.log('🔄 Resetting application state...');

    // Reset ImageStore (images, directories, filters, etc.)
    useImageStore.getState().resetState();
    console.log('✅ Image store reset');

    // Reset SettingsStore (preferences, cache path, auto-update)
    useSettingsStore.getState().resetState();
    console.log('✅ Settings store reset');

  } catch (error) {
    console.error('❌ Error resetting stores:', error);
  }

  try {
    // 6. Clear Zustand persistence (the stored state data)
    console.log('💾 Clearing Zustand persistence...');

    // Get persistence storage keys and clear them
    const storageName1 = 'image-metahub-settings';
    const storageName2 = 'invokeai-image-store';

    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(storageName1);
      localStorage.removeItem(storageName2);
      console.log('✅ Zustand persistence cleared from localStorage');
    }

    // Also clear through Electron API if available
    if (window.electronAPI) {
      try {
        await window.electronAPI.saveSettings({});
        console.log('✅ Electron settings cleared');
      } catch (err) {
        console.warn('⚠️ Could not clear Electron settings:', err);
      }
    }

  } catch (error) {
    console.error('❌ Error clearing Zustand persistence:', error);
  }

  console.log('🎉 All caches and app state cleared successfully!');
  console.log('🔄 App will reload to complete the reset.');

  // After all clearing operations, reload the app
  if (needsRestart) {
    console.log('🔄 Restarting application in 500ms...');
    setTimeout(() => {
      window.location.reload();
    }, 500);
  }
}

/**
 * Nuclear option: Complete fresh start
 * This clears everything and forces a page reload
 */
export async function completeFreshStart(): Promise<void> {
  console.log('💥 COMPLETE FRESH START - Nuclear Option');
  console.log('======================================');

  // Clear all caches first
  await resetAllCaches();

  // Clear any remaining browser storage
  try {
    console.log('🗑️ Clearing all browser storage...');
    if ('serviceWorker' in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      for (const registration of registrations) {
        await registration.unregister();
      }
    }

    // Clear caches API if available
    if ('caches' in window) {
      const cacheNames = await caches.keys();
      await Promise.all(
        cacheNames.map(cacheName => caches.delete(cacheName))
      );
    }

    console.log('✅ Browser storage cleared');
  } catch (error) {
    console.error('❌ Error clearing browser storage:', error);
  }

  // Force reload after a short delay
  console.log('🔄 Reloading page in 2 seconds...');
  setTimeout(() => {
    window.location.reload();
  }, 2000);
}

// Auto-run if this script is executed directly (for console usage)
if (typeof window !== 'undefined' && window.location) {
  // Make functions available globally for console usage
  (window as any).resetAllCaches = resetAllCaches;
  (window as any).completeFreshStart = completeFreshStart;

  console.log('💡 Cache reset utilities loaded!');
  console.log('   • Run resetAllCaches() to clear app caches');
  console.log('   • Run completeFreshStart() for nuclear reset + reload');
}