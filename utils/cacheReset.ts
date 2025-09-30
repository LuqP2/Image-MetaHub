/**
 * Complete Cache Reset Utility for Image MetaHub
 * Use this to clear ALL caches and data when testing new versions
 */

/// <reference lib="dom" />

export async function resetAllCaches(): Promise<void> {
  console.log('🧹 Starting complete cache reset...');

  try {
    // 1. Clear IndexedDB cache
    console.log('📦 Clearing IndexedDB cache...');
    const dbName = 'invokeai-browser-cache';
    const deleteRequest = indexedDB.deleteDatabase(dbName);

    await new Promise<void>((resolve, reject) => {
      deleteRequest.onsuccess = () => {
        console.log('✅ IndexedDB cache cleared');
        resolve();
      };
      deleteRequest.onerror = () => {
        console.error('❌ Failed to clear IndexedDB:', deleteRequest.error);
        reject(deleteRequest.error);
      };
    });

  } catch (error) {
    console.error('❌ Error clearing IndexedDB:', error);
  }

  try {
    // 2. Clear localStorage items
    console.log('💾 Clearing localStorage...');
    const keysToRemove = [
      'image-metahub-sort-order',
      'image-metahub-items-per-page',
      'image-metahub-electron-directory-path',
      'image-metahub-directory-name',
      'invokeai-advanced-expanded'
    ];

    keysToRemove.forEach(key => {
      if (localStorage.getItem(key)) {
        localStorage.removeItem(key);
        console.log(`🗑️ Removed localStorage key: ${key}`);
      }
    });

    console.log('✅ localStorage cleared');

  } catch (error) {
    console.error('❌ Error clearing localStorage:', error);
  }

  try {
    // 3. Clear sessionStorage if any
    console.log('🔄 Clearing sessionStorage...');
    sessionStorage.clear();
    console.log('✅ sessionStorage cleared');

  } catch (error) {
    console.error('❌ Error clearing sessionStorage:', error);
  }

  console.log('🎉 All caches cleared successfully!');
  console.log('🔄 Please refresh the page to start fresh.');
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