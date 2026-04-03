import type { LightweightLineageImage, LineageRegistrySnapshot } from '../lineageRegistry';
import { buildLineageRegistrySnapshot } from '../lineageRegistry';

type WorkerMessage =
  | {
      type: 'build';
      payload: {
        images: LightweightLineageImage[];
        librarySignature: string;
      };
    }
  | { type: 'cancel' };

type WorkerResponse =
  | {
      type: 'progress';
      payload: {
        current: number;
        total: number;
        message: string;
      };
    }
  | {
      type: 'complete';
      payload: {
        snapshot: LineageRegistrySnapshot;
      };
    }
  | {
      type: 'error';
      payload: {
        error: string;
      };
    };

let isCancelled = false;

self.onmessage = async (event: MessageEvent<WorkerMessage>) => {
  const message = event.data;

  switch (message.type) {
    case 'build':
      await buildRegistry(message.payload.images, message.payload.librarySignature);
      break;
    case 'cancel':
      isCancelled = true;
      break;
  }
};

const postProgress = (current: number, total: number, message: string): void => {
  const response: WorkerResponse = {
    type: 'progress',
    payload: { current, total, message },
  };

  self.postMessage(response);
};

const postComplete = (snapshot: LineageRegistrySnapshot): void => {
  const response: WorkerResponse = {
    type: 'complete',
    payload: { snapshot },
  };

  self.postMessage(response);
};

const postError = (error: string): void => {
  const response: WorkerResponse = {
    type: 'error',
    payload: { error },
  };

  self.postMessage(response);
};

async function buildRegistry(images: LightweightLineageImage[], librarySignature: string): Promise<void> {
  try {
    isCancelled = false;
    postProgress(0, Math.max(images.length * 2, 1), 'Preparing lineage registry...');

    const snapshot = buildLineageRegistrySnapshot(
      images,
      librarySignature,
      (current, total, message) => {
        if (!isCancelled) {
          postProgress(current, total, message);
        }
      }
    );

    if (isCancelled) {
      return;
    }

    postComplete(snapshot);
  } catch (error) {
    console.error('Lineage worker error:', error);
    postError(error instanceof Error ? error.message : String(error));
  }
}

export type { WorkerMessage, WorkerResponse };
