/**
 * This file defines the schema for the ComfyUI Node Registry.
 * The registry uses a declarative, data-driven approach to describe the behavior and properties of each ComfyUI node.
 * This allows the parsing engine to be generic and extensible, instead of containing hardcoded logic for each node type.
 */

/**
 * The expected data type for a node's input or output connection.
 * This is crucial for the type-aware traversal engine.
 */
export type ComfyNodeDataType =
  | 'MODEL'
  | 'CONDITIONING'
  | 'LATENT'
  | 'IMAGE'
  | 'VAE'
  | 'CLIP'
  | 'INT'
  | 'FLOAT'
  | 'STRING'
  | 'CONTROL_NET'
  | 'PIPE'
  | 'GUIDER'
  | 'SAMPLER'
  | 'SCHEDULER'
  | 'SIGMAS'
  | 'ANY'; // A wildcard type for generic connections

/**
 * The high-level parameter being searched for by the traversal engine.
 */
export type ComfyTraversableParam =
  | 'prompt'
  | 'negativePrompt'
  | 'seed'
  | 'steps'
  | 'cfg'
  | 'width'
  | 'height'
  | 'model'
  | 'sampler'
  | 'scheduler'
  | 'lora'
  | 'vae';

/**
 * Defines a single input slot for a node.
 */
export interface InputDefinition {
  type: ComfyNodeDataType;
}

/**
 * Defines a single output slot for a node.
 */
export interface OutputDefinition {
  type: ComfyNodeDataType;
}

/**
 * Defines how a high-level traversable parameter (like 'seed') maps to a specific
 * input field or widget on the node.
 */
export interface ParamMappingRule {
  /** The source of the value on the node. */
  source: 'input' | 'widget';
  /** The name of the input field or widget. */
  key: string;
}

/**
 * For nodes that pass data through (e.g., Reroute), this defines the mapping
 * from a specific input to a specific output.
 */
export interface PassThroughRule {
  from_input: string;
  to_output: string;
}

/**
 * Defines the primary behavior of a node in the data flow.
 * - SOURCE: Originates a value (e.g., CLIPTextEncode, EmptyLatentImage).
 * - SINK: A terminal node for a path (e.g., SaveImage, KSampler).
 * - TRANSFORM: Modifies data (e.g., ConditioningCombine).
 * - PASS_THROUGH: Forwards data without modification (e.g., Reroute).
 * - ROUTING: A more complex pass-through that might have conditional logic.
 */
export type NodeBehavior = 'SOURCE' | 'SINK' | 'TRANSFORM' | 'PASS_THROUGH' | 'ROUTING';

/**
 * The complete definition for a given `class_type` of a ComfyUI node.
 */
export interface NodeDefinition {
  /** A broad functional category for the node. */
  category: 'SAMPLING' | 'LOADING' | 'TRANSFORM' | 'ROUTING' | 'UTILS' | 'IO';
  /** The primary role of the node in the data flow. */
  behavior: NodeBehavior;
  /** A map of the node's input slots and their expected data types. */
  inputs: Record<string, InputDefinition>;
  /** A map of the node's output slots and the data types they provide. */
  outputs: Record<string, OutputDefinition>;
  /** Rules for mapping high-level parameters to specific inputs/widgets on this node. */
  param_mapping?: Partial<Record<ComfyTraversableParam, ParamMappingRule>>;
  /** For PASS_THROUGH or TRANSFORM nodes, defines how data flows from input to output. */
  pass_through_rules?: PassThroughRule[];
  /** For TRANSFORM nodes, defines how multiple inputs of the same type are combined. */
  composition_rule?: 'concat' | 'add' | 'average';
}

/**
 * The Node Registry.
 * This is a map where the key is the `class_type` of a ComfyUI node, and the value
 * is its declarative definition.
 */
export const NodeRegistry: Record<string, NodeDefinition> = {
  // --- SAMPLING NODES ---
  KSampler: {
    category: 'SAMPLING',
    behavior: 'SINK', // It's the target for most parameter searches.
    inputs: {
      model: { type: 'MODEL' },
      positive: { type: 'CONDITIONING' },
      negative: { type: 'CONDITIONING' },
      latent_image: { type: 'LATENT' },
      seed: { type: 'INT' },
      steps: { type: 'INT' },
      cfg: { type: 'FLOAT' },
      sampler_name: { type: 'SAMPLER' },
      scheduler: { type: 'SCHEDULER' },
    },
    outputs: {
      LATENT: { type: 'LATENT' },
    },
    param_mapping: {
      seed: { source: 'input', key: 'seed' },
      steps: { source: 'input', key: 'steps' },
      cfg: { source: 'input', key: 'cfg' },
      sampler: { source: 'input', key: 'sampler_name' },
      scheduler: { source: 'input', key: 'scheduler' },
      positive: { source: 'input', key: 'positive' },
      negative: { source: 'input', key: 'negative' },
      model: { source: 'input', key: 'model' },
    },
  },

  // --- TEXT ENCODING NODES ---
  CLIPTextEncode: {
    category: 'LOADING',
    behavior: 'SOURCE',
    inputs: {
      clip: { type: 'CLIP' },
      text: { type: 'STRING' },
    },
    outputs: {
      CONDITIONING: { type: 'CONDITIONING' },
    },
    param_mapping: {
      prompt: { source: 'widget', key: 'text' },
      negativePrompt: { source: 'widget', key: 'text' },
    },
  },

  // --- LATENT NODES ---
  EmptyLatentImage: {
    category: 'SAMPLING',
    behavior: 'SOURCE',
    inputs: {
      width: { type: 'INT' },
      height: { type: 'INT' },
      batch_size: { type: 'INT' },
    },
    outputs: {
      LATENT: { type: 'LATENT' },
    },
    param_mapping: {
      width: { source: 'input', key: 'width' },
      height: { source: 'input', key: 'height' },
    },
  },

  // --- ROUTING NODES ---
  Reroute: {
    category: 'ROUTING',
    behavior: 'PASS_THROUGH',
    inputs: {
      '': { type: 'ANY' }, // Reroute has a dynamic input name
    },
    outputs: {
      '': { type: 'ANY' }, // and a dynamic output name
    },
    // The engine will need a special case for Reroute since its io names are not fixed.
    // A pass_through_rule is not sufficient here.
  },

  // --- IO NODES ---
  SaveImage: {
    category: 'IO',
    behavior: 'SINK',
    inputs: {
      images: { type: 'IMAGE' },
      filename_prefix: { type: 'STRING' },
    },
    outputs: {},
  },

  // --- MODEL/LORA LOADERS ---
  CheckpointLoaderSimple: {
    category: 'LOADING',
    behavior: 'SOURCE',
    inputs: {
      ckpt_name: { type: 'STRING' },
    },
    outputs: {
      MODEL: { type: 'MODEL' },
      CLIP: { type: 'CLIP' },
      VAE: { type: 'VAE' },
    },
    param_mapping: {
      model: { source: 'widget', key: 'ckpt_name' },
    },
  },
  LoraLoader: {
    category: 'LOADING',
    behavior: 'TRANSFORM',
    inputs: {
      model: { type: 'MODEL' },
      clip: { type: 'CLIP' },
      lora_name: { type: 'STRING' },
      strength_model: { type: 'FLOAT' },
      strength_clip: { type: 'FLOAT' },
    },
    outputs: {
      MODEL: { type: 'MODEL' },
      CLIP: { type: 'CLIP' },
    },
    param_mapping: {
      lora: { source: 'widget', key: 'lora_name' },
    },
    pass_through_rules: [
      { from_input: 'model', to_output: 'MODEL' },
      { from_input: 'clip', to_output: 'CLIP' },
    ],
  },
};