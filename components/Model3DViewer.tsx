import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box, Camera, Download, Grid3X3, Image as ImageIcon, Maximize2, Palette, RotateCcw, Sun } from 'lucide-react';
import type { IndexedImage } from '../types';
import { getRelativeImagePath, mediaSourceCache } from '../services/mediaSourceCache';
import { hasCompactedRuntimeMetadata, hydrateImageRawMetadata } from '../services/rawMetadataHydration';
import { getFileExtension } from '../utils/mediaTypes.js';

type MaterialMode = 'original' | 'normal' | 'wireframe';
type CameraType = 'perspective' | 'orthographic';

interface ViewerPreferences {
  showGrid: boolean;
  backgroundColor: string;
  materialMode: MaterialMode;
  cameraType: CameraType;
  fov: number;
  lightIntensity: number;
}

interface Model3DViewerProps {
  image: IndexedImage;
  directoryPath?: string;
  compact?: boolean;
  showControls?: boolean;
  className?: string;
  onSnapshot?: (blob: Blob) => void;
  onError?: (message: string) => void;
}

interface RuntimeState {
  THREE: typeof import('three');
  scene: import('three').Scene;
  model: import('three').Object3D;
  animations: import('three').AnimationClip[];
  renderer: import('three').WebGLRenderer;
  perspective: import('three').PerspectiveCamera;
  orthographic: import('three').OrthographicCamera;
  activeCamera: import('three').PerspectiveCamera | import('three').OrthographicCamera;
  controls: import('three/examples/jsm/controls/OrbitControls.js').OrbitControls;
  createControls: (camera: import('three').Camera) => import('three/examples/jsm/controls/OrbitControls.js').OrbitControls;
  grid: import('three').GridHelper;
  keyLight: import('three').DirectionalLight;
  fillLight: import('three').AmbientLight;
  originals: Map<import('three').Mesh, import('three').Material | import('three').Material[]>;
  animationFrame: number;
  resizeObserver: ResizeObserver;
  sourceUrl: string;
}

const STORAGE_KEY = 'imh:model3d-viewer-settings:v1';
const DEFAULTS: ViewerPreferences = {
  showGrid: true,
  backgroundColor: '#090909',
  materialMode: 'original',
  cameraType: 'perspective',
  fov: 35,
  lightIntensity: 2.5,
};

const loadPreferences = (): ViewerPreferences => {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    return { ...DEFAULTS, ...parsed };
  } catch {
    return DEFAULTS;
  }
};

const savePreferences = (value: ViewerPreferences) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    // Viewer preferences are non-critical.
  }
};

const downloadBlob = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
};

const copyBytes = (value: ArrayBufferLike | ArrayBufferView): Uint8Array<ArrayBuffer> => {
  const source = ArrayBuffer.isView(value)
    ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
    : new Uint8Array(value);
  const copy = new Uint8Array(source.byteLength);
  copy.set(source);
  return copy;
};

const disposeMaterial = (material: import('three').Material) => {
  for (const value of Object.values(material)) {
    if (value && typeof value === 'object' && 'isTexture' in value && typeof (value as import('three').Texture).dispose === 'function') {
      (value as import('three').Texture).dispose();
    }
  }
  material.dispose();
};

export const safeModel3DAssetPath = (directoryPath: string, relativeModelPath: string, resourceUrl: string): string | null => {
  if (/^(?:[a-z]+:|\/|\\)/i.test(resourceUrl)) return null;
  let cleanResource: string;
  try {
    cleanResource = decodeURIComponent(resourceUrl.split(/[?#]/, 1)[0] || '').replace(/\\/g, '/');
  } catch {
    return null;
  }
  const segments = cleanResource.split('/').filter(Boolean);
  if (segments.some((part) => part === '..')) return null;
  const modelParts = relativeModelPath.replace(/\\/g, '/').split('/');
  if (modelParts.some((part) => part === '..')) return null;
  modelParts.pop();
  const base = directoryPath.replace(/[\\/]$/, '');
  return [base, ...modelParts, ...segments].join('\\');
};

const buildProtocolUrl = (absolutePath: string) =>
  `imh-media://local/?path=${encodeURIComponent(absolutePath)}`;

const getMetadataPayload = (image: IndexedImage): Record<string, unknown> => {
  const embedded = (image.metadata as Record<string, unknown> | undefined)?.imagemetahub_data;
  if (embedded && typeof embedded === 'object' && !Array.isArray(embedded)) {
    return embedded as Record<string, unknown>;
  }
  return {
    schema_version: 1,
    media_type: 'model3d',
    generator: image.metadata?.normalizedMetadata?.generator || 'Image MetaHub',
    ...image.metadata?.normalizedMetadata,
  };
};

export const embedMetadataInGlb = (buffer: ArrayBuffer, metadata: Record<string, unknown>): ArrayBuffer => {
  const source = new Uint8Array(buffer);
  if (source.byteLength < 20 || new TextDecoder().decode(source.slice(0, 4)) !== 'glTF') return buffer;
  const view = new DataView(buffer);
  const jsonLength = view.getUint32(12, true);
  if (view.getUint32(16, true) !== 0x4e4f534a || 20 + jsonLength > source.byteLength) return buffer;
  const document = JSON.parse(new TextDecoder().decode(source.slice(20, 20 + jsonLength)).replace(/[\u0000\s]+$/g, ''));
  document.asset = document.asset || { version: '2.0' };
  document.asset.extras = typeof document.asset.extras === 'object' && document.asset.extras ? document.asset.extras : {};
  document.asset.extras.imagemetahub_data = metadata;
  const encoded = new TextEncoder().encode(JSON.stringify(document));
  const paddedLength = Math.ceil(encoded.byteLength / 4) * 4;
  const remaining = source.slice(20 + jsonLength);
  const result = new Uint8Array(12 + 8 + paddedLength + remaining.byteLength);
  const resultView = new DataView(result.buffer);
  result.set(source.slice(0, 12), 0);
  resultView.setUint32(8, result.byteLength, true);
  resultView.setUint32(12, paddedLength, true);
  resultView.setUint32(16, 0x4e4f534a, true);
  result.set(encoded, 20);
  result.fill(0x20, 20 + encoded.byteLength, 20 + paddedLength);
  result.set(remaining, 20 + paddedLength);
  return result.buffer;
};

const modelBaseName = (name: string) => name.replace(/\.[^.]+$/, '') || 'model';

const Model3DViewer: React.FC<Model3DViewerProps> = ({
  image,
  directoryPath,
  compact = false,
  showControls = true,
  className = '',
  onSnapshot,
  onError,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const runtimeRef = useRef<RuntimeState | null>(null);
  const backgroundUrlRef = useRef<string | null>(null);
  const [preferences, setPreferences] = useState<ViewerPreferences>(loadPreferences);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const preferencesRef = useRef(preferences);
  const onSnapshotRef = useRef(onSnapshot);
  const onErrorRef = useRef(onError);

  useEffect(() => {
    preferencesRef.current = preferences;
  }, [preferences]);

  useEffect(() => {
    onSnapshotRef.current = onSnapshot;
  }, [onSnapshot]);

  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  const metadataPayload = useMemo(() => getMetadataPayload(image), [image]);
  const extension = getFileExtension(image.name).slice(1).toLowerCase();

  const updatePreference = useCallback(<K extends keyof ViewerPreferences>(key: K, value: ViewerPreferences[K]) => {
    setPreferences((current) => {
      const next = { ...current, [key]: value };
      savePreferences(next);
      return next;
    });
  }, []);

  const fitCamera = useCallback(() => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    const { THREE, model, controls } = runtime;
    const box = new THREE.Box3().setFromObject(model);
    if (box.isEmpty()) return;
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const radius = Math.max(sphere.radius, 0.01);
    runtime.perspective.position.copy(sphere.center).add(new THREE.Vector3(radius * 1.7, radius * 1.25, radius * 1.7));
    runtime.perspective.near = Math.max(radius / 1000, 0.001);
    runtime.perspective.far = radius * 1000;
    runtime.perspective.updateProjectionMatrix();
    runtime.orthographic.position.copy(runtime.perspective.position);
    runtime.orthographic.near = runtime.perspective.near;
    runtime.orthographic.far = runtime.perspective.far;
    runtime.orthographic.zoom = 1 / radius;
    runtime.orthographic.updateProjectionMatrix();
    controls.target.copy(sphere.center);
    controls.update();
  }, []);

  const applyMaterialMode = useCallback((mode: MaterialMode) => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    runtime.model.traverse((object) => {
      if (!(object as import('three').Mesh).isMesh) return;
      const mesh = object as import('three').Mesh;
      let original = runtime.originals.get(mesh);
      if (!original) {
        original = mesh.material;
        runtime.originals.set(mesh, original);
      }
      const currentMaterials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      if (mesh.material !== original) {
        currentMaterials.forEach(disposeMaterial);
      }
      if (mode === 'original') {
        mesh.material = runtime.originals.get(mesh) || mesh.material;
      } else if (mode === 'normal') {
        mesh.material = new runtime.THREE.MeshNormalMaterial();
      } else {
        mesh.material = new runtime.THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true });
      }
    });
  }, []);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    runtime.grid.visible = preferences.showGrid;
    if (!backgroundUrlRef.current) {
      runtime.scene.background = new runtime.THREE.Color(preferences.backgroundColor);
    }
    runtime.perspective.fov = preferences.fov;
    runtime.perspective.updateProjectionMatrix();
    runtime.keyLight.intensity = preferences.lightIntensity;
    runtime.fillLight.intensity = preferences.lightIntensity * 0.35;
    applyMaterialMode(preferences.materialMode);

    const nextCamera = preferences.cameraType === 'orthographic' ? runtime.orthographic : runtime.perspective;
    if (runtime.activeCamera !== nextCamera) {
      const target = runtime.controls.target.clone();
      runtime.controls.dispose();
      runtime.activeCamera = nextCamera;
      runtime.controls = runtime.createControls(nextCamera);
      runtime.controls.target.copy(target);
      runtime.controls.enableDamping = true;
      runtime.controls.update();
    }
  }, [applyMaterialMode, preferences]);

  useEffect(() => {
    let disposed = false;
    setLoading(true);
    setError(null);

    const initialize = async () => {
      let pendingRenderer: import('three').WebGLRenderer | null = null;
      const canvas = canvasRef.current;
      const container = containerRef.current;
      if (!canvas || !container) return;
      try {
        const initialPreferences = preferencesRef.current;
        const THREE = await import('three');
        const [{ OrbitControls }, { GLTFLoader }, { OBJLoader }, { MTLLoader }, { FBXLoader }, { STLLoader }] = await Promise.all([
          import('three/examples/jsm/controls/OrbitControls.js'),
          import('three/examples/jsm/loaders/GLTFLoader.js'),
          import('three/examples/jsm/loaders/OBJLoader.js'),
          import('three/examples/jsm/loaders/MTLLoader.js'),
          import('three/examples/jsm/loaders/FBXLoader.js'),
          import('three/examples/jsm/loaders/STLLoader.js'),
        ]);
        if (disposed) return;

        const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, preserveDrawingBuffer: Boolean(onSnapshotRef.current) });
        pendingRenderer = renderer;
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        renderer.shadowMap.enabled = true;
        const scene = new THREE.Scene();
        scene.background = new THREE.Color(initialPreferences.backgroundColor);
        const perspective = new THREE.PerspectiveCamera(initialPreferences.fov, 1, 0.01, 10000);
        const orthographic = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 10000);
        const activeCamera = initialPreferences.cameraType === 'orthographic' ? orthographic : perspective;
        const controls = new OrbitControls(activeCamera, renderer.domElement);
        controls.enableDamping = true;
        const grid = new THREE.GridHelper(10, 20, 0x777777, 0x3f3f46);
        grid.visible = initialPreferences.showGrid;
        scene.add(grid);
        scene.add(new THREE.AxesHelper(1.25));
        const keyLight = new THREE.DirectionalLight(0xffffff, initialPreferences.lightIntensity);
        keyLight.position.set(4, 7, 5);
        scene.add(keyLight);
        const fillLight = new THREE.AmbientLight(0xffffff, initialPreferences.lightIntensity * 0.35);
        scene.add(fillLight);

        const sourceUrl = await mediaSourceCache.getOrLoad(image, directoryPath);
        const manager = new THREE.LoadingManager();
        const relativeModelPath = getRelativeImagePath(image);
        if (window.electronAPI && directoryPath) {
          manager.setURLModifier((url) => {
            if (url === sourceUrl || /^(?:blob:|data:|https?:)/i.test(url) || (/^imh-media:/i.test(url) && url.includes('?path='))) return url;
            const relativeUrl = url.startsWith('imh-media://local/')
              ? url.slice('imh-media://local/'.length)
              : url;
            const resolved = safeModel3DAssetPath(directoryPath, relativeModelPath, relativeUrl);
            return resolved ? buildProtocolUrl(resolved) : url;
          });
        }

        let model: import('three').Object3D;
        let animations: import('three').AnimationClip[] = [];
        if (extension === 'glb' || extension === 'gltf') {
          const gltf = await new GLTFLoader(manager).loadAsync(sourceUrl);
          model = gltf.scene;
          animations = gltf.animations;
        } else if (extension === 'obj') {
          const loader = new OBJLoader(manager);
          if (window.electronAPI && directoryPath) {
            const materialPath = safeModel3DAssetPath(directoryPath, relativeModelPath, `${modelBaseName(image.name)}.mtl`);
            if (materialPath) {
              try {
                const materials = await new MTLLoader(manager).loadAsync(buildProtocolUrl(materialPath));
                materials.preload();
                loader.setMaterials(materials);
              } catch {
                // OBJ remains usable when no sibling MTL exists.
              }
            }
          }
          model = await loader.loadAsync(sourceUrl);
        } else if (extension === 'fbx') {
          model = await new FBXLoader(manager).loadAsync(sourceUrl);
          animations = model.animations;
        } else if (extension === 'stl') {
          const geometry = await new STLLoader(manager).loadAsync(sourceUrl);
          geometry.computeVertexNormals();
          model = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: 0xb8bcc6, roughness: 0.75, metalness: 0.05 }));
        } else {
          throw new Error(`Unsupported 3D format: ${extension || 'unknown'}`);
        }
        model.animations = animations;
        if (disposed) {
          model.traverse((object) => {
            if (!(object as import('three').Mesh).isMesh) return;
            const mesh = object as import('three').Mesh;
            mesh.geometry?.dispose();
            const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
            materials.forEach(disposeMaterial);
          });
          renderer.dispose();
          return;
        }
        scene.add(model);

        const runtime: RuntimeState = {
          THREE,
          scene,
          model,
          animations,
          renderer,
          perspective,
          orthographic,
          activeCamera,
          controls,
          createControls: (camera) => new OrbitControls(camera, renderer.domElement),
          grid,
          keyLight,
          fillLight,
          originals: new Map(),
          animationFrame: 0,
          resizeObserver: null as unknown as ResizeObserver,
          sourceUrl,
        };
        runtimeRef.current = runtime;
        pendingRenderer = null;
        applyMaterialMode(initialPreferences.materialMode);

        const resize = () => {
          const width = Math.max(container.clientWidth, 1);
          const height = Math.max(container.clientHeight, 1);
          renderer.setSize(width, height, false);
          perspective.aspect = width / height;
          perspective.updateProjectionMatrix();
          const aspect = width / height;
          orthographic.left = -aspect;
          orthographic.right = aspect;
          orthographic.top = 1;
          orthographic.bottom = -1;
          orthographic.updateProjectionMatrix();
        };
        runtime.resizeObserver = new ResizeObserver(resize);
        runtime.resizeObserver.observe(container);
        resize();
        fitCamera();

        let snapshotTaken = false;
        const render = () => {
          if (disposed) return;
          runtime.controls.update();
          renderer.render(scene, runtime.activeCamera);
          if (!snapshotTaken && onSnapshotRef.current) {
            snapshotTaken = true;
            renderer.domElement.toBlob((blob) => blob && onSnapshotRef.current?.(blob), 'image/webp', 0.82);
          }
          runtime.animationFrame = requestAnimationFrame(render);
        };
        render();
        setLoading(false);
      } catch (loadError) {
        pendingRenderer?.dispose();
        if (!disposed) {
          setLoading(false);
          const message = loadError instanceof Error ? loadError.message : 'Unable to load this 3D model.';
          setError(message);
          onErrorRef.current?.(message);
        }
      }
    };

    void initialize();
    return () => {
      disposed = true;
      const runtime = runtimeRef.current;
      runtimeRef.current = null;
      if (runtime) {
        cancelAnimationFrame(runtime.animationFrame);
        runtime.resizeObserver.disconnect();
        runtime.controls.dispose();
        runtime.model.traverse((object) => {
          if (!(object as import('three').Mesh).isMesh) return;
          const mesh = object as import('three').Mesh;
          mesh.geometry?.dispose();
          const materials = new Set<import('three').Material>([
            ...(Array.isArray(mesh.material) ? mesh.material : [mesh.material]),
            ...(Array.isArray(runtime.originals.get(mesh))
              ? runtime.originals.get(mesh) as import('three').Material[]
              : runtime.originals.get(mesh)
                ? [runtime.originals.get(mesh) as import('three').Material]
                : []),
          ]);
          materials.forEach(disposeMaterial);
        });
        if (runtime.scene.background && 'isTexture' in runtime.scene.background) {
          runtime.scene.background.dispose();
        }
        runtime.renderer.dispose();
      }
      if (backgroundUrlRef.current) {
        URL.revokeObjectURL(backgroundUrlRef.current);
        backgroundUrlRef.current = null;
      }
    };
  }, [applyMaterialMode, directoryPath, extension, fitCamera, image.handle, image.id, image.name, image.lastModified]);

  const setBackgroundImage = useCallback(async (file: File | null) => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    const previousBackground = runtime.scene.background;
    if (previousBackground && 'isTexture' in previousBackground) {
      previousBackground.dispose();
    }
    if (backgroundUrlRef.current) URL.revokeObjectURL(backgroundUrlRef.current);
    backgroundUrlRef.current = file ? URL.createObjectURL(file) : null;
    if (!file) {
      runtime.scene.background = new runtime.THREE.Color(preferences.backgroundColor);
      return;
    }
    const backgroundUrl = backgroundUrlRef.current;
    const texture = await new runtime.THREE.TextureLoader().loadAsync(backgroundUrl);
    if (runtimeRef.current !== runtime || backgroundUrlRef.current !== backgroundUrl) {
      texture.dispose();
      return;
    }
    texture.colorSpace = runtime.THREE.SRGBColorSpace;
    runtime.scene.background = texture;
  }, [preferences.backgroundColor]);

  const resolveExportMetadata = useCallback(async () => {
    if (!hasCompactedRuntimeMetadata(image)) return metadataPayload;
    const hydrated = await hydrateImageRawMetadata(image, directoryPath);
    return getMetadataPayload(hydrated);
  }, [directoryPath, image, metadataPayload]);

  const saveExport = useCallback(async (blob: Blob, filename: string, exportMetadata: Record<string, unknown>, includeSidecar = true) => {
    const sidecar = new Blob([JSON.stringify(exportMetadata, null, 2)], { type: 'application/json' });
    if (window.electronAPI?.showSaveDialog && window.electronAPI?.writeFile) {
      const extensionName = filename.split('.').pop() || '';
      const result = await window.electronAPI.showSaveDialog({
        title: 'Export 3D Model',
        defaultPath: filename,
        filters: [{ name: extensionName.toUpperCase(), extensions: [extensionName] }],
      });
      if (!result.success || !result.path) return;
      const modelWrite = await window.electronAPI.writeFile(result.path, new Uint8Array(await blob.arrayBuffer()));
      if (!modelWrite.success) throw new Error(modelWrite.error || 'Could not write exported 3D model.');
      if (includeSidecar) {
        const sidecarWrite = await window.electronAPI.writeFile(`${result.path}.imagemetahub.json`, new Uint8Array(await sidecar.arrayBuffer()));
        if (!sidecarWrite.success) throw new Error(sidecarWrite.error || 'Could not write exported metadata sidecar.');
      }
    } else {
      downloadBlob(blob, filename);
      if (includeSidecar) downloadBlob(sidecar, `${filename}.imagemetahub.json`);
    }
  }, []);

  const exportModel = useCallback(async (format: 'glb' | 'obj' | 'stl' | 'fbx') => {
    const runtime = runtimeRef.current;
    if (!runtime || exporting) return;
    setExporting(true);
    try {
      applyMaterialMode('original');
      const base = modelBaseName(image.name);
      const exportMetadata = await resolveExportMetadata();
      if (format === 'glb') {
        const { GLTFExporter } = await import('three/examples/jsm/exporters/GLTFExporter.js');
        const result = await new Promise<ArrayBuffer>((resolve, reject) => {
          new GLTFExporter().parse(runtime.model, (value) => resolve(value as ArrayBuffer), reject, {
            binary: true,
            animations: runtime.animations,
          });
        });
        await saveExport(new Blob([embedMetadataInGlb(result, exportMetadata)], { type: 'model/gltf-binary' }), `${base}.glb`, exportMetadata);
      } else if (format === 'obj') {
        const { OBJExporter } = await import('three/examples/jsm/exporters/OBJExporter.js');
        await saveExport(new Blob([new OBJExporter().parse(runtime.model)], { type: 'model/obj' }), `${base}.obj`, exportMetadata);
      } else if (format === 'stl') {
        const { STLExporter } = await import('three/examples/jsm/exporters/STLExporter.js');
        const value = new STLExporter().parse(runtime.model, { binary: true }) as DataView | ArrayBuffer;
        await saveExport(new Blob([copyBytes(value)], { type: 'model/stl' }), `${base}.stl`, exportMetadata);
      } else {
        const { FBXExporter } = await import('@comfyorg/fbx-exporter-three');
        const bytes = await new FBXExporter().parseAsync(runtime.model);
        await saveExport(new Blob([copyBytes(bytes)], { type: 'application/octet-stream' }), `${base}.fbx`, exportMetadata);
      }
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : '3D export failed.');
    } finally {
      applyMaterialMode(preferencesRef.current.materialMode);
      setExporting(false);
    }
  }, [applyMaterialMode, exporting, image.name, resolveExportMetadata, saveExport]);

  const controlButton = 'inline-flex h-8 items-center gap-1.5 rounded-md border border-gray-700 bg-gray-950/85 px-2 text-xs text-gray-200 hover:bg-gray-800';

  return (
    <div ref={containerRef} className={`relative h-full min-h-[180px] w-full overflow-hidden bg-black ${className}`} data-no-window-drag="true">
      <canvas ref={canvasRef} className="block h-full w-full" />
      {loading && <div className="absolute inset-0 flex items-center justify-center bg-black/70 text-sm text-gray-300">Loading 3D model…</div>}
      {error && <div className="absolute inset-x-4 top-4 rounded-lg border border-red-500/40 bg-red-950/90 p-3 text-sm text-red-100">{error}</div>}
      {showControls && !loading && (
        <div className={`absolute left-2 top-2 flex max-w-[calc(100%-1rem)] flex-wrap gap-1.5 ${compact ? 'scale-90 origin-top-left' : ''}`}>
          <button type="button" className={controlButton} onClick={() => updatePreference('showGrid', !preferences.showGrid)} title="Toggle grid">
            <Grid3X3 size={14} /> Grid
          </button>
          <label className={controlButton} title="Background color">
            <Palette size={14} />
            <input type="color" value={preferences.backgroundColor} onChange={(event) => updatePreference('backgroundColor', event.target.value)} className="h-5 w-6 border-0 bg-transparent p-0" />
          </label>
          <label className={controlButton} title="Upload temporary background image">
            <ImageIcon size={14} /> Background
            <input type="file" accept="image/*" className="hidden" onChange={(event) => void setBackgroundImage(event.target.files?.[0] || null)} />
          </label>
          <label className={controlButton} title="Material mode">
            <Box size={14} />
            <select value={preferences.materialMode} onChange={(event) => updatePreference('materialMode', event.target.value as MaterialMode)} className="bg-transparent outline-none">
              <option value="original">Original</option>
              <option value="normal">Normal</option>
              <option value="wireframe">Wireframe</option>
            </select>
          </label>
          <button type="button" className={controlButton} onClick={() => updatePreference('cameraType', preferences.cameraType === 'perspective' ? 'orthographic' : 'perspective')} title="Switch camera">
            <Camera size={14} /> {preferences.cameraType === 'perspective' ? 'Perspective' : 'Orthographic'}
          </button>
          {preferences.cameraType === 'perspective' && (
            <label className={controlButton} title={`FOV ${preferences.fov}°`}>
              FOV <input type="range" min="15" max="90" step="1" value={preferences.fov} onChange={(event) => updatePreference('fov', Number(event.target.value))} className="w-20" />
            </label>
          )}
          <label className={controlButton} title={`Light intensity ${preferences.lightIntensity.toFixed(1)}`}>
            <Sun size={14} /><input type="range" min="0" max="8" step="0.1" value={preferences.lightIntensity} onChange={(event) => updatePreference('lightIntensity', Number(event.target.value))} className="w-20" />
          </label>
          <button type="button" className={controlButton} onClick={fitCamera} title="Fit model"><Maximize2 size={14} /> Fit</button>
          <button type="button" className={controlButton} onClick={fitCamera} title="Reset camera"><RotateCcw size={14} /></button>
          <label className={controlButton} title="OBJ/STL may not preserve materials, textures, or animations">
            <Download size={14} />
            <select disabled={exporting} defaultValue="" onChange={(event) => { const value = event.target.value as 'glb' | 'obj' | 'stl' | 'fbx'; if (value) void exportModel(value); event.target.value = ''; }} className="bg-transparent outline-none">
              <option value="">{exporting ? 'Exporting…' : 'Export'}</option>
              <option value="glb">GLB</option>
              <option value="obj">OBJ</option>
              <option value="stl">STL</option>
              <option value="fbx">FBX</option>
            </select>
          </label>
        </div>
      )}
      <div className="pointer-events-none absolute bottom-2 left-2 rounded bg-black/60 px-2 py-1 font-mono text-[10px] text-gray-300">X <span className="text-red-400">●</span> Y <span className="text-green-400">●</span> Z <span className="text-blue-400">●</span></div>
      {showControls && !compact && (
        <div className="pointer-events-none absolute bottom-2 right-2 max-w-[55%] rounded bg-black/60 px-2 py-1 text-right text-[10px] text-gray-400">
          GLB recommended. OBJ/STL can lose materials, textures, and animations; STL stores geometry only.
        </div>
      )}
    </div>
  );
};

export default Model3DViewer;
