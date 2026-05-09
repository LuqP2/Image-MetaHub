import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useGenerationQueueStore } from '../store/useGenerationQueueStore';

const resetQueueStore = () => {
  useGenerationQueueStore.setState({
    items: [],
    activeJobs: {
      a1111: null,
      comfyui: null,
    },
  });
};

const createA1111Job = (imageName: string) =>
  useGenerationQueueStore.getState().createJob({
    provider: 'a1111',
    imageId: imageName,
    imageName,
    prompt: 'prompt',
    totalImages: 1,
    payload: {
      provider: 'a1111',
      numberOfImages: 1,
    },
  });

describe('useGenerationQueueStore', () => {
  beforeEach(() => {
    resetQueueStore();
    vi.useRealTimers();
  });

  it('creates the first job as processing when there is no active provider job', () => {
    const id = createA1111Job('first.png');
    const state = useGenerationQueueStore.getState();

    expect(state.items.find((item) => item.id === id)?.status).toBe('processing');
    expect(state.activeJobs.a1111).toBe(id);
  });

  it('creates the second provider job as waiting when one is already active', () => {
    const firstId = createA1111Job('first.png');
    const secondId = createA1111Job('second.png');
    const state = useGenerationQueueStore.getState();

    expect(state.activeJobs.a1111).toBe(firstId);
    expect(state.items.find((item) => item.id === secondId)?.status).toBe('waiting');
  });

  it('returns the oldest waiting job for FIFO processing', () => {
    vi.useFakeTimers();
    createA1111Job('active.png');

    vi.setSystemTime(1000);
    const olderId = createA1111Job('older.png');
    vi.setSystemTime(2000);
    const newerId = createA1111Job('newer.png');

    expect(useGenerationQueueStore.getState().getNextWaitingJobId('a1111')).toBe(olderId);
    expect(useGenerationQueueStore.getState().getNextWaitingJobId('a1111')).not.toBe(newerId);
  });

  it('clears activeJobs when removing the active job', () => {
    const id = createA1111Job('active.png');

    useGenerationQueueStore.getState().removeJob(id);

    expect(useGenerationQueueStore.getState().activeJobs.a1111).toBeNull();
  });

  it('does not leave activeJobs pointing to an item removed by clearByStatus', () => {
    const id = createA1111Job('active.png');
    expect(useGenerationQueueStore.getState().activeJobs.a1111).toBe(id);

    useGenerationQueueStore.getState().clearByStatus(['processing']);

    expect(useGenerationQueueStore.getState().items).toHaveLength(0);
    expect(useGenerationQueueStore.getState().activeJobs.a1111).toBeNull();
  });

  it('upserts external ComfyUI jobs without assigning the provider active job', () => {
    const id = useGenerationQueueStore.getState().upsertExternalComfyUIJob({
      providerJobId: 'prompt-external-1',
      status: 'waiting',
      prompt: 'external prompt',
    });

    const state = useGenerationQueueStore.getState();
    const item = state.items.find((candidate) => candidate.id === id);

    expect(item?.origin).toBe('comfyui-external');
    expect(item?.providerJobId).toBe('prompt-external-1');
    expect(item?.prompt).toBe('external prompt');
    expect(state.activeJobs.comfyui).toBeNull();
    expect(state.getNextWaitingJobId('comfyui')).toBeNull();
  });

  it('deduplicates an observed external ComfyUI job when an internal job receives the same prompt id', () => {
    const internalId = useGenerationQueueStore.getState().createJob({
      provider: 'comfyui',
      imageId: 'image-1',
      imageName: 'source.png',
      prompt: 'internal prompt',
      payload: {
        provider: 'comfyui',
      },
    });

    useGenerationQueueStore.getState().upsertExternalComfyUIJob({
      providerJobId: 'prompt-shared',
      status: 'processing',
    });

    expect(useGenerationQueueStore.getState().items).toHaveLength(2);

    useGenerationQueueStore.getState().updateJob(internalId, {
      providerJobId: 'prompt-shared',
    });

    const state = useGenerationQueueStore.getState();
    expect(state.items).toHaveLength(1);
    expect(state.items[0].id).toBe(internalId);
    expect(state.items[0].origin).toBe('metahub');
    expect(state.items[0].providerJobId).toBe('prompt-shared');
  });

  it('does not downgrade an internal processing ComfyUI job to waiting when the monitor sees it pending', () => {
    const internalId = useGenerationQueueStore.getState().createJob({
      provider: 'comfyui',
      imageId: 'image-1',
      imageName: 'source.png',
      prompt: 'internal prompt',
      payload: {
        provider: 'comfyui',
      },
    });

    useGenerationQueueStore.getState().updateJob(internalId, {
      providerJobId: 'prompt-internal',
    });

    useGenerationQueueStore.getState().upsertExternalComfyUIJob({
      providerJobId: 'prompt-internal',
      status: 'waiting',
    });

    const state = useGenerationQueueStore.getState();
    expect(state.items).toHaveLength(1);
    expect(state.items[0].id).toBe(internalId);
    expect(state.items[0].origin).toBe('metahub');
    expect(state.items[0].status).toBe('processing');
  });
});
