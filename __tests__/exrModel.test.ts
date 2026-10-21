import { describe, expect, it } from 'vitest';
import { exrChannelGroups, exrDefaultSelection } from '../services/exr/model';
import type { ExrPart } from '../services/exr/contracts';
import { canEditRasterFile, inferMimeTypeFromName, isExrFileName, isSupportedMediaFileName } from '../utils/mediaTypes.js';

describe('EXR format and channel model', () => {
  const part = (index: number, name: string, channels = ['R', 'G', 'B'], deep = false) => ({ index, name, deep, channels: channels.map(name => ({ name, type: 'float' })) }) as ExrPart;
  it.each(['beauty', 'Combined', 'ViewLayer.Beauty'])('prefers a later %s part over the first specular RGB part', name => {
    const beauty = part(1, name, ['B', 'A', 'R', 'G']);
    expect(exrDefaultSelection([part(0, 'specular'), beauty])).toEqual({ part: beauty, channels: ['R', 'G', 'B', 'A'] });
  });
  it('uses native preference for layered beauty channels and preserves equal-score ordering', () => {
    const layered = part(0, 'Main', ['specular.R', 'specular.G', 'specular.B', 'combined.R', 'combined.G', 'combined.B']);
    expect(exrDefaultSelection([layered, part(1, 'beauty')])).toEqual({ part: layered, channels: ['combined.R', 'combined.G', 'combined.B'] });
  });
  it('skips deep parts and prefers main RGB over layered RGB or diagnostic XYZ', () => {
    const rgb = part(3, 'Main');
    expect(exrDefaultSelection([part(0, 'beauty', undefined, true), part(1, 'normal', ['X', 'Y', 'Z']), part(2, 'specular', ['layer.R', 'layer.G', 'layer.B']), rgb])).toEqual({ part: rgb, channels: ['R', 'G', 'B'] });
    expect(exrDefaultSelection([part(0, 'data', ['Z', 'ObjectID'])])?.channels).toEqual(['ObjectID']);
    expect(exrDefaultSelection([part(0, 'deep', undefined, true)])).toBeUndefined();
  });
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
