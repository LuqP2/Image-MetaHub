import { describe, expect, it } from 'vitest';
import { getUnsupportedModel3DTransferError } from '../utils/model3DTransfer';

describe('3D model transfers', () => {
  it('blocks GLTF and OBJ transfers that may leave sibling resources behind', () => {
    expect(getUnsupportedModel3DTransferError([{ name: 'model.gltf' }])).toContain('containing folder');
    expect(getUnsupportedModel3DTransferError([{ name: 'model.obj' }])).toContain('containing folder');
  });

  it('allows self-contained model formats and regular media', () => {
    expect(getUnsupportedModel3DTransferError([
      { name: 'model.glb' },
      { name: 'model.stl' },
      { name: 'model.fbx' },
      { name: 'image.png' },
    ])).toBeNull();
  });
});
