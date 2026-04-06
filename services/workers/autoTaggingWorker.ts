/**
 * Auto-Tagging Web Worker
 *
 * Builds a TF-IDF model and extracts auto-tags in the background.
 */

import type { AutoTag, TFIDFModel } from '../../types';
import { buildTFIDFModel, extractAutoTags } from '../autoTaggingEngine';
import type { TaggingImage } from '../autoTaggingEngine';

type WorkerMessage =
  | {
      type: 'start';
      payload: {
        images: TaggingImage[];
        topN?: number;
        minScore?: number;
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
        autoTags: Record<string, AutoTag[]>;
        tfidfModel: TFIDFModel;
      };
    }
  | {
      type: 'error';
      payload: {
        error: string;
      };
    };

const MAX_AUTO_TAG_IMAGES = 50000;
const MAX_TOP_N = 50;

let isCancelled = false;

self.onmessage = async (e: MessageEvent<WorkerMessage>) => {
  const message = e.data;

  switch (message.type) {
    case 'start':
      await startAutoTagging(message.payload.images, {
        topN: sanitizeTopN(message.payload.topN),
        minScore: sanitizeMinScore(message.payload.minScore),
      });
      break;
    case 'cancel':
      isCancelled = true;
      postProgress(0, 0, 'Cancelled');
      break;
  }
};

async function startAutoTagging(
  images: TaggingImage[],
  options: { topN?: number; minScore?: number }
): Promise<void> {
  try {
    if (!Array.isArray(images)) {
      postError('Invalid auto-tagging payload: images must be an array.');
      return;
    }
    if (images.length > MAX_AUTO_TAG_IMAGES) {
      postError(`Auto-tagging payload too large: received ${images.length} images (max ${MAX_AUTO_TAG_IMAGES}).`);
      return;
    }

    isCancelled = false;
    postProgress(0, images.length, 'Building TF-IDF model...');

    const tfidfModel = buildTFIDFModel(images);
    if (isCancelled) {
      postProgress(0, 0, 'Cancelled');
      return;
    }

    const autoTags: Record<string, AutoTag[]> = {};
    const total = images.length;
    const progressIntervalMs = 200;
    let lastProgress = performance.now();

    for (let i = 0; i < images.length; i += 1) {
      if (isCancelled) {
        postProgress(0, 0, 'Cancelled');
        return;
      }

      const image = images[i];
      autoTags[image.id] = extractAutoTags(image, tfidfModel, options);

      const now = performance.now();
      if (now - lastProgress >= progressIntervalMs || i === images.length - 1) {
        postProgress(i + 1, total, 'Generating auto-tags...');
        lastProgress = now;
      }
    }

    postComplete(autoTags, tfidfModel);
  } catch (error) {
    console.error('Auto-tagging worker error:', error);
    postError(error instanceof Error ? error.message : String(error));
  }
}

function postProgress(current: number, total: number, message: string): void {
  const response: WorkerResponse = {
    type: 'progress',
    payload: { current, total, message },
  };
  self.postMessage(response);
}

function postComplete(autoTags: Record<string, AutoTag[]>, tfidfModel: TFIDFModel): void {
  const response: WorkerResponse = {
    type: 'complete',
    payload: { autoTags, tfidfModel },
  };
  self.postMessage(response);
}

function postError(error: string): void {
  const response: WorkerResponse = {
    type: 'error',
    payload: { error },
  };
  self.postMessage(response);
}

function sanitizeTopN(value: number | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!Number.isFinite(value)) {
    return undefined;
  }

  return Math.max(1, Math.min(MAX_TOP_N, Math.floor(value)));
}

function sanitizeMinScore(value: number | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!Number.isFinite(value)) {
    return undefined;
  }

  return Math.max(0, Math.min(1, value));
}

export type { WorkerMessage, WorkerResponse };
