const fs = require('fs');

let content = fs.readFileSync('store/useImageStore.ts', 'utf8');

content = content.replace(/ {4}\n {12}const existingIds = new Set<string>\(\);\n {12}for \(let i = 0; i < state\.images\.length; i\+\+\) \{\n {16}existingIds\.add\(state\.images\[i\]\.id\);\n {12}\}\n/g, '');

content = content.replace(/<<<<<<< HEAD\n=======\n>>>>>>> origin\/main/g, '');

fs.writeFileSync('store/useImageStore.ts', content);
