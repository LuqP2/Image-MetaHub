import { Box3, Vector3, type DirectionalLight, type Object3D } from 'three';

export function positionModel3DLight(model: Object3D, light: DirectionalLight, azimuthDegrees: number, elevationDegrees: number) {
  const azimuth = azimuthDegrees * Math.PI / 180, elevation = elevationDegrees * Math.PI / 180;
  const bounds = new Box3().setFromObject(model);
  const center = bounds.getCenter(new Vector3());
  const distance = Math.max(10, bounds.getSize(new Vector3()).length() * 2);
  light.target.position.copy(center);
  light.position.copy(center).add(new Vector3(Math.cos(elevation) * Math.sin(azimuth), Math.sin(elevation), Math.cos(elevation) * Math.cos(azimuth)).multiplyScalar(distance));
  light.target.updateMatrixWorld();
}
