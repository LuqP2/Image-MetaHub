# Cache Retention Manual Test Guide

This guide helps verify that the cache retention fix is working correctly.

## What Was Fixed

### Problem
1. Cache was not being retained between app sessions
2. Refreshing a folder would reindex ALL images instead of only new/modified ones
3. For users with 100k+ images, this caused significant performance issues

### Solution
1. **Consistent Cache DB Name**: The cache now uses a consistent database name across sessions:
   - Default: `invokeai-browser-cache` (when no custom cache path is set)
   - Custom: `image-metahub-cache-{sanitized_path}` (when custom cache path is configured)

2. **basePath Tracking**: The cache manager now tracks which basePath was used for initialization and properly reinitializes if it changes.

3. **Consistent Initialization**: All cache initialization calls now use the same cachePath from settings, ensuring consistency.

## Manual Testing Steps

### Test 1: Cache Persistence Between Sessions

1. **Start the app** and select a folder with images
2. **Wait for indexing** to complete (you'll see progress indicator)
3. **Note the time** it took to index
4. **Close the app** completely
5. **Restart the app**
6. **Observe**: The app should show images immediately without reindexing
   - ✅ **Expected**: Images appear instantly from cache
   - ❌ **Before fix**: Would reindex all images again

**Verification in Console:**
```
🔧 Initializing cache with basePath: "undefined" -> DB name: "invokeai-browser-cache"
✅ IndexedDB initialized successfully: invokeai-browser-cache
✅ CACHE FOUND for "YourFolderName". Analyzing diff...
   - 0 new or modified files to process.
   - 0 deleted files to remove.
   - 1234 images restored from cache.
```

### Test 2: Incremental Refresh (Only New Images)

1. **Load a folder** with some images (e.g., 100 images)
2. **Wait for indexing** to complete
3. **Add a few new images** to the folder (e.g., 5 new images)
4. **Click the refresh button** (⟳) next to the folder name
5. **Observe the progress indicator**:
   - ✅ **Expected**: Shows "Processing 5 of 5" (only new images)
   - ❌ **Before fix**: Would show "Processing 105 of 105" (all images)

**Verification in Console:**
```
✅ CACHE FOUND for "YourFolderName". Analyzing diff...
   - 5 new or modified files to process.
   - 0 deleted files to remove.
   - 100 images restored from cache.
```

### Test 3: Modified Image Detection

1. **Load a folder** with images
2. **Wait for indexing** to complete
3. **Modify one image file** (e.g., open in image editor and save, which updates lastModified timestamp)
4. **Click the refresh button**
5. **Observe**:
   - ✅ **Expected**: Only the modified image is reprocessed
   - The console should show "1 new or modified files to process"

### Test 4: Deleted Image Detection

1. **Load a folder** with images
2. **Wait for indexing** to complete
3. **Delete a few images** from the folder
4. **Click the refresh button**
5. **Observe**:
   - ✅ **Expected**: Deleted images disappear from the UI
   - Console shows "X deleted files to remove"

### Test 5: Custom Cache Path

1. **Open Settings** (gear icon)
2. **Set a custom cache location** (e.g., a specific folder path)
3. **Reload the app**
4. **Select a folder** and index images
5. **Close and restart the app**
6. **Observe**: Cache should still work with the custom location

**Verification in Console:**
```
🔧 Initializing cache with basePath: "/your/custom/path" -> DB name: "image-metahub-cache-_your_custom_path"
✅ IndexedDB initialized successfully: image-metahub-cache-_your_custom_path
```

## Expected Performance

### Before Fix
- **Initial Index**: 18,000 images in ~3.5 minutes
- **Refresh (all)**: 18,000 images in ~3.5 minutes every time
- **After Restart**: 18,000 images in ~3.5 minutes (no cache retention)

### After Fix
- **Initial Index**: 18,000 images in ~3.5 minutes (same as before)
- **Refresh (no changes)**: Instant (0 files processed, all from cache)
- **Refresh (10 new)**: 10 images in ~2 seconds (only new files processed)
- **After Restart**: Instant (all images loaded from cache)

## Troubleshooting

### Cache Not Working?

1. **Check console logs** for cache initialization messages
2. **Verify basePath consistency**:
   - All `init()` calls should use the same basePath
   - Look for "🔄 Cache basePath changed" messages (should not appear after initial setup)
3. **Check browser/Electron dev tools**:
   - Open IndexedDB inspector
   - Verify `invokeai-browser-cache` database exists
   - Check that it contains cache entries

### Still Reindexing Everything?

1. **Check if scanSubfolders setting changed**:
   - Cache is separate for recursive vs flat scanning
   - Changing this setting will require a full reindex
2. **Verify directory path is the same**:
   - Cache ID is based on directory path
   - Moving or renaming folder requires full reindex
3. **Check for errors** in console logs during cache save

## Implementation Details

### Cache Database Structure
- **Database Name**: `invokeai-browser-cache` or `image-metahub-cache-{sanitized_path}`
- **Version**: 3
- **Object Stores**:
  - `cache`: Stores directory metadata and image information
  - `thumbnails`: Stores thumbnail blobs (separate from main cache)

### Cache Entry ID Format
```
{directoryPath}-{scanSubfolders ? 'recursive' : 'flat'}
```

Example:
- `/home/user/pictures` with recursive scanning: `/home/user/pictures-recursive`
- `/home/user/pictures` without recursive scanning: `/home/user/pictures-flat`

### Cache Validation Logic
The cache compares current files with cached metadata:
1. **New files**: Not in cache → process
2. **Modified files**: `lastModified` timestamp increased → reprocess
3. **Unchanged files**: Same `lastModified` → load from cache
4. **Deleted files**: In cache but not in filesystem → remove from UI

## Success Criteria

✅ **Cache retention is working** if:
1. Images appear instantly after app restart (no progress bar)
2. Refresh only processes new/modified files (not all files)
3. Console shows "images restored from cache"
4. Large collections (100k+ images) can be refreshed in seconds

✅ **Incremental refresh is working** if:
1. Adding 10 images to 10,000 only processes 10 images
2. Console shows correct count of new/modified files
3. No "full refresh" messages appear on refresh
