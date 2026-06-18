import { useImageStore } from '../store/useImageStore';

const isDirectoryActive = (directoryId: string): boolean => {
  const state = useImageStore.getState();
  return Boolean(state.directoryProgress[directoryId]) ||
    state.refreshingDirectories.has(directoryId);
};

export const waitForDirectoryActivityToSettle = async (directoryId: string): Promise<void> => {
  if (!isDirectoryActive(directoryId)) {
    return;
  }

  await new Promise<void>((resolve) => {
    const unsubscribe = useImageStore.subscribe(() => {
      if (!isDirectoryActive(directoryId)) {
        unsubscribe();
        resolve();
      }
    });
  });
};
