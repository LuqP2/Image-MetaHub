from playwright.sync_api import sync_playwright, expect

def run_verification(playwright):
    browser = playwright.chromium.launch(headless=True)
    context = browser.new_context()
    page = context.new_page()

    try:
        page.goto("http://localhost:5173")

        # Clear localStorage to ensure a clean start
        page.evaluate("() => localStorage.clear()")
        page.reload()

        # Wait for the app to be ready by looking for the FolderSelector component
        expect(page.get_by_text("Select Image Folder")).to_be_visible(timeout=30000)

        # 1. Verify F1 opens the Hotkey Help modal
        page.keyboard.press("F1")
        expect(page.get_by_role("heading", name="Keyboard Shortcuts")).to_be_visible()
        page.screenshot(path="jules-scratch/verification/hotkey_help_modal.png")
        print("Hotkey Help modal opened successfully.")

        # 2. Verify Escape closes the modal
        page.keyboard.press("Escape")
        expect(page.get_by_role("heading", name="Keyboard Shortcuts")).not_to_be_visible()
        print("Hotkey Help modal closed successfully.")

        # 3. Verify Ctrl+K opens the Command Palette
        page.keyboard.press("Control+K")
        expect(page.get_by_placeholder("Type a command or search...")).to_be_visible()
        page.screenshot(path="jules-scratch/verification/command_palette.png")
        print("Command Palette opened successfully.")

        # 4. Verify Escape closes the Command Palette
        page.keyboard.press("Escape")
        expect(page.get_by_placeholder("Type a command or search...")).not_to_be_visible()
        print("Command Palette closed successfully.")

    except Exception as e:
        print(f"An error occurred: {e}")
        page.screenshot(path="jules-scratch/verification/error.png")

    finally:
        browser.close()

with sync_playwright() as playwright:
    run_verification(playwright)