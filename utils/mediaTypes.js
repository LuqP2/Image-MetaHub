export const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp', '.avif', '.gif'];
export const VIDEO_EXTENSIONS = ['.mp4', '.webm', '.mkv', '.mov', '.avi'];
export const AUDIO_EXTENSIONS = ['.mp3', '.wav', '.flac', '.ogg', '.oga', '.m4a', '.aac', '.opus', '.aiff', '.aif', '.wma'];
export const MODEL_3D_EXTENSIONS = ['.glb', '.gltf', '.obj', '.fbx', '.stl'];
export const EXTERNAL_RESOURCE_MODEL_3D_EXTENSIONS = ['.gltf', '.obj'];

export const SUPPORTED_MEDIA_EXTENSIONS = [
  ...IMAGE_EXTENSIONS,
  ...VIDEO_EXTENSIONS,
  ...AUDIO_EXTENSIONS,
  ...MODEL_3D_EXTENSIONS,
];

const MEDIA_MIME_TYPES = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.gif': 'image/gif',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.mov': 'video/quicktime',
  '.avi': 'video/x-msvideo',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.flac': 'audio/flac',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.opus': 'audio/opus',
  '.aiff': 'audio/aiff',
  '.aif': 'audio/aiff',
  '.wma': 'audio/x-ms-wma',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.obj': 'model/obj',
  '.fbx': 'application/octet-stream',
  '.stl': 'model/stl',
};

export const getFileExtension = (name = '') => {
  const match = String(name).toLowerCase().match(/\.[^.\\/]+$/);
  return match ? match[0] : '';
};

export const inferMimeTypeFromName = (name, fallback = 'application/octet-stream') => {
  return MEDIA_MIME_TYPES[getFileExtension(name)] || fallback;
};

export const hasExtension = (name, extensions) => {
  const ext = getFileExtension(name);
  return extensions.includes(ext);
};

export const isImageFileName = (name) => hasExtension(name, IMAGE_EXTENSIONS);
export const isVideoFileName = (name, fileType) =>
  Boolean(fileType?.startsWith?.('video/')) || hasExtension(name, VIDEO_EXTENSIONS);
export const isAudioFileName = (name, fileType) =>
  Boolean(fileType?.startsWith?.('audio/')) || hasExtension(name, AUDIO_EXTENSIONS);
export const isModel3DFileName = (name, fileType) =>
  Boolean(fileType?.startsWith?.('model/')) || hasExtension(name, MODEL_3D_EXTENSIONS);
export const isExternalResourceModel3DFileName = (name) =>
  hasExtension(name, EXTERNAL_RESOURCE_MODEL_3D_EXTENSIONS);
export const isSupportedMediaFileName = (name) => hasExtension(name, SUPPORTED_MEDIA_EXTENSIONS);

export const resolveMediaType = (name, fileType) => {
  if (fileType?.startsWith?.('image/')) return 'image';
  if (fileType?.startsWith?.('video/')) return 'video';
  if (fileType?.startsWith?.('audio/')) return 'audio';
  if (fileType?.startsWith?.('model/')) return 'model3d';
  if (isImageFileName(name)) return 'image';
  if (isVideoFileName(name)) return 'video';
  if (isAudioFileName(name)) return 'audio';
  if (isModel3DFileName(name)) return 'model3d';
  return 'unknown';
};

export const buildSupportedMediaRegex = () =>
  new RegExp(`(${SUPPORTED_MEDIA_EXTENSIONS.map((ext) => ext.replace('.', '\\.')).join('|')})$`, 'i');
