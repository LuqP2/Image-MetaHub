#!/usr/bin/env node

/**
 * Complete Release Workflow Script
 * Handles version bump, changelog update, tag creation, and release generation
 */

import { execSync } from 'child_process';

const VERSION = process.argv[2];
if (!VERSION) {
  console.error('Usage: node release-workflow.js <version>');
  console.error('Example: node release-workflow.js 1.7.4');
  process.exit(1);
}

console.log(`🚀 Starting release workflow for v${VERSION}\n`);

// Step 1: Update version across ALL files
console.log('📝 Updating version across all files...');
execSync(`node update-version.js ${VERSION}`, { stdio: 'inherit' });

// Step 2: Generate release notes
console.log('📝 Generating release notes...');
execSync(`node generate-release.js ${VERSION}`, { stdio: 'inherit' });

// Step 3: Commit changes
console.log('💾 Committing version changes...');
execSync('git add package.json ARCHITECTURE.md', { stdio: 'inherit' });
execSync(`git commit -m "chore: bump version to v${VERSION}"`, { stdio: 'inherit' });
console.log('✅ Changes committed');

// Step 4: Create and push tag
console.log('🏷️  Creating and pushing tag...');
execSync(`git tag v${VERSION}`, { stdio: 'inherit' });
execSync(`git push origin main`, { stdio: 'inherit' });
execSync(`git push origin v${VERSION}`, { stdio: 'inherit' });
console.log(`✅ Tag v${VERSION} created and pushed`);

// Step 5: Instructions for manual steps
console.log('\n🎯 MANUAL STEPS REQUIRED:');
console.log('='.repeat(50));
console.log(`1. 📋 Copy release notes from: release-v${VERSION}.md`);
console.log(`2. 🌐 Go to: https://github.com/LuqP2/image-metahub/releases/new`);
console.log(`3. 🏷️  Select tag: v${VERSION}`);
console.log(`4. 📝 Paste the release notes into the description`);
console.log(`5. 📤 Set as latest release and publish!`);
console.log('='.repeat(50));

// Optional: Open browser to GitHub releases page
console.log('\n🔗 Opening GitHub releases page...');
try {
  execSync('start https://github.com/LuqP2/image-metahub/releases/new', { stdio: 'inherit' });
} catch (error) {
  console.log('💡 Manually open: https://github.com/LuqP2/image-metahub/releases/new');
}

console.log('\n🎉 Release workflow completed!');
console.log(`📁 Release notes saved to: release-v${VERSION}.md`);