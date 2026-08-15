#!/usr/bin/env node

/**
 * Changelog Synchronization Script
 * 
 * Keeps CHANGELOG.md (root) and public/CHANGELOG.md in sync.
 * 
 * Why two files?
 * - Root CHANGELOG.md: Used by release workflow (scripts/generate-release.js) for GitHub releases
 * - public/CHANGELOG.md: Loaded by the app's ChangelogModal component via fetch('/CHANGELOG.md')
 * 
 * Usage:
 *   node sync-changelog.js [--to-public|--to-root]
 * 
 * Default: Copies root CHANGELOG.md → public/CHANGELOG.md (recommended workflow)
 */

import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const rootChangelog = join(__dirname, 'CHANGELOG.md');
const publicChangelog = join(__dirname, 'public', 'CHANGELOG.md');

const direction = process.argv[2] || '--to-public';

try {
  if (direction === '--to-public') {
    console.log('📄 Syncing CHANGELOG.md → public/CHANGELOG.md');
    const content = readFileSync(rootChangelog, 'utf8');
    writeFileSync(publicChangelog, content, 'utf8');
    console.log('✅ Successfully synced to public/CHANGELOG.md');
  } else if (direction === '--to-root') {
    console.log('📄 Syncing public/CHANGELOG.md → CHANGELOG.md');
    const content = readFileSync(publicChangelog, 'utf8');
    writeFileSync(rootChangelog, content, 'utf8');
    console.log('✅ Successfully synced to CHANGELOG.md');
  } else {
    console.error('❌ Invalid option. Use --to-public or --to-root');
    process.exit(1);
  }
} catch (error) {
  console.error('❌ Error syncing changelog:', error.message);
  process.exit(1);
}
