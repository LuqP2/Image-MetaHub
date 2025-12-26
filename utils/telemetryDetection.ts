/**
 * Telemetry Detection Utilities
 * Detects if an image has verified telemetry data from MetaHub Save Node
 */

import { IndexedImage } from '../types';

/**
 * Checks if an image has verified telemetry data from MetaHub Save Node
 *
 * Verified telemetry includes:
 * - Generation time (generation_time_ms)
 * - GPU device information (gpu_device)
 * - Steps per second (steps_per_second)
 * - Software versions (comfyui_version, torch_version, python_version)
 * - VRAM peak (optional, only for CUDA GPUs)
 */
export function hasVerifiedTelemetry(image: IndexedImage): boolean {
  // Try both analytics and _analytics (underscore version is used in normalizedMetadata)
  const analytics = image.metadata?.normalizedMetadata?.analytics ||
                    (image.metadata?.normalizedMetadata as any)?._analytics;

  if (!analytics) {
    return false;
  }

  // Critical metrics that must be present
  const hasGenerationTime = typeof analytics.generation_time_ms === 'number' && analytics.generation_time_ms > 0;
  const hasGpuDevice = typeof analytics.gpu_device === 'string' && analytics.gpu_device.length > 0;
  const hasStepsPerSecond = typeof analytics.steps_per_second === 'number' && !isNaN(analytics.steps_per_second);

  // Software versions (at least one should be present and not null/empty)
  const hasComfyVersion = analytics.comfyui_version !== null && analytics.comfyui_version !== undefined &&
                          typeof analytics.comfyui_version === 'string' && analytics.comfyui_version.length > 0;
  const hasTorchVersion = analytics.torch_version !== null && analytics.torch_version !== undefined &&
                          typeof analytics.torch_version === 'string' && analytics.torch_version.length > 0;
  const hasPythonVersion = analytics.python_version !== null && analytics.python_version !== undefined &&
                           typeof analytics.python_version === 'string' && analytics.python_version.length > 0;

  const hasSoftwareVersions = hasComfyVersion || hasTorchVersion || hasPythonVersion;

  // Verified telemetry requires critical metrics + software versions
  return hasGenerationTime && hasGpuDevice && hasStepsPerSecond && hasSoftwareVersions;
}

/**
 * Gets a summary of telemetry quality
 */
export function getTelemetryQuality(image: IndexedImage): 'verified' | 'partial' | 'none' {
  if (hasVerifiedTelemetry(image)) {
    return 'verified';
  }

  // Try both analytics and _analytics (underscore version is used in normalizedMetadata)
  const analytics = image.metadata?.normalizedMetadata?.analytics ||
                    (image.metadata?.normalizedMetadata as any)?._analytics;

  // Check if at least some analytics exist
  if (analytics && (analytics.generation_time_ms || analytics.gpu_device)) {
    return 'partial';
  }

  return 'none';
}
