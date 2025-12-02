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

import * as extractors from './extractors';

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

interface WidgetRule { source: 'widget'; key: string; accumulate?: boolean; }
interface TraceRule { source: 'trace'; input: string; accumulate?: boolean; }
interface CustomExtractorRule {
  source: 'custom_extractor';
  extractor: (node: ParserNode, state: any, graph: any, traverse: any) => any;
  accumulate?: boolean;
}
interface InputRule { source: 'input'; key: string; accumulate?: boolean; }
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

// =============================================================================
// SECTION: Node Registry
// =============================================================================

export const NodeRegistry: Record<string, NodeDefinition> = {
  // --- LOADING NODES (Fontes de Verdade) ---
  'Efficient Loader': {
    category: 'LOADING', roles: ['SOURCE', 'TRANSFORM'],
    inputs: { positive: { type: 'STRING' }, negative: { type: 'STRING' } },
    outputs: { MODEL: { type: 'MODEL' }, 'CONDITIONING+': { type: 'CONDITIONING' }, 'CONDITIONING-': { type: 'CONDITIONING' }, LATENT: { type: 'LATENT' }, VAE: { type: 'VAE' } },
    param_mapping: { 
      prompt: { source: 'trace', input: 'positive' }, 
      negativePrompt: { source: 'trace', input: 'negative' }, 
      model: { source: 'widget', key: 'ckpt_name' }, 
      vae: { source: 'widget', key: 'vae_name' }, 
      lora: { source: 'widget', key: 'lora_name' }, 
      seed: { source: 'widget', key: 'seed' }, 
      steps: { source: 'widget', key: 'steps' }, 
      cfg: { source: 'widget', key: 'cfg' }, 
      sampler_name: { source: 'widget', key: 'sampler_name' }, 
      scheduler: { source: 'widget', key: 'scheduler' }, 
      // Note: width/height NOT extracted from workflow - read from actual image dimensions instead
      denoise: { source: 'widget', key: 'denoise' }, 
    },
    // Based on embedded widgets_values array from actual workflow
    widget_order: ['ckpt_name', 'vae_name', 'clip_skip', 'lora_name', 'lora_model_strength', 'lora_clip_strength', 'positive', 'negative', 'token_normalization', 'weight_interpretation', 'empty_latent_width', 'empty_latent_height', 'batch_size']
  },
  CheckpointLoaderSimple: {
    category: 'LOADING', roles: ['SOURCE'], inputs: {},
    outputs: { MODEL: { type: 'MODEL' }, CLIP: { type: 'CLIP' }, VAE: { type: 'VAE' }, },
    param_mapping: { model: { source: 'widget', key: 'ckpt_name' } },
    widget_order: ['ckpt_name']
  },
   VAELoader: {
    category: 'LOADING', roles: ['SOURCE'], inputs: {},
    outputs: { VAE: { type: 'VAE' } },
    param_mapping: { vae: { source: 'widget', key: 'vae_name' } },
    widget_order: ['vae_name']
  },

  // --- SAMPLING NODES (Sinks e Caixas-Pretas) ---
  KSampler: {
    category: 'SAMPLING', roles: ['SINK'],
    inputs: { model: { type: 'MODEL' }, positive: { type: 'CONDITIONING' }, negative: { type: 'CONDITIONING' }, latent_image: { type: 'LATENT' }, },
    outputs: { LATENT: { type: 'LATENT' } },
    param_mapping: { seed: { source: 'widget', key: 'seed' }, steps: { source: 'widget', key: 'steps' }, cfg: { source: 'widget', key: 'cfg' }, sampler_name: { source: 'widget', key: 'sampler_name' }, scheduler: { source: 'widget', key: 'scheduler' }, denoise: { source: 'widget', key: 'denoise' }, model: { source: 'trace', input: 'model' }, prompt: { source: 'trace', input: 'positive' }, negativePrompt: { source: 'trace', input: 'negative' }, },
    // CORRECTED: Some workflows export with a placeholder at index 1 (similar to KSampler Efficient)
    widget_order: ['seed', '__unknown__', 'steps', 'cfg', 'sampler_name', 'scheduler', 'denoise']
  },
  'KSampler (Efficient)': {
    category: 'SAMPLING', roles: ['SINK'],
    inputs: { model: { type: 'MODEL' }, positive: { type: 'CONDITIONING' }, negative: { type: 'CONDITIONING' }, latent_image: { type: 'LATENT' }, seed: { type: 'INT' }, steps: { type: 'INT' }, cfg: { type: 'FLOAT' }, sampler_name: { type: 'SAMPLER' }, scheduler: { type: 'SCHEDULER' }, denoise: { type: 'FLOAT' }, },
    outputs: { LATENT: { type: 'LATENT' }, IMAGE: { type: 'IMAGE' } },
    param_mapping: { 
      seed: { source: 'widget', key: 'seed' },  // Changed from 'trace' to 'widget'
      steps: { source: 'widget', key: 'steps' }, 
      cfg: { source: 'widget', key: 'cfg' }, 
      sampler_name: { source: 'widget', key: 'sampler_name' }, 
      scheduler: { source: 'widget', key: 'scheduler' }, 
      denoise: { source: 'widget', key: 'denoise' }, 
      model: { source: 'trace', input: 'model' }, 
      prompt: { source: 'trace', input: 'positive' }, 
      negativePrompt: { source: 'trace', input: 'negative' }, 
    },
    // CORRECTED order based on actual embedded widgets_values: [seed, null?, steps, cfg, sampler_name, scheduler, denoise, preview_method, vae_decode]
    widget_order: ['seed', '__unknown__', 'steps', 'cfg', 'sampler_name', 'scheduler', 'denoise', 'preview_method', 'vae_decode']
  },
  FaceDetailer: {
    category: 'SAMPLING',
    roles: ['SINK', 'PASS_THROUGH'],
    inputs: { image: { type: 'IMAGE' }, model: { type: 'MODEL' }, clip: { type: 'CLIP' }, vae: { type: 'VAE' }, positive: { type: 'CONDITIONING' }, negative: { type: 'CONDITIONING' }, },
    outputs: { IMAGE: { type: 'IMAGE' } },
    param_mapping: { seed: { source: 'widget', key: 'seed' }, steps: { source: 'widget', key: 'steps' }, cfg: { source: 'widget', key: 'cfg' }, sampler_name: { source: 'widget', key: 'sampler_name' }, denoise: { source: 'widget', key: 'denoise' }, prompt: { source: 'trace', input: 'positive' }, negativePrompt: { source: 'trace', input: 'negative' }, model: { source: 'trace', input: 'model' }, vae: { source: 'trace', input: 'vae' }, },
    pass_through_rules: [{ from_input: 'image', to_output: 'IMAGE' }],
    widget_order: ['seed', 'steps', 'cfg', 'sampler_name', 'scheduler', 'denoise']
  },

  // --- TRANSFORM & PASS-THROUGH NODES ---
  CLIPTextEncode: {
    category: 'LOADING', roles: ['SOURCE'],
    inputs: { clip: { type: 'CLIP' }, text: { type: 'STRING' } }, outputs: { CONDITIONING: { type: 'CONDITIONING' } },
    param_mapping: {
      prompt: {
        source: 'custom_extractor',
        extractor: (node, state, graph, traverse) => {
          // If text comes from a link (like String Literal), trace it
          const textInput = node.inputs?.text;
          if (textInput && Array.isArray(textInput)) {
            return traverse(textInput as any, { ...state, targetParam: 'prompt' }, graph, []);
          }
          // If text is a direct value in inputs, use it
          if (textInput && typeof textInput === 'string') {
            return textInput;
          }
          // Otherwise use widget value at index 0
          if (node.widgets_values?.[0]) {
            return node.widgets_values[0];
          }
          return null;
        }
      },
      negativePrompt: {
        source: 'custom_extractor',
        extractor: (node, state, graph, traverse) => {
          // Same logic as prompt - CLIPTextEncode can be used for both positive and negative
          const textInput = node.inputs?.text;
          if (textInput && Array.isArray(textInput)) {
            return traverse(textInput as any, { ...state, targetParam: 'negativePrompt' }, graph, []);
          }
          if (textInput && typeof textInput === 'string') {
            return textInput;
          }
          if (node.widgets_values?.[0]) {
            return node.widgets_values[0];
          }
          return null;
        }
      }
    },
    widget_order: ['text']
  },
  'ControlNetApply': {
    category: 'TRANSFORM', roles: ['TRANSFORM'],
    inputs: { conditioning: { type: 'CONDITIONING' }, control_net: { type: 'CONTROL_NET' }, image: { type: 'IMAGE' }, },
    outputs: { CONDITIONING: { type: 'CONDITIONING' } },
    param_mapping: { prompt: { source: 'trace', input: 'conditioning' }, negativePrompt: { source: 'trace', input: 'conditioning' }, },
    pass_through_rules: [{ from_input: 'conditioning', to_output: 'CONDITIONING' }],
  },
  LoraLoader: {
    category: 'LOADING', roles: ['TRANSFORM'],
    inputs: { model: { type: 'MODEL' }, clip: { type: 'CLIP' } },
    outputs: { MODEL: { type: 'MODEL' }, CLIP: { type: 'CLIP' } },
    param_mapping: {
      lora: { source: 'widget', key: 'lora_name', accumulate: true },
      model: { source: 'trace', input: 'model' },
    },
    pass_through_rules: [{ from_input: 'model', to_output: 'MODEL' }, { from_input: 'clip', to_output: 'CLIP' },],
    widget_order: ['lora_name', 'strength_model', 'strength_clip']
  },
  'LoRA Stacker': {
    category: 'LOADING', roles: ['TRANSFORM'],
    inputs: {}, outputs: { '*': { type: 'ANY' } },
    param_mapping: { lora: { source: 'custom_extractor', extractor: (node) => {
      // Try both widgets_values and inputs (workflows may have either)
      const loraCount = node.widgets_values?.[0] ?? node.inputs?.lora_count ?? 0;
      if (loraCount === 0) return [];
      
      const loras = [];
      for (let i = 1; i <= loraCount; i++) {
        // For widgets: lora_name is at index i*3 (lora_name_1 at 3, lora_name_2 at 6, etc.)
        // For inputs: lora_name_1, lora_name_2, etc.
        const loraName = node.widgets_values?.[i * 3] ?? node.inputs?.[`lora_name_${i}`];
        if (loraName && loraName !== 'None' && !Array.isArray(loraName)) {
          loras.push(loraName);
        }
      }
      return loras;
    }}},
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
    widget_order: ['filename_prefix', 'subdirectory_name', 'output_format', 'quality', 'metadata_scope', 'include_batch_num', 'prefer_nearest']
  },

  // Common ComfyUI nodes that might appear in workflows
  SaveImage: {
    category: 'IO', roles: ['SINK'],
    inputs: { images: { type: 'IMAGE' } }, 
    outputs: {},
    param_mapping: {},  // No direct params, but traverse inputs
    widget_order: ['filename_prefix']
  },

  PreviewImage: {
    category: 'IO', roles: ['SINK'],
    inputs: { images: { type: 'IMAGE' } }, outputs: {},
  },

  // --- UTILS & PRIMITIVES ---
  'Int Literal': {
    category: 'UTILS', roles: ['SOURCE'],
    inputs: {}, outputs: { INT: { type: 'INT' } },
    param_mapping: { steps: { source: 'widget', key: 'int' }, cfg: { source: 'widget', key: 'int' }, },
    widget_order: ['int']
  },
  'String Literal': {
    category: 'UTILS', roles: ['SOURCE'],
    inputs: { string: { type: 'STRING' } }, outputs: { STRING: { type: 'STRING' } },
    param_mapping: { prompt: { source: 'input', key: 'string' }, negativePrompt: { source: 'input', key: 'string' }, },
  },
  'Seed Generator': {
    category: 'UTILS', roles: ['SOURCE'],
    inputs: { seed: { type: 'INT' } }, outputs: { INT: { type: 'INT' } },
    param_mapping: { seed: { source: 'input', key: 'seed' }, },
  },

  // --- FLUX-SPECIFIC NODES (woman.json workflow) ---
  'Lora Loader (JPS)': {
    category: 'LOADING', roles: ['TRANSFORM'],
    inputs: { model: { type: 'MODEL' }, clip: { type: 'CLIP' } },
    outputs: { MODEL: { type: 'MODEL' }, CLIP: { type: 'CLIP' } },
    param_mapping: {
      lora: { 
        source: 'custom_extractor',
        extractor: (node: ParserNode) => {
          const enabled = node.widgets_values?.[0];
          const loraName = node.widgets_values?.[1];
          // Only include if enabled is "On" and lora name exists
          if (enabled === 'On' && loraName && loraName !== 'None') {
            return [loraName];
          }
          return [];
        }
      }
    },
    widget_order: ['enabled', 'lora_name', 'lora_model_strength', 'lora_clip_strength'],
    pass_through_rules: [
      { from_input: 'model', to_output: 'MODEL' },
      { from_input: 'clip', to_output: 'CLIP' }
    ]
  },

  ModelSamplingFlux: {
    category: 'TRANSFORM', roles: ['PASS_THROUGH'],
    inputs: { model: { type: 'MODEL' } },
    outputs: { MODEL: { type: 'MODEL' } },
    param_mapping: {},
    pass_through_rules: [{ from_input: 'model', to_output: 'MODEL' }]
  },

  DualCLIPLoaderGGUF: {
    category: 'LOADING', roles: ['SOURCE'],
    inputs: {},
    outputs: { CLIP: { type: 'CLIP' } },
    param_mapping: {},
    widget_order: ['clip_name1', 'clip_name2', 'type']
  },

  UnetLoaderGGUF: {
    category: 'LOADING', roles: ['SOURCE'],
    inputs: {},
    outputs: { MODEL: { type: 'MODEL' } },
    param_mapping: {
      model: { source: 'widget', key: 'unet_name' }
    },
    widget_order: ['unet_name']
  },

  CLIPTextEncodeFlux: {
    category: 'CONDITIONING', roles: ['SOURCE'],
    inputs: { 
      clip: { type: 'CLIP' },
      clip_l: { type: 'STRING' },
      t5xxl: { type: 'STRING' }
    },
    outputs: { CONDITIONING: { type: 'CONDITIONING' } },
    param_mapping: {
      prompt: { 
        source: 'custom_extractor',
        extractor: (node, state, graph, traverse) => {
          // Flux uses both clip_l and t5xxl for the full prompt
          const clip_l_link = node.inputs?.clip_l;
          const t5xxl_link = node.inputs?.t5xxl;
          
          let clip_l_text = '';
          let t5xxl_text = '';
          
          // Extract clip_l text
          if (clip_l_link && Array.isArray(clip_l_link)) {
            const clip_l_result = traverse(clip_l_link, { ...state, targetParam: 'prompt' }, graph, []);
            if (clip_l_result) clip_l_text = String(clip_l_result);
          }
          
          // Extract t5xxl text
          if (t5xxl_link && Array.isArray(t5xxl_link)) {
            const t5xxl_result = traverse(t5xxl_link, { ...state, targetParam: 'prompt' }, graph, []);
            if (t5xxl_result) t5xxl_text = String(t5xxl_result);
          }
          
          // Concatenate both parts (clip_l + t5xxl)
          const fullPrompt = [clip_l_text, t5xxl_text].filter(t => t.trim()).join(' ').trim();
          return fullPrompt || null;
        }
      },
      cfg: { source: 'widget', key: 'guidance' }
    },
    widget_order: ['clip_l', 't5xxl', 'guidance']
  },

  ACE_TextGoogleTranslate: {
    category: 'UTILS', roles: ['SOURCE'],
    inputs: {},
    outputs: { STRING: { type: 'STRING' } },
    param_mapping: {
      prompt: { source: 'widget', key: 'text' }
    },
    widget_order: ['text', 'source_lang', 'target_lang']
  },

  UltimateSDUpscale: {
    category: 'SAMPLING', roles: ['SINK'],  // Terminal node for upscale workflows
    inputs: {
      image: { type: 'IMAGE' },
      model: { type: 'MODEL' },
      positive: { type: 'CONDITIONING' },
      negative: { type: 'CONDITIONING' },
      vae: { type: 'VAE' },
      upscale_model: { type: 'UPSCALE_MODEL' }
    },
    outputs: { IMAGE: { type: 'IMAGE' } },
    param_mapping: {
      seed: { source: 'widget', key: 'seed' },
      steps: { source: 'widget', key: 'steps' },
      cfg: { source: 'widget', key: 'cfg' },
      sampler_name: { source: 'widget', key: 'sampler_name' },
      scheduler: { source: 'widget', key: 'scheduler' },
      denoise: { source: 'widget', key: 'denoise' },
      model: { source: 'trace', input: 'model' },
      lora: { source: 'trace', input: 'model' },  // LoRAs travel through model connections
      vae: { source: 'trace', input: 'vae' },
      prompt: { source: 'trace', input: 'positive' },
      negativePrompt: { source: 'trace', input: 'negative' }
    },
    widget_order: [
      'upscale_by',           // 0: Scale factor (e.g., 2)
      'seed',                 // 1: Seed value
      'seed_mode',            // 2: 'randomize', 'fixed', etc.
      'steps',                // 3: Sampling steps
      'cfg',                  // 4: CFG scale
      'sampler_name',         // 5: Sampler algorithm
      'scheduler',            // 6: Scheduler type
      'denoise',              // 7: Denoise strength
      'mode_type',            // 8: Upscale mode
      'tile_width',           // 9: Tile width
      'tile_height',          // 10: Tile height
      'mask_blur',            // 11: Mask blur
      'tile_padding',         // 12: Tile padding
      'seam_fix_mode',        // 13: Seam fix mode
      'seam_fix_denoise',     // 14: Seam fix denoise
      'seam_fix_width',       // 15: Seam fix width
      'seam_fix_mask_blur',   // 16: Seam fix mask blur
      'seam_fix_padding',     // 17: Seam fix padding
      'force_uniform_tiles',  // 18: Force uniform tiles
      'tiled_decode'          // 19: Tiled decode
    ]
  },

  GetImageSizeAndCount: {
    category: 'UTILS', roles: ['TRANSFORM'],
    inputs: { image: { type: 'IMAGE' } },
    outputs: { 
      image: { type: 'IMAGE' },
      width: { type: 'INT' },
      height: { type: 'INT' },
      count: { type: 'INT' }
    },
    param_mapping: {},
    pass_through_rules: [{ from_input: 'image', to_output: 'image' }]
  },

  'PlaySound|pysssss': {
    category: 'UTILS', roles: ['PASS_THROUGH'],
    inputs: { any: { type: 'ANY' } },
    outputs: { '*': { type: 'ANY' } },
    param_mapping: {},
    widget_order: ['mode', 'volume', 'sound_file'],
    pass_through_rules: [{ from_input: 'any', to_output: '*' }]
  },

  LoadImage: {
    category: 'IO', roles: ['SOURCE'],
    inputs: {},
    outputs: { IMAGE: { type: 'IMAGE' }, MASK: { type: 'MASK' } },
    param_mapping: {},
    widget_order: ['image', 'upload']
  },

  Reroute: {
    category: 'UTILS', roles: ['PASS_THROUGH'],
    inputs: { '*': { type: 'ANY' } },
    outputs: { '*': { type: 'ANY' } },
    param_mapping: {},
    pass_through_rules: [{ from_input: '*', to_output: '*' }]
  },

  // Flux-specific nodes for oreos.json workflow
  FluxGuidance: {
    category: 'CONDITIONING', roles: ['TRANSFORM'],
    inputs: { conditioning: { type: 'CONDITIONING' } },
    outputs: { CONDITIONING: { type: 'CONDITIONING' } },
    param_mapping: {},
    widget_order: ['guidance'],
    pass_through_rules: [{ from_input: 'conditioning', to_output: 'CONDITIONING' }]
  },

  FluxResolutionNode: {
    category: 'UTILS', roles: ['SOURCE'],
    inputs: {},
    outputs: { 
      width: { type: 'INT' },
      height: { type: 'INT' }
    },
    param_mapping: {
      width: { source: 'input', key: 'width' },
      height: { source: 'input', key: 'height' }
    },
    widget_order: ['megapixel', 'aspect_ratio', 'custom_ratio', 'custom_aspect_ratio']
  },

  'Automatic CFG - Warp Drive': {
    category: 'TRANSFORM', roles: ['PASS_THROUGH'],
    inputs: { model: { type: 'MODEL' } },
    outputs: { MODEL: { type: 'MODEL' } },
    param_mapping: {},
    widget_order: ['uncond_sigma_start', 'uncond_sigma_end', 'fake_uncond_sigma_end'],
    pass_through_rules: [{ from_input: 'model', to_output: 'MODEL' }]
  },

  UNETLoader: {
    category: 'LOADING', roles: ['SOURCE'],
    inputs: {},
    outputs: { MODEL: { type: 'MODEL' } },
    param_mapping: {
      model: { source: 'widget', key: 'unet_name' }
    },
    widget_order: ['unet_name', 'weight_dtype']
  },

  EmptyLatentImage: {
    category: 'LOADING', roles: ['SOURCE'],
    inputs: {},
    outputs: { LATENT: { type: 'LATENT' } },
    param_mapping: {
      width: { source: 'input', key: 'width' },
      height: { source: 'input', key: 'height' }
    },
    widget_order: ['width', 'height', 'batch_size']
  },

  ImageUpscaleWithModel: {
    category: 'TRANSFORM', roles: ['TRANSFORM'],
    inputs: { 
      upscale_model: { type: 'UPSCALE_MODEL' },
      image: { type: 'IMAGE' }
    },
    outputs: { IMAGE: { type: 'IMAGE' } },
    param_mapping: {},
    pass_through_rules: []
  },

  UpscaleModelLoader: {
    category: 'LOADING', roles: ['SOURCE'],
    inputs: {},
    outputs: { UPSCALE_MODEL: { type: 'UPSCALE_MODEL' } },
    param_mapping: {},
    widget_order: ['model_name']
  },

  'LayerUtility: PurgeVRAM': {
    category: 'UTILS', roles: ['PASS_THROUGH'],
    inputs: { anything: { type: 'ANY' } },
    outputs: { '*': { type: 'ANY' } },
    param_mapping: {},
    widget_order: ['purge_cache', 'purge_models', 'anything'],
    pass_through_rules: [{ from_input: 'anything', to_output: '*' }]
  },

  'easy showAnything': {
    category: 'UTILS', roles: ['PASS_THROUGH'],
    inputs: { anything: { type: 'ANY' } },
    outputs: { '*': { type: 'ANY' } },
    param_mapping: {},
    widget_order: ['text', 'anything'],
    pass_through_rules: [{ from_input: 'anything', to_output: '*' }]
  },

  DualCLIPLoader: {
    category: 'LOADING', roles: ['SOURCE'],
    inputs: {},
    outputs: { CLIP: { type: 'CLIP' } },
    param_mapping: {},
    widget_order: ['clip_name1', 'clip_name2', 'type', 'device']
  },

  // --- GROUPED/WORKFLOW NODES (Custom Meta-Nodes) ---
  'workflow>Load Model - Flux': {
    category: 'LOADING', roles: ['SOURCE'],
    inputs: {},
    outputs: { MODEL: { type: 'MODEL' }, CLIP: { type: 'CLIP' }, VAE: { type: 'VAE' } },
    param_mapping: {
      vae: { source: 'widget', key: 'vae_name' },
      model: { source: 'widget', key: 'unet_name' }
    },
    // Widget order from coolpigeon.json node 64: ['FLUX1/ae.safetensors', 'FLUX/flux1-dev.safetensors', 'fp8_e5m2', ...]
    widget_order: ['vae_name', 'unet_name', 'weight_dtype', 'clip_name1', 'clip_name2', 'clip_type', 'lora1', 'lora1_strength', 'lora2', 'lora2_strength', 'lora3', 'lora3_strength', 'lora4', 'lora4_strength']
  },

  'workflow>CLIP Encode - Flux': {
    category: 'CONDITIONING', roles: ['SOURCE', 'TRANSFORM'],
    inputs: { 
      clip: { type: 'CLIP' },
      model: { type: 'MODEL' },
      anything3: { type: 'ANY' }
    },
    outputs: { GUIDER: { type: 'GUIDER' }, LATENT: { type: 'LATENT' } },
    param_mapping: {
      prompt: { source: 'widget', key: 'positive_prompt' },
      negativePrompt: { source: 'widget', key: 'negative_prompt' },
      seed: { source: 'widget', key: 'seed' }
    },
    // Widget order from coolpigeon.json node 51: ['Snapshot of...', 'stunning mens...', true, 1345, 'increment', ...]
    widget_order: ['positive_prompt', 'negative_prompt', 'wildcard_enabled', 'seed', 'seed_mode', 'wildcard_text', 'resolution', 'upscale_factor', 'width_offset', 'height_offset', 'lora_trigger_1', 'lora_trigger_2', 'credit', 'cfg_scale', 'batch_size']
  },

  'workflow>Sampler/Scheduler - Flux': {
    category: 'SAMPLING', roles: ['SINK'],
    inputs: {
      model: { type: 'MODEL' },
      guider: { type: 'GUIDER' },
      latent_image: { type: 'LATENT' },
      vae: { type: 'VAE' }
    },
    outputs: { denoised_output: { type: 'LATENT' }, IMAGE: { type: 'IMAGE' } },
    param_mapping: {
      seed: { source: 'widget', key: 'seed' },
      steps: { source: 'widget', key: 'steps' },
      sampler_name: { source: 'widget', key: 'sampler_name' },
      scheduler: { source: 'widget', key: 'scheduler' },
      cfg: { source: 'widget', key: 'cfg' },
      denoise: { source: 'widget', key: 'denoise' },
      model: { source: 'trace', input: 'model' },
      prompt: { source: 'trace', input: 'guider' }
    },
    // Widget order from coolpigeon.json node 42: [seed, seed_mode, sampler, scheduler, steps, denoise]
    widget_order: ['seed', 'seed_mode', 'sampler_name', 'scheduler', 'steps', 'denoise']
  },

  // Additional grouped workflow support nodes
  RandomNoise: {
    category: 'UTILS', roles: ['SOURCE'],
    inputs: {},
    outputs: { NOISE: { type: 'NOISE' } },
    param_mapping: {
      seed: { source: 'widget', key: 'noise_seed' }
    },
    widget_order: ['noise_seed', 'seed_mode']
  },

  KSamplerSelect: {
    category: 'UTILS', roles: ['SOURCE'],
    inputs: {},
    outputs: { SAMPLER: { type: 'SAMPLER' } },
    param_mapping: {
      sampler_name: { source: 'widget', key: 'sampler_name' }
    },
    widget_order: ['sampler_name']
  },

  BasicScheduler: {
    category: 'UTILS', roles: ['TRANSFORM'],
    inputs: { model: { type: 'MODEL' } },
    outputs: { SIGMAS: { type: 'SIGMAS' } },
    param_mapping: {
      scheduler: { source: 'widget', key: 'scheduler' },
      steps: { source: 'widget', key: 'steps' },
      denoise: { source: 'widget', key: 'denoise' }
    },
    widget_order: ['scheduler', 'steps', 'denoise'],
    pass_through_rules: []
  },

  SamplerCustomAdvanced: {
    category: 'SAMPLING', roles: ['SINK'],
    inputs: {
      noise: { type: 'NOISE' },
      guider: { type: 'GUIDER' },
      sampler: { type: 'SAMPLER' },
      sigmas: { type: 'SIGMAS' },
      latent_image: { type: 'LATENT' }
    },
    outputs: { output: { type: 'LATENT' }, denoised_output: { type: 'LATENT' } },
    param_mapping: {
      seed: { source: 'trace', input: 'noise' },
      sampler_name: { source: 'trace', input: 'sampler' },
      scheduler: { source: 'trace', input: 'sigmas' },
      steps: { source: 'trace', input: 'sigmas' },
      prompt: { source: 'trace', input: 'guider' },
      cfg: { source: 'trace', input: 'guider' },
      model: { source: 'trace', input: 'guider' }
    }
  },

  BasicGuider: {
    category: 'CONDITIONING', roles: ['TRANSFORM'],
    inputs: {
      model: { type: 'MODEL' },
      conditioning: { type: 'CONDITIONING' }
    },
    outputs: { GUIDER: { type: 'GUIDER' } },
    param_mapping: {
      model: { source: 'trace', input: 'model' },
      prompt: { source: 'trace', input: 'conditioning' },
      negativePrompt: { source: 'trace', input: 'conditioning' }
    },
    widget_order: []
  },

  CFGGuider: {
    category: 'CONDITIONING', roles: ['TRANSFORM'],
    inputs: {
      model: { type: 'MODEL' },
      positive: { type: 'CONDITIONING' },
      negative: { type: 'CONDITIONING' }
    },
    outputs: { GUIDER: { type: 'GUIDER' } },
    param_mapping: {
      cfg: { source: 'widget', key: 'cfg' },
      prompt: { source: 'trace', input: 'positive' },
      negativePrompt: { source: 'trace', input: 'negative' }
    },
    widget_order: ['cfg']
  },

  CascadeResolutions: {
    category: 'UTILS', roles: ['SOURCE'],
    inputs: {},
    outputs: { width: { type: 'INT' }, height: { type: 'INT' } },
    param_mapping: {
      width: { source: 'widget', key: 'resolution' },
      height: { source: 'widget', key: 'resolution' }
    },
    widget_order: ['resolution', 'upscale_factor', 'width_offset', 'height_offset']
  },

  'ttN concat': {
    category: 'UTILS', roles: ['TRANSFORM'],
    inputs: { text1: { type: 'STRING' }, text2: { type: 'STRING' }, text3: { type: 'STRING' } },
    outputs: { concat: { type: 'STRING' } },
    param_mapping: {
      prompt: {
        source: 'custom_extractor',
        extractor: (node, state, graph, traverseFromLink) => {
          return extractors.concatTextExtractor(node, state, graph, traverseFromLink, ['text1', 'text2', 'text3'], 'delimiter');
        }
      }
    },
    widget_order: ['text1', 'text2', 'text3', 'delimiter']
  },

  'Anything Everywhere': {
    category: 'UTILS', roles: ['PASS_THROUGH'],
    inputs: { anything: { type: 'ANY' } },
    outputs: {},
    param_mapping: {},
    pass_through_rules: []
  },

  'Anything Everywhere3': {
    category: 'UTILS', roles: ['PASS_THROUGH'],
    inputs: { 
      anything: { type: 'ANY' },
      anything2: { type: 'ANY' },
      anything3: { type: 'ANY' }
    },
    outputs: {},
    param_mapping: {},
    pass_through_rules: []
  },

  'Save image with extra metadata [Crystools]': {
    category: 'IO', roles: ['SINK'],
    inputs: { image: { type: 'IMAGE' } },
    outputs: { 'Metadata RAW': { type: 'ANY' } },
    param_mapping: {},
    widget_order: ['output_path', 'embed_workflow', 'metadata_json']
  },

  // Grouped Workflow Nodes - Support for composite nodes that contain multiple child nodes
  'workflow>Generation Parameters': {
    category: 'UTILS', roles: ['SOURCE'],
    inputs: {},
    outputs: {
      INT: { type: 'INT' },        // steps
      FLOAT: { type: 'FLOAT' },    // cfg
      'Seed Generator INT': { type: 'INT' }, // seed
      scheduler: { type: 'STRING' }, // scheduler
      sampler: { type: 'STRING' },   // sampler
      sampler_name: { type: 'STRING' }, // sampler_name
      'Scheduler Selector (Image Saver) scheduler': { type: 'STRING' }, // scheduler for Image Saver
      scheduler_name: { type: 'STRING' }  // scheduler_name
    },
    param_mapping: {
      steps: { source: 'widget', key: 'steps' },
      cfg: { source: 'widget', key: 'cfg' },
      seed: { source: 'widget', key: 'seed' },
      scheduler: { source: 'widget', key: 'scheduler' },
      sampler_name: { source: 'widget', key: 'sampler_name' }
    },
    widget_order: ['steps', 'cfg', 'seed', 'scheduler', 'sampler_name', 'scheduler_name']
  },

  // --- UTILS NODES (Processamento de Texto e Wildcards) ---
// Adicione após a definição do node 'ImpactWildcardProcessor' existente (ou substitua):

ImpactWildcardProcessor: {
  category: 'UTILS',
  roles: ['SOURCE'],
  inputs: {},
  outputs: { STRING: { type: 'STRING' } },
  param_mapping: {
    prompt: {
      source: 'custom_extractor',
      extractor: (node: ParserNode) => {
        const text = extractors.getWildcardOrPopulatedText(node);
        return extractors.cleanWildcardText(text);
      }
    }
  },
  widget_order: ['wildcard_text', 'populated_text', 'mode', 'seed', 'seed_mode', 'select_wildcard']
},
ImpactWildcardEncode: {
  category: 'UTILS',
  roles: ['SOURCE', 'TRANSFORM'],
  inputs: {
    model: { type: 'MODEL' },
    clip: { type: 'CLIP' }
  },
  outputs: {
    model: { type: 'MODEL' },
    clip: { type: 'CLIP' },
    conditioning: { type: 'CONDITIONING' },
    populated_text: { type: 'STRING' }
  },
  param_mapping: {
    lora: {
      source: 'custom_extractor',
      extractor: (node: ParserNode) => {
        const text = node.inputs?.wildcard_text || node.widgets_values?.[0] || '';
        return extractors.extractLorasFromText(text);
      }
    },
    prompt: {
      source: 'custom_extractor',
      extractor: (node: ParserNode) => {
        const text = node.inputs?.wildcard_text || node.widgets_values?.[0] || '';
        return extractors.removeLoraTagsFromText(text) || null;
      }
    }
  },
  widget_order: ['wildcard_text', 'populated_text', 'mode', 'Select to add LoRA', 'Select to add Wildcard', 'seed', 'seed_mode', 'speak_and_recognation'],
  pass_through_rules: [
    { from_input: 'model', to_output: 'model' },
    { from_input: 'clip', to_output: 'clip' }
  ]
},
JWStringConcat: {
  category: 'UTILS',
  roles: ['TRANSFORM'],
  inputs: {
    a: { type: 'STRING' },
    b: { type: 'STRING' }
  },
  outputs: {
    STRING: { type: 'STRING' }
  },
  param_mapping: {
    prompt: {
      source: 'custom_extractor',
      extractor: (node, state, graph, traverseFromLink) => {
        return extractors.concatTextExtractor(node, state, graph, traverseFromLink, ['a', 'b']);
      }
    }
  },
  widget_order: ['a', 'b']
},
String: {
  category: 'UTILS',
  roles: ['SOURCE'],
  inputs: {},
  outputs: { STRING: { type: 'STRING' } },
  param_mapping: {
    prompt: { source: 'widget', key: 'String' },
    negativePrompt: { source: 'widget', key: 'String' }
  },
  widget_order: ['String', 'speak_and_recognation']
},
  // --- LOADING NODES (LoRA Stack Management) ---
  'CR Apply LoRA Stack': {
  category: 'LOADING',
  roles: ['TRANSFORM'],
  inputs: {
    model: { type: 'MODEL' },
    clip: { type: 'CLIP' },
    lora_stack: { type: 'LORA_STACK' }
  },
  outputs: {
    MODEL: { type: 'MODEL' },
    CLIP: { type: 'CLIP' },
    show_help: { type: 'STRING' }
  },
  param_mapping: {
    lora: { source: 'trace', input: 'lora_stack' },
    model: { source: 'trace', input: 'model' }
  },
  pass_through_rules: [
    { from_input: 'model', to_output: 'MODEL' },
    { from_input: 'clip', to_output: 'CLIP' }
  ]
},
'CR LoRA Stack': {
  category: 'LOADING',
  roles: ['TRANSFORM'],
  inputs: {
    lora_stack: { type: 'LORA_STACK' }
  },
  outputs: {
    LORA_STACK: { type: 'LORA_STACK' },
    show_help: { type: 'STRING' }
  },
  param_mapping: {
    lora: {
      source: 'custom_extractor',
      extractor: (node: ParserNode) => {
        const widgets = node.widgets_values || [];
        return extractors.extractLorasFromStack(widgets, 4, 0, 1);
      }
    }
  },
  widget_order: [
    'switch_1', 'lora_name_1', 'model_weight_1', 'clip_weight_1',
    'switch_2', 'lora_name_2', 'model_weight_2', 'clip_weight_2',
    'switch_3', 'lora_name_3', 'model_weight_3', 'clip_weight_3'
  ],
  pass_through_rules: []
},
// --- TEXT AND PROMPT NODES ---
'DF_Text_Box': {
  category: 'CONDITIONING',
  roles: ['SOURCE'],
  inputs: {},
  outputs: { STRING: { type: 'STRING' } },
  param_mapping: {
    prompt: { source: 'widget', key: 'Text' }
  },
  widget_order: ['Text']
},
// --- SDXL LOADER NODE ---
'Eff. Loader SDXL': {
  category: 'LOADING',
  roles: ['SOURCE', 'TRANSFORM'],
  inputs: {
    lora_stack: { type: 'LORA_STACK' },
    positive: { type: 'STRING' },
    negative: { type: 'STRING' },
    empty_latent_width: { type: 'INT' },
    empty_latent_height: { type: 'INT' },
    batch_size: { type: 'INT' }
  },
  outputs: {
    SDXL_TUPLE: { type: 'SDXL_TUPLE' },
    LATENT: { type: 'LATENT' },
    VAE: { type: 'VAE' },
    DEPENDENCIES: { type: 'ANY' }
  },
  param_mapping: {
    prompt: { source: 'trace', input: 'positive' },
    negativePrompt: { source: 'trace', input: 'negative' },
    model: { source: 'widget', key: 'base_ckpt_name' },
    vae: { source: 'widget', key: 'vae_name' },
    lora: { source: 'trace', input: 'lora_stack' }
  },
  widget_order: [
    'base_ckpt_name', 'base_clip_skip', 'refiner_ckpt_name', 'refiner_clip_skip',
    'positive_ascore', 'negative_ascore', 'vae_name', 'positive', 'negative',
    'token_normalization', 'weight_interpretation', 'empty_latent_width',
    'empty_latent_height', 'batch_size'
  ]
},
// --- SDXL UNPACKER NODE ---
'Unpack SDXL Tuple': {
  category: 'TRANSFORM',
  roles: ['PASS_THROUGH'],
  inputs: {
    sdxl_tuple: { type: 'SDXL_TUPLE' }
  },
  outputs: {
    BASE_MODEL: { type: 'MODEL' },
    BASE_CLIP: { type: 'CLIP' },
    'BASE_CONDITIONING+': { type: 'CONDITIONING' },
    'BASE_CONDITIONING-': { type: 'CONDITIONING' },
    REFINER_MODEL: { type: 'MODEL' },
    REFINER_CLIP: { type: 'CLIP' },
    'REFINER_CONDITIONING+': { type: 'CONDITIONING' },
    'REFINER_CONDITIONING-': { type: 'CONDITIONING' }
  },
  param_mapping: {
    prompt: { source: 'trace', input: 'sdxl_tuple' },
    negativePrompt: { source: 'trace', input: 'sdxl_tuple' },
    model: { source: 'trace', input: 'sdxl_tuple' },
    vae: { source: 'trace', input: 'sdxl_tuple' }
  },
  pass_through_rules: [
    { from_input: 'sdxl_tuple', to_output: 'BASE_MODEL' },
    { from_input: 'sdxl_tuple', to_output: 'BASE_CLIP' },
    { from_input: 'sdxl_tuple', to_output: 'BASE_CONDITIONING+' },
    { from_input: 'sdxl_tuple', to_output: 'BASE_CONDITIONING-' }
  ]
}
};