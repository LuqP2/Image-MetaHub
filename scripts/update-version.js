#!/usr/bin/env node

/**
 * Complete Version Update Script
 * Updates version across ALL files in the project
 *
 * Usage: node update-version.js <version>
 * Example: node update-version.js 0.11.2
 */

import { readFileSync, writeFileSync } from 'fs';

const NEW_VERSION = process.argv[2];
if (!NEW_VERSION) {
  console.error('❌ Error: Version argument required');
  console.error('Usage: node update-version.js <version>');
  console.error('Example: node update-version.js 0.11.2');
  process.exit(1);
}

// Validate semver format
if (!/^\d+\.\d+\.\d+(-[a-z0-9.-]+)?$/.test(NEW_VERSION)) {
  console.error(`❌ Error: Invalid version format: ${NEW_VERSION}`);
  console.error('Expected format: MAJOR.MINOR.PATCH (e.g., 0.11.2 or 1.0.0-rc)');
  process.exit(1);
}

console.log(`\n🔄 Updating version to v${NEW_VERSION}...\n`);

let updatedCount = 0;
let errors = [];

/**
 * Update a file with pattern replacement
 */
function updateFile(filePath, pattern, replacement, description) {
  try {
    const content = readFileSync(filePath, 'utf8');
    const newContent = content.replace(pattern, replacement);

    if (content === newContent) {
      console.log(`⚠️  [SKIP] ${description} - no changes needed`);
      return false;
    }

    writeFileSync(filePath, newContent, 'utf8');
    console.log(`✅ [${++updatedCount}] ${description}`);
    return true;
  } catch (error) {
    const errorMsg = `Failed to update ${filePath}: ${error.message}`;
    errors.push(errorMsg);
    console.error(`❌ ${errorMsg}`);
    return false;
  }
}

// ============================================================
// 1. package.json - Main version field
// ============================================================
updateFile(
  'package.json',
  /"version":\s*"[^"]+"/,
  `"version": "${NEW_VERSION}"`,
  'package.json version field'
);

// ============================================================
// 2. ARCHITECTURE.md - Current Version section
// ============================================================
updateFile(
  'ARCHITECTURE.md',
  /- \*\*Version:\*\*\s*\d+\.\d+\.\d+(-[a-z0-9.-]+)?/,
  `- **Version:** ${NEW_VERSION}`,
  'ARCHITECTURE.md current version'
);

// ============================================================
// 3. components/Header.tsx - Main header title
// ============================================================
updateFile(
  'components/Header.tsx',
  /Image MetaHub v\d+\.\d+\.\d+(-[a-z0-9.-]+)?/,
  `Image MetaHub v${NEW_VERSION}`,
  'Header.tsx main title'
);

// ============================================================
// 4. components/FolderSelector.tsx - Welcome screen (all occurrences)
// ============================================================
updateFile(
  'components/FolderSelector.tsx',
  /v\d+\.\d+\.\d+(-[a-z0-9.-]+)?/g,
  `v${NEW_VERSION}`,
  'FolderSelector.tsx welcome screen (all occurrences)'
);

// ============================================================
// 5. index.html - Page title
// ============================================================
updateFile(
  'index.html',
  /<title>Image MetaHub v\d+\.\d+\.\d+(-[a-z0-9.-]+)?<\/title>/,
  `<title>Image MetaHub v${NEW_VERSION}</title>`,
  'index.html page title'
);

// ============================================================
// 6. electron.mjs - Window title fallback
// ============================================================
updateFile(
  'electron.mjs',
  /mainWindow\.setTitle\('Image MetaHub v\d+\.\d+\.\d+(-[a-z0-9.-]+)?'\)/,
  `mainWindow.setTitle('Image MetaHub v${NEW_VERSION}')`,
  'electron.mjs window title fallback'
);

// ============================================================
// 7. electron.mjs - Mock update info version
// ============================================================
updateFile(
  'electron.mjs',
  /version:\s*'\d+\.\d+\.\d+(-[a-z0-9.-]+)?'/,
  `version: '${NEW_VERSION}'`,
  'electron.mjs mock update info'
);

// ============================================================
// 8. cli.ts - CLI version
// ============================================================
updateFile(
  'cli.ts',
  /\.version\('\d+\.\d+\.\d+(-[a-z0-9.-]+)?'\)/,
  `.version('${NEW_VERSION}')`,
  'cli.ts version'
);

// ============================================================
// 9. components/ChangelogModal.tsx - Message from dev
// ============================================================
// Note: This one is optional and may need manual adjustment
// for the description text based on the release content
const changelogUpdated = updateFile(
  'components/ChangelogModal.tsx',
  /Image MetaHub \d+\.\d+\.\d+(-[a-z0-9.-]+)? is here/,
  `Image MetaHub ${NEW_VERSION} is here`,
  'ChangelogModal.tsx version reference'
);

if (changelogUpdated) {
  console.log(`   ℹ️  Note: You may want to manually update the release description in ChangelogModal.tsx`);
}

// ============================================================
// 10. Sync CHANGELOG.md to public/ (if needed for build)
// ============================================================
try {
  const changelog = readFileSync('CHANGELOG.md', 'utf8');
  writeFileSync('public/CHANGELOG.md', changelog, 'utf8');
  console.log(`✅ [${++updatedCount}] Synced CHANGELOG.md to public/`);
} catch (error) {
  errors.push(`Failed to sync CHANGELOG.md: ${error.message}`);
  console.error(`❌ Failed to sync CHANGELOG.md: ${error.message}`);
}

// ============================================================
// Summary
// ============================================================
console.log('\n' + '='.repeat(60));
if (errors.length > 0) {
  console.log(`⚠️  Version update completed with ${errors.length} error(s)`);
  console.log('\nErrors:');
  errors.forEach(err => console.log(`  - ${err}`));
  console.log('\n' + '='.repeat(60));
  process.exit(1);
} else {
  console.log(`✅ Successfully updated ${updatedCount} files to v${NEW_VERSION}`);
  console.log('='.repeat(60));
  console.log('\n📋 Next steps:');
  console.log(`  1. Review changes: git diff`);
  console.log(`  2. Update CHANGELOG.md with release notes for v${NEW_VERSION}`);
  console.log(`  3. Run: npm run auto-release ${NEW_VERSION}`);
  console.log(`     OR commit manually: git add . && git commit -m "chore: bump version to v${NEW_VERSION}"`);
  console.log('\n');
}
