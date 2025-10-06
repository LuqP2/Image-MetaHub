/**
 * @file nodeRegistry.ts
 * @description Contém a definição declarativa para nós de workflow ComfyUI.
 * Esta configuração alimenta o traversalEngine para extrair metadados de grafos
 * de forma determinística e extensível.
 *
 * @version 3.0.0
 * @description Arquitetura "Red Teamed" e Fortificada.
 * - Substitui `behavior` por `roles: NodeBehavior[]` para nós de múltiplo papel.
 * - Adiciona `conditional_routing` para suportar travessia dinâmica em nós de switch.
 * - O schema agora descreve o comportamento dinâmico e de estado, não apenas caminhos estáticos.
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
  | 'SIGMAS' | 'NOISE' | 'UPSCALE_MODEL' | 'ANY';

export type ComfyTraversableParam =
  | 'prompt' | 'negativePrompt' | 'seed' | 'steps' | 'cfg' | 'width' | 'height'
  | 'model' | 'sampler_name' | 'scheduler' | 'lora' | 'vae' | 'denoise';

interface WidgetRule { source: 'widget'; key: string; }
interface TraceRule { source: 'trace'; input: string; }
interface CustomExtractorRule { source: 'custom_extractor'; extractor: (node: ParserNode) => any; }
export type ParamMappingRule = WidgetRule | TraceRule | CustomExtractorRule;

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
  category: 'SAMPLING' | 'LOADING' | 'TRANSFORM' | 'ROUTING' | 'UTILS' | 'IO';
  roles: NodeBehavior[]; // Um nó pode ter múltiplos papéis.
  inputs: Record<string, InputDefinition>;
  outputs: Record<string, OutputDefinition>;
  param_mapping?: Partial<Record<ComfyTraversableParam, ParamMappingRule>>;
  pass_through_rules?: PassThroughRule[];
  conditional_routing?: ConditionalRoutingRule; // Para nós como ImpactSwitch
}

// =============================================================================
// SECTION: Node Registry
// =============================================================================

export const NodeRegistry: Record<string, NodeDefinition> = {
  // --- LOADING NODES (Fontes de Verdade) ---
  'Efficient Loader': {
    category: 'LOADING', roles: ['SOURCE'], inputs: {},
    outputs: { MODEL: { type: 'MODEL' }, 'CONDITIONING+': { type: 'CONDITIONING' }, 'CONDITIONING-': { type: 'CONDITIONING' }, LATENT: { type: 'LATENT' }, VAE: { type: 'VAE' } },
    param_mapping: { prompt: { source: 'widget', key: 'positive' }, negativePrompt: { source: 'widget', key: 'negative' }, model: { source: 'widget', key: 'ckpt_name' }, vae: { source: 'widget', key: 'vae_name' }, lora: { source: 'widget', key: 'lora_name' }, seed: { source: 'widget', key: 'seed' }, steps: { source: 'widget', key: 'steps' }, cfg: { source: 'widget', key: 'cfg' }, sampler_name: { source: 'widget', key: 'sampler_name' }, scheduler: { source: 'widget', key: 'scheduler' }, width: { source: 'widget', key: 'width' }, height: { source: 'widget', key: 'height' }, denoise: { source: 'widget', key: 'denoise' }, }
  },
  CheckpointLoaderSimple: {
    category: 'LOADING', roles: ['SOURCE'], inputs: {},
    outputs: { MODEL: { type: 'MODEL' }, CLIP: { type: 'CLIP' }, VAE: { type: 'VAE' }, },
    param_mapping: { model: { source: 'widget', key: 'ckpt_name' } },
  },
   VAELoader: {
    category: 'LOADING', roles: ['SOURCE'], inputs: {},
    outputs: { VAE: { type: 'VAE' } },
    param_mapping: { vae: { source: 'widget', key: 'vae_name' } },
  },

  // --- SAMPLING NODES (Sinks e Caixas-Pretas) ---
  KSampler: {
    category: 'SAMPLING', roles: ['SINK'],
    inputs: { model: { type: 'MODEL' }, positive: { type: 'CONDITIONING' }, negative: { type: 'CONDITIONING' }, latent_image: { type: 'LATENT' }, },
    outputs: { LATENT: { type: 'LATENT' } },
    param_mapping: { seed: { source: 'widget', key: 'seed' }, steps: { source: 'widget', key: 'steps' }, cfg: { source: 'widget', key: 'cfg' }, sampler_name: { source: 'widget', key: 'sampler_name' }, scheduler: { source: 'widget', key: 'scheduler' }, denoise: { source: 'widget', key: 'denoise' }, model: { source: 'trace', input: 'model' }, prompt: { source: 'trace', input: 'positive' }, negativePrompt: { source: 'trace', input: 'negative' }, },
  },
  FaceDetailer: {
    category: 'SAMPLING',
    roles: ['SINK', 'PASS_THROUGH'],
    inputs: { image: { type: 'IMAGE' }, model: { type: 'MODEL' }, clip: { type: 'CLIP' }, vae: { type: 'VAE' }, positive: { type: 'CONDITIONING' }, negative: { type: 'CONDITIONING' }, },
    outputs: { IMAGE: { type: 'IMAGE' } },
    param_mapping: { seed: { source: 'widget', key: 'seed' }, steps: { source: 'widget', key: 'steps' }, cfg: { source: 'widget', key: 'cfg' }, sampler_name: { source: 'widget', key: 'sampler_name' }, denoise: { source: 'widget', key: 'denoise' }, prompt: { source: 'trace', input: 'positive' }, negativePrompt: { source: 'trace', input: 'negative' }, model: { source: 'trace', input: 'model' }, vae: { source: 'trace', input: 'vae' }, },
    pass_through_rules: [{ from_input: 'image', to_output: 'IMAGE' }]
  },

  // --- TRANSFORM & PASS-THROUGH NODES ---
  CLIPTextEncode: {
    category: 'LOADING', roles: ['SOURCE'],
    inputs: { clip: { type: 'CLIP' } }, outputs: { CONDITIONING: { type: 'CONDITIONING' } },
    param_mapping: { prompt: { source: 'widget', key: 'text' }, negativePrompt: { source: 'widget', key: 'text' }, },
  },
  LoraLoader: {
    category: 'LOADING', roles: ['TRANSFORM'],
    inputs: { model: { type: 'MODEL' }, clip: { type: 'CLIP' } },
    outputs: { MODEL: { type: 'MODEL' }, CLIP: { type: 'CLIP' } },
    param_mapping: { lora: { source: 'widget', key: 'lora_name' }, model: { source: 'trace', input: 'model' }, },
    pass_through_rules: [{ from_input: 'model', to_output: 'MODEL' }, { from_input: 'clip', to_output: 'CLIP' },],
  },

  // --- ROUTING NODES (Estático e Dinâmico) ---
  'Reroute (rgthree)': {
    category: 'ROUTING', roles: ['PASS_THROUGH'],
    inputs: { '*': { type: 'ANY' } }, outputs: { '*': { type: 'ANY' } },
    pass_through_rules: [{ from_input: '*', to_output: '*' }],
  },
  ImpactSwitch: {
    category: 'ROUTING', roles: ['ROUTING'],
    inputs: { select: { type: 'INT' }, input1: { type: 'ANY' }, input2: { type: 'ANY' } },
    outputs: { '*': { type: 'ANY' } },
    conditional_routing: {
        control_input: 'select',
        dynamic_input_prefix: 'input'
    }
  },

  // --- IO NODES ---
  VAEDecode: {
    category: 'IO', roles: ['TRANSFORM'],
    inputs: { samples: { type: 'LATENT' }, vae: { type: 'VAE' }, },
    outputs: { IMAGE: { type: 'IMAGE' } },
    param_mapping: { vae: { source: 'trace', input: 'vae' }, },
    pass_through_rules: [{ from_input: 'samples', to_output: 'IMAGE' }]
  },
  SaveImageWithMetaData: {
    category: 'IO', roles: ['SINK'],
    inputs: { images: { type: 'IMAGE' } }, outputs: {},
  },

  // --- UTILS & PRIMITIVES ---
  'Int Literal': {
    category: 'UTILS', roles: ['SOURCE'],
    inputs: {}, outputs: { INT: { type: 'INT' } },
    param_mapping: { steps: { source: 'widget', key: 'int' }, cfg: { source: 'widget', key: 'int' }, },
  },
};

