export interface ParserNode {
  id: string;
  class_type: string;
  inputs: Record<string, any[] | any>;
  widgets_values?: any[];
  mode?: number;
}

export type ComfyNodeDataType =
  | 'MODEL' | 'CONDITIONING' | 'LATENT' | 'IMAGE' | 'VAE' | 'CLIP' | 'INT'
  | 'FLOAT' | 'STRING' | 'CONTROL_NET' | 'GUIDER' | 'SAMPLER' | 'SCHEDULER'
  | 'SIGMAS' | 'NOISE' | 'UPSCALE_MODEL' | 'MASK' | 'ANY' | 'LORA_STACK' | 'SDXL_TUPLE';

export type ComfyTraversableParam =
  | 'prompt' | 'negativePrompt' | 'seed' | 'steps' | 'cfg' | 'width' | 'height'
  | 'model' | 'sampler_name' | 'scheduler' | 'lora' | 'vae' | 'denoise';

export interface WidgetRule { source: 'widget'; key: string; accumulate?: boolean; }
export interface TraceRule { source: 'trace'; input: string; accumulate?: boolean; }
export interface CustomExtractorRule {
  source: 'custom_extractor';
  extractor: (node: ParserNode, state: any, graph: any, traverse: any) => any;
  accumulate?: boolean;
}
export interface InputRule { source: 'input'; key: string; accumulate?: boolean; }
export type ParamMappingRule = WidgetRule | TraceRule | CustomExtractorRule | InputRule;

export interface InputDefinition { type: ComfyNodeDataType; }
export interface OutputDefinition { type: ComfyNodeDataType; }
export interface PassThroughRule { from_input: string; to_output: string; }

export type NodeBehavior = 'SOURCE' | 'SINK' | 'TRANSFORM' | 'PASS_THROUGH' | 'ROUTING';

export interface ConditionalRoutingRule {
  control_input: string;
  dynamic_input_prefix: string;
}

export interface NodeDefinition {
  category: 'SAMPLING' | 'LOADING' | 'CONDITIONING' | 'TRANSFORM' | 'ROUTING' | 'UTILS' | 'IO';
  roles: NodeBehavior[];
  inputs: Record<string, InputDefinition>;
  outputs: Record<string, OutputDefinition>;
  param_mapping?: Partial<Record<ComfyTraversableParam, ParamMappingRule>>;
  pass_through_rules?: PassThroughRule[];
  conditional_routing?: ConditionalRoutingRule;
  widget_order?: string[];
}

// Lineage detection (img2img/inpaint/outpaint). Mirrors the app's central
// types.ts definitions (services/../types.ts) so comfyUIParser.ts can be kept
// in sync between the app and this package without an app-specific import.
export type GenerationType = 'txt2img' | 'img2img' | 'inpaint' | 'outpaint';

export interface SourceImageReference {
  fileName?: string | null;
  relativePath?: string | null;
  absolutePath?: string | null;
  sha256?: string | null;
  width?: number | null;
  height?: number | null;
  nodeId?: string | null;
  nodeType?: string | null;
}

export interface ImageLineage {
  detection?: 'explicit' | 'inferred';
  sourceImage?: SourceImageReference | null;
  workflowSourceImage?: SourceImageReference | null;
  denoiseStrength?: number | null;
  maskBlur?: number | null;
  maskedContent?: string | null;
  resizeMode?: string | null;
}

export interface WorkflowFacts {
  prompts: {
    positive: string | null;
    negative: string | null;
  };
  model: {
    base: string | null;
    vae: string | null;
  };
  loras: Array<{
    name: string;
    modelStrength?: number;
    clipStrength?: number;
  }>;
  sampling: {
    seed: number | null;
    steps: number | null;
    cfg: number | null;
    sampler_name: string | null;
    scheduler: string | null;
    denoise: number | null;
  };
  dimensions: {
    width: number | null;
    height: number | null;
  };
}
