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
});
