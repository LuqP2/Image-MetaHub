import { describe, expect, it } from 'vitest';
import {
  inferMimeTypeFromName,
  isAudioFileName,
  isSupportedMediaFileName,
  resolveMediaType,
} from '../utils/mediaTypes.js';

describe('media type helpers', () => {
  it.each([
    ['track.mp3', 'audio/mpeg'],
    ['track.wav', 'audio/wav'],
    ['track.flac', 'audio/flac'],
    ['track.ogg', 'audio/ogg'],
    ['track.oga', 'audio/ogg'],
    ['track.m4a', 'audio/mp4'],
    ['track.aac', 'audio/aac'],
    ['track.opus', 'audio/opus'],
    ['track.aiff', 'audio/aiff'],
    ['track.aif', 'audio/aiff'],
    ['track.wma', 'audio/x-ms-wma'],
  ])('maps %s to %s', (fileName, mimeType) => {
    expect(inferMimeTypeFromName(fileName)).toBe(mimeType);
    expect(isAudioFileName(fileName)).toBe(true);
    expect(isSupportedMediaFileName(fileName)).toBe(true);
    expect(resolveMediaType(fileName)).toBe('audio');
  });
});
