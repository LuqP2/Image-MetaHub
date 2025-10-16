const fs = require('fs');

function checkPNGChunks(filePath) {
  if (!fs.existsSync(filePath)) {
    console.log('File not found:', filePath);
    return;
  }

  const buffer = fs.readFileSync(filePath);
  const view = new DataView(buffer.buffer);
  const decoder = new TextDecoder();
  let offset = 8; // Skip PNG signature

  console.log('Checking PNG chunks in:', filePath);

  while (offset < buffer.length - 8) {
    const length = view.getUint32(offset);
    const type = decoder.decode(buffer.slice(offset + 4, offset + 8));

    if (type === 'tEXt' || type === 'iTXt') {
      const chunkData = buffer.slice(offset + 8, offset + 8 + length);
      const chunkString = decoder.decode(chunkData);
      const nullIndex = chunkString.indexOf('\0');
      const keyword = nullIndex !== -1 ? chunkString.substring(0, nullIndex) : chunkString;
      const text = nullIndex !== -1 ? chunkString.substring(nullIndex + 1) : '';

      console.log(`Found ${type} chunk: "${keyword}"`);
      if (keyword.toLowerCase() === 'parameters') {
        console.log('Parameters content (first 200 chars):', text.substring(0, 200));
      }
    }

    offset += 12 + length;
    if (offset > buffer.length) break;
  }
}

// Test with a sample path - replace with your actual image path
const testPath = process.argv[2] || 'd:/temp/test.png';
checkPNGChunks(testPath);