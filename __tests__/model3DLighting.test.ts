import { describe, expect, it } from 'vitest';
import { BoxGeometry, DirectionalLight, Mesh, Vector3 } from 'three';
import { positionModel3DLight } from '../services/model3DLighting';

describe('3D lighting', () => {
  it('orbits the model center independently of its position and scale', () => {
    const model = new Mesh(new BoxGeometry(100, 100, 100));
    model.position.set(1000, 20, 0); model.updateMatrixWorld(true);
    const light = new DirectionalLight();
    positionModel3DLight(model, light, 90, 0);
    expect(light.target.position.toArray()).toEqual([1000, 20, 0]);
    expect(light.position.x).toBeGreaterThan(1100);
    expect(light.position.y).toBeCloseTo(20);
    expect(light.position.z).toBeCloseTo(0);
    positionModel3DLight(model, light, 0, 90);
    expect(light.position.y).toBeGreaterThan(120);
    expect(light.position.distanceTo(light.target.position)).toBeCloseTo(new Vector3(100, 100, 100).length() * 2);
    model.geometry.dispose();
  });
});
