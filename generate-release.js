#!/usr/bin/env node

/**
 * GitHub Release Generator
 * Generates rich release notes from CHANGELOG.md for GitHub releases
 */

import { readFileSync, writeFileSync } from 'fs';
import { execSync } from 'child_process';

const VERSION = process.argv[2];
if (!VERSION) {
  console.error('Usage: node generate-release.js <version>');
  console.error('Example: node generate-release.js 1.7.4');
  process.exit(1);
}

// Read CHANGELOG.md
const changelog = readFileSync('CHANGELOG.md', 'utf8');

// Extract the specific version section
const lines = changelog.split('\n');
let inVersion = false;
let versionContent = [];

for (const line of lines) {
  if (line.startsWith(`## [${VERSION}]`)) {
    inVersion = true;
    versionContent.push(line);
  } else if (inVersion && line.startsWith('## [')) {
    // Next version section starts
    break;
  } else if (inVersion) {
    versionContent.push(line);
  }
}

if (versionContent.length === 0) {
  console.error(`Version ${VERSION} not found in CHANGELOG.md`);
  console.error('Available versions:');
  const versions = changelog.match(/## \[\d+\.\d+\.\d+\]/g);
  if (versions) {
    versions.forEach(v => console.error(`  ${v.replace('## [', '').replace(']', '')}`));
  }
  process.exit(1);
}

const releaseNotes = versionContent.join('\n').trim();

// Get current date
const today = new Date().toISOString().split('T')[0];

// Generate release title
const releaseTitle = `Local Image Browser for InvokeAI v${VERSION}`;

// Generate rich release body
const releaseBody = `# ${releaseTitle}

${releaseNotes}

## Downloads

Choose the appropriate installer for your operating system:

###  Windows
- **Installer**: \`LocalImageBrowser-InvokeAI-Setup-${VERSION}.exe\`
- **Format**: NSIS installer with desktop and start menu shortcuts
- **Size**: ~85MB

###  macOS
- **Intel Macs**: \`LocalImageBrowser-InvokeAI-${VERSION}.dmg\`
- **Apple Silicon**: \`LocalImageBrowser-InvokeAI-${VERSION}-arm64.dmg\`
- **Format**: DMG packages with proper entitlements
- **Requirements**: macOS 10.15+

###  Linux
- **Universal**: \`LocalImageBrowser-InvokeAI-${VERSION}.AppImage\`
- **Format**: Portable AppImage (no installation required)
- **Dependencies**: None (fully self-contained)

## What's New in v${VERSION}

${releaseNotes.split('\n').slice(2).join('\n')}

## System Requirements

- **OS**: Windows 10+, macOS 10.15+, Ubuntu 18.04+ (or equivalent)
- **RAM**: 4GB minimum, 8GB recommended
- **Storage**: 100MB for application + space for your image collections

## Documentation

- [README](https://github.com/LuqP2/local-image-browser-for-invokeai/blob/main/README.md)
- [Architecture](https://github.com/LuqP2/local-image-browser-for-invokeai/blob/main/ARCHITECTURE.md)
- [Changelog](https://github.com/LuqP2/local-image-browser-for-invokeai/blob/CHANGELOG.md)

## Known Issues

- Safari, Firefox, and Brave browsers don't support the File System Access API on macOS
- Use Chrome, Vivaldi, Edge, or the Desktop App for full functionality

## Feedback

Found a bug or have a feature request? [Open an issue](https://github.com/LuqP2/local-image-browser-for-invokeai/issues)!

---

*Released on ${today}*`;

// Save to file
const filename = `release-v${VERSION}.md`;
writeFileSync(filename, releaseBody);

console.log(`Release notes generated: ${filename}`);
console.log('\nRelease Body Preview:');
console.log('='.repeat(50));
console.log(releaseBody.split('\n').slice(0, 10).join('\n') + '\n...');
console.log('='.repeat(50));
console.log('\nTo create the GitHub release:');
console.log(`1. Create and push tag: git tag v${VERSION} && git push origin v${VERSION}`);
console.log(`2. Go to GitHub releases and create new release for tag v${VERSION}`);
console.log(`3. Copy the content from ${filename} into the release description`);
console.log('4. Publish the release!');

// Optional: Open browser to GitHub releases page
console.log('\nOpening GitHub releases page...');
try {
  // Only try to open browser on Windows (where 'start' command exists)
  if (process.platform === 'win32') {
    execSync('start https://github.com/LuqP2/local-image-browser-for-invokeai/releases/new', { stdio: 'inherit' });
  } else {
    console.log('On non-Windows systems, manually open: https://github.com/LuqP2/local-image-browser-for-invokeai/releases/new');
  }
} catch (error) {
  console.log('Manually open: https://github.com/LuqP2/local-image-browser-for-invokeai/releases/new');
}