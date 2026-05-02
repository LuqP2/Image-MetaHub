const fs = require('fs');

let content = fs.readFileSync('services/fileTransferService.ts', 'utf8');

content = content.replace(
  "import { transferImagePersistence } from './imageAnnotationsStorage';",
  "import { bulkTransferImagePersistence } from './imageAnnotationsStorage';"
);

// 1. the 'copy' phase (the loop adding to persistenceTransfers)
const targetPhase1 = `    persistenceTransfers.push({ sourceImageId: sourceImage.id, targetImageId });

    const sourceAnnotation = annotationsMap.get(sourceImage.id);`;

content = content.replace(
  `    persistenceTransfers.push({ sourceImage, targetImageId });
    await transferImagePersistence(sourceImage.id, targetImageId, 'copy');

    const sourceAnnotation = annotationsMap.get(sourceImage.id);`,
  targetPhase1
);

const persistenceTypeDecl = `  const persistenceTransfers: Array<{ sourceImageId: string; targetImageId: string }> = [];`;

content = content.replace(
  `  const persistenceTransfers: Array<{ sourceImage: IndexedImage; targetImageId: string }> = [];`,
  persistenceTypeDecl
);

// Now execute the bulk copy transfer explicitly
const bulkCopyExecute = `  if (persistenceTransfers.length > 0) {
    await bulkTransferImagePersistence(persistenceTransfers, 'copy');
  }`;

content = content.replace(
  `  const transferredEntries = transferredItems.map(buildTransferredEntry);`,
  `${bulkCopyExecute}\n\n  const transferredEntries = transferredItems.map(buildTransferredEntry);`
);

// update phase 2 for 'move' map updates
content = content.replace(
  `  if (mode === 'move') {
    for (const transfer of persistenceTransfers) {
      annotationsMap.delete(transfer.sourceImage.id);
    }
  }`,
  `  if (mode === 'move') {
    for (const transfer of persistenceTransfers) {
      annotationsMap.delete(transfer.sourceImageId);
    }
  }`
);

// 2. update phase 3 - 'move' phase if watchers rely
const targetWatcherMove = `    if (mode === 'move') {
      if (persistenceTransfers.length > 0) {
        await bulkTransferImagePersistence(persistenceTransfers, 'move');
      }
    }`;

content = content.replace(
  `    if (mode === 'move') {
      for (const transfer of persistenceTransfers) {
        await transferImagePersistence(transfer.sourceImage.id, transfer.targetImageId, 'move');
      }
    }`,
  targetWatcherMove
);


// 3. update phase 4 - 'move' phase without watcher (end of file)
const targetEndMove = `  if (mode === 'move') {
    if (persistenceTransfers.length > 0) {
      await bulkTransferImagePersistence(persistenceTransfers, 'move');
    }
    removeImages(images.map((image) => image.id));
  }`;

content = content.replace(
  `  if (mode === 'move') {
    for (const transfer of persistenceTransfers) {
      await transferImagePersistence(transfer.sourceImage.id, transfer.targetImageId, 'move');
    }
    removeImages(images.map((image) => image.id));
  }`,
  targetEndMove
);

fs.writeFileSync('services/fileTransferService.ts', content);
