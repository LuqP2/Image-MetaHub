export type ExrMode = 'auto' | 'color' | 'scalar' | 'normal' | 'id';
export interface ExrColorProfile {
  config: string;
  input: string;
  display: string;
  view: string;
}
export interface ExrSettings {
  enabled: boolean;
  global: ExrColorProfile;
  folders: Record<string, ExrColorProfile>;
  revision: number;
}
export interface ExrRuntimeStatus {
  installed: boolean;
  enabled: boolean;
  available: boolean;
  version: string;
  platform: string;
  downloadBytes: number;
  phase?: 'downloading' | 'verifying' | 'installing' | 'ready' | 'error';
  receivedBytes?: number;
  error?: string;
}
export interface ExrPart {
  index: number;
  name: string;
  deep: boolean;
  width: number;
  height: number;
  dataWindow: number[];
  displayWindow: number[];
  pixelAspectRatio: number;
  compression: string;
  channels: Array<{ name: string; type: string }>;
  attributes: Record<string, unknown>;
}
export interface ExrAssetInfo { parts: ExrPart[]; profile?: ExrColorProfile }
export interface ExrConfigInfo {
  spaces: string[];
  displays: Array<{ name: string; views: string[] }>;
  defaultDisplay: string;
  defaultView: string;
  fingerprint: string;
}
export interface ExrPreviewRequest {
  requestId: string;
  filePath: string;
  purpose?: 'thumbnail' | 'viewer';
  profile?: ExrColorProfile;
  part?: number;
  channels?: string[];
  mode?: ExrMode;
  exposure?: number;
  maxEdge?: number;
  range?: [number, number];
  region?: { x: number; y: number; width: number; height: number };
}
export interface ExrPreviewResult {
  url: string;
  width: number;
  height: number;
  assumedInput: boolean;
  input: string;
  mode: ExrMode;
  part: number;
  channels: string[];
  range?: [number, number];
}
export type ExrReply<T> = { success: true; value: T } | { success: false; error: string; code?: string };
export interface ExrAPI {
  status(): Promise<ExrReply<ExrRuntimeStatus>>;
  install(): Promise<ExrReply<ExrRuntimeStatus>>;
  cancelInstall(): Promise<ExrReply<null>>;
  remove(): Promise<ExrReply<null>>;
  settings(): Promise<ExrReply<ExrSettings>>;
  saveSettings(settings: ExrSettings): Promise<ExrReply<ExrSettings>>;
  chooseConfig(): Promise<ExrReply<string | null>>;
  config(config: string): Promise<ExrReply<ExrConfigInfo>>;
  inspect(filePath: string): Promise<ExrReply<ExrAssetInfo>>;
  preview(request: ExrPreviewRequest): Promise<ExrReply<ExrPreviewResult>>;
  cancel(requestId: string): void;
  onChanged(callback: (status?: ExrRuntimeStatus) => void): () => void;
}
