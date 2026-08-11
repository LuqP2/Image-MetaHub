import { describe, expect, it } from 'vitest';
import {
  getUnsupportedModel3DBatchExportError,
  getUnsupportedModel3DTransferError,
} from '../utils/model3DTransfer';

describe('3D model transfers', () => {
  it('blocks GLTF, OBJ, and FBX transfers that may leave sibling resources behind', () => {
    expect(getUnsupportedModel3DTransferError([{ name: 'model.gltf' }])).toContain('containing folder');
    expect(getUnsupportedModel3DTransferError([{ name: 'model.obj' }])).toContain('containing folder');
    expect(getUnsupportedModel3DTransferError([{ name: 'model.fbx' }])).toContain('containing folder');
  });

  it('blocks GLTF, OBJ, and FBX batch exports for the same dependency reason', () => {
    expect(getUnsupportedModel3DBatchExportError([{ name: 'model.gltf' }])).toContain('batch export');
    expect(getUnsupportedModel3DBatchExportError([{ name: 'model.obj' }])).toContain('batch export');
    expect(getUnsupportedModel3DBatchExportError([{ name: 'model.fbx' }])).toContain('batch export');
  });

  it('allows self-contained model formats and regular media', () => {
    expect(getUnsupportedModel3DTransferError([
      { name: 'model.glb' },
      { name: 'model.stl' },
      { name: 'image.png' },
    ])).toBeNull();
  });
});
