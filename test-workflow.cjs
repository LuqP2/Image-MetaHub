const fs = require('fs');

// Pega o nome do arquivo da linha de comando
const fileName = process.argv[2] || 'image2.json';

const workflow = JSON.parse(fs.readFileSync(`./.comfyworkflows/${fileName}`, 'utf8'));

console.log(`Workflow ${fileName} - Procurando nós CLIPTextEncode...`);

const clipNodes = [];
if (workflow.nodes) {
    for (const node of workflow.nodes) {
        if (node.type === 'CLIPTextEncode') {
            clipNodes.push({
                id: node.id,
                text: node.widgets_values?.[0] || '',
                mode: node.mode || 0
            });
        }
    }
}

console.log(`Encontrados ${clipNodes.length} nós CLIPTextEncode:`);
clipNodes.forEach(node => {
    console.log(`- Nó ${node.id}: "${node.text.substring(0, 100)}${node.text.length > 100 ? '...' : ''}" (modo: ${node.mode})`);
});