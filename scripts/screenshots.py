#!/usr/bin/env python3
"""Capture the README / docs screenshots with Playwright (Chromium).

Starts the built app on a spare port, seeds a few boards through
localStorage so every shot shows real content, and writes PNGs to
docs/screenshots/. Run: npm run build && npm run screenshots
"""
import json
import os
import socket
import subprocess
import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "docs" / "screenshots"
OUT.mkdir(parents=True, exist_ok=True)

SAMPLE_JSON = json.dumps(
    {
        "service": "checkout-api",
        "version": "2026.9.1",
        "healthy": True,
        "regions": ["us-east-1", "eu-west-2", "ap-southeast-1"],
        "limits": {"rps": 1200, "burst": None, "retry": {"attempts": 3, "backoffMs": [100, 400, 1600]}},
        "owners": [{"team": "payments", "oncall": "pager@example.com"}],
    },
    indent=2,
)
JWT = (
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9."
    "eyJzdWIiOiJ1c2VyXzQyIiwibmFtZSI6IkFkYSBMb3ZlbGFjZSIsInJvbGUiOiJhZG1pbiIsImlhdCI6MTc1ODE1MzYwMCwiZXhwIjoxNzg5Njg5NjAwfQ."
    "s1gn4tur3-not-verified-here"
)
YAML = "server:\n  host: 0.0.0.0\n  port: 8166\nfeatures:\n  - offline\n  - pipes\n  - boards\nlimits:\n  rps: 1200\n"
DIFF = "name: c64\nversion: 0.1.0\nfeatures:\n  - panes\n  - modes\n=====\nname: c64\nversion: 1.0.0\nfeatures:\n  - panes\n  - modes\n  - pipes\n  - boards\n"
MD = "# Release notes\n\nc64 **1.0** adds pipes, boards and *20 new tools*.\n\n- [x] Command palette\n- [x] Offline (PWA)\n- [ ] Plugins\n\n| Tool | Category |\n|---|---|\n| Hash | Crypto & IDs |\n| Diff | Developer |\n\n```json\n{\"ok\": true}\n```\n"


def pane(mode, text, **opts):
    return {"type": "pane", "id": f"p_{mode}_{abs(hash(text)) % 10**6}", "state": {"mode": mode, "input": text, "seam": 0.42, "pretty": True, "layout": "stacked", "options": opts.pop("options", {}), **opts}}


def split(direction, sizes, *children):
    return {"type": "split", "id": f"s_{direction}_{len(children)}_{abs(hash(str(sizes)))%10**5}", "dir": direction, "children": list(children), "sizes": sizes}


BOARDS = {
    "workspace": split("row", [0.42, 0.58], pane("json", SAMPLE_JSON, title="Payload"), split("col", [0.55, 0.45], pane("json-tree", SAMPLE_JSON, title="Tree"), pane("jwt", JWT, layout="side"))),
    "pipes": split("row", [0.34, 0.33, 0.33], pane("yaml", YAML, title="YAML in", pretty=False), pane("json", '{"server":{"host":"0.0.0.0","port":8166},"features":["offline","pipes","boards"],"limits":{"rps":1200}}', title="→ JSON", sourceId="src"), pane("json-to-types", '{"server":{"host":"0.0.0.0","port":8166},"features":["offline","pipes","boards"],"limits":{"rps":1200}}', title="→ TypeScript", sourceId="mid")),
    "tools": split("row", [0.5, 0.5], split("col", [0.5, 0.5], pane("diff", DIFF, title="Diff"), pane("hash", "The quick brown fox jumps over the lazy dog", title="Hashes")), split("col", [0.5, 0.5], pane("markdown", MD, title="Markdown"), pane("regex", "2026-09-18 ERROR db: timeout after 30s\n2026-09-18 WARN cache: miss rate 12%\n2026-09-19 ERROR api: 502 from upstream", title="Regex", options={"pattern": r"(?<date>\d{4}-\d{2}-\d{2}) (?<level>ERROR|WARN) (?<src>\w+):", "flags": "g"}))),
    "empty": pane("json", ""),
}
# Fix pipe ids so the linked panes point at real neighbours.
p = BOARDS["pipes"]
p["children"][0]["id"] = "src"
p["children"][1]["id"] = "mid"


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def main():
    port = free_port()
    env = {**os.environ, "PORT": str(port), "HOST": "127.0.0.1", "NODE_ENV": "production"}
    server = subprocess.Popen(["node", "server.mjs"], cwd=ROOT, env=env, stdout=subprocess.DEVNULL)
    try:
        time.sleep(0.8)
        base = f"http://127.0.0.1:{port}/"
        with sync_playwright() as pw:
            browser = pw.chromium.launch()

            def shot(name, board_key, theme="dark", width=1440, height=900, mobile=False, after=None):
                ctx = browser.new_context(viewport={"width": width, "height": height}, device_scale_factor=2, is_mobile=mobile, has_touch=mobile, color_scheme=theme)
                page = ctx.new_page()
                board = BOARDS[board_key]
                file = {"current": "b1", "boards": [{"id": "b1", "name": "Release checks", "root": board, "updated": 0}, {"id": "b2", "name": "Scratch", "root": pane("json", ""), "updated": 0}]}
                page.add_init_script(f"localStorage.setItem('c64.boards.v1', {json.dumps(json.dumps(file))}); localStorage.setItem('c64.theme', '{theme}'); localStorage.setItem('c64.prefs.v1', JSON.stringify({{sidebar: '{'closed' if mobile else 'open'}', fontSize: 13}}));")
                page.goto(base, wait_until="networkidle")
                page.wait_for_timeout(700)
                if after:
                    after(page)
                    page.wait_for_timeout(500)
                page.screenshot(path=str(OUT / f"{name}.png"))
                ctx.close()
                print("wrote docs/screenshots/%s.png" % name)

            shot("workspace-dark", "workspace")
            shot("workspace-light", "workspace", theme="light")
            shot("pipes", "pipes")
            shot("tools", "tools")
            shot("empty-picker", "empty", theme="light")
            shot("palette", "workspace", after=lambda pg: (pg.keyboard.press("Control+K"), pg.keyboard.type("hash")))
            shot("mobile", "workspace", width=430, height=932, mobile=True)
            browser.close()
    finally:
        server.terminate()


if __name__ == "__main__":
    sys.exit(main())
