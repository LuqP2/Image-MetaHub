import { create } from 'zustand';
import { BaseMetadata } from '../types';
import { WorkflowOverrides } from '../services/comfyUIApiClient';
import { ComfyUISourceImagePolicy, ComfyUIWorkflowMode } from '../services/comfyUIWorkflowBuilder';

export type GenerationProvider = 'a1111' | 'comfyui';
export type GenerationStatus = 'waiting' | 'processing' | 'done' | 'failed' | 'canceled';
export type GenerationOrigin = 'metahub' | 'comfyui-external';

export type A1111QueuePayload = {
  provider: 'a1111';
  customMetadata?: Partial<BaseMetadata>;
  numberOfImages?: number;
};

export type ComfyUIQueuePayload = {
  provider: 'comfyui';
  customMetadata?: Partial<BaseMetadata>;
  overrides?: WorkflowOverrides;
  workflowMode?: ComfyUIWorkflowMode;
  sourceImagePolicy?: ComfyUISourceImagePolicy;
  advancedPromptJson?: string;
  advancedWorkflowJson?: string;
  maskFile?: File | null;
};

export type GenerationQueuePayload = A1111QueuePayload | ComfyUIQueuePayload;

export interface GeneratedQueueOutput {
  id: string;
  kind: 'data-url' | 'object-url' | 'remote-url' | 'indexed-image';
  url?: string;
  imageId?: string;
  relativePath?: string;
  name?: string;
  width?: number;
  height?: number;
}

export interface GenerationQueueItem {
  id: string;
  provider: GenerationProvider;
  origin?: GenerationOrigin;
  imageId?: string;
  imageName: string;
  prompt?: string;
  status: GenerationStatus;
  progress: number;
  currentStep?: number;
  totalSteps?: number;
  currentImage?: number;
  totalImages?: number;
  currentNode?: string | null;
  providerJobId?: string;
  error?: string;
  payload?: GenerationQueuePayload;
  generatedOutputs?: GeneratedQueueOutput[];
  completedAt?: number;
  createdAt: number;
  updatedAt: number;
}

type CreateJobInput = {
  provider: GenerationProvider;
  origin?: GenerationOrigin;
  imageId?: string;
  imageName: string;
  prompt?: string;
  totalImages?: number;
  payload?: GenerationQueuePayload;
};

interface GenerationQueueState {
  items: GenerationQueueItem[];
  activeJobs: Record<GenerationProvider, string | null>;
  createJob: (input: CreateJobInput) => string;
  upsertExternalComfyUIJob: (input: {
    providerJobId: string;
    status: GenerationStatus;
    imageName?: string;
    prompt?: string;
    progress?: number;
    currentStep?: number;
    totalSteps?: number;
    currentNode?: string | null;
    error?: string;
    generatedOutputs?: GeneratedQueueOutput[];
    completedAt?: number;
  }) => string;
  updateJob: (id: string, updates: Partial<GenerationQueueItem>) => void;
  setJobStatus: (id: string, status: GenerationStatus, updates?: Partial<GenerationQueueItem>) => void;
  setActiveJob: (provider: GenerationProvider, id: string | null) => void;
  getNextWaitingJobId: (provider: GenerationProvider) => string | null;
  removeJob: (id: string) => void;
  clearByStatus: (statuses: GenerationStatus[]) => void;
}

const MAX_ITEMS = 200;

const createQueueId = () =>
  `job_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;

const revokeGeneratedOutputUrls = (items: GenerationQueueItem[]) => {
  if (typeof URL === 'undefined' || typeof URL.revokeObjectURL !== 'function') {
    return;
  }

  items.forEach((item) => {
    item.generatedOutputs?.forEach((output) => {
      if (output.kind === 'object-url' && output.url) {
        URL.revokeObjectURL(output.url);
      }
    });
  });
};

export const useGenerationQueueStore = create<GenerationQueueState>((set, get) => ({
  items: [],
  activeJobs: {
    a1111: null,
    comfyui: null,
  },
  createJob: (input) => {
    const id = createQueueId();
    const state = get();
    const hasActive = Boolean(state.activeJobs[input.provider]);
    const status: GenerationStatus = hasActive ? 'waiting' : 'processing';
    const now = Date.now();
    const item: GenerationQueueItem = {
      id,
      provider: input.provider,
      origin: input.origin || 'metahub',
      imageId: input.imageId,
      imageName: input.imageName,
      prompt: input.prompt,
      status,
      progress: 0,
      totalImages: input.totalImages,
      payload: input.payload,
      createdAt: now,
      updatedAt: now,
    };

    set((current) => {
      const nextItems = [item, ...current.items];
      const removedItems = nextItems.slice(MAX_ITEMS);
      revokeGeneratedOutputUrls(removedItems);

      return {
        items: nextItems.slice(0, MAX_ITEMS),
        activeJobs: hasActive
          ? current.activeJobs
          : { ...current.activeJobs, [input.provider]: id },
      };
    });

    return id;
  },
  upsertExternalComfyUIJob: (input) => {
    const now = Date.now();
    const shortPromptId = input.providerJobId.slice(0, 8);
    const imageName = input.imageName || `ComfyUI job ${shortPromptId}`;
    const existing = get().items.find(
      (item) => item.provider === 'comfyui' && item.providerJobId === input.providerJobId
    );

    if (existing) {
      if (existing.status === 'canceled') {
        return existing.id;
      }

      if (existing.status === 'done' && input.status !== 'done' && input.status !== 'failed') {
        return existing.id;
      }

      const nextStatus =
        existing.origin !== 'comfyui-external' &&
        existing.status === 'processing' &&
        input.status === 'waiting'
          ? existing.status
          : input.status;

      set((state) => ({
        items: state.items.map((item) =>
          item.id === existing.id
            ? {
                ...item,
                origin: item.origin || 'metahub',
                status: nextStatus,
                imageName: input.imageName || item.imageName,
                prompt: input.prompt ?? item.prompt,
                progress: input.progress ?? item.progress,
                currentStep: input.currentStep ?? item.currentStep,
                totalSteps: input.totalSteps ?? item.totalSteps,
                currentNode: input.currentNode === undefined ? item.currentNode : input.currentNode,
                error: input.error,
                generatedOutputs: input.generatedOutputs ?? item.generatedOutputs,
                completedAt: input.completedAt ?? item.completedAt,
                updatedAt: now,
              }
            : item
        ),
      }));
      return existing.id;
    }

    const id = createQueueId();
    const item: GenerationQueueItem = {
      id,
      provider: 'comfyui',
      origin: 'comfyui-external',
      imageName,
      prompt: input.prompt,
      status: input.status,
      progress: input.progress ?? 0,
      currentStep: input.currentStep,
      totalSteps: input.totalSteps,
      currentNode: input.currentNode,
      providerJobId: input.providerJobId,
      error: input.error,
      generatedOutputs: input.generatedOutputs,
      completedAt: input.completedAt,
      createdAt: now,
      updatedAt: now,
    };

    set((state) => {
      const nextItems = [item, ...state.items];
      const removedItems = nextItems.slice(MAX_ITEMS);
      revokeGeneratedOutputUrls(removedItems);

      return {
        items: nextItems.slice(0, MAX_ITEMS),
      };
    });

    return id;
  },
  updateJob: (id, updates) => {
    set((state) => ({
      items: state.items
        .filter((item) => {
          if (!updates.providerJobId || item.id === id) {
            return true;
          }
          return !(item.provider === 'comfyui' && item.origin === 'comfyui-external' && item.providerJobId === updates.providerJobId);
        })
        .map((item) =>
          item.id === id ? { ...item, ...updates, updatedAt: Date.now() } : item
        ),
    }));
  },
  setJobStatus: (id, status, updates) => {
    set((state) => ({
      items: state.items.map((item) =>
        item.id === id
          ? { ...item, status, ...updates, updatedAt: Date.now() }
          : item
      ),
    }));
  },
  setActiveJob: (provider, id) =>
    set((state) => ({
      activeJobs: { ...state.activeJobs, [provider]: id },
    })),
  getNextWaitingJobId: (provider) => {
    const { items } = get();
    const next = items
      .filter((item) => item.provider === provider && item.status === 'waiting' && item.origin !== 'comfyui-external')
      .sort((a, b) => a.createdAt - b.createdAt)[0];
    return next?.id ?? null;
  },
  removeJob: (id) => {
    set((state) => {
      revokeGeneratedOutputUrls(state.items.filter((item) => item.id === id));
      const activeJobs = { ...state.activeJobs };
      if (activeJobs.a1111 === id) {
        activeJobs.a1111 = null;
      }
      if (activeJobs.comfyui === id) {
        activeJobs.comfyui = null;
      }
      return {
        items: state.items.filter((item) => item.id !== id),
        activeJobs,
      };
    });
  },
  clearByStatus: (statuses) => {
    const statusSet = new Set(statuses);
    set((state) => {
      const activeJobs = { ...state.activeJobs };
      const removedItems = state.items.filter((item) => statusSet.has(item.status));
      const nextItems = state.items.filter((item) => !statusSet.has(item.status));
      revokeGeneratedOutputUrls(removedItems);
      if (activeJobs.a1111 && !nextItems.some((item) => item.id === activeJobs.a1111)) {
        activeJobs.a1111 = null;
      }
      if (activeJobs.comfyui && !nextItems.some((item) => item.id === activeJobs.comfyui)) {
        activeJobs.comfyui = null;
      }
      return { items: nextItems, activeJobs };
    });
  },
}));
