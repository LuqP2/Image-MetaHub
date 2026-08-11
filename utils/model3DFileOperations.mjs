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
