
/**
 * @file types.ts
 * @description Shared type definitions for ComfyUI parser to avoid circular dependencies.
 */

// =============================================================================
// SECTION: Type Definitions (Schema Fortificado)
// =============================================================================

export interface ParserNode {
  id: string;
  class_type: string;
  inputs: Record<string, any[] | any>;
  widgets_values?: any[];
  mode?: number; // Para detectar nós silenciados (0: ativo, 2/4: mudo/bypass)
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

/**
 * Nova regra para nós de roteamento dinâmico.
 */
export interface ConditionalRoutingRule {
    control_input: string; // O input/widget que controla o fluxo (ex: 'select')
    dynamic_input_prefix: string; // O prefixo da entrada de dados (ex: 'input_')
}

export interface NodeDefinition {
  category: 'SAMPLING' | 'LOADING' | 'CONDITIONING' | 'TRANSFORM' | 'ROUTING' | 'UTILS' | 'IO';
  roles: NodeBehavior[]; // Um nó pode ter múltiplos papéis.
  inputs: Record<string, InputDefinition>;
  outputs: Record<string, OutputDefinition>;
  param_mapping?: Partial<Record<ComfyTraversableParam, ParamMappingRule>>;
  pass_through_rules?: PassThroughRule[];
  conditional_routing?: ConditionalRoutingRule; // Para nós como ImpactSwitch
  widget_order?: string[]; // Ordered list of widget names for index-based extraction
}

/**
 * Structured workflow facts extracted from the graph.
 * This separates "what was extracted" from "how to present it".
 */
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
