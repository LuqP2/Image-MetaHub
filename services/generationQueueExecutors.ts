import { A1111ApiClient } from './a1111ApiClient';
import { ComfyUIApiClient } from './comfyUIApiClient';
import { BaseMetadata, IndexedImage } from '../types';
import {
  GeneratedQueueOutput,
  GenerationQueueItem,
} from '../store/useGenerationQueueStore';
import {
  hasPromptMetadata,
  mergeNormalizedMetadata,
  NO_METADATA_MESSAGE,
} from '../utils/imageMetadata';

type ProgressPollingControls = {
  startPolling: (serverUrl: string, numberOfImages?: number) => void;
  stopPolling: () => void;
  isCanceled?: () => boolean;
};

type ProgressTrackingControls = {
  startTracking: (serverUrl: string, promptId: string, clientId?: string) => void;
  stopTracking: () => void;
  isCanceled?: () => boolean;
};

export type QueueExecutionResult = {
  generatedOutputs?: GeneratedQueueOutput[];
  providerJobId?: string;
};

const getErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const base64PngToObjectUrl = (base64: string): string => {
  const binary = atob(base64);
  const chunks: BlobPart[] = [];
  const chunkSize = 8192;

  for (let offset = 0; offset < binary.length; offset += chunkSize) {
    const slice = binary.slice(offset, offset + chunkSize);
    const bytes = new Uint8Array(slice.length);
    for (let index = 0; index < slice.length; index += 1) {
      bytes[index] = slice.charCodeAt(index);
    }
    chunks.push(bytes);
  }

  return URL.createObjectURL(new Blob(chunks, { type: 'image/png' }));
};

const assertRunnableMetadata = (metadata: BaseMetadata) => {
  if (!hasPromptMetadata(metadata)) {
    throw new Error(NO_METADATA_MESSAGE);
  }
};

export async function executeA1111QueueJob(
  job: GenerationQueueItem,
  context: {
    image: IndexedImage;
    serverUrl: string;
  } & ProgressPollingControls
): Promise<QueueExecutionResult> {
  if (!context.serverUrl) {
    throw new Error('A1111 server URL not configured. Please check Settings.');
  }

  const payload = job.payload?.provider === 'a1111' ? job.payload : undefined;
  const metadata = mergeNormalizedMetadata(context.image, payload?.customMetadata);
  assertRunnableMetadata(metadata);

  const numberOfImages = payload?.numberOfImages || job.totalImages || 1;
  const client = new A1111ApiClient({ serverUrl: context.serverUrl });
  const controller = new AbortController();
  const cancelCheckId = setInterval(() => {
    if (context.isCanceled?.()) {
      controller.abort();
    }
  }, 250);

  context.startPolling(context.serverUrl, numberOfImages);
  try {
    const result = await client.sendToTxt2Img(metadata, {
      autoStart: true,
      numberOfImages,
      signal: controller.signal,
    });

    if (context.isCanceled?.()) {
      return {};
    }

    if (!result.success) {
      throw new Error(result.error || 'Generation failed');
    }

    return {
      generatedOutputs: (result.images || []).map((base64, index) => ({
        id: `${job.id}_a1111_${index}`,
        kind: 'object-url',
        url: base64PngToObjectUrl(base64),
        name: `${job.imageName} result ${index + 1}`,
      })),
    };
  } finally {
    clearInterval(cancelCheckId);
    context.stopPolling();
  }
}

type ComfyUIHistoryImage = {
  filename?: unknown;
  subfolder?: unknown;
  type?: unknown;
};

const isHistoryImage = (value: unknown): value is ComfyUIHistoryImage =>
  Boolean(value && typeof value === 'object' && 'filename' in value);

function extractComfyUIOutputs(
  history: Record<string, unknown>,
  promptId: string,
  client: ComfyUIApiClient,
  job: GenerationQueueItem
): GeneratedQueueOutput[] {
  const promptHistory = history[promptId];
  if (!promptHistory || typeof promptHistory !== 'object') {
    return [];
  }

  const outputs = (promptHistory as { outputs?: unknown }).outputs;
  if (!outputs || typeof outputs !== 'object') {
    return [];
  }

  const images: GeneratedQueueOutput[] = [];
  Object.values(outputs as Record<string, unknown>).forEach((nodeOutput, nodeIndex) => {
    const nodeImages = (nodeOutput as { images?: unknown }).images;
    if (!Array.isArray(nodeImages)) {
      return;
    }

    nodeImages.filter(isHistoryImage).forEach((image, imageIndex) => {
      if (typeof image.filename !== 'string') {
        return;
      }

      const subfolder = typeof image.subfolder === 'string' ? image.subfolder : '';
      const type = typeof image.type === 'string' ? image.type : 'output';
      const relativePath = subfolder ? `${subfolder}/${image.filename}` : image.filename;
      images.push({
        id: `${job.id}_comfyui_${nodeIndex}_${imageIndex}`,
        kind: 'remote-url',
        url: client.getViewUrl({
          filename: image.filename,
          subfolder,
          type,
        }),
        relativePath,
        name: image.filename,
      });
    });
  });

  return images;
}

async function waitForComfyUIOutputs(
  client: ComfyUIApiClient,
  promptId: string,
  job: GenerationQueueItem,
  isCanceled?: () => boolean
): Promise<GeneratedQueueOutput[]> {
  const startedAt = Date.now();
  const timeoutMs = 5 * 60 * 1000;

  while (Date.now() - startedAt < timeoutMs) {
    if (isCanceled?.()) {
      return [];
    }

    const history = await client.getHistory(promptId) as Record<string, unknown>;
    if (isCanceled?.()) {
      return [];
    }

    const outputs = extractComfyUIOutputs(history, promptId, client, job);
    if (outputs.length > 0) {
      return outputs;
    }

    if (history[promptId]) {
      return [];
    }

    await sleep(1000);
  }

  throw new Error('Timed out waiting for ComfyUI generation to finish.');
}

export async function executeComfyUIQueueJob(
  job: GenerationQueueItem,
  context: {
    image: IndexedImage;
    serverUrl: string;
  } & ProgressTrackingControls
): Promise<QueueExecutionResult> {
  if (!context.serverUrl) {
    throw new Error('ComfyUI server URL not configured. Please check Settings.');
  }

  const payload = job.payload?.provider === 'comfyui' ? job.payload : undefined;
  const metadata = mergeNormalizedMetadata(context.image, payload?.customMetadata);
  assertRunnableMetadata(metadata);

  const client = new ComfyUIApiClient({ serverUrl: context.serverUrl });
  const prepared = await client.prepareWorkflow({
    image: context.image,
    metadata,
    overrides: payload?.overrides,
    workflowMode: payload?.workflowMode,
    sourceImagePolicy: payload?.sourceImagePolicy,
    advancedPromptJson: payload?.advancedPromptJson,
    advancedWorkflowJson: payload?.advancedWorkflowJson,
    maskFile: payload?.maskFile || null,
  });

  const result = await client.queuePrompt(prepared.workflow);
  if (!result.success || !result.prompt_id) {
    throw new Error(result.error || 'Failed to queue workflow');
  }

  context.startTracking(context.serverUrl, result.prompt_id, prepared.workflow.client_id);
  try {
    return {
      providerJobId: result.prompt_id,
      generatedOutputs: await waitForComfyUIOutputs(client, result.prompt_id, job, context.isCanceled),
    };
  } catch (error) {
    throw new Error(getErrorMessage(error));
  } finally {
    context.stopTracking();
  }
}
