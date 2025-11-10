# ComfyUI Parser Development Guide

## Overview

This document provides comprehensive guidance for developing and maintaining the ComfyUI metadata parser. The parser uses a **rule-based, declarative architecture** that handles graph complexities natively, outperforming legacy string-based parsers.

**Current Status (v0.9.5)**: Production-ready with robust handling of complex workflows including efficiency-nodes, custom samplers, and multi-path prompt tracing.

**Location**: `services/parsers/comfyui/`

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Node Registry Reference](#node-registry-reference)
3. [Widget Order Specifications](#widget-order-specifications)
4. [Testing & Validation](#testing--validation)
5. [Common Issues & Solutions](#common-issues--solutions)
6. [Future Enhancements](#future-enhancements)

---

## Architecture Overview

### Core Components

**1. Graph Construction (`comfyUIParser.ts`)**
- Merges `workflow` (UI data with widgets_values) and `prompt` (execution data with inputs)
- Handles NaN sanitization in exported JSON
- Overlays workflow.nodes onto prompt data for complete graph representation
- Populates inputs from workflow.links for incomplete prompts

**2. Traversal Engine (`traversalEngine.ts`)**
- Graph traversal from terminal SINK nodes backwards through connections
- Mode-aware: skips muted nodes (mode 2/4)
- State-aware: maintains traversal context for complex parameter resolution
- Supports multiple traversal strategies:
  - **Single Path**: Follow one connection (for unique params like seed)
  - **Multi-Path**: Explore all paths and select best value (for prompts)
  - **Pass-Through**: Continue traversal through routing nodes

**3. Node Registry (`nodeRegistry.ts`)**
- Declarative node definitions with:
  - **Roles**: SOURCE, SINK, TRANSFORM, PASS_THROUGH, ROUTING
  - **Inputs/Outputs**: Typed connections (MODEL, CONDITIONING, LATENT, etc.)
  - **param_mapping**: Rules for extracting parameters
  - **widget_order**: Index-based mapping for widgets_values arrays

### Key Design Decisions

**✅ Why Rule-Based Architecture?**
- ComfyUI workflows are graphs, not linear sequences
- Different node types require different extraction strategies
- Extensible: add new nodes by registering definitions
- Maintainable: clear separation of concerns

**✅ Why Read Dimensions from Image Files?**
- Workflow dimensions are generation settings, not final output
- Images may be upscaled, cropped, or resized after generation
- Reading from PNG properties is more accurate and reliable
- **Implementation**: `fileIndexer.ts` uses Image API to read actual width/height

**✅ Why Separate widgets_values and inputs?**
- **widgets_values**: UI widget data (flat array, position-based)
- **inputs**: Execution connections (object with link references)
- PNG exports may contain both or only one
- Fallback strategy: `widgets_values → inputs → defaults`

---

## Node Registry Reference

### Node Definition Structure

```typescript
'Node Type Name': {
  category: 'LOADING' | 'SAMPLING' | 'CONDITIONING' | 'TRANSFORM' | 'ROUTING',
  roles: ['SOURCE', 'SINK', 'TRANSFORM', 'PASS_THROUGH', 'ROUTING'],
  inputs: { 
    input_name: { type: 'MODEL' | 'CONDITIONING' | 'LATENT' | ... }
  },
  outputs: { 
    output_name: { type: 'MODEL' | 'CONDITIONING' | 'LATENT' | ... }
  },
  param_mapping: {
    prompt: { source: 'widget', key: 'text' },           // Extract from widgets_values
    seed: { source: 'trace', input: 'seed' },            // Follow connection
    lora: { source: 'custom_extractor', extractor: fn }, // Custom logic
  },
  widget_order: ['widget_name1', 'widget_name2', ...],  // Index mapping
  pass_through: [                                        // Pass-through rules
    { from_input: 'model', to_output: 'MODEL' }
  ],
  conditional_routing: {                                 // For switch nodes
    control_input: 'select',
    branches: { ... }
  }
}
```

### Parameter Mapping Sources

**1. Widget Extraction (`source: 'widget'`)**
```typescript
{ source: 'widget', key: 'steps' }
// Reads from widgets_values[widget_order.indexOf('steps')]
```

**2. Input Tracing (`source: 'trace'`)**
```typescript
{ source: 'trace', input: 'positive' }
// Follows inputs['positive'] connection to source node
```

**3. Direct Input (`source: 'input'`)**
```typescript
{ source: 'input', key: 'seed' }
// Reads directly from inputs object (for non-link values)
```

**4. Custom Extractor (`source: 'custom_extractor'`)**
```typescript
{ 
  source: 'custom_extractor', 
  extractor: (node: ParserNode) => {
    // Custom logic for complex cases
    return extractedValue;
  }
}
```

---

## Widget Order Specifications

**CRITICAL**: `widget_order` arrays MUST match the exact sequence in embedded PNG `widgets_values` data. Mismatches cause value swapping bugs.

### Verified Widget Orders (from Primary Sources)

**Source**: efficiency-nodes-comfyui wiki, RunComfy docs, community workflows

#### Efficient Loader
```typescript
widget_order: [
  'ckpt_name',                // 0: Checkpoint model file
  'vae_name',                 // 1: VAE model (or 'Baked VAE')
  'clip_skip',                // 2: CLIP skip layers (-1, -2, etc.)
  'lora_name',                // 3: LoRA file name
  'lora_model_strength',      // 4: LoRA strength for model
  'lora_clip_strength',       // 5: LoRA strength for CLIP
  'positive',                 // 6: Positive prompt text
  'negative',                 // 7: Negative prompt text
  'token_normalization',      // 8: Token normalization method
  'weight_interpretation',    // 9: Weight interpretation method
  'empty_latent_width',       // 10: Generation width
  'empty_latent_height',      // 11: Generation height
  'batch_size'                // 12: Batch size
]
```

---

## Testing & Validation

### Test Strategy (Target: 95%+ Accuracy)

**1. Unit Tests for Node Extraction**
```javascript
test('KSampler (Efficient) extracts steps correctly', async () => {
  const node = {
    id: '55',
    class_type: 'KSampler (Efficient)',
    widgets_values: [625212262135330, null, 28, 3, 'euler_ancestral', 'normal', 1, 'auto', 'true']
  };
  
  const result = extractValue(node, { source: 'widget', key: 'steps' });
  expect(result).toBe(28);
});
```

**2. Integration Tests for Workflows**
```javascript
test('test workflow parses correctly', async () => {
  const workflow = JSON.parse(fs.readFileSync('./fixtures/comfyui/test.json'));
  const result = resolvePromptFromGraph(workflow, workflow);
  
  expect(result.prompt).toBeDefined();
  expect(result.steps).toBeGreaterThan(0);
  expect(result.seed).toBeDefined();
});
```

---

## Common Issues & Solutions

### Issue 1: Value Swapping in KSampler (Efficient)

**Symptom**: `steps=0, cfg=28, sampler=3` instead of `steps=28, cfg=3, sampler='euler'`

**Cause**: Missing `__unknown__` placeholder at index 1 in widget_order

**Solution**:
```typescript
// WRONG:
widget_order: ['seed', 'steps', 'cfg', 'sampler_name', 'scheduler']

// CORRECT:
widget_order: ['seed', '__unknown__', 'steps', 'cfg', 'sampler_name', 'scheduler']
```

### Issue 2: Unknown Node Types

**Symptom**: Parser returns `null` for all parameters

**Cause**: Node not registered in NodeRegistry

**Solution**: Add logging and fallback
```typescript
const nodeDef = NodeRegistry[node.class_type];
if (!nodeDef) {
  console.warn(`[ComfyUI Parser] Unknown node type: ${node.class_type}`);
  // Continue traversal to parent nodes
  return state.targetParam === 'lora' ? accumulator : null;
}
```

---

## Future Enhancements

### Priority 1: Auto-Discovery

**Goal**: Automatically detect widget_order from ComfyUI node definitions

### Priority 2: Multi-Prompt Handling

**Goal**: Handle workflows with multiple CLIPTextEncode nodes

### Priority 3: Export Interoperability

**Goal**: Export parsed metadata to standard formats

---

## Contributing

To contribute improvements to the ComfyUI parser:

1. **Test with Real Workflows**: Submit problematic workflows to improve coverage
2. **Document Node Types**: Add widget_order specs for new nodes
3. **Report Issues**: Include workflow JSON and expected vs actual results
4. **Submit PRs**: Follow testing checklist

---

**Version**: 0.9.5  
**Last Updated**: November 10, 2025  
**Maintainer**: Image MetaHub Development Team  
**Status**: Production Ready ✅
