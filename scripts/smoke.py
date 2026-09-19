#!/usr/bin/env python3
"""Browser smoke test (Playwright/Chromium): loads the built app, walks every
tool with its sample, exercises panes, pipes, palette and boards, and fails
on any console error or page error. Run: npm run build && npm run smoke"""
import os
import socket
import subprocess
import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def main():
    port = free_port()
    env = {**os.environ, "PORT": str(port), "HOST": "127.0.0.1", "NODE_ENV": "production"}
    server = subprocess.Popen(["node", "server.mjs"], cwd=ROOT, env=env, stdout=subprocess.DEVNULL)
    problems = []
    try:
        time.sleep(0.8)
        with sync_playwright() as pw:
            browser = pw.chromium.launch()
            page = browser.new_page(viewport={"width": 1400, "height": 900})
            page.on("console", lambda m: problems.append(f"console.{m.type}: {m.text}") if m.type in ("error",) else None)
            page.on("pageerror", lambda e: problems.append(f"pageerror: {e}"))
            page.goto(f"http://127.0.0.1:{port}/", wait_until="networkidle")
            assert page.locator(".pane").count() == 1, "one pane on a fresh board"
            assert page.locator("body.sidebar-collapsed").count() == 1, "first visit starts with the sidebar collapsed"
            page.click("#sidebar-toggle")
            page.wait_for_timeout(250)

            assert page.locator(".pane.is-active .mode-select").input_value() == "auto", "a fresh pane starts in Auto detect"
            assert page.locator(".pane.is-active .start-chips:not([hidden])").count() == 1, "start chips under the empty Auto editor"
            assert page.locator(".pane.is-active .run-btn").inner_text() == "Detect & run"

            # Every tool: clear (back to Auto), pick via sidebar, click the empty-state
            # "Try a sample" button, expect no error box. Auto has no sample button:
            # paste its (JSON) sample and let detection do its job.
            ids = page.eval_on_selector_all(".nav-item", "els => els.map(e => e.dataset.mode)")
            expected = page.evaluate("() => document.querySelectorAll('.nav-section:not(.nav-special) .nav-item').length")
            ids = list(dict.fromkeys(ids))
            assert len(ids) == expected and expected >= 54, f"expected all tools in the sidebar, got {len(ids)} of {expected}"
            for mode in ids:
                page.click(".pane.is-active .panel-head button:has-text('Clear')")
                page.click(f'.nav-item[data-mode="{mode}"]')
                if mode == "auto":
                    page.fill(".pane.is-active textarea >> nth=0", '{"service":"api","healthy":true}')
                else:
                    page.click(".pane.is-active .picker-ready button:has-text('Try a sample')")
                page.wait_for_timeout(350)
                err = page.locator(".pane.is-active .error:not([hidden])")
                if err.count():
                    problems.append(f"{mode}: sample shows error: {err.first.inner_text()[:120]}")
                has_output = page.evaluate("() => { const p = document.querySelector('.pane.is-active'); const o = p.querySelector('.output'); const v = p.querySelector('.view-host'); return (!o.hidden && o.textContent.length > 0) || !v.hidden; }")
                if not has_output:
                    problems.append(f"{mode}: no output rendered for the sample")

            # Panes: split, duplicate, maximise, close + undo.
            page.keyboard.press("Alt+Shift+R")
            page.keyboard.press("Alt+Shift+B")
            assert page.locator(".pane").count() == 3, "split right + below"
            page.keyboard.press("Alt+Shift+D")
            assert page.locator(".pane").count() == 4, "duplicate"
            page.keyboard.press("Alt+Shift+Enter")
            assert page.locator("#board.is-zoomed").count() == 1, "zoomed"
            page.keyboard.press("Alt+Shift+Enter")
            page.keyboard.press("Alt+Shift+W")
            assert page.locator(".pane").count() == 3, "close"
            page.keyboard.press("Alt+Shift+Z")
            assert page.locator(".pane").count() == 4, "undo close"

            # Pipe: base64-decode a sample, send on, downstream pane gets the output.
            page.click(".pane.is-active .panel-head button:has-text('Clear')")
            page.click('.nav-item[data-mode="base64"]')
            page.click(".pane.is-active .picker-ready button:has-text('Try a sample')")
            page.wait_for_timeout(300)
            src_out = page.locator(".pane.is-active .output").inner_text()
            page.keyboard.press("Alt+Shift+N")
            page.wait_for_timeout(300)
            linked = page.locator(".pane.is-active textarea").first.input_value()
            assert linked == src_out and linked, "piped pane received the source output"
            assert page.locator(".pane.is-active .link-chip:not([hidden])").count() == 1, "link chip shown"

            # Palette: open, search a tool, run it.
            page.keyboard.press("Control+K")
            page.fill(".palette-input", "cron")
            page.keyboard.press("Enter")
            page.wait_for_timeout(200)
            assert page.locator(".pane.is-active .mode-select").input_value() == "cron", "palette switched tool"

            # Boards: new board via palette, then back.
            page.keyboard.press("Control+K")
            page.fill(".palette-input", "new board")
            page.keyboard.press("Enter")
            page.wait_for_timeout(200)
            assert page.locator(".pane").count() == 1, "new board starts with one pane"
            assert "Board 2" in page.locator("#board-menu").inner_text()

            # Auto detect: typing JSON switches the pane to JSON and shows the chip;
            # a JWT pasted into a new pane switches that one to JWT.
            assert page.locator(".pane.is-active .mode-select").input_value() == "auto"
            page.type(".pane.is-active textarea >> nth=0", '{"a":1}')
            page.wait_for_timeout(400)
            assert page.locator(".pane.is-active .mode-select").input_value() == "json", "typed JSON was detected"
            assert page.locator(".pane.is-active .detect-chip:not([hidden])").count() == 1, "detect chip visible"
            assert "Detected JSON" in page.locator(".pane.is-active .detect-chip").inner_text()
            page.keyboard.press("Alt+Shift+R")
            page.wait_for_timeout(200)
            assert page.locator(".pane.is-active .mode-select").input_value() == "auto", "new pane starts in Auto"
            page.fill(".pane.is-active textarea >> nth=0", "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c")
            page.wait_for_timeout(400)
            assert page.locator(".pane.is-active .mode-select").input_value() == "jwt", "pasted JWT was detected"
            # A manual choice hides the chip; Clear returns to Auto.
            page.click('.nav-item[data-mode="hash"]')
            assert page.locator(".pane.is-active .detect-chip:not([hidden])").count() == 0, "manual choice hides the chip"
            page.click(".pane.is-active .panel-head button:has-text('Clear')")
            assert page.locator(".pane.is-active .mode-select").input_value() == "auto", "Clear returns to Auto"
            # Primary action: Format JSON on the first pane, Shift+click copies.
            page.keyboard.press("Alt+Shift+W")
            assert page.locator(".pane.is-active .run-btn").inner_text() == "Format JSON"
            page.click(".pane.is-active .run-btn")
            # Title-bar chrome: one pane → no split/close icons; ⋯ menu carries them.
            assert page.locator(".pane-title .btn.close:visible").count() == 0, "close icon hidden on a single-pane board"
            page.click(".pane.is-active .more-btn")
            assert page.locator(".menu-item:has-text('Add pane to the right')").count() == 1
            page.keyboard.press("Escape")

            # Persistence: reload keeps the boards.
            page.reload(wait_until="networkidle")
            page.wait_for_timeout(300)
            assert "Board 2" in page.locator("#board-menu").inner_text(), "board persisted"

            # Theme + find + wrap don't throw.
            page.keyboard.press("Alt+Shift+T")
            page.keyboard.press("Alt+Shift+F")
            page.keyboard.press("Escape")
            page.keyboard.press("Alt+Shift+O")
            page.wait_for_timeout(200)
            browser.close()
    finally:
        server.terminate()
    if problems:
        print("SMOKE FAILED")
        for p in problems:
            print(" -", p)
        return 1
    print(f"SMOKE OK: {len(ids)} tools, panes, pipes, palette, boards, persistence, auto-detect")
    return 0


if __name__ == "__main__":
    sys.exit(main())
