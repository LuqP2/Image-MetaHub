const errorMessage = (error) => error?.message || String(error || 'Unknown error');

/** Copy a file while retaining the source access/modified timestamps. */
export const copyFilePreservingTimestamps = async (fsApi, sourcePath, destinationPath) => {
  const sourceStats = await fsApi.stat(sourcePath);
  await fsApi.copyFile(sourcePath, destinationPath);
  try {
    await fsApi.utimes(destinationPath, sourceStats.atime, sourceStats.mtime);
  } catch (timestampError) {
    try {
      await fsApi.unlink(destinationPath);
    } catch (cleanupError) {
      throw new Error(
        `Could not preserve copied file timestamps (${errorMessage(timestampError)}), and the destination copy could not be removed (${errorMessage(cleanupError)}).`,
      );
    }
    throw timestampError;
  }
};
