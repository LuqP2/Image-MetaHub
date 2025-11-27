# ComfyUI Parser Development Guide

## Overview

This document provides comprehensive guidance for developing and maintaining the ComfyUI metadata parser. The parser uses a **rule-based, declarative architecture** that handles graph complexities natively, outperforming legacy string-based parsers.

**Current Status (v0.9.5)**: Production-ready with robust handling of complex workflows including efficiency-nodes, custom samplers, and multi-path prompt tracing.

**Location**: `services/parsers/comfyui/`

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Node Registry Reference](#node-registry-reference)
3. [Widget Order Specifications](#widget-order-specifications)
4. [How to Reverse-Engineer widget_order](#how-to-reverse-engineer-widget_order)
5. [Node Roles Clarification](#node-roles-clarification)
6. [Testing & Validation](#testing--validation)
7. [Common Issues & Solutions](#common-issues--solutions)
8. [Future Enhancements](#future-enhancements)

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

## How to Reverse-Engineer widget_order

**Problem**: The node definition requires `widget_order` array, but this isn't always documented. You need to extract it without reading Python source code.

### Method 1: Export Workflow as JSON (Recommended - 2 minutes)

**Step 1**: Open your workflow in ComfyUI UI
**Step 2**: Save the workflow and locate the JSON file (or right-click → "Save workflow as JSON")
**Step 3**: Open the JSON in a text editor and find your node:

```json
{
  "1": {
    "class_type": "UltimateSDUpscale",
    "inputs": {
      "image": [15, 0],
      "model": [3, 0],
      "seed": 12345,
      "denoise": 1.0
    },
    "widgets_values": [4, 12345, 1.0]
  }
}
```

**Step 4**: In the ComfyUI UI, click on the node and note the order of widgets displayed:
- 1st widget: `upscale_by` (value: 4)
- 2nd widget: `seed` (value: 12345)
- 3rd widget: `denoise` (value: 1.0)

**Step 5**: Map the indices to widget names:
```typescript
widget_order: ['upscale_by', 'seed', 'denoise']
```

### Method 2: Browser DevTools (For Debugging - 3 minutes)

**Step 1**: Open ComfyUI in browser, press `F12` to open DevTools
**Step 2**: Go to Console tab
**Step 3**: Click on your node to select it
**Step 4**: Paste this command:
```javascript
// Find the currently selected node in the canvas
const node = app.canvas.selected_nodes[0];
if (node && node.widgets) {
  console.table(node.widgets.map((w, i) => ({ index: i, name: w.name, value: w.value })));
}
```

**Step 5**: Copy the output mapping directly

### Method 3: Inspect ComfyUI Python Definitions

If the node is from a custom pack, check the GitHub repo:
- Look for `node.py` or `__init__.py`
- Search for the class definition and `RETURN_TYPES` or `INPUT_TYPES`
- The order in `INPUT_TYPES['required']` or `INPUT_TYPES['optional']` → widgets order (skipping inputs that connect to other nodes)

**Example**: ComfyUI-Manager nodes are documented in: https://github.com/ltdrdata/ComfyUI-Manager

### ⚠️ Common Pitfalls

**Pitfall 1**: Confusing widgets with node inputs
- **Widgets** = UI controls in the node (sliders, dropdowns, text boxes) → appear in `widgets_values`
- **Inputs** = connections to other nodes → appear in `inputs` object
- Example: `UltimateSDUpscale` has widget `seed` but also **connects** `model` from another node

**Pitfall 2**: Not accounting for `__unknown__` placeholders
- Some nodes have gaps in their widget array (deprecated or hidden widgets)
- Use `__unknown__` to mark skipped indices
- Example: If you see `widgets_values: [1, null, 2, 3]`, the middle element might need `__unknown__`

**Pitfall 3**: Assuming visual order = widget_order
- The UI might display widgets in a different order than `widgets_values`
- **Always verify** against the JSON export, not the visual UI

---

## Node Roles Clarification

The roles in node definitions can be confusing. This section clarifies the differences and provides decision trees.

### Role Definitions

| Role | Purpose | Example |
|------|---------|---------|
| **SOURCE** | Generates or loads data from nothing | `CheckpointLoader`, `CLIPTextEncode` |
| **SINK** | Terminal node, final output consumer | `SaveImage`, `Preview` |
| **TRANSFORM** | Modifies data and **DOES NOT pass original forward** | `KSampler`, `ImageScale`, `UltimateSDUpscale` |
| **PASS_THROUGH** | Routes/selects data **WITHOUT modification**, OR modifies one aspect while passing others through | `Mux`, `Switch`, `LoraLoader` (passes model forward) |
| **ROUTING** | Conditional logic to select between multiple paths | `If` node, `Switch` nodes |

### Decision Tree: TRANSFORM vs PASS_THROUGH

Use this flowchart to decide the correct role:

```
Does the node modify its PRIMARY output?
├─ YES → Could be TRANSFORM or PASS_THROUGH (continue below)
├─ NO → It's PASS_THROUGH or ROUTING
└─ DEPENDS ON CONTEXT → See "Hybrid Nodes" section

Does the node PASS THROUGH another input without modification?
├─ YES → It's PASS_THROUGH
│   Example: LoraLoader passes MODEL forward unchanged
│   Example: KSampler Efficient passes CONDITIONING forward unchanged
├─ NO → It's TRANSFORM
│   Example: UltimateSDUpscale modifies IMAGE but doesn't pass original
└─ BOTH → See "Hybrid Nodes"
```

### Examples by Category

#### Pure TRANSFORM Nodes
```typescript
// KSampler - Takes LATENT, outputs modified LATENT
// Does NOT pass original inputs forward
'KSampler': {
  category: 'SAMPLING',
  roles: ['TRANSFORM'],
  inputs: { latent: { type: 'LATENT' }, model: { type: 'MODEL' } },
  outputs: { LATENT: { type: 'LATENT' } },
  // No pass_through rules
}

// UltimateSDUpscale - Takes IMAGE, outputs new upscaled IMAGE
// Modifies but doesn't pass original forward
'UltimateSDUpscale': {
  category: 'TRANSFORM',
  roles: ['TRANSFORM'],
  inputs: { image: { type: 'IMAGE' }, model: { type: 'MODEL' } },
  outputs: { image: { type: 'IMAGE' } },
  // No pass_through rules
}
```

#### Pure PASS_THROUGH Nodes
```typescript
// LoraLoader - Loads LoRA metadata but passes MODEL through unchanged
'LoraLoader': {
  category: 'LOADING',
  roles: ['PASS_THROUGH'],
  inputs: { model: { type: 'MODEL' } },
  outputs: { MODEL: { type: 'MODEL' } },
  pass_through: [
    { from_input: 'model', to_output: 'MODEL' }  // Same model passes through
  ]
}
```

#### Hybrid Nodes (PASS_THROUGH + widget modification)
```typescript
// KSampler (Efficient) - Modifies LATENT but passes CONDITIONING forward
// This is still TRANSFORM because primary output (LATENT) is modified
'KSampler (Efficient)': {
  category: 'SAMPLING',
  roles: ['TRANSFORM'],  // Primary output is modified
  inputs: {
    latent: { type: 'LATENT' },
    positive: { type: 'CONDITIONING' }
  },
  outputs: { LATENT: { type: 'LATENT' } },
  // CONDITIONING is not passed through - it's consumed
}
```

### Rule of Thumb

- **TRANSFORM**: The PRIMARY data transformation is the node's purpose
- **PASS_THROUGH**: The node's purpose is to SELECT/ROUTE/LOAD metadata that affects OTHER nodes

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

### Issue 3: Adding a New Node - UltimateSDUpscale Example

**Scenario**: You need to add `UltimateSDUpscale` support to the parser. You have:
- A workflow with this node loaded
- No access to Python source code initially
- Widgets: `upscale_by`, `seed`, `denoise`
- Inputs: `image`, `model`

**Step 1: Extract widget_order**
- Export workflow as JSON
- Find the node's `widgets_values: [4, 12345, 1.0]`
- Visually verify in UI: index 0=upscale_by(4), index 1=seed(12345), index 2=denoise(1.0)

**Step 2: Determine role**
- Does it modify the primary output (image)? YES
- Does it pass through the original image? NO
- Decision: **TRANSFORM** (not PASS_THROUGH)

**Step 3: Define param_mapping**
```typescript
param_mapping: {
  upscale_factor: { source: 'widget', key: 'upscale_by' },
  seed: { source: 'widget', key: 'seed' },
  denoise: { source: 'widget', key: 'denoise' },
  model: { source: 'trace', input: 'model' }  // Follow to source
}
```

**Step 4: Complete definition**
```typescript
'UltimateSDUpscale': {
  category: 'TRANSFORM',
  roles: ['TRANSFORM'],
  inputs: {
    image: { type: 'IMAGE' },
    model: { type: 'MODEL' },
    upscaler: { type: 'UPSCALER' },  // Optional, may not apply here
  },
  outputs: {
    image: { type: 'IMAGE' }
  },
  param_mapping: {
    upscale_factor: { source: 'widget', key: 'upscale_by' },
    seed: { source: 'widget', key: 'seed' },
    denoise: { source: 'widget', key: 'denoise' },
  },
  widget_order: ['upscale_by', 'seed', 'denoise']
}
```

**Step 5: Test**
```javascript
// In your test file
test('UltimateSDUpscale extracts upscale_factor correctly', () => {
  const node = {
    id: '8',
    class_type: 'UltimateSDUpscale',
    widgets_values: [4, 12345, 1.0]
  };

  const result = extractValue(node, { source: 'widget', key: 'upscale_by' });
  expect(result).toBe(4);
});
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
