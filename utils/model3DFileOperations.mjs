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
      try {
        await fsApi.unlink(sourcePath);
      } catch (unlinkError) {
        try {
          await removeIfPresent(fsApi, destinationPath);
        } catch (cleanupError) {
          throw new Error(
            `Could not remove the source after a cross-volume copy (${getErrorMessage(unlinkError)}), and the destination copy could not be removed (${getErrorMessage(cleanupError)}).`,
          );
        }
        throw unlinkError;
      }
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

const createExportStagingPath = (destinationPath, label) =>
  `${destinationPath}.imagemetahub-${label}-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.tmp`;

export const trashModel3DWithSidecar = async (fsApi, trashItem, modelPath) => {
  const sidecarPath = await getModel3DSidecarPathIfPresent(fsApi, modelPath);
  try {
    await trashItem(modelPath);
  } catch (error) {
    throw Object.assign(new Error(getErrorMessage(error)), {
      remainingPaths: [modelPath, ...(sidecarPath ? [sidecarPath] : [])],
      primaryDeleted: false,
      trashAttempted: true,
    });
  }
  if (!sidecarPath) return;

  try {
    await trashItem(sidecarPath);
  } catch (sidecarError) {
    throw Object.assign(
      new Error(`The model was moved to trash, but its metadata sidecar could not be moved (${getErrorMessage(sidecarError)}).`),
      { remainingPaths: [sidecarPath], primaryDeleted: true, trashAttempted: true },
    );
  }
};

const writeModel3DExportPair = async (fsApi, destinationPath, modelData, writeSidecar) => {
  const destinationSidecarPath = `${destinationPath}.imagemetahub.json`;
  const stagedModelPath = createExportStagingPath(destinationPath, 'model');
  const stagedSidecarPath = createExportStagingPath(destinationSidecarPath, 'sidecar');
  const backupModelPath = createExportStagingPath(destinationPath, 'backup');
  const backupSidecarPath = createExportStagingPath(destinationSidecarPath, 'backup');
  let modelBackedUp = false;
  let sidecarBackedUp = false;
  let modelPromoted = false;
  let sidecarPromoted = false;

  try {
    await fsApi.writeFile(stagedModelPath, modelData);
    if (writeSidecar) {
      await writeSidecar(stagedSidecarPath);
    }

    const destinationStats = await lstatIfPresent(fsApi, destinationPath);
    const destinationSidecarStats = await lstatIfPresent(fsApi, destinationSidecarPath);
    if (destinationStats) {
      await fsApi.rename(destinationPath, backupModelPath);
      modelBackedUp = true;
    }
    if (destinationSidecarStats) {
      await fsApi.rename(destinationSidecarPath, backupSidecarPath);
      sidecarBackedUp = true;
    }

    await fsApi.rename(stagedModelPath, destinationPath);
    modelPromoted = true;
    if (writeSidecar) {
      await fsApi.rename(stagedSidecarPath, destinationSidecarPath);
      sidecarPromoted = true;
    }
  } catch (exportError) {
    const recoveryErrors = [];
    for (const cleanupPath of [
      ...(sidecarPromoted ? [destinationSidecarPath] : []),
      ...(modelPromoted ? [destinationPath] : []),
      stagedSidecarPath,
      stagedModelPath,
    ]) {
      try {
        await removeIfPresent(fsApi, cleanupPath);
      } catch (cleanupError) {
        recoveryErrors.push(getErrorMessage(cleanupError));
      }
    }

    for (const [wasBackedUp, backupPath, originalPath] of [
      [sidecarBackedUp, backupSidecarPath, destinationSidecarPath],
      [modelBackedUp, backupModelPath, destinationPath],
    ]) {
      if (!wasBackedUp) continue;
      try {
        await fsApi.rename(backupPath, originalPath);
      } catch (restoreError) {
        recoveryErrors.push(getErrorMessage(restoreError));
      }
    }

    if (recoveryErrors.length > 0) {
      throw new Error(
        `Could not export the model (${getErrorMessage(exportError)}), and existing output recovery failed (${recoveryErrors.join('; ')}).`,
      );
    }
    const recoveryMessage = modelBackedUp || sidecarBackedUp
      ? 'existing output was restored'
      : 'incomplete output was removed';
    throw new Error(`Could not export the model and metadata sidecar; ${recoveryMessage} (${getErrorMessage(exportError)}).`);
  }

  for (const backupPath of [
    ...(sidecarBackedUp ? [backupSidecarPath] : []),
    ...(modelBackedUp ? [backupModelPath] : []),
  ]) {
    try {
      await removeIfPresent(fsApi, backupPath);
    } catch (cleanupError) {
      console.warn('[model3d] Could not remove replaced export backup:', getErrorMessage(cleanupError));
    }
  }
};

export const writeModel3DExportWithSidecar = async (fsApi, destinationPath, modelData, sourceSidecarPath) =>
  writeModel3DExportPair(
    fsApi,
    destinationPath,
    modelData,
    sourceSidecarPath
      ? (destinationSidecarPath) => fsApi.copyFile(sourceSidecarPath, destinationSidecarPath)
      : null,
  );

export const writeModel3DExportDataWithSidecar = async (fsApi, destinationPath, modelData, sidecarData) =>
  writeModel3DExportPair(
    fsApi,
    destinationPath,
    modelData,
    sidecarData
      ? (destinationSidecarPath) => fsApi.writeFile(destinationSidecarPath, sidecarData)
      : null,
  );

export const transferModel3DWithSidecar = async (fsApi, sourcePath, destinationPath, mode) => {
  const sourceSidecarPath = await getModel3DSidecarPathIfPresent(fsApi, sourcePath);
  const destinationSidecarPath = `${destinationPath}.imagemetahub.json`;
  const destinationSidecarStats = await lstatIfPresent(fsApi, destinationSidecarPath);
  if (destinationSidecarStats) {
    throw new Error('A metadata sidecar already exists at the destination.');
  }
  if (!sourceSidecarPath) {
    await transferPath(fsApi, sourcePath, destinationPath, mode);
    return;
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
  const newSidecarStats = await lstatIfPresent(fsApi, newSidecarPath);

  if (newSidecarStats && (!oldSidecarStats || !isSameFile(oldSidecarStats, newSidecarStats))) {
    throw new Error('A metadata sidecar with that name already exists.');
  }

  if (!oldSidecarStats) {
    await fsApi.rename(oldPath, newPath);
    return;
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
