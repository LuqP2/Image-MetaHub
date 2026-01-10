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

let isCancelled = false;

self.onmessage = async (e: MessageEvent<WorkerMessage>) => {
  const { type, payload } = e.data;

  switch (type) {
    case 'start':
      await startAutoTagging(payload.images, {
        topN: payload.topN,
        minScore: payload.minScore,
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

export type { WorkerMessage, WorkerResponse };
