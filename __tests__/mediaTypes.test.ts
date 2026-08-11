import { describe, expect, it } from 'vitest';
import {
  inferMimeTypeFromName,
  isAudioFileName,
  isModel3DFileName,
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

  it('discovers AVIF files as first-class images', () => {
    expect(inferMimeTypeFromName('workflow.AVIF')).toBe('image/avif');
    expect(isSupportedMediaFileName('workflow.AVIF')).toBe(true);
    expect(resolveMediaType('workflow.AVIF')).toBe('image');
  });

  it.each([
    ['model.glb', 'model/gltf-binary'],
    ['model.gltf', 'model/gltf+json'],
    ['model.obj', 'model/obj'],
    ['model.fbx', 'application/octet-stream'],
    ['model.stl', 'model/stl'],
  ])('discovers %s as a 3D model', (fileName, mimeType) => {
    expect(inferMimeTypeFromName(fileName)).toBe(mimeType);
    expect(isModel3DFileName(fileName)).toBe(true);
    expect(isSupportedMediaFileName(fileName)).toBe(true);
    expect(resolveMediaType(fileName)).toBe('model3d');
  });

  it('keeps 3D metadata sidecars out of the media catalog', () => {
    expect(isSupportedMediaFileName('model.glb.imagemetahub.json')).toBe(false);
  });
});
