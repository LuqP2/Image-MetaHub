export const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp', '.gif'];
export const VIDEO_EXTENSIONS = ['.mp4', '.webm', '.mkv', '.mov', '.avi'];
export const AUDIO_EXTENSIONS = ['.mp3', '.wav', '.flac', '.ogg', '.oga', '.m4a', '.aac', '.opus', '.aiff', '.aif', '.wma'];

export const SUPPORTED_MEDIA_EXTENSIONS = [
  ...IMAGE_EXTENSIONS,
  ...VIDEO_EXTENSIONS,
  ...AUDIO_EXTENSIONS,
];

const MEDIA_MIME_TYPES = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
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
export const isSupportedMediaFileName = (name) => hasExtension(name, SUPPORTED_MEDIA_EXTENSIONS);

export const resolveMediaType = (name, fileType) => {
  if (fileType?.startsWith?.('image/')) return 'image';
  if (fileType?.startsWith?.('video/')) return 'video';
  if (fileType?.startsWith?.('audio/')) return 'audio';
  if (isImageFileName(name)) return 'image';
  if (isVideoFileName(name)) return 'video';
  if (isAudioFileName(name)) return 'audio';
  return 'unknown';
};

export const buildSupportedMediaRegex = () =>
  new RegExp(`(${SUPPORTED_MEDIA_EXTENSIONS.map((ext) => ext.replace('.', '\\.')).join('|')})$`, 'i');
