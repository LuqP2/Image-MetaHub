import { useEffect } from 'react';
import { useA1111ProgressContext } from '../contexts/A1111ProgressContext';
import { useComfyUIProgressContext } from '../contexts/ComfyUIProgressContext';
import { useGenerationQueueStore } from '../store/useGenerationQueueStore';

export function useGenerationQueueSync() {
  const { progressState: a1111Progress } = useA1111ProgressContext();
  const { progressState: comfyUIProgress } = useComfyUIProgressContext();
  const updateJob = useGenerationQueueStore((state) => state.updateJob);

  useEffect(() => {
    const { activeJobs } = useGenerationQueueStore.getState();
    const jobId = activeJobs.a1111;

    if (a1111Progress && jobId) {
      updateJob(jobId, {
        progress: a1111Progress.progress,
        currentImage: a1111Progress.currentImage,
        totalImages: a1111Progress.totalImages,
        currentStep: a1111Progress.currentStep,
        totalSteps: a1111Progress.totalSteps,
        status: 'processing',
      });
    }
  }, [a1111Progress, updateJob]);

  useEffect(() => {
    const { activeJobs } = useGenerationQueueStore.getState();
    const jobId = activeJobs.comfyui;

    if (comfyUIProgress && jobId) {
      updateJob(jobId, {
        progress: comfyUIProgress.progress,
        currentStep: comfyUIProgress.currentStep,
        totalSteps: comfyUIProgress.totalSteps,
        currentNode: comfyUIProgress.currentNode,
        status: 'processing',
      });
    }
  }, [comfyUIProgress, updateJob]);
}
