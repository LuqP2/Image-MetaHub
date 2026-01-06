import { create } from 'zustand';
import { BaseMetadata } from '../types';
import { WorkflowOverrides } from '../services/comfyUIApiClient';

export type GenerationProvider = 'a1111' | 'comfyui';
export type GenerationStatus = 'waiting' | 'processing' | 'done' | 'failed' | 'canceled';

export type A1111QueuePayload = {
  provider: 'a1111';
  customMetadata?: Partial<BaseMetadata>;
  numberOfImages?: number;
};

export type ComfyUIQueuePayload = {
  provider: 'comfyui';
  customMetadata?: Partial<BaseMetadata>;
  overrides?: WorkflowOverrides;
};

export type GenerationQueuePayload = A1111QueuePayload | ComfyUIQueuePayload;

export interface GenerationQueueItem {
  id: string;
  provider: GenerationProvider;
  imageId: string;
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
  createdAt: number;
  updatedAt: number;
}

type CreateJobInput = {
  provider: GenerationProvider;
  imageId: string;
  imageName: string;
  prompt?: string;
  totalImages?: number;
  payload?: GenerationQueuePayload;
};

interface GenerationQueueState {
  items: GenerationQueueItem[];
  activeJobs: Record<GenerationProvider, string | null>;
  createJob: (input: CreateJobInput) => string;
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

    set((current) => ({
      items: [item, ...current.items].slice(0, MAX_ITEMS),
      activeJobs: hasActive
        ? current.activeJobs
        : { ...current.activeJobs, [input.provider]: id },
    }));

    return id;
  },
  updateJob: (id, updates) => {
    set((state) => ({
      items: state.items.map((item) =>
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
    const next = items.find(
      (item) => item.provider === provider && item.status === 'waiting'
    );
    return next?.id ?? null;
  },
  removeJob: (id) => {
    set((state) => {
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
      const nextItems = state.items.filter((item) => !statusSet.has(item.status));
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
