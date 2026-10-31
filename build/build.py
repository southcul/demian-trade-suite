#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""Build assets/workbench.html from the doc-suite base + loader parts.

Run:  python build/build.py
"""
import os
from pathlib import Path

HERE = Path(__file__).resolve().parent          # .../build
SKILL = Path(os.environ.get("SKILL_DIR", HERE.parent)).resolve()
BASE = HERE / "base.html"
PARTS = HERE / "parts"
OUT = SKILL / "assets" / "workbench.html"


def read(p: Path) -> str:
    return p.read_text(encoding="utf-8")


def main() -> None:
    html = read(BASE)

    nav = read(PARTS / "nav.html")
    loading = read(PARTS / "loading.html")
    css = read(PARTS / "loading.css")
    js = read(PARTS / "loading.js")

    # 2) nav inside app-layout
    anchor = '<div class="app-layout">'
    assert html.count(anchor) == 1, "app-layout anchor"
    html = html.replace(anchor, anchor + "\n" + nav, 1)

    # 3) ids + hidden for the doc workspace (loading tab is the default)
    assert html.count('<div class="top-bar">') == 1, "top-bar anchor"
    html = html.replace(
        '<div class="top-bar">', '<div class="top-bar ws-hidden" id="docTopBar">', 1
    )
    assert html.count('<div class="main-workspace">') == 1, "main-workspace anchor"
    html = html.replace(
        '<div class="main-workspace">',
        '<div class="main-workspace ws-hidden" id="docWorkspace">',
        1,
    )

    # 4) loading section as sibling of main-workspace, inside app-layout
    anchor = '  </div>\n</div>\n\n<!-- 抽屉遮罩层 -->'
    assert html.count(anchor) == 1, "app-layout close anchor"
    html = html.replace(
        anchor,
        '  </div>\n' + loading
        + '\n</div>\n\n<div class="lg-print-area" id="lgPrintArea"></div>\n\n<!-- 抽屉遮罩层 -->',
        1,
    )

    # 5) styles
    anchor = "\n  </style>\n</head>"
    assert html.count(anchor) == 1, "style anchor"
    html = html.replace(anchor, "\n" + css + "\n  </style>\n</head>", 1)

    # 6) loader JS after the doc-suite init()
    anchor = "\n  init();\n</script>"
    assert html.count(anchor) == 1, "init anchor"
    html = html.replace(anchor, "\n  init();\n" + js + "\n</script>", 1)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(html, encoding="utf-8", newline="\n")
    print(f"built {OUT} ({len(html):,} chars)")


if __name__ == "__main__":
    main()
