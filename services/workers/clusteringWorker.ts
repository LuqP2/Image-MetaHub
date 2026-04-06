/**
 * Clustering Web Worker
 *
 * Runs clustering algorithm in background thread to avoid blocking UI
 * Processes images in chunks with progress reporting
 */

import { generateClusters, LightweightImage } from '../clusteringEngine';
import { ImageCluster } from '../../types';

/**
 * Message types sent TO worker
 */
type WorkerMessage =
  | {
      type: 'start';
      payload: {
        images: LightweightImage[];
        threshold: number;
      };
    }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'cancel' };

/**
 * Message types sent FROM worker
 */
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
        clusters: ImageCluster[];
      };
    }
  | {
      type: 'error';
      payload: {
        error: string;
      };
    };

const MAX_CLUSTERING_IMAGES = 50000;

// Worker state
let isPaused = false;
let isCancelled = false;

/**
 * Main worker message handler
 */
self.onmessage = async (e: MessageEvent<WorkerMessage>) => {
  const message = e.data;

  switch (message.type) {
    case 'start':
      await startClustering(message.payload.images, sanitizeThreshold(message.payload.threshold));
      break;

    case 'pause':
      isPaused = true;
      postProgress(0, 0, 'Paused');
      break;

    case 'resume':
      isPaused = false;
      postProgress(0, 0, 'Resumed');
      break;

    case 'cancel':
      isCancelled = true;
      postProgress(0, 0, 'Cancelled');
      break;
  }
};

/**
 * Start clustering process
 */
async function startClustering(
  images: LightweightImage[],
  threshold: number
): Promise<void> {
  try {
    if (!Array.isArray(images)) {
      postError('Invalid clustering payload: images must be an array.');
      return;
    }
    if (images.length > MAX_CLUSTERING_IMAGES) {
      postError(`Clustering payload too large: received ${images.length} images (max ${MAX_CLUSTERING_IMAGES}).`);
      return;
    }

    // Reset state
    isPaused = false;
    isCancelled = false;

    postProgress(0, images.length, 'Starting clustering...');

    // Run clustering (this is CPU-intensive)
    const clusters = await generateClusters(images, {
      threshold,
      onProgress: (progress) => {
        postProgress(progress.current, progress.total, progress.message);
      }
    });

    if (isCancelled) {
      postProgress(0, 0, 'Cancelled');
      return;
    }

    // Send results
    postComplete(clusters);
  } catch (error) {
    console.error('Clustering worker error:', error);
    postError(error instanceof Error ? error.message : String(error));
  }
}

/**
 * Wait for resume if paused
 */
async function waitForResume(): Promise<void> {
  while (isPaused && !isCancelled) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

/**
 * Post progress update
 */
function postProgress(current: number, total: number, message: string): void {
  const response: WorkerResponse = {
    type: 'progress',
    payload: { current, total, message },
  };
  self.postMessage(response);
}

/**
 * Post completion
 */
function postComplete(clusters: ImageCluster[]): void {
  const response: WorkerResponse = {
    type: 'complete',
    payload: { clusters },
  };
  self.postMessage(response);
}

/**
 * Post error
 */
function postError(error: string): void {
  const response: WorkerResponse = {
    type: 'error',
    payload: { error },
  };
  self.postMessage(response);
}

function sanitizeThreshold(value: number): number {
  if (!Number.isFinite(value)) {
    return 0.35;
  }

  return Math.max(0, Math.min(1, value));
}

// Export types for use in main thread
export type { WorkerMessage, WorkerResponse };
