import { parseImageFile, SCHEMA_VERSION } from '@image-metahub/metadata-engine';

console.log('✅ Import successful!');
console.log(`📦 Schema version: ${SCHEMA_VERSION}`);

// Test with an image from the parent directory
const testImagePath = 'd:/invokeai-local-image-search/logo1.png';

try {
  console.log('\n🔍 Testing parseImageFile...');
  const result = await parseImageFile(testImagePath);

  console.log('✅ Parse successful!');
  console.log(`   Generator: ${result.metadata?.generator || 'unknown'}`);
  console.log(`   Prompt: ${result.metadata?.prompt?.substring(0, 50) || 'none'}...`);
  console.log(`   Model: ${result.metadata?.model || 'none'}`);
  console.log(`   Dimensions: ${result.dimensions?.width}x${result.dimensions?.height}`);
  console.log(`   SHA256: ${result.sha256?.substring(0, 16)}...`);
  console.log(`   Raw source: ${result.rawSource}`);

  console.log('\n🎉 All tests passed!');
} catch (error) {
  console.error('❌ Test failed:', error.message);
  process.exit(1);
}
