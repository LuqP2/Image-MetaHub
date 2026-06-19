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
  while (isDirectoryActive(directoryId)) {
    const settled = await new Promise<boolean>((resolve) => {
      let completed = false;
      let unsubscribe = () => {};

      const finish = (didSettle: boolean) => {
        if (completed) {
          return;
        }
        completed = true;
        clearTimeout(timer);
        unsubscribe();
        resolve(didSettle);
      };

      const timer = setTimeout(() => finish(false), timeoutMs);
      unsubscribe = useImageStore.subscribe(() => {
        if (!isDirectoryActive(directoryId)) {
          finish(true);
        }
      });

      if (!isDirectoryActive(directoryId)) {
        finish(true);
      }
    });

    if (!settled) {
      console.warn(`Directory activity is still running; keeping queued event: ${directoryId}`);
    }
  }
};
