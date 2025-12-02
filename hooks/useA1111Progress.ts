import { useState, useCallback, useRef } from 'react';

export interface A1111ProgressState {
  isGenerating: boolean;
  currentImage: number;
  totalImages: number;
  progress: number; // 0-1, overall progress including batch
  currentStep: number;
  totalSteps: number;
}

interface A1111ProgressResponse {
  progress: number; // 0-1, progress within current image
  eta_relative: number;
  state: {
    sampling_steps: number;
    sampling_step: number;
    job_count: number;
    job_no: number;
  };
  current_image: string | null;
  textinfo: string;
}

export function useA1111Progress() {
  const [progressState, setProgressState] = useState<A1111ProgressState | null>(null);
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const serverUrlRef = useRef<string>('');
  const totalImagesRef = useRef<number>(0);

  const pollProgress = useCallback(async () => {
    if (!serverUrlRef.current) return;

    try {
      const response = await fetch(`${serverUrlRef.current}/sdapi/v1/progress`, {
        method: 'GET',
      });

      if (!response.ok) {
        console.warn('[A1111Progress] Failed to fetch progress');
        return;
      }

      const data: A1111ProgressResponse = await response.json();

      // Calculate which image we're on in the batch
      const currentImageInBatch = data.state.job_no || 0;
      const totalImagesInBatch = data.state.job_count || totalImagesRef.current || 1;

      // Calculate overall progress
      // For batch: (completed images + current image progress) / total images
      const completedImages = currentImageInBatch;
      const currentImageProgress = data.progress; // 0-1 for current image
      const overallProgress = totalImagesInBatch > 1
        ? (completedImages + currentImageProgress) / totalImagesInBatch
        : currentImageProgress;

      setProgressState({
        isGenerating: data.progress > 0 && data.progress < 1,
        currentImage: currentImageInBatch + 1, // 1-indexed for display
        totalImages: totalImagesInBatch,
        progress: overallProgress,
        currentStep: data.state.sampling_step || 0,
        totalSteps: data.state.sampling_steps || 0,
      });

      // Stop polling if generation is complete
      if (data.progress === 0 && data.state.job_count === 0) {
        stopPolling();
      }
    } catch (error) {
      console.warn('[A1111Progress] Error polling progress:', error);
    }
  }, []);

  const startPolling = useCallback((serverUrl: string, numberOfImages: number = 1) => {
    // Stop any existing polling
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
    }

    serverUrlRef.current = serverUrl;
    totalImagesRef.current = numberOfImages;

    // Initialize state
    setProgressState({
      isGenerating: true,
      currentImage: 1,
      totalImages: numberOfImages,
      progress: 0,
      currentStep: 0,
      totalSteps: 0,
    });

    // Poll every 500ms for smooth updates
    pollingIntervalRef.current = setInterval(pollProgress, 500);
  }, [pollProgress]);

  const stopPolling = useCallback(() => {
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
    }

    // Keep the final state visible for 2 seconds before clearing
    setTimeout(() => {
      setProgressState(null);
    }, 2000);
  }, []);

  return {
    progressState,
    startPolling,
    stopPolling,
  };
}
