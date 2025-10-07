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
  | 'SIGMAS' | 'NOISE' | 'UPSCALE_MODEL' | 'MASK' | 'ANY';

export type ComfyTraversableParam =
  | 'prompt' | 'negativePrompt' | 'seed' | 'steps' | 'cfg' | 'width' | 'height'
  | 'model' | 'sampler_name' | 'scheduler' | 'lora' | 'vae' | 'denoise';

interface WidgetRule { source: 'widget'; key: string; }
interface TraceRule { source: 'trace'; input: string; }
interface CustomExtractorRule { 
  source: 'custom_extractor'; 
  extractor: (node: ParserNode, state: any, graph: any, traverse: any) => any; 
}
interface InputRule { source: 'input'; key: string; }
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
    widget_order: ['seed', 'steps', 'cfg', 'sampler_name', 'scheduler', 'denoise']
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
    inputs: { clip: { type: 'CLIP' } }, outputs: { CONDITIONING: { type: 'CONDITIONING' } },
    param_mapping: { prompt: { source: 'widget', key: 'text' }, negativePrompt: { source: 'widget', key: 'text' }, },
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
    param_mapping: { lora: { source: 'widget', key: 'lora_name' }, model: { source: 'trace', input: 'model' }, },
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
};

