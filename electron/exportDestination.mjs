import path from 'node:path';
import fs from 'node:fs/promises';

/** Existing aliases and hard links must never turn an export into an in-place edit. */
export async function assertDistinctExportFile(sourcePath, destinationPath) {
  let destinationStat;
  try {
    destinationStat = await fs.stat(destinationPath, { bigint: true });
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }
  const sourceStat = await fs.stat(sourcePath, { bigint: true });
  if (sourceStat.ino !== 0n && sourceStat.dev === destinationStat.dev && sourceStat.ino === destinationStat.ino) {
    throw new Error('Choose a destination other than the original file.');
  }
  // Some filesystems do not supply a useful inode. Canonical paths still catch
  // symbolic-link aliases there; stat identity also covers case-insensitive macOS.
  const [sourceRealPath, destinationRealPath] = await Promise.all([
    fs.realpath(sourcePath), fs.realpath(destinationPath),
  ]);
  if (sourceRealPath === destinationRealPath || (process.platform === 'win32' && sourceRealPath.toLowerCase() === destinationRealPath.toLowerCase())) {
    throw new Error('Choose a destination other than the original file.');
  }
}

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
