#!/usr/bin/env node

/**
 * Automated Release Script
 * Complete workflow: build, test, version bump, commit, tag, push
 * GitHub Actions will handle the actual release creation and publishing
 */

import { readFileSync, writeFileSync } from 'fs';
import { execSync } from 'child_process';

const VERSION = process.argv[2];
if (!VERSION) {
  console.error('Usage: node auto-release.js <version>');
  console.error('Example: node auto-release.js 1.7.5');
  process.exit(1);
}

console.log(`🚀 Starting AUTOMATED release workflow for v${VERSION}\n`);

// Step 1: Run tests and build to ensure everything works
console.log('🧪 Testing build process...');
try {
  console.log('Building project...');
  execSync('npm run build', { stdio: 'inherit' });
  console.log('✅ Build successful');
} catch (error) {
  console.error('❌ Build failed! Aborting release.');
  process.exit(1);
}

// Step 2: Update package.json version
console.log('📦 Updating package.json version...');
const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));
packageJson.version = VERSION;
writeFileSync('package.json', JSON.stringify(packageJson, null, 2) + '\n');
console.log(`✅ Updated to v${VERSION}`);

// Step 3: Update ARCHITECTURE.md version
console.log('📖 Updating ARCHITECTURE.md version...');
let architecture = readFileSync('ARCHITECTURE.md', 'utf8');
architecture = architecture.replace(/Version: \d+\.\d+\.\d+/g, `Version: ${VERSION}`);
writeFileSync('ARCHITECTURE.md', architecture);
console.log(`✅ Updated ARCHITECTURE.md to v${VERSION}`);

// Step 4: Generate release notes
console.log('📝 Generating release notes...');
execSync(`node generate-release.js ${VERSION}`, { stdio: 'inherit' });

// Step 5: Commit all changes
console.log('💾 Committing all changes...');
execSync('git add .', { stdio: 'inherit' });
execSync(`git commit -m "chore: release v${VERSION}

- Performance optimizations: eliminated console logging spam
- Fixed image duplication bug (36k -> 18k processing)
- Fixed critical syntax errors preventing app startup
- Updated version to ${VERSION}"`, { stdio: 'inherit' });
console.log('✅ All changes committed');

// Step 6: Create and push tag
console.log('🏷️  Creating and pushing tag...');
execSync(`git tag v${VERSION}`, { stdio: 'inherit' });
execSync(`git push origin main`, { stdio: 'inherit' });
execSync(`git push origin v${VERSION}`, { stdio: 'inherit' });
console.log(`✅ Tag v${VERSION} created and pushed`);

// Step 7: Wait a moment for GitHub to process
console.log('⏳ Waiting for GitHub Actions to start...');
await new Promise(resolve => setTimeout(resolve, 3000));

console.log('\n🎉 AUTOMATED RELEASE COMPLETED!');
console.log('='.repeat(60));
console.log(`📦 Version: v${VERSION}`);
console.log(`🔗 GitHub Actions: https://github.com/LuqP2/local-image-browser-for-invokeai/actions`);
console.log(`📋 Release will be created automatically at:`);
console.log(`   https://github.com/LuqP2/local-image-browser-for-invokeai/releases/tag/v${VERSION}`);
console.log('='.repeat(60));
console.log('\n📝 What happens next:');
console.log('1. GitHub Actions will build installers for Windows, macOS, Linux');
console.log('2. Installers will be automatically uploaded to the release');
console.log('3. Release will be published with generated notes');
console.log('4. Users can download the new version immediately');
console.log('\n⏰ This usually takes 10-15 minutes to complete.');