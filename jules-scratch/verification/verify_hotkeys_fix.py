from playwright.sync_api import sync_playwright, expect

def run(playwright):
    browser = playwright.chromium.launch(headless=True)
    context = browser.new_context()
    page = context.new_page()

    try:
        page.goto("http://localhost:5173")

        # Assume a folder is loaded.
        expect(page.locator('header')).to_be_visible()

        # Press F1 to open the hotkey help
        page.keyboard.press('F1')

        # Check if the hotkey help modal is visible
        expect(page.locator('[data-testid="hotkey-help-modal"]')).to_be_visible()

        # Screenshot of the hotkey help modal
        page.screenshot(path="jules-scratch/verification/hotkey-help-visible.png")

    except Exception as e:
        print(f"An error occurred: {e}")
        page.screenshot(path="jules-scratch/verification/error-hotkey-fix.png")

    finally:
        browser.close()

with sync_playwright() as playwright:
    run(playwright)