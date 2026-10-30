import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { captureModel3DCamera, applyModel3DCamera, sameModel3DCamera } from '../services/model3DCamera';
function runtime(size: number, offset: number) {
  const model = new THREE.Mesh(new THREE.BoxGeometry(size,size,size)); model.position.x = offset; model.updateMatrixWorld(true);
  const perspective = new THREE.PerspectiveCamera(35,1,.001,10000);
  const orthographic = new THREE.OrthographicCamera(-1,1,1,-1,.001,10000);
  const controls = () => ({ target: new THREE.Vector3(), update() {}, dispose() {} });
  return { THREE, model, perspective, orthographic, activeCamera: perspective as THREE.PerspectiveCamera | THREE.OrthographicCamera, controls: controls() as any, createControls: controls as any };
}
describe('normalized 3D comparison cameras', () => {
  it.each(['perspective', 'orthographic'] as const)('preserves orientation, pan and framing across model scale/center in %s', projection => {
    const a = runtime(1,2), b = runtime(100,1000);
    const pose = { projection, position: [3,2,4] as [number,number,number], target: [.2,.3,0] as [number,number,number], up: [0,1,0] as [number,number,number], zoom: 1.5, fov: 40 };
    applyModel3DCamera(a, pose); applyModel3DCamera(b, captureModel3DCamera(a));
    expect(sameModel3DCamera(captureModel3DCamera(b), pose)).toBe(true);
    expect(a.activeCamera.position.distanceTo(a.controls.target)).toBeCloseTo(b.activeCamera.position.distanceTo(b.controls.target) / 100);
    a.model.geometry.dispose(); b.model.geometry.dispose();
  });
});
