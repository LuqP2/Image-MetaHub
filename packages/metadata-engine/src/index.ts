/**
 * @image-metahub/metadata-engine
 *
 * Parse AI-generated image metadata from 15+ formats including:
 * - ComfyUI
 * - InvokeAI
 * - Automatic1111 / Forge / SD.Next
 * - SwarmUI
 * - Easy Diffusion
 * - Midjourney / Niji Journey
 * - DALL-E 3
 * - Adobe Firefly
 * - DreamStudio
 * - Draw Things
 * - Fooocus
 */

// Core engine functions
export { parseImageFile, parseFiles } from './core/engine';
export type { MetadataEngineResult } from './core/engine';

// Type definitions
export type {
  BaseMetadata,
  ImageMetadata,
  InvokeAIMetadata,
  Automatic1111Metadata,
  ComfyUIMetadata,
  SwarmUIMetadata,
  EasyDiffusionMetadata,
  EasyDiffusionJson,
  MidjourneyMetadata,
  NijiMetadata,
  ForgeMetadata,
  DalleMetadata,
  DreamStudioMetadata,
  FireflyMetadata,
  DrawThingsMetadata,
  FooocusMetadata,
  SDNextMetadata,
} from './core/types';

// Type guards
export {
  isInvokeAIMetadata,
  isComfyUIMetadata,
  isAutomatic1111Metadata,
  isSwarmUIMetadata,
  isEasyDiffusionMetadata,
  isEasyDiffusionJson,
  isMidjourneyMetadata,
  isNijiMetadata,
  isForgeMetadata,
  isDalleMetadata,
  isDreamStudioMetadata,
  isFireflyMetadata,
  isDrawThingsMetadata,
} from './core/types';

// Parser factory (advanced use)
export { parseImageMetadata, getMetadataParser } from './parsers';

// Constants
export { SCHEMA_VERSION } from './core/constants';
