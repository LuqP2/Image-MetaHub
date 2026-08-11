const getErrorMessage = (error) => error?.message || String(error || 'Unknown error');

const lstatIfPresent = async (fsApi, filePath) => {
  try {
    return await fsApi.lstat(filePath);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
};

const isSameFile = (left, right) => left.dev === right.dev && left.ino === right.ino;

export const getModel3DSidecarPathIfPresent = async (fsApi, modelPath) => {
  const sidecarPath = `${modelPath}.imagemetahub.json`;
  const stats = await lstatIfPresent(fsApi, sidecarPath);
  return stats?.isFile?.() === false ? null : stats ? sidecarPath : null;
};

const transferPath = async (fsApi, sourcePath, destinationPath, mode) => {
  if (mode === 'move') {
    try {
      await fsApi.rename(sourcePath, destinationPath);
    } catch (error) {
      if (error?.code !== 'EXDEV') throw error;
      await fsApi.copyFile(sourcePath, destinationPath);
      await fsApi.unlink(sourcePath);
    }
    return;
  }

  await fsApi.copyFile(sourcePath, destinationPath);
};

const removeIfPresent = async (fsApi, filePath) => {
  try {
    await fsApi.unlink(filePath);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
};

export const trashModel3DWithSidecar = async (fsApi, trashItem, modelPath) => {
  const sidecarPath = await getModel3DSidecarPathIfPresent(fsApi, modelPath);
  await trashItem(modelPath);
  if (!sidecarPath) return;

  try {
    await trashItem(sidecarPath);
  } catch (sidecarError) {
    try {
      await removeIfPresent(fsApi, sidecarPath);
    } catch (cleanupError) {
      throw new Error(
        `The model was moved to trash, but its metadata sidecar could not be trashed or removed (${getErrorMessage(cleanupError)}).`,
      );
    }
    throw new Error(
      `The model was moved to trash, but its metadata sidecar could not be moved to trash and was permanently removed (${getErrorMessage(sidecarError)}).`,
    );
  }
};

export const writeModel3DExportWithSidecar = async (fsApi, destinationPath, modelData, sourceSidecarPath) => {
  const destinationSidecarPath = `${destinationPath}.imagemetahub.json`;
  let sidecarCopyStarted = false;
  try {
    await fsApi.writeFile(destinationPath, modelData);
    if (sourceSidecarPath) {
      sidecarCopyStarted = true;
      await fsApi.copyFile(sourceSidecarPath, destinationSidecarPath);
    }
  } catch (exportError) {
    const cleanupErrors = [];
    const cleanupPaths = sidecarCopyStarted
      ? [destinationSidecarPath, destinationPath]
      : [destinationPath];
    for (const cleanupPath of cleanupPaths) {
      try {
        await removeIfPresent(fsApi, cleanupPath);
      } catch (cleanupError) {
        cleanupErrors.push(getErrorMessage(cleanupError));
      }
    }
    if (cleanupErrors.length > 0) {
      throw new Error(
        `Could not export the model (${getErrorMessage(exportError)}), and incomplete output cleanup failed (${cleanupErrors.join('; ')}).`,
      );
    }
    throw new Error(`Could not export the model and metadata sidecar; incomplete output was removed (${getErrorMessage(exportError)}).`);
  }
};

export const transferModel3DWithSidecar = async (fsApi, sourcePath, destinationPath, mode) => {
  const sourceSidecarPath = await getModel3DSidecarPathIfPresent(fsApi, sourcePath);
  if (!sourceSidecarPath) {
    await transferPath(fsApi, sourcePath, destinationPath, mode);
    return;
  }

  const destinationSidecarPath = `${destinationPath}.imagemetahub.json`;
  const destinationSidecarStats = await lstatIfPresent(fsApi, destinationSidecarPath);
  if (destinationSidecarStats) {
    throw new Error('A metadata sidecar already exists at the destination.');
  }

  await transferPath(fsApi, sourcePath, destinationPath, mode);
  try {
    await transferPath(fsApi, sourceSidecarPath, destinationSidecarPath, mode);
  } catch (sidecarError) {
    let cleanupError = null;
    try {
      await removeIfPresent(fsApi, destinationSidecarPath);
    } catch (error) {
      cleanupError = error;
    }

    try {
      if (mode === 'move') {
        await transferPath(fsApi, destinationPath, sourcePath, 'move');
      } else {
        await removeIfPresent(fsApi, destinationPath);
      }
    } catch (rollbackError) {
      throw new Error(
        `Could not transfer the metadata sidecar (${getErrorMessage(sidecarError)}), and the model transfer could not be rolled back (${getErrorMessage(rollbackError)}).`,
      );
    }

    if (cleanupError) {
      throw new Error(
        `Could not transfer the metadata sidecar; the model transfer was rolled back, but the incomplete destination sidecar could not be removed (${getErrorMessage(cleanupError)}).`,
      );
    }

    throw new Error(`Could not transfer the metadata sidecar; the model transfer was rolled back (${getErrorMessage(sidecarError)}).`);
  }
};

export const renameModel3DWithSidecar = async (fsApi, oldPath, newPath) => {
  const oldSidecarPath = `${oldPath}.imagemetahub.json`;
  const newSidecarPath = `${newPath}.imagemetahub.json`;
  const oldSidecarStats = await lstatIfPresent(fsApi, oldSidecarPath);

  if (!oldSidecarStats) {
    await fsApi.rename(oldPath, newPath);
    return;
  }

  const newSidecarStats = await lstatIfPresent(fsApi, newSidecarPath);
  if (newSidecarStats && !isSameFile(oldSidecarStats, newSidecarStats)) {
    throw new Error('A metadata sidecar with that name already exists.');
  }

  await fsApi.rename(oldPath, newPath);
  try {
    await fsApi.rename(oldSidecarPath, newSidecarPath);
  } catch (sidecarError) {
    try {
      await fsApi.rename(newPath, oldPath);
    } catch (rollbackError) {
      throw new Error(
        `Could not rename the metadata sidecar (${getErrorMessage(sidecarError)}), and the model rename could not be rolled back (${getErrorMessage(rollbackError)}).`,
      );
    }

    throw new Error(`Could not rename the metadata sidecar; the model rename was rolled back (${getErrorMessage(sidecarError)}).`);
  }
};
