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

## Grouped Workflow Nodes (Advanced)

### Understanding Grouped Workflows

**What are Grouped Workflow Nodes?**
- Custom composite nodes that encapsulate multiple standard nodes
- Example: `workflow>Load Model - Flux`, `workflow>CLIP Encode - Flux`, `workflow>Sampler/Scheduler - Flux`
- ComfyUI exports them as parent nodes (ID 42, 51, 64) with child nodes (42:0, 42:1, 51:6, etc.)

**Critical Architecture Rule:**
```typescript
// ❌ WRONG: Do NOT apply parent widgets_values to children
graph['42:0'].widgets_values = graph['42'].widgets_values; // Breaks indices!

// ✅ CORRECT: Children use prompt.inputs data, parents use workflow.widgets_values
// Parent node 42: widgets_values = [2419, 'increment', 'euler', 'ddim_uniform', 50, 1] (concatenated)
// Child node 42:0: inputs = { noise_seed: 2419 } (individual value)
```

### Data Structure Breakdown

**Workflow Structure (UI Data):**
```json
{
  "workflow": {
    "nodes": [
      {
        "id": 42,
        "type": "workflow>Sampler/Scheduler - Flux",
        "widgets_values": [2419, "increment", "euler", "ddim_uniform", 50, 1]
      }
    ]
  }
}
```

**Prompt Structure (Execution Data):**
```json
{
  "prompt": {
    "42:0": { "class_type": "RandomNoise", "inputs": { "noise_seed": 2419 } },
    "42:1": { "class_type": "KSamplerSelect", "inputs": { "sampler_name": "euler" } },
    "42:2": { "class_type": "BasicScheduler", "inputs": { "scheduler": "ddim_uniform", "steps": 50, "denoise": 1.0 } }
  }
}
```

### Extraction Strategy

**Phase 1: Build Graph**
```typescript
// createNodeMap() in comfyUIParser.ts
1. Start with prompt data (accurate child node inputs)
2. Overlay workflow data (only for parent nodes, NOT children)
3. Do NOT propagate parent widgets to children
```

**Phase 2: Extract Values**
```typescript
// extractValue() in traversalEngine.ts
if (rule.source === 'widget') {
  // Try widget_order index first
  if (widgetIndex !== -1 && node.widgets_values?.[widgetIndex] !== undefined) {
    return node.widgets_values[widgetIndex];
  }
  
  // FALLBACK: Use inputs data when widgets_values missing
  const inputValue = node.inputs?.[rule.key];
  
  // Direct value (not a link)
  if (inputValue !== undefined && !Array.isArray(inputValue)) {
    return inputValue;
  }
  
  // Link - follow it
  if (Array.isArray(inputValue) && inputValue.length === 2) {
    return traverseFromLink(inputValue, state, graph, accumulator);
  }
}
```

### Example: ttN concat Node

**Problem**: Concatenates multiple text inputs (text1, text2, text3) with delimiter
**Solution**: Custom extractor that follows links

```typescript
'ttN concat': {
  category: 'UTILS',
  roles: ['TRANSFORM'],
  inputs: { text1: { type: 'STRING' }, text2: { type: 'STRING' }, text3: { type: 'STRING' } },
  outputs: { concat: { type: 'STRING' } },
  param_mapping: {
    prompt: {
      source: 'custom_extractor',
      extractor: (node, state, graph, traverseFromLink) => {
        const texts: string[] = [];
        const delimiter = node.inputs?.delimiter || ' ';
        
        // Resolve each text input (can be direct value or link)
        ['text1', 'text2', 'text3'].forEach(key => {
          const input = node.inputs?.[key];
          if (!input) return;
          
          if (Array.isArray(input)) {
            // Follow link
            const result = traverseFromLink(input, state, graph, []);
            if (result) texts.push(String(result));
          } else {
            // Direct value
            texts.push(String(input));
          }
        });
        
        return texts.filter(t => t.trim()).join(String(delimiter));
      }
    }
  }
}
```

### Testing Grouped Workflows

**Validation Checklist:**
- [ ] Parent nodes have workflow.widgets_values applied
- [ ] Child nodes use prompt.inputs data (NOT parent widgets)
- [ ] extractValue falls back to inputs when widgets_values missing
- [ ] Links in inputs are followed via traverseFromLink
- [ ] Custom extractors handle multi-input concatenation

**Debug Logs to Check:**
```
[createNodeMap] Overlaying node 42 (workflow>Sampler/Scheduler - Flux) with widgets_values: [...]
[traverse] Node 42:0 (RandomNoise), looking for param: seed
[extractValue] Fallback from inputs (direct value): node 42:0, key noise_seed, value: 2419
[extractValue] Fallback from inputs (following link): node 51:4, key text, link: ['51:2', 0]
```

---

## Common Failure Modes

This section documents real-world parsing failures and how the parser handles them.

### 1. Custom Node Without Registry Entry

**Symptom**: Parser encounters `CustomNodeXYZ` not in nodeRegistry.ts

**How Parser Handles It**:
```typescript
// Parser automatically logs unknown nodes in telemetry
telemetry.unknown_nodes_count++;
telemetry.warnings.push('Unknown node type: CustomNodeXYZ');

// Falls back to:
// 1. Generic param extraction from inputs
// 2. Widget extraction using index 0, 1, 2...
// 3. Regex fallback on workflow JSON text if terminal node missing
```

**Example**:
```json
{
  "_telemetry": {
    "detection_method": "standard",
    "unknown_nodes_count": 1,
    "warnings": ["Unknown node type: CustomSampler2000"]
  },
  "seed": 12345,  // Still extracted from inputs
  "steps": 20,    // Still extracted from widgets
  "_raw_parsed_with_regex": false
}
```

**Developer Action**: Add node to registry if widely used (see "How to Add a New Node" below)

---

### 2. Compressed/Encoded Workflow Payload

**Symptom**: PNG chunk contains Base64-encoded or zlib-compressed workflow data

**How Parser Handles It**:
```typescript
// tryParseComfyPayload attempts multiple strategies:
// 1. Direct JSON.parse
// 2. Base64 decode → JSON.parse
// 3. Base64 decode → zlib inflate → JSON.parse (Node.js only)
// 4. Regex fallback to find large JSON blocks

const parseResult = await tryParseComfyPayload(rawChunk);
// Returns: { data, detectionMethod: 'compressed', warnings: [] }
```

**Example**:
```json
{
  "_parse_telemetry": {
    "detection_method": "compressed",
    "warnings": ["Direct JSON parse failed", "Base64 decode failed"]
  },
  "prompt": "beautiful landscape",
  "seed": 12345
}
```

**Developer Action**: No action needed - parser handles automatically

---

### 3. Missing Terminal Node (No SINK)

**Symptom**: Workflow has no KSampler, SaveImage, or other SINK node

**How Parser Handles It**:
```typescript
// findTerminalNode returns null → parser falls back to regex
if (!terminalNode) {
  const workflowText = JSON.stringify(workflow) + JSON.stringify(prompt);
  const regexParams = extractParamsWithRegex(workflowText);
  
  // extractParamsWithRegex searches for:
  // - Prompt[:\n]\s*(.+?)
  // - Seed[:=]\s*(\d+)
  // - Steps[:=]\s*(\d{1,4})
  // - CFG[:=]\s*([0-9]*\.?[0-9]+)
  // etc.
}
```

**Example**:
```json
{
  "_telemetry": {
    "detection_method": "regex_fallback",
    "warnings": ["No terminal node found"]
  },
  "prompt": "abstract art",
  "seed": 54321,
  "steps": 30,
  "raw_parsed_with_regex": true
}
```

**Developer Action**: Verify workflow structure, may indicate corrupted/incomplete export

---

### 4. Hex Seed Format (0xABCDEF)

**Symptom**: Seed is stored as hex string instead of numeric

**How Parser Handles It**:
```typescript
// extractAdvancedSeed handles multiple formats
if (typeof node.inputs?.seed === 'string' && node.inputs.seed.startsWith('0x')) {
  const hexSeed = parseInt(node.inputs.seed, 16);
  return { seed: hexSeed };  // Converts 0xABCDEF12 → 2882400018
}
```

**Example**:
```json
{
  "seed": 2882400018,  // Converted from 0xABCDEF12
  "steps": 20
}
```

**Developer Action**: No action needed - parser handles automatically

---

### 5. Derived/Random Seed

**Symptom**: Workflow uses `derived_seed` or `random_seed` node with no fixed value

**How Parser Handles It**:
```typescript
// extractAdvancedSeed generates approximate seed
if (node.inputs?.derived_seed || node.inputs?.random_seed) {
  const approximateSeed = Math.floor(Date.now() / 1000) % 2147483647;
  return { seed: approximateSeed, approximateSeed: true };
}
```

**Example**:
```json
{
  "seed": 1728700123,  // Timestamp-based approximation
  "approximateSeed": true,  // Flag indicates seed is not exact
  "_telemetry": {
    "warnings": ["Seed is approximate (derived from derived_seed or random_seed)"]
  }
}
```

**Developer Action**: Understand that reproducibility is limited with derived seeds

---

### 6. Model Hash Instead of Name

**Symptom**: CheckpointLoader has `model_hash` but no `model_name` or `ckpt_name`

**How Parser Handles It**:
```typescript
// extractAdvancedModel maps hash to "unknown (hash: xxxx)"
const hashMatch = JSON.stringify(node).match(/"(?:model_hash|hash)"\s*:\s*"([0-9a-fA-F]{8,})"/);
if (hashMatch) {
  return `unknown (hash: ${hashMatch[1].substring(0, 8)})`;
}
```

**Example**:
```json
{
  "model": "unknown (hash: a1b2c3d4)",
  "seed": 12345
}
```

**Developer Action**: User can manually map hash to model name later

---

## How to Add a New Node to the Registry

If you encounter a custom node frequently and want first-class support, follow this guide:

### Step 1: Identify Node Behavior

Determine the node's **role** in the workflow:
- **SOURCE**: Generates data (CheckpointLoader, CLIPTextEncode)
- **SINK**: Terminal node (KSampler, SaveImage, UltimateSDUpscale)
- **TRANSFORM**: Modifies data (VAEDecode, UpscaleModel)
- **PASS_THROUGH**: Routes unchanged (Reroute)
- **ROUTING**: Conditional logic (Switch, Selector)

### Step 2: Analyze Inputs/Outputs

Inspect the workflow JSON to understand:
- Input slots: `inputs: { model: ['4', 0], positive: ['6', 0] }`
- Output slots: `outputs: { MODEL: { type: 'MODEL' } }`
- Widget values: `widgets_values: [12345, 'fixed', 20, 8, 'euler']`

### Step 3: Define Node in nodeRegistry.ts

**Example: Adding a Custom Sampler Node**

```typescript
// In services/parsers/comfyui/nodeRegistry.ts

'MySuperSampler': {
  category: 'SAMPLING',
  roles: ['SINK'],
  
  // Define inputs (connections from other nodes)
  inputs: {
    model: { type: 'MODEL' },
    positive: { type: 'CONDITIONING' },
    negative: { type: 'CONDITIONING' },
    latent_image: { type: 'LATENT' }
  },
  
  // Define outputs (what this node produces)
  outputs: {
    LATENT: { type: 'LATENT' }
  },
  
  // Map parameters to sources
  param_mapping: {
    // Extract seed from inputs (follows connection)
    seed: { 
      source: 'trace', 
      input: 'seed' 
    },
    
    // Extract steps from widgets_values[2] (fixed index)
    steps: { 
      source: 'widget', 
      key: 'steps' 
    },
    
    // Extract cfg from inputs (direct value)
    cfg: { 
      source: 'input', 
      key: 'cfg' 
    },
    
    // Extract sampler_name from widgets_values[4]
    sampler_name: { 
      source: 'widget', 
      key: 'sampler_name' 
    },
    
    // Extract prompt by tracing 'positive' connection
    prompt: { 
      source: 'trace', 
      input: 'positive' 
    },
    
    // Custom extraction function for complex logic
    custom_param: {
      source: 'custom_extractor',
      extractor: (node, graph, targetParam, state) => {
        // Your custom logic here
        return { value: node.inputs?.custom_param || 'default' };
      }
    }
  },
  
  // Specify widget_values array order (if using widget source)
  widget_order: ['seed', 'control_after_generate', 'steps', 'cfg', 'sampler_name', 'scheduler', 'denoise']
}
```

### Step 4: Parameter Mapping Source Types

**Available Sources:**

| Source | Description | Example |
|--------|-------------|---------|
| `widget` | Extract from `widgets_values` array using `key` or index | `{ source: 'widget', key: 'steps' }` |
| `input` | Extract from `inputs` object (direct value) | `{ source: 'input', key: 'cfg' }` |
| `trace` | Follow connection to another node | `{ source: 'trace', input: 'positive' }` |
| `custom_extractor` | Use custom function for complex logic | `{ source: 'custom_extractor', extractor: (node, graph) => {...} }` |

### Step 5: Test with Real Workflows

**Create a test fixture in `__tests__/fixtures/comfyui/`:**

```json
{
  "workflow": {
    "nodes": [
      {
        "id": 3,
        "type": "MySuperSampler",
        "widgets_values": [12345, "fixed", 20, 8, "euler", "normal", 1],
        "mode": 0
      }
    ]
  },
  "prompt": {
    "3": {
      "class_type": "MySuperSampler",
      "inputs": {
        "seed": 12345,
        "steps": 20,
        "cfg": 8,
        "sampler_name": "euler",
        "scheduler": "normal",
        "model": ["4", 0],
        "positive": ["6", 0],
        "negative": ["7", 0]
      }
    }
  }
}
```

**Add test case in `__tests__/comfyui-parser.test.ts`:**

```typescript
describe('ComfyUI Parser - MySuperSampler', () => {
  it('should parse MySuperSampler node', () => {
    const fixture = loadFixture('my-super-sampler.json');
    const result = resolvePromptFromGraph(fixture.workflow, fixture.prompt);
    
    expect(result.seed).toBe(12345);
    expect(result.steps).toBe(20);
    expect(result.cfg).toBe(8);
    expect(result.sampler_name).toBe('euler');
    expect(result.scheduler).toBe('normal');
  });
});
```

### Step 6: Submit Pull Request

**PR Checklist:**
- [ ] Node definition added to `nodeRegistry.ts`
- [ ] Test fixture added to `__tests__/fixtures/comfyui/`
- [ ] Test case added to `__tests__/comfyui-parser.test.ts`
- [ ] Tests pass: `npm test -- __tests__/comfyui-parser.test.ts`
- [ ] Description includes: node purpose, source (custom/official), common use case

**PR Template:**

```markdown
## Add Support for MySuperSampler Node

**Node Type**: Custom sampling node from ComfyUI-SuperNodes extension

**Purpose**: Advanced sampling with enhanced quality controls

**Common Use Cases**:
- High-quality image generation with custom schedulers
- Multi-pass sampling workflows
- Professional studio workflows

**Testing**:
- [x] Added test fixture `my-super-sampler.json`
- [x] Added test case with assertions
- [x] All tests passing (13/13 ✅)

**Screenshots**:
![MySuperSampler workflow](screenshot.png)
```

---

## Contributing

To contribute improvements to the ComfyUI parser:

1. **Test with Real Workflows**: Submit problematic workflows to improve coverage
2. **Document Node Types**: Add widget_order specs for new nodes using guide above
3. **Report Issues**: Include workflow JSON and expected vs actual results
4. **Submit PRs**: Follow the testing checklist and PR template above

---

**Version**: 3.2.0  
**Last Updated**: 2025-01-12  
**Maintainer**: Image MetaHub Development Team  
**Status**: Production Ready ✅  
**Recent Additions**: Common failure modes documentation, "How to Add a New Node" guide, enhanced CLI support, comprehensive test suite
