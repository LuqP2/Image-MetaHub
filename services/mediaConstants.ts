/**
 * Centralized media type constants and utilities
 * Single source of truth for supported file extensions
 */

export const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp'] as const;
export const VIDEO_EXTENSIONS = ['.mp4', '.webm', '.mkv'] as const;
export const ALL_MEDIA_EXTENSIONS = [...IMAGE_EXTENSIONS, ...VIDEO_EXTENSIONS] as const;

export type MediaType = 'image' | 'video';

export const VIDEO_MIME_TYPES: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
};

export const IMAGE_MIME_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
};

/**
 * Determines the media type based on file extension
 */
export function getMediaType(filename: string): MediaType {
  const ext = getExtension(filename);
  if ((VIDEO_EXTENSIONS as readonly string[]).includes(ext)) {
    return 'video';
  }
  return 'image';
}

/**
 * Gets the MIME type for a file based on extension
 */
export function getMimeType(filename: string): string {
  const ext = getExtension(filename);
  return VIDEO_MIME_TYPES[ext] || IMAGE_MIME_TYPES[ext] || 'application/octet-stream';
}

/**
 * Checks if a file is a video based on extension
 */
export function isVideoFile(filename: string): boolean {
  const ext = getExtension(filename);
  return (VIDEO_EXTENSIONS as readonly string[]).includes(ext);
}

/**
 * Checks if a file is an image based on extension
 */
export function isImageFile(filename: string): boolean {
  const ext = getExtension(filename);
  return (IMAGE_EXTENSIONS as readonly string[]).includes(ext);
}

/**
 * Checks if a file is a supported media file (image or video)
 */
export function isSupportedMediaFile(filename: string): boolean {
  const ext = getExtension(filename);
  return (ALL_MEDIA_EXTENSIONS as readonly string[]).includes(ext);
}

/**
 * Gets the lowercase extension from a filename
 */
function getExtension(filename: string): string {
  const match = filename.toLowerCase().match(/\.[^.]+$/);
  return match ? match[0] : '';
}

/**
 * Regex pattern for matching supported image files
 */
export const IMAGE_EXTENSION_REGEX = /\.(png|jpg|jpeg|webp)$/i;

/**
 * Regex pattern for matching supported video files
 */
export const VIDEO_EXTENSION_REGEX = /\.(mp4|webm|mkv)$/i;

/**
 * Regex pattern for matching all supported media files
 */
export const ALL_MEDIA_EXTENSION_REGEX = /\.(png|jpg|jpeg|webp|mp4|webm|mkv)$/i;
