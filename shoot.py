"""Take the three token-radar screenshots with Playwright Chromium (real renders)."""
import asyncio
import sys
from playwright.async_api import async_playwright

BASE = "file:///home/hatch/workspace/makefun/token-radar-01/out/dashboard/index.html"
OUT = "/home/hatch/workspace/makefun/token-radar-01/screenshots"
CHROME = "/home/hatch/.cache/ms-playwright/chrome-linux64/chrome"


async def main() -> None:
    async with async_playwright() as p:
        browser = await p.chromium.launch(
            executable_path=CHROME,
            args=["--no-sandbox", "--disable-gpu", "--allow-file-access-from-files"],
        )
        page = await browser.new_page(viewport={"width": 1440, "height": 900}, device_scale_factor=1)
        errors = []
        page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
        page.on("pageerror", lambda e: errors.append(str(e)))

        # 1. board
        await page.goto(BASE)
        await page.wait_for_selector("tbody tr", timeout=15000)
        await page.wait_for_timeout(400)
        await page.screenshot(path=f"{OUT}/1-board.png")

        # 2. detail: open the rank-1 row via hash (query param forces a real reload)
        slug = sys.argv[1] if len(sys.argv) > 1 else "steakhouse-financial"
        await page.goto(f"{BASE}?shot=2#p={slug}")
        await page.wait_for_selector("dialog.detail >> visible=true", timeout=15000)
        await page.wait_for_timeout(400)
        await page.screenshot(path=f"{OUT}/2-detail.png")

        # 3. filtered view: search "lending"
        await page.goto(f"{BASE}?shot=3#q=lending")
        await page.wait_for_selector("tbody tr", timeout=15000)
        await page.wait_for_timeout(400)
        await page.screenshot(path=f"{OUT}/3-filtered.png")

        await browser.close()
        print("console errors:", errors if errors else "none")


asyncio.run(main())
