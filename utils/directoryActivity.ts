import { useImageStore } from '../store/useImageStore';

const isDirectoryActive = (directoryId: string): boolean => {
  const state = useImageStore.getState();
  return Boolean(state.directoryProgress[directoryId]) ||
    state.refreshingDirectories.has(directoryId);
};

export const waitForDirectoryActivityToSettle = async (
  directoryId: string,
  timeoutMs = 10_000,
): Promise<void> => {
  if (!isDirectoryActive(directoryId)) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    let unsubscribe = () => {};

    const finish = (error?: Error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      unsubscribe();
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    };

    const timer = setTimeout(() => {
      finish(new Error(`Timed out waiting for directory activity to finish: ${directoryId}`));
    }, timeoutMs);

    unsubscribe = useImageStore.subscribe(() => {
      if (!isDirectoryActive(directoryId)) {
        finish();
      }
    });

    if (!isDirectoryActive(directoryId)) {
      finish();
    }
  });
};
