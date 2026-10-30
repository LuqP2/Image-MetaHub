import type * as Three from 'three';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
export interface Model3DCameraState {
  projection: 'perspective' | 'orthographic';
  position: [number, number, number];
  target: [number, number, number];
  up: [number, number, number];
  zoom: number;
  fov: number;
}
interface CameraRuntime {
  THREE: typeof Three; model: Three.Object3D;
  activeCamera: Three.PerspectiveCamera | Three.OrthographicCamera;
  perspective: Three.PerspectiveCamera; orthographic: Three.OrthographicCamera;
  controls: OrbitControls; createControls: (camera: Three.Camera) => OrbitControls;
}
function bounds(runtime: CameraRuntime) {
  const sphere = new runtime.THREE.Box3().setFromObject(runtime.model).getBoundingSphere(new runtime.THREE.Sphere());
  return { center: sphere.center, radius: Math.max(sphere.radius, .01) };
}
export function captureModel3DCamera(runtime: CameraRuntime): Model3DCameraState {
  const { center, radius } = bounds(runtime);
  const orthographic = runtime.activeCamera === runtime.orthographic;
  return { projection: orthographic ? 'orthographic' : 'perspective', position: runtime.activeCamera.position.clone().sub(center).divideScalar(radius).toArray() as [number,number,number], target: runtime.controls.target.clone().sub(center).divideScalar(radius).toArray() as [number,number,number], up: runtime.activeCamera.up.toArray() as [number,number,number], zoom: runtime.activeCamera.zoom * (orthographic ? radius : 1), fov: runtime.perspective.fov };
}
export function applyModel3DCamera(runtime: CameraRuntime, state: Model3DCameraState) {
  const { center, radius } = bounds(runtime);
  const camera = state.projection === 'orthographic' ? runtime.orthographic : runtime.perspective;
  const target = new runtime.THREE.Vector3(...state.target).multiplyScalar(radius).add(center);
  if (runtime.activeCamera !== camera) { runtime.controls.dispose(); runtime.activeCamera = camera; runtime.controls = runtime.createControls(camera); }
  camera.position.fromArray(state.position).multiplyScalar(radius).add(center);
  camera.up.fromArray(state.up);
  camera.zoom = state.zoom / (state.projection === 'orthographic' ? radius : 1);
  runtime.perspective.fov = state.fov;
  runtime.perspective.updateProjectionMatrix(); camera.updateProjectionMatrix();
  runtime.controls.target.copy(target); runtime.controls.update();
}
export function sameModel3DCamera(a: Model3DCameraState | undefined, b: Model3DCameraState): boolean {
  return !!a && a.projection === b.projection && Math.abs(a.zoom-b.zoom) < 1e-5 && Math.abs(a.fov-b.fov) < 1e-5 && [...a.position,...a.target,...a.up].every((value,index) => Math.abs(value-[...b.position,...b.target,...b.up][index]) < 1e-5);
}
