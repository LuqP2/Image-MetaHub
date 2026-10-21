import { describe, expect, it } from 'vitest';
import { exrChannelGroups } from '../services/exr/model';
import type { ExrPart } from '../services/exr/contracts';
import { canEditRasterFile, inferMimeTypeFromName, isExrFileName, isSupportedMediaFileName } from '../utils/mediaTypes.js';

describe('EXR format and channel model', () => {
  it('discovers EXR as an image without granting raster editing', () => {
    expect(isExrFileName('render.EXR')).toBe(true);
    expect(isSupportedMediaFileName('render.exr')).toBe(true);
    expect(inferMimeTypeFromName('render.exr')).toBe('image/x-exr');
    expect(canEditRasterFile('render.exr')).toBe(false);
    expect(canEditRasterFile('render.png')).toBe(true);
  });
  it('groups shuffled beauty channels and preserves standalone data channels', () => {
    const names = ['depth.Z','specular.B','beauty.G','beauty.A','beauty.R','specular.R','beauty.B','specular.G','ObjectID','normal.X','normal.Z','normal.Y'];
    const groups = exrChannelGroups({ channels: names.map(name => ({ name, type: 'float' })) } as ExrPart);
    expect(groups[0]).toEqual({ name: 'beauty', channels: ['beauty.R','beauty.G','beauty.B','beauty.A'] });
    expect(groups).toContainEqual({ name: 'normal', channels: ['normal.X','normal.Y','normal.Z'] });
    expect(groups).toContainEqual({ name: 'depth.Z', channels: ['depth.Z'] });
    expect(groups).toContainEqual({ name: 'ObjectID', channels: ['ObjectID'] });
  });
});
