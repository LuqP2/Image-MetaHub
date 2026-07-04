import asyncio
import os
from playwright.async_api import async_playwright

async def run():
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        # Create a context with clipboard permissions
        context = await browser.new_context(
            permissions=['clipboard-read', 'clipboard-write']
        )
        page = await context.new_page()

        # Log console messages
        page.on("console", lambda msg: print(f"PAGE LOG: {msg.text}"))

        await page.goto("http://localhost:5173")

        # Bypass license and welcome screen
        await page.evaluate("""() => {
            localStorage.setItem('IMH_LICENSE_SECRET', 'pro');
            // Mock state
            window.useImageStore.setState({
                images: [{ id: 'test-image-1', path: 'test.jpg', directoryId: 'dir1' }],
                directories: [{ id: 'dir1', path: 'test-dir' }],
                selectedImageIds: ['test-image-1']
            });
        }""")

        await page.reload()

        # Wait for the toolbar to be visible
        copy_button = page.get_by_label("Copy to Clipboard")
        await copy_button.wait_for(state="visible")

        print("Copy button visible.")

        # Click the button
        await copy_button.click()
        print("Copy button clicked.")

        # Take a screenshot immediately after click
        await page.screenshot(path="verification/screenshots/immediately_after_click.png")

        # Polling for "Copied!" state
        found_copied = False
        for i in range(20):
            if await page.get_by_label("Copied!").is_visible():
                found_copied = True
                print(f"Found 'Copied!' state at iteration {i}")
                await page.screenshot(path="verification/screenshots/success_copied.png")
                break
            await asyncio.sleep(0.1)

        if not found_copied:
            print("Failed to find 'Copied!' state.")
            # Let's check what label the button has now
            # We can use a selector that targets the button element specifically
            label = await page.evaluate("() => document.querySelector('button[aria-label]').ariaLabel")
            print(f"Current button label: {label}")

        await browser.close()

if __name__ == "__main__":
    os.makedirs("verification/screenshots", exist_ok=True)
    asyncio.run(run())
