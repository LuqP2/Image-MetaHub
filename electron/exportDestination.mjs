import path from 'node:path';

/** Resolve the explicit single-file target without changing batch naming. */
export function resolveExportDestination({ files, destDir, destFilePath }) {
  if (destFilePath !== undefined) {
    if (files.length !== 1 || typeof destFilePath !== 'string' || !path.isAbsolute(destFilePath)) {
      throw new Error('A single-file export requires one file and an absolute destination path.');
    }
    const filePath = path.resolve(destFilePath);
    if (!path.extname(filePath)) throw new Error('Include the file extension in the destination path.');
    const sourcePath = path.resolve(files[0].directoryPath, files[0].relativePath);
    if (filePath === sourcePath || (process.platform === 'win32' && filePath.toLowerCase() === sourcePath.toLowerCase())) {
      throw new Error('Choose a destination other than the original file.');
    }
    return { directory: path.dirname(filePath), filePath };
  }
  if (typeof destDir !== 'string' || !path.isAbsolute(destDir)) {
    throw new Error('Choose an absolute destination folder.');
  }
  return { directory: path.resolve(destDir), filePath: null };
}

export function validateExportExtension(destination, artifactName) {
  if (path.extname(destination).toLowerCase() !== path.extname(artifactName).toLowerCase()) {
    throw new Error(`The destination extension must be ${path.extname(artifactName)}.`);
  }
}
