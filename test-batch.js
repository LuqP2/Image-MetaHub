#!/usr/bin/env node

/**
 * Test script for batch file reading optimization
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Simulate the batch reading logic
async function testBatchReading() {
    console.log('🧪 Testing batch file reading logic...');

    // Test directory
    const testDir = 'K:\\outputs\\images';
    console.log(`📁 Test directory: ${testDir}`);

    try {
        // Check if directory exists
        if (!fs.existsSync(testDir)) {
            console.log('❌ Test directory does not exist');
            return;
        }

        // Get some PNG files
        const files = fs.readdirSync(testDir)
            .filter(file => file.toLowerCase().endsWith('.png'))
            .slice(0, 10); // Just test with first 10 files

        console.log(`📄 Found ${files.length} PNG files for testing`);

        if (files.length === 0) {
            console.log('❌ No PNG files found for testing');
            return;
        }

        // Simulate batch creation
        const BATCH_SIZE = 5;
        const batches = [];
        for (let i = 0; i < files.length; i += BATCH_SIZE) {
            batches.push(files.slice(i, i + BATCH_SIZE));
        }

        console.log(`📦 Would create ${batches.length} batches of ${BATCH_SIZE} files each`);

        // Test reading one batch
        const firstBatch = batches[0];
        console.log(`🔄 Testing batch with ${firstBatch.length} files:`);
        firstBatch.forEach(file => console.log(`   - ${file}`));

        // Simulate reading files
        const filePaths = firstBatch.map(file => path.join(testDir, file));
        console.log('📖 Reading files...');

        const startTime = Date.now();
        const results = await Promise.allSettled(
            filePaths.map(filePath => fs.promises.readFile(filePath))
        );
        const endTime = Date.now();

        const successCount = results.filter(r => r.status === 'fulfilled').length;
        const failCount = results.filter(r => r.status === 'rejected').length;

        console.log(`✅ Batch read complete in ${endTime - startTime}ms`);
        console.log(`   - Success: ${successCount} files`);
        console.log(`   - Failed: ${failCount} files`);
        console.log(`   - Average: ${(endTime - startTime) / firstBatch.length}ms per file`);

    } catch (error) {
        console.error('❌ Test failed:', error.message);
    }
}

testBatchReading();