const fs = require('fs');
const path = require('path');

// Read workflow file
const workflowPath = process.argv[2] || 'coolpigeon.json';
const fullPath = path.join(__dirname, '.comfyworkflows', workflowPath);

console.log(`\n=== Testing Grouped Workflow: ${workflowPath} ===\n`);

const workflow = JSON.parse(fs.readFileSync(fullPath, 'utf-8'));

// Display main nodes
console.log('Main Nodes:');
workflow.nodes.forEach(node => {
  console.log(`  - Node #${node.id}: ${node.type}`);
  if (node.widgets_values && node.widgets_values.length > 0) {
    console.log(`    Widgets (${node.widgets_values.length}):`, node.widgets_values.slice(0, 3));
  }
});

// Display grouped nodes
if (workflow.extra && workflow.extra.groupNodes) {
  console.log('\nGrouped Workflow Nodes:');
  Object.entries(workflow.extra.groupNodes).forEach(([groupName, groupData]) => {
    console.log(`\n  Group: "${groupName}"`);
    groupData.nodes.forEach(node => {
      console.log(`    - Node #${node.id}: ${node.type}`);
      if (node.widgets_values && node.widgets_values.length > 0) {
        console.log(`      Widgets:`, node.widgets_values.slice(0, 3));
      }
    });
  });
}

// Display widget index map
if (workflow.extra && workflow.extra.widget_idx_map) {
  console.log('\nWidget Index Map:');
  Object.entries(workflow.extra.widget_idx_map).forEach(([nodeId, mappings]) => {
    console.log(`  Node #${nodeId}:`, mappings);
  });
}

console.log('\n');
