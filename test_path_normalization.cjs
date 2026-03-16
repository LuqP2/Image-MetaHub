const path = require('path');

const pathsToTest = [
    'D:\\InvokeAI-Local-Image-Search\\Test',
    'd:/invokeai-local-image-search/test',
    'D:/InvokeAI-Local-Image-Search/Test/',
    'd:\\invokeai-local-image-search\\test\\subfolder'
];

const allowedStore = new Set();
allowedStore.add(path.resolve('D:\\InvokeAI-Local-Image-Search\\Test'));

console.log('--- Path.resolve Test ---');
console.log('Allowed (resolved):', Array.from(allowedStore));

pathsToTest.forEach(p => {
    const resolved = path.resolve(p);
    let allowed = false;
    for (const a of allowedStore) {
        if (resolved.toLowerCase().startsWith(a.toLowerCase())) allowed = true;
    }
    console.log(`Input: "${p}" -> Resolved: "${resolved}" -> Allowed? ${allowed}`);
});


console.log('\n--- Manual Forward Slash Test ---');
const normalizeManual = (p) => p.replace(/\\/g, '/').toLowerCase().replace(/\/+$/, '');
const allowedStoreManual = new Set();
allowedStoreManual.add(normalizeManual('D:\\InvokeAI-Local-Image-Search\\Test'));

console.log('Allowed (manual):', Array.from(allowedStoreManual));

pathsToTest.forEach(p => {
    const normalized = normalizeManual(p);
    let allowed = false;
    for (const a of allowedStoreManual) {
        // Simple startswith might fail if it matches partial folder name (e.g. /test vs /tested)
        // Correct check: exact match OR starts with allowed + '/'
        if (normalized === a || normalized.startsWith(a + '/')) allowed = true;
    }
    console.log(`Input: "${p}" -> Normalized: "${normalized}" -> Allowed? ${allowed}`);
});
