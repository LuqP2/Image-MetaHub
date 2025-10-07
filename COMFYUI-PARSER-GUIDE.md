# ComfyUI Parser Developer Guide

## Overview

This document provides comprehensive guidance for developing and maintaining the ComfyUI metadata parser. The parser uses a **rule-based, declarative architecture** that handles graph complexities natively, outperforming legacy string-based parsers.

**Current Status (v3.0.0)**: Production-ready with robust handling of complex workflows including efficiency-nodes, custom samplers, and multi-path prompt tracing.

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

**Notes**: 
- Exports models/LoRAs with caching support
- May connect prompts to String Literal nodes (use trace)
- Width/height are generation dims, not final output
- Dependencies: Requires model paths; handles auto-caching

#### KSampler (Efficient)
```typescript
widget_order: [
  'seed',                     // 0: Seed value
  '__unknown__',              // 1: ⚠️ NULL/unknown placeholder (skip!)
  'steps',                    // 2: Sampling steps
  'cfg',                      // 3: CFG scale
  'sampler_name',             // 4: Sampler algorithm
  'scheduler',                // 5: Scheduler type
  'denoise',                  // 6: Denoise strength (0.0-1.0)
  'preview_method',           // 7: Preview method
  'vae_decode'                // 8: VAE decode mode
]
```

**CRITICAL**: 
- Index 1 contains a null/unknown placeholder in exported workflows
- Ignoring this causes value swapping: steps→cfg, cfg→sampler, etc.
- Use `'trace'` for seed if connected to Seed Generator
- Controls denoising process; more steps = quality ↑, compute ↑

#### LoRA Stacker
```typescript
// Special case: Dynamic widget structure
widget_order: [
  'lora_count',               // 0: Number of active LoRAs
  // Followed by dynamic slots: [lora_name1, strength_model1, strength_clip1, ...]
]

// Custom extractor required:
extractor: (node: ParserNode) => {
  const loraCount = node.widgets_values?.[0] ?? node.inputs?.lora_count ?? 0;
  if (loraCount === 0) return [];
  
  const loras = [];
  for (let i = 0; i < loraCount; i++) {
    const loraName = node.widgets_values?.[1 + i * 3]; // Every 3rd element
    if (loraName && loraName !== 'None') {
      loras.push(loraName);
    }
  }
  return loras;
}
```

**Notes**: 
- Stacks multiple LoRAs; extract active ones via lora_count
- If widgets_values missing, fallback to inputs.lora_count
- Outputs extended stacks for model refinement

#### String Literal
```typescript
widget_order: [
  'text'                      // 0: Static string value
  // OR 'string_value' in some variants
]
```

**Notes**: 
- Simple static string provider
- Often used for prompts in workflows like cats.json
- Connect to loaders—map as SOURCE for prompt/negativePrompt
- No complex dependencies; handle as SOURCE role

#### Seed Generator
```typescript
widget_order: [
  'seed_value',               // 0: Current seed value
  'seed_mode',                // 1: 'fixed', 'random', 'increment'
  'increment'                 // 2: Increment value (optional)
]

// OR alternate format:
widget_order: [
  'seed_mode',                // 0: Mode first
  'seed_value',               // 1: Value second
  'increment'                 // 2: Increment (optional)
]
```

**Notes**: 
- Provides reproducible seeds; modes include fixed/incremental for batching
- Widget order varies by extension (e.g., Inspire Pack: mode first)
- Trace outputs for seed param in samplers

#### ControlNetApply
```typescript
widget_order: [
  'strength',                 // 0: ControlNet strength (0.0-1.0)
  'start_percent',            // 1: Start percentage of denoising
  'end_percent'               // 2: End percentage of denoising
  // Advanced variants may add: image, control_net
]
```

**Notes**: 
- Applies control nets to conditioning
- Inputs: positive/negative CONDITIONING
- Pass-through for prompts; add to registry as TRANSFORM
- Use trace for model/prompt paths

---

## Testing & Validation

### Test Strategy (Target: 95%+ Accuracy)

**1. Unit Tests for Node Extraction**
```javascript
// Test individual node parameter extraction
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
// Test complete workflow parsing
test('cats.json workflow parses correctly', async () => {
  const workflow = JSON.parse(fs.readFileSync('./.comfyworkflows/cats.json'));
  const result = resolvePromptFromGraph(workflow, workflow);
  
  expect(result.prompt).toContain('tabby cat');
  expect(result.negativePrompt).toContain('worst quality');
  expect(result.steps).toBe(28);
  expect(result.cfg).toBe(3);
  expect(result.sampler_name).toBe('euler_ancestral');
  expect(result.scheduler).toBe('normal');
  expect(result.model).toBe('plantMilk_almond.safetensors');
  expect(result.seed).toBe(625212262135330);
});
```

**3. Edge Case Tests**
- Workflows without widgets_values (prompt-only execution)
- Workflows with muted nodes (mode 2/4)
- Upscaled workflows (dim mismatch: 512→1024)
- Invalid JSON (NaN, undefined, circular refs)
- Unknown node types (fallback behavior)

**4. Performance Benchmarks**
```javascript
// Measure parsing performance
test('parses 100 workflows in <5 seconds', async () => {
  const start = Date.now();
  for (let i = 0; i < 100; i++) {
    await resolvePromptFromGraph(testWorkflow, testWorkflow);
  }
  const elapsed = Date.now() - start;
  expect(elapsed).toBeLessThan(5000);
});
```

### Validation Checklist

**Per Workflow Test:**
- [ ] Prompt extracted correctly (non-empty, matches expected text)
- [ ] Negative prompt extracted (different from positive)
- [ ] Seed matches embedded value
- [ ] Steps/CFG/Sampler/Scheduler correct
- [ ] Model name extracted
- [ ] LoRAs listed (or empty array if none)
- [ ] Width/height from image file (not workflow)
- [ ] No null/undefined for critical params

**Accuracy Metrics:**
- Prompt: 95%+ exact match
- Seed: 100% exact match (numeric)
- Steps/CFG: 100% exact match (numeric)
- Sampler/Scheduler: 95%+ exact match (string)
- Model: 90%+ (handles variants like .safetensors vs .ckpt)

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

### Issue 2: Negative Prompt Same as Positive

**Symptom**: `negativePrompt === prompt`

**Cause**: `collectAllValues()` was exploring all graph paths indiscriminately

**Solution**: Use `traverse()` with directed param_mapping instead
```typescript
// WRONG:
const values = collectAllValues(node, 'CONDITIONING-', graph);

// CORRECT:
const value = traverse(node, { targetParam: 'negativePrompt' }, graph, []);
```

### Issue 3: Width/Height Always 0

**Symptom**: Dimensions not extracted from workflow

**Solution**: Read from actual image file, not workflow
```typescript
// Read actual dimensions
const img = new Image();
const objectUrl = URL.createObjectURL(file);
await new Promise((resolve) => {
  img.onload = () => {
    metadata.width = img.width;
    metadata.height = img.height;
    URL.revokeObjectURL(objectUrl);
    resolve();
  };
  img.src = objectUrl;
});
```

### Issue 4: Unknown Node Types

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

### Issue 5: NaN in Exported JSON

**Symptom**: JSON.parse() fails with "Unexpected token N"

**Cause**: ComfyUI exports NaN for undefined numeric values

**Solution**: Sanitize before parsing
```typescript
function sanitizeJson(jsonString: string): string {
  return jsonString.replace(/:\s*NaN/g, ': null');
}
```

---

## Future Enhancements

### Priority 1: Auto-Discovery

**Goal**: Automatically detect widget_order from ComfyUI node definitions

**Implementation**:
- Query ComfyUI server API for node schemas
- Extract widget definitions from node classes
- Generate widget_order arrays programmatically
- Cache results to avoid repeated queries

**Benefits**:
- No manual widget_order maintenance
- Supports custom nodes automatically
- Always up-to-date with ComfyUI versions

### Priority 2: Multi-Prompt Handling

**Goal**: Handle workflows with multiple CLIPTextEncode nodes

**Current Behavior**: Uses first encountered prompt

**Desired Behavior**: 
- Prioritize longest/non-empty prompt
- Allow user configuration for prompt selection
- Support prompt weighting/combination

### Priority 3: Export Interoperability

**Goal**: Export parsed metadata to standard formats

**Formats**:
- Civitai geninfo format
- A1111 parameters format
- EXIF metadata
- JSON schema for external tools

### Priority 4: Performance Optimization

**Current**: ~50ms per workflow parse

**Target**: <10ms per workflow

**Strategies**:
- Cache NodeRegistry lookups
- Use iterative BFS instead of recursion
- Precompile param_mapping rules
- Lazy evaluation of unused parameters

### Priority 5: Error Resilience

**Goals**:
- Never crash on invalid workflows
- Provide partial results when possible
- Log detailed diagnostics for failures

**Implementations**:
- Try-catch around all extractValue calls
- Fallback chains: widget → input → default
- Validation of node connections before traversal
- Timeout protection for infinite loops

---

## Development Workflow

### Adding a New Node Type

1. **Research**: Find official documentation or example workflows
2. **Identify Widget Order**: Export workflow and examine widgets_values
3. **Define Inputs/Outputs**: Map connection types
4. **Add to Registry**: Create node definition
5. **Test**: Create test case with expected values
6. **Document**: Add to this guide's reference section

### Testing New Changes

1. Run unit tests: `npm test`
2. Test with all 10 reference workflows
3. Measure accuracy metrics
4. Check performance benchmarks
5. Validate against edge cases

### Release Checklist

- [ ] All tests passing (100%)
- [ ] Accuracy ≥95% on reference workflows
- [ ] Performance <50ms per workflow
- [ ] Documentation updated
- [ ] Changelog entries added
- [ ] No console errors in production

---

## Resources & References

**Primary Sources:**
- [efficiency-nodes-comfyui Wiki](https://github.com/jags111/efficiency-nodes-comfyui/wiki)
- [ComfyUI Official Repo](https://github.com/comfyanonymous/ComfyUI)
- [ComfyUI Nodes Documentation](https://docs.comfy.org/)

**Community Resources:**
- [RunComfy Node Library](https://www.runcomfy.com/nodes)
- [ComfyUI Reddit](https://www.reddit.com/r/comfyui/)
- [OpenArt Workflows](https://openart.ai/workflows)

**Related Tools:**
- [ComfyUI Manager](https://github.com/ltdrdata/ComfyUI-Manager)
- [ComfyUI Custom Scripts](https://github.com/pythongosssss/ComfyUI-Custom-Scripts)

---

## Contributing

To contribute improvements to the ComfyUI parser:

1. **Test with Real Workflows**: Submit problematic workflows to improve coverage
2. **Document Node Types**: Add widget_order specs for new nodes
3. **Report Issues**: Include workflow JSON and expected vs actual results
4. **Submit PRs**: Follow the testing checklist above

---

**Version**: 3.0.0  
**Last Updated**: 2025-10-07  
**Maintainer**: Image MetaHub Development Team  
**Status**: Production Ready ✅
