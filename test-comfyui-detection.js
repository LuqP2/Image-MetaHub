const testMetadata = 'front view, samsung king mackerel, Robotic Terror, Large Format Photography, selective color, subdued nightlight, leica m3 analog, muted low grain, ((a close-up portrait)) robocop, a dilapidated Awful with mechanical Peplum dress, stained with blood and dust. advanced cinematic perfect light metal textures, scars, damaged implants. futuristic dystopian atmosphere, Edgy lighting with cold glare. darksyber aesthetic, photorealistic style, portrait, (tuvaluan:1.15) , (Gray eyes:1.05) , ( pink lips:1.05) , (thin lips:1.05) , long face-shape, (bushy hair style:1.05) , (multicolored hair color:1.05) , (Knotty hair length:1.05) , A close up view of the face of a robot. The robot\'s face is covered in Amaranth and white paint. The eyes of the Journalist are covered in Flamboyant deep purple paint. There is a Absurd circle in the center of the head that is black in color. There are ridges of the metal around the robot\'s neck and around the neck. The figure\'s neck is made up of a series of ridges and bumps that run vertically. The face of the figure is covered by the silhouette paint.\\nNegative prompt: \\nSteps: 20, Sampler: Euler, CFG scale: 3.5, Seed: 934100943193926, Size: 896x1152, Hashes: {"Model:flux1-dev-fp8": "8e91b68084", "model": "8e91b68084"}, Version: ComfyUI';
function isComfyUIMetadata(metadata) {
  if (!metadata) return false;
  if (metadata.workflow && typeof metadata.workflow === 'object') {
    return true;
  }
  if (metadata.prompt && typeof metadata.prompt === 'object' && metadata.prompt.workflow) {
    return true;
  }
  if (typeof metadata === 'string' && metadata.includes('Version: ComfyUI')) {
    return true;
  }
  if (metadata.parameters && typeof metadata.parameters === 'string' && metadata.parameters.includes('Version: ComfyUI')) {
    return true;
  }
  return false;
}
console.log('Testing isComfyUIMetadata with string metadata:');
console.log('Result:', isComfyUIMetadata(testMetadata));
console.log('\\nTesting isComfyUIMetadata with object metadata:');
console.log('Result:', isComfyUIMetadata({ parameters: testMetadata }));
