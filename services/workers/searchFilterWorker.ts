import type { LibraryQueryImage as SearchWorkerImage, LibraryWorkerCriteria as SearchWorkerCriteria } from '../libraryQuery/types';
import { executeWorkerQuery } from '../libraryQuery/execute';

type WorkerMessage =
  | {
      type: 'syncDataset';
      payload: {
        datasetVersion: number;
        images: SearchWorkerImage[];
      };
    }
  | {
      type: 'compute';
      payload: {
        criteriaKey: string;
        datasetVersion: number;
        criteria: SearchWorkerCriteria;
      };
    };

type WorkerResponse =
  | {
      type: 'complete';
      payload: {
        criteriaKey: string;
        filteredIds: string[];
        facets: {
          availableModels: string[];
          availableLoras: string[];
          availableSamplers: string[];
          availableSchedulers: string[];
          availableGenerators: string[];
          availableGpuDevices: string[];
          availableDimensions: string[];
          modelFacetCounts: Array<[string, number]>;
          loraFacetCounts: Array<[string, number]>;
          samplerFacetCounts: Array<[string, number]>;
          schedulerFacetCounts: Array<[string, number]>;
        };
      };
    }
  | {
      type: 'error';
      payload: {
        error: string;
      };
    };

type CompletePayload = Extract<WorkerResponse, { type: 'complete' }>['payload'];

let datasetVersion = -1;
let workerImages: SearchWorkerImage[] = [];

self.onmessage = (event: MessageEvent<WorkerMessage>) => {
  const message = event.data;

  try {
    if (message.type === 'syncDataset') {
      workerImages = message.payload.images;
      datasetVersion = message.payload.datasetVersion;
      return;
    }

    if (message.type === 'compute') {
      if (message.payload.datasetVersion !== datasetVersion) {
        postError('Search dataset is out of sync.');
        return;
      }

      postComplete(message.payload.criteriaKey, executeWorkerQuery(workerImages, message.payload.criteria));
    }
  } catch (error) {
    postError(error instanceof Error ? error.message : String(error));
  }
};

function postComplete(
  criteriaKey: string,
  payload: Omit<CompletePayload, 'criteriaKey'>
): void {
  const response: WorkerResponse = {
    type: 'complete',
    payload: {
      ...payload,
      criteriaKey,
    },
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
