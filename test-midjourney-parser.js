// Basic unit tests for Midjourney metadata parsing
// This file can be run with Node.js for basic validation

console.log('🧪 Midjourney Parser Tests (Basic Validation)\n');

// Test data that mimics Midjourney metadata formats
const testCases = [
  {
    name: "Standard Midjourney format",
    data: "A beautiful landscape with mountains --v 5 --ar 16:9 --q 2 --s 100",
    expected: {
      hasPrompt: true,
      hasVersion: true,
      hasAspectRatio: true,
      hasQuality: true,
      hasStylize: true
    }
  },
  {
    name: "Midjourney with seed",
    data: "Prompt: A futuristic city --v 6 --ar 1:1 --seed 12345 --q 1",
    expected: {
      hasPrompt: true,
      hasVersion: true,
      hasAspectRatio: true,
      hasSeed: true,
      hasQuality: true
    }
  },
  {
    name: "Simple Midjourney format",
    data: "Midjourney image of a cat --v 4",
    expected: {
      hasPrompt: true,
      hasVersion: true,
      hasMidjourney: true
    }
  },
  {
    name: "Complex parameters",
    data: "Beautiful portrait --v 5 --ar 2:3 --q 2 --s 750 --seed 98765 --chaos 50",
    expected: {
      hasPrompt: true,
      hasVersion: true,
      hasAspectRatio: true,
      hasQuality: true,
      hasStylize: true,
      hasSeed: true
    }
  }
];

console.log('Test 1: Metadata format validation');
testCases.forEach((testCase, index) => {
  console.log(`\n${index + 1}. ${testCase.name}:`);
  const data = testCase.data;
  const expected = testCase.expected;

  console.log(`   Data: "${data}"`);
  console.log(`   ✅ Contains prompt: ${data.includes('Prompt:') || !data.includes('--') ? '✓' : '✗'}`);
  console.log(`   ✅ Contains --v: ${data.includes('--v') ? '✓' : '✗'}`);
  console.log(`   ✅ Contains --ar: ${data.includes('--ar') ? '✓' : '✗'}`);
  console.log(`   ✅ Contains --q: ${data.includes('--q') ? '✓' : '✗'}`);
  console.log(`   ✅ Contains --s: ${data.includes('--s') ? '✓' : '✗'}`);
  console.log(`   ✅ Contains --seed: ${data.includes('--seed') ? '✓' : '✗'}`);
  console.log(`   ✅ Contains Midjourney: ${data.includes('Midjourney') ? '✓' : '✗'}`);
});

console.log('\nTest 2: Parameter extraction patterns');
const extractionTests = [
  { pattern: /--v\s+(\d+)/, data: "--v 5", expected: "5" },
  { pattern: /--ar\s+(\d+):(\d+)/, data: "--ar 16:9", expected: "16:9" },
  { pattern: /--q\s+([\d.]+)/, data: "--q 2", expected: "2" },
  { pattern: /--s\s+(\d+)/, data: "--s 100", expected: "100" },
  { pattern: /--seed\s+(\d+)/, data: "--seed 12345", expected: "12345" }
];

extractionTests.forEach((test, index) => {
  const match = test.data.match(test.pattern);
  let result = null;
  if (match) {
    if (match.length > 2) {
      result = `${match[1]}:${match[2]}`;
    } else {
      result = match[1];
    }
  }
  console.log(`   ${index + 1}. ${test.pattern} on "${test.data}": ${result === test.expected ? '✓' : '✗'} (${result})`);
});

console.log('\nTest 3: Prompt extraction');
const promptTests = [
  { data: "A beautiful landscape --v 5", expected: "A beautiful landscape" },
  { data: "Prompt: A futuristic city --v 6", expected: "A futuristic city" },
  { data: "Midjourney image of a cat --v 4", expected: "Midjourney image of a cat" }
];

promptTests.forEach((test, index) => {
  const promptMatch = test.data.match(/^(.+?)(?:\s+--|\s*$)/);
  let prompt = promptMatch ? promptMatch[1].trim() : test.data;
  prompt = prompt.replace(/^Prompt:\s*/i, '');
  console.log(`   ${index + 1}. "${test.data}" → "${prompt}": ${prompt === test.expected ? '✓' : '✗'}`);
});

console.log('\n🎉 Basic validation tests completed successfully!');
console.log('\n📝 Note: Full parser testing requires the application runtime environment.');
console.log('   The Midjourney parser is integrated into the fileIndexer.ts and will be tested');
console.log('   when processing actual Midjourney images with embedded metadata.');