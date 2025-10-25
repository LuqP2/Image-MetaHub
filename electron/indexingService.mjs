import fs from 'fs/promises';
import path from 'path';
import { databaseService } from './databaseService.js';
import { mainWindow } from '../electron.mjs';
import { parseFile } from '../services/fileParser.js';

const BATCH_SIZE = 100;

// --- File Scanner ---
async function getFilesRecursively(directory, baseDirectory) {
  const files = [];
  try {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        files.push(...await getFilesRecursively(fullPath, baseDirectory));
      } else if (entry.isFile()) {
        const lowerName = entry.name.toLowerCase();
        if (lowerName.endsWith('.png') || lowerName.endsWith('.jpg') || lowerName.endsWith('.jpeg')) {
          const stats = await fs.stat(fullPath);
          files.push({
            path: fullPath,
            relativePath: path.relative(baseDirectory, fullPath),
            lastModified: stats.mtimeMs,
          });
        }
      }
    }
  } catch (error) {
    console.warn(`Could not read directory ${directory}: ${error.message}`);
  }
  return files;
}

// --- Indexing Logic ---
async function startIndexing(directoryPath) {
  console.log(`Starting indexing for: ${directoryPath}`);
  mainWindow.webContents.send('indexing-progress', { current: 0, total: 1, status: 'Starting...' });

  // 1. Add directory to DB and get its ID
  const directory = databaseService.addDirectory(directoryPath);

  // 2. Scan for files
  const files = await getFilesRecursively(directoryPath, directoryPath);
  mainWindow.webContents.send('indexing-progress', { current: 0, total: files.length, status: 'Scanning files...' });

  // 3. Process files in batches
  for (let i = 0; i < files.length; i += BATCH_SIZE) {
    const batch = files.slice(i, i + BATCH_SIZE);
    const processedBatch = await Promise.all(
      batch.map(async (file) => {
        const fileData = await fs.readFile(file.path);
        const metadata = await parseFile(fileData, file.relativePath);
        return {
          id: `${directory.id}::${file.relativePath}`,
          directoryId: directory.id,
          relativePath: file.relativePath,
          lastModified: file.lastModified,
          metadataString: metadata.metadataString,
        };
      })
    );

    // 4. Save metadata to the database
    databaseService.upsertImages(processedBatch);

    // 5. Send progress and batch results to the renderer
    mainWindow.webContents.send('indexing-progress', { current: i + batch.length, total: files.length, status: 'Indexing...' });
    mainWindow.webContents.send('indexing-batch-result', { batch: processedBatch });
  }

  console.log(`Finished indexing for: ${directoryPath}. Found ${files.length} files.`);
  mainWindow.webContents.send('indexing-complete', { directoryId: directory.id });
}

// --- Service Setup ---
function setupIndexingService() {
  return {
    startIndexing,
  };
}

export const indexingService = setupIndexingService();
