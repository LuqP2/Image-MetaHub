import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box, Camera, Download, Grid3X3, Image as ImageIcon, Maximize2, Palette, RotateCcw, Sun } from 'lucide-react';
import type { IndexedImage } from '../types';
import { getRelativeImagePath, mediaSourceCache } from '../services/mediaSourceCache';
import { hasCompactedRuntimeMetadata, hydrateImageRawMetadata } from '../services/rawMetadataHydration';
import { useImageStore } from '../store/useImageStore';
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
  modalControls?: boolean;
  className?: string;
  onOpenSourceImage?: (image: IndexedImage) => void;
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

const disposeRenderer = (renderer: import('three').WebGLRenderer) => {
  renderer.forceContextLoss();
  renderer.dispose();
};

const trimJsonChunkPadding = (value: string): string => {
  let end = value.length;
  while (end > 0) {
    const character = value[end - 1];
    if (character.charCodeAt(0) !== 0 && character.trim() !== '') break;
    end -= 1;
  }
  return value.slice(0, end);
};

export const safeModel3DAssetPath = (directoryPath: string, relativeModelPath: string, resourceUrl: string): string | null => {
  if (/^(?:[a-z][a-z0-9+.-]*:|\/|\\)/i.test(resourceUrl)) return null;
  let cleanResource: string;
  try {
    cleanResource = decodeURIComponent(resourceUrl.split(/[?#]/, 1)[0] || '').replace(/\\/g, '/');
  } catch {
    return null;
  }
  const cleanModelPath = relativeModelPath.replace(/\\/g, '/');
  if (!cleanResource || /^(?:[a-z][a-z0-9+.-]*:|\/)/i.test(cleanResource)) return null;
  if (/^(?:[a-z][a-z0-9+.-]*:|\/)/i.test(cleanModelPath)) return null;

  const normalizeWithinRoot = (parts: string[]): string[] | null => {
    const normalized: string[] = [];
    for (const part of parts) {
      if (!part || part === '.') continue;
      if (part === '..') {
        if (normalized.length === 0) return null;
        normalized.pop();
      } else {
        normalized.push(part);
      }
    }
    return normalized;
  };

  const modelParts = normalizeWithinRoot(cleanModelPath.split('/'));
  if (!modelParts) return null;
  modelParts.pop();
  const resolvedParts = normalizeWithinRoot([...modelParts, ...cleanResource.split('/')]);
  if (!resolvedParts) return null;
  const base = directoryPath.replace(/[\\/]$/, '');
  const separator = directoryPath.startsWith('/') ? '/' : directoryPath.includes('\\') ? '\\' : '/';
  return [base, ...resolvedParts].join(separator);
};

const buildProtocolUrl = (absolutePath: string) =>
  `imh-media://local/?path=${encodeURIComponent(absolutePath)}`;

const VIRTUAL_LOCAL_RESOURCE_PREFIX = 'imh-media://local/';

export const resolveModel3DResourceUrl = (
  directoryPath: string | undefined,
  relativeModelPath: string,
  sourceUrl: string,
  resourceUrl: string,
): string | null => {
  if (resourceUrl === sourceUrl || /^(?:blob:|data:)/i.test(resourceUrl)) {
    return resourceUrl;
  }
  if (!directoryPath) return null;

  const isVirtualLocalResource = resourceUrl.startsWith(VIRTUAL_LOCAL_RESOURCE_PREFIX)
    && !resourceUrl.slice(VIRTUAL_LOCAL_RESOURCE_PREFIX.length).startsWith('?');
  const relativeUrl = isVirtualLocalResource
    ? resourceUrl.slice(VIRTUAL_LOCAL_RESOURCE_PREFIX.length)
    : resourceUrl;
  const resolved = safeModel3DAssetPath(directoryPath, relativeModelPath, relativeUrl);
  return resolved ? buildProtocolUrl(resolved) : null;
};

export const extractObjMaterialLibraries = (objText: string): string[] => {
  const libraries: string[] = [];
  const seen = new Set<string>();

  for (const line of objText.split(/\r?\n/)) {
    const match = /^\s*mtllib\s+(.+?)\s*$/i.exec(line);
    if (!match) continue;

    const tokens = match[1].match(/"[^"]+"|'[^']+'|\S+/g) || [];
    for (const token of tokens) {
      if (token.startsWith('#')) break;
      const library = token.replace(/^(?:"|')|(?:"|')$/g, '');
      if (library && !seen.has(library)) {
        seen.add(library);
        libraries.push(library);
      }
    }
  }

  return libraries;
};

type ObjMaterialLibrary<T> = {
  materialsInfo: Record<string, unknown>;
  create: (materialName: string) => T | undefined;
};

export const combineObjMaterialLibraries = <T,>(
  libraries: Array<ObjMaterialLibrary<T>>,
): Pick<ObjMaterialLibrary<T>, 'create'> => ({
  create: (materialName: string) => {
    // Later mtllib declarations take precedence when material names overlap,
    // while each creator keeps its own base path for relative textures.
    for (let index = libraries.length - 1; index >= 0; index -= 1) {
      const library = libraries[index];
      if (Object.prototype.hasOwnProperty.call(library.materialsInfo, materialName)) {
        return library.create(materialName);
      }
    }
    return undefined;
  },
});

const getVirtualResourceDirectory = (resourcePath: string): string => {
  const parts = resourcePath.replace(/\\/g, '/').split('/');
  parts.pop();
  return parts.length > 0 ? `${VIRTUAL_LOCAL_RESOURCE_PREFIX}${parts.join('/')}/` : VIRTUAL_LOCAL_RESOURCE_PREFIX;
};

const parseMetadataRecord = (value: unknown): Record<string, unknown> | null => {
  if (typeof value === 'string') {
    try {
      return parseMetadataRecord(JSON.parse(value));
    } catch {
      return null;
    }
  }
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
};

export const getModel3DExportMetadataPayload = (
  image: Pick<IndexedImage, 'metadata'>,
): Record<string, unknown> => {
  const rawMetadata = image.metadata as Record<string, unknown> | undefined;
  const normalizedMetadata = parseMetadataRecord(rawMetadata?.normalizedMetadata) || {};
  const embedded = parseMetadataRecord(rawMetadata?.imagemetahub_data);
  const payload: Record<string, unknown> = embedded
    ? { ...embedded }
    : {
        schema_version: 1,
        media_type: 'model3d',
        generator: normalizedMetadata.generator || 'Image MetaHub',
        ...normalizedMetadata,
      };

  const workflow = parseMetadataRecord(rawMetadata?.workflow);
  const promptApi = parseMetadataRecord(rawMetadata?.prompt_api)
    || parseMetadataRecord(rawMetadata?.prompt);
  if (workflow && !parseMetadataRecord(payload.workflow)) {
    payload.workflow = workflow;
  }
  if (promptApi && !parseMetadataRecord(payload.prompt_api)) {
    payload.prompt_api = promptApi;
  }

  return payload;
};

export const embedMetadataInGlb = (buffer: ArrayBuffer, metadata: Record<string, unknown>): ArrayBuffer => {
  const source = new Uint8Array(buffer);
  if (source.byteLength < 20 || new TextDecoder().decode(source.slice(0, 4)) !== 'glTF') return buffer;
  const view = new DataView(buffer);
  const jsonLength = view.getUint32(12, true);
  if (view.getUint32(16, true) !== 0x4e4f534a || 20 + jsonLength > source.byteLength) return buffer;
  const document = JSON.parse(trimJsonChunkPadding(new TextDecoder().decode(source.slice(20, 20 + jsonLength))));
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
  modalControls = false,
  className = '',
  onOpenSourceImage,
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
  const resolvedLineage = useImageStore(
    useCallback((state) => state.getResolvedLineage(image.id), [image.id])
  );
  const sourceImage = useImageStore(
    useCallback((state) => {
      const sourceImageId = state.lineageResolvedByImageId[image.id]?.sourceImageId;
      if (!sourceImageId) return null;
      return state.images.find((candidate) => candidate.id === sourceImageId)
        ?? state.filteredImages.find((candidate) => candidate.id === sourceImageId)
        ?? null;
    }, [image.id])
  );

  useEffect(() => {
    preferencesRef.current = preferences;
  }, [preferences]);

  useEffect(() => {
    onSnapshotRef.current = onSnapshot;
  }, [onSnapshot]);

  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  const metadataPayload = useMemo(() => getModel3DExportMetadataPayload(image), [image]);
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
        mesh.material = new runtime.THREE.MeshNormalMaterial({
          // Flat shading derives face normals in the fragment shader, so models
          // with missing or invalid vertex normals do not render black.
          flatShading: true,
          side: runtime.THREE.DoubleSide,
          toneMapped: false,
        });
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
        const trustedLocalResourceUrls = new Set([sourceUrl]);
        if (window.electronAPI) {
          manager.setURLModifier((url) => {
            if (trustedLocalResourceUrls.has(url)) return url;
            const resolved = resolveModel3DResourceUrl(directoryPath, relativeModelPath, sourceUrl, url);
            if (!resolved) {
              throw new Error(`Blocked external or unsafe 3D resource: ${url}`);
            }
            return resolved;
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
          const response = await fetch(sourceUrl);
          if (!response.ok) throw new Error(`Could not load OBJ (${response.status})`);
          const objText = await response.text();
          if (window.electronAPI && directoryPath) {
            const declaredLibraries = extractObjMaterialLibraries(objText);
            const materialLibraries = declaredLibraries.length > 0
              ? declaredLibraries
              : [`${modelBaseName(image.name)}.mtl`];
            const loadedMaterialLibraries: Array<ObjMaterialLibrary<import('three').Material>> = [];

            for (const materialLibrary of materialLibraries) {
              const materialPath = safeModel3DAssetPath(directoryPath, relativeModelPath, materialLibrary);
              if (!materialPath) continue;

              try {
                const materialUrl = buildProtocolUrl(materialPath);
                trustedLocalResourceUrls.add(materialUrl);
                const materialLoader = new MTLLoader(manager);
                materialLoader.setResourcePath(getVirtualResourceDirectory(materialLibrary));
                const materials = await materialLoader.loadAsync(materialUrl);
                materials.preload();
                loadedMaterialLibraries.push(materials);
              } catch {
                // Try the next declared library; geometry remains usable without materials.
              }
            }

            if (loadedMaterialLibraries.length > 0) {
              loader.setMaterials(
                combineObjMaterialLibraries(loadedMaterialLibraries) as Parameters<typeof loader.setMaterials>[0],
              );
            }
          }
          model = loader.parse(objText);
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
          disposeRenderer(renderer);
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
        if (pendingRenderer) disposeRenderer(pendingRenderer);
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
        disposeRenderer(runtime.renderer);
      }
      if (backgroundUrlRef.current) {
        URL.revokeObjectURL(backgroundUrlRef.current);
        backgroundUrlRef.current = null;
      }
    };
  }, [applyMaterialMode, directoryPath, extension, fitCamera, image.contentModifiedMs, image.handle, image.id, image.name, image.lastModified]);

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
    return getModel3DExportMetadataPayload(hydrated);
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
  const sourceReferenceName = resolvedLineage?.sourceReference?.fileName
    || resolvedLineage?.sourceReference?.relativePath
    || resolvedLineage?.sourceReference?.absolutePath
    || null;
  const controlsPosition = modalControls
    ? 'left-20 right-20 top-14 z-30 justify-center lg:left-28 lg:right-28'
    : 'left-2 top-2 z-30 max-w-[calc(100%-1rem)]';
  const minimumHeightClass = compact || !showControls ? 'min-h-0' : 'min-h-[180px]';

  return (
    <div ref={containerRef} className={`relative h-full ${minimumHeightClass} w-full overflow-hidden bg-black ${className}`} data-no-window-drag="true">
      <canvas ref={canvasRef} className="block h-full w-full" />
      {loading && <div className="absolute inset-0 flex items-center justify-center bg-black/70 text-sm text-gray-300">Loading 3D model…</div>}
      {error && <div className="absolute inset-x-4 top-4 rounded-lg border border-red-500/40 bg-red-950/90 p-3 text-sm text-red-100">{error}</div>}
      {showControls && !loading && (
        <div className={`absolute flex flex-wrap gap-1.5 ${controlsPosition} ${compact ? 'scale-90 origin-top-left' : ''}`}>
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
            <select value={preferences.materialMode} onChange={(event) => updatePreference('materialMode', event.target.value as MaterialMode)} className="rounded bg-gray-950 text-gray-100 outline-none [color-scheme:dark]">
              <option value="original" className="bg-gray-950 text-gray-100">Original</option>
              <option value="normal" className="bg-gray-950 text-gray-100">Normal</option>
              <option value="wireframe" className="bg-gray-950 text-gray-100">Wireframe</option>
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
            <select disabled={exporting} defaultValue="" onChange={(event) => { const value = event.target.value as 'glb' | 'obj' | 'stl' | 'fbx'; if (value) void exportModel(value); event.target.value = ''; }} className="rounded bg-gray-950 text-gray-100 outline-none [color-scheme:dark]">
              <option value="" className="bg-gray-950 text-gray-100">{exporting ? 'Exporting…' : 'Export'}</option>
              <option value="glb" className="bg-gray-950 text-gray-100">GLB</option>
              <option value="obj" className="bg-gray-950 text-gray-100">OBJ</option>
              <option value="stl" className="bg-gray-950 text-gray-100">STL</option>
              <option value="fbx" className="bg-gray-950 text-gray-100">FBX</option>
            </select>
          </label>
        </div>
      )}
      {!loading && (sourceImage || sourceReferenceName) && (
        sourceImage && onOpenSourceImage ? (
          <button
            type="button"
            onClick={() => onOpenSourceImage(sourceImage)}
            className="absolute bottom-9 left-1/2 z-30 max-w-[70%] -translate-x-1/2 truncate rounded-md border border-blue-400/30 bg-black/75 px-2.5 py-1 text-xs text-blue-200 backdrop-blur-sm hover:bg-blue-950/90"
            title={`Open source image: ${sourceImage.name}`}
          >
            Generated from: {sourceImage.name}
          </button>
        ) : (
          <div
            className="pointer-events-none absolute bottom-9 left-1/2 z-30 max-w-[70%] -translate-x-1/2 truncate rounded-md border border-blue-400/20 bg-black/70 px-2.5 py-1 text-xs text-blue-200 backdrop-blur-sm"
            title={sourceImage?.name || sourceReferenceName || undefined}
          >
            Generated from: {sourceImage?.name || sourceReferenceName}
          </div>
        )
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
