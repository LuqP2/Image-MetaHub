// Direct test of ComfyUI parser (Node.js version)
import { resolvePromptFromGraph } from './services/parsers/comfyUIParser';
import fs from 'fs';

const workflow = JSON.parse(fs.readFileSync('./.comfyworkflows/woman.json', 'utf8'));

console.log('=== PARSING WOMAN.JSON WORKFLOW ===\n');

const result = resolvePromptFromGraph(workflow, workflow);

console.log('Parsed metadata:');
console.log(JSON.stringify(result, null, 2));

console.log('\n=== VALIDATION ===\n');

// Expected values
const checks = [
  { name: 'Model', expected: 'flux1-dev-F16.gguf', actual: result.model },
  { name: 'LoRAs count (should be 3)', expected: 3, actual: result.lora?.length || 0 },
  { name: 'Prompt contains text', expected: true, actual: result.prompt?.includes('masterpiece') || false },
  { name: 'Upscale seed', expected: 828691839299387, actual: result.seed },
  { name: 'Upscale steps', expected: 20, actual: result.steps },
  { name: 'Upscale CFG', expected: 1.1, actual: result.cfg },
  { name: 'Upscale sampler', expected: 'euler', actual: result.sampler_name },
  { name: 'Upscale scheduler', expected: 'simple', actual: result.scheduler },
  { name: 'Denoise', expected: 0.2, actual: result.denoise },
];

checks.forEach(check => {
  const passed = check.actual === check.expected || (typeof check.expected === 'boolean' && check.actual === check.expected);
  const icon = passed ? '✅' : '❌';
  console.log(`${icon} ${check.name}: expected ${check.expected}, got ${check.actual}`);
});

if (result.lora && result.lora.length > 0) {
  console.log('\n=== EXTRACTED LoRAs ===');
  result.lora.forEach((lora, i) => {
    console.log(`${i + 1}. ${lora}`);
  });
}

// Check for duplicates
if (result.lora && result.lora.length > 0) {
  const uniqueLoras = new Set(result.lora);
  if (uniqueLoras.size !== result.lora.length) {
    console.log(`\n❌ WARNING: Found ${result.lora.length - uniqueLoras.size} duplicate LoRAs!`);
  } else {
    console.log(`\n✅ No duplicate LoRAs found`);
  }
}

// Check for duplicate prompts
if (result.prompt) {
  const segments = result.prompt.split(/,\s*/).filter(s => s.trim());
  const uniqueSegments = new Set(segments);
  if (uniqueSegments.size !== segments.length) {
    console.log(`\n❌ WARNING: Found ${segments.length - uniqueSegments.size} duplicate prompt segments!`);
    console.log('Segments:', segments);
  } else {
    console.log(`\n✅ No duplicate prompt segments found`);
  }
}

console.log('\n=== DONE ===');
