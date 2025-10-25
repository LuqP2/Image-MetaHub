
import asyncio
from playwright.async_api import async_playwright, expect

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page()

        # Mock the electronAPI
        await page.add_init_script("""
            window.electronAPI = {
                showDirectoryDialog: () => {
                    return Promise.resolve({
                        canceled: false,
                        path: '/__tests__/fixtures/images',
                        name: 'images'
                    });
                },
                streamDirectoryFiles: async ({ directoryId }) => {
                    // Simulate streaming files in batches
                    const files1 = Array.from({ length: 50 }, (_, i) => ({ name: `file${i + 1}.png`, lastModified: Date.now() }));
                    const files2 = Array.from({ length: 50 }, (_, i) => ({ name: `file${i + 51}.png`, lastModified: Date.now() }));

                    setTimeout(() => {
                        window.dispatchEvent(new CustomEvent('directory-scan-batch', { detail: { directoryId, files: files1 } }));
                    }, 100);

                    setTimeout(() => {
                        window.dispatchEvent(new CustomEvent('directory-scan-batch', { detail: { directoryId, files: files2 } }));
                    }, 300);

                    setTimeout(() => {
                        window.dispatchEvent(new CustomEvent('directory-scan-complete', { detail: { directoryId, total: 100 } }));
                    }, 500);

                    return Promise.resolve({ success: true });
                },
                onDirectoryScanBatch: (callback) => {
                    const handler = (event) => callback(event.detail);
                    window.addEventListener('directory-scan-batch', handler);
                    return () => window.removeEventListener('directory-scan-batch', handler);
                },
                onDirectoryScanComplete: (callback) => {
                    const handler = (event) => callback(event.detail);
                    window.addEventListener('directory-scan-complete', handler);
                    return () => window.removeEventListener('directory-scan-complete', handler);
                },
                 onDirectoryScanError: (callback) => {
                    // No-op for this test
                },
                updateAllowedPaths: () => Promise.resolve(),
                // Mock other methods that might be called
                onMenuAddFolder: () => {},
                getTheme: () => Promise.resolve({ shouldUseDarkColors: true }),
            };
        """)

        await page.goto("http://localhost:5173")

        # The app opens a changelog modal on first launch.
        # We need to wait for the button to appear and then close it.
        close_button = page.get_by_role("button", name="Got it!")
        await close_button.wait_for(state="visible")
        await close_button.click()

        # Now, click the "Add Folder" button
        await page.get_by_text("Add Folder").click()

        # Wait for placeholder images to appear
        await expect(page.locator('.image-card.placeholder')).to_have_count(50, timeout=2000)

        # Take a screenshot
        await page.screenshot(path="jules-scratch/verification/verification.png")

        await browser.close()

if __name__ == '__main__':
    asyncio.run(main())
