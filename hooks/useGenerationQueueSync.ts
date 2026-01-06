import { useEffect } from 'react';
import { useA1111ProgressContext } from '../contexts/A1111ProgressContext';
import { useComfyUIProgressContext } from '../contexts/ComfyUIProgressContext';
import { useGenerationQueueStore } from '../store/useGenerationQueueStore';

export function useGenerationQueueSync() {
  const { progressState: a1111Progress } = useA1111ProgressContext();
  const { progressState: comfyUIProgress } = useComfyUIProgressContext();
  const updateJob = useGenerationQueueStore((state) => state.updateJob);
  const setJobStatus = useGenerationQueueStore((state) => state.setJobStatus);
  const setActiveJob = useGenerationQueueStore((state) => state.setActiveJob);

  useEffect(() => {
    const { activeJobs, items, getNextWaitingJobId } = useGenerationQueueStore.getState();
    const activeJobId = activeJobs.a1111;

    if (a1111Progress) {
      let jobId = activeJobId;
      if (!jobId) {
        const nextId = getNextWaitingJobId('a1111');
        if (nextId) {
          setActiveJob('a1111', nextId);
          setJobStatus(nextId, 'processing');
          jobId = nextId;
        }
      }

      if (jobId) {
        updateJob(jobId, {
          progress: a1111Progress.progress,
          currentImage: a1111Progress.currentImage,
          totalImages: a1111Progress.totalImages,
          currentStep: a1111Progress.currentStep,
          totalSteps: a1111Progress.totalSteps,
          status: 'processing',
        });
      }
      return;
    }

    if (activeJobId) {
      const activeItem = items.find((item) => item.id === activeJobId);
      if (activeItem && activeItem.status === 'processing') {
        setJobStatus(activeJobId, 'done', { progress: 1 });
      }
      setActiveJob('a1111', null);
    }
  }, [a1111Progress, setActiveJob, setJobStatus, updateJob]);

  useEffect(() => {
    const { activeJobs, items, getNextWaitingJobId } = useGenerationQueueStore.getState();
    const activeJobId = activeJobs.comfyui;

    if (comfyUIProgress) {
      let jobId = activeJobId;
      if (!jobId) {
        const nextId = getNextWaitingJobId('comfyui');
        if (nextId) {
          setActiveJob('comfyui', nextId);
          setJobStatus(nextId, 'processing');
          jobId = nextId;
        }
      }

      if (jobId) {
        updateJob(jobId, {
          progress: comfyUIProgress.progress,
          currentStep: comfyUIProgress.currentStep,
          totalSteps: comfyUIProgress.totalSteps,
          currentNode: comfyUIProgress.currentNode,
          status: 'processing',
        });
      }
      return;
    }

    if (activeJobId) {
      const activeItem = items.find((item) => item.id === activeJobId);
      if (activeItem && activeItem.status === 'processing') {
        setJobStatus(activeJobId, 'done', { progress: 1 });
      }
      setActiveJob('comfyui', null);
    }
  }, [comfyUIProgress, setActiveJob, setJobStatus, updateJob]);
}
