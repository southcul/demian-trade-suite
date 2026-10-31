#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""Render a container loading plan PDF from a shipment JSON.

Example:
    python render_loading.py ../assets/demo-shipment.json --container 40HQ --out outputs
"""

from __future__ import annotations

import argparse
import json
import math
import sys
import tempfile
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from render_docs import find_chrome, fnum, load_json, print_pdf  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
WORKBENCH = ROOT / "assets" / "workbench.html"

CAPACITY = {
    "20GP": 33.2, "40GP": 67.7, "40HQ": 76.3, "45HQ": 86.0,
    "4.2m": 15.2, "5.2m": 22.9, "6.8m": 36.0, "7.6m": 40.2,
}
PAYLOAD = {
    "20GP": 28000, "40GP": 26000, "40HQ": 26000, "45HQ": 25000,
    "4.2m": 5000, "5.2m": 8000, "6.8m": 10000, "7.6m": 12000,
}


def to_items(shipment: dict) -> list[dict]:
    items = []
    for i, src in enumerate(shipment.get("items") or [], 1):
        qty = int(fnum(src.get("qty")))
        pcs = int(fnum(src.get("pcs_per_ctn"), 1)) or 1
        cartons = (qty + pcs - 1) // pcs
        l, w, h = fnum(src.get("ctn_l")), fnum(src.get("ctn_w")), fnum(src.get("ctn_h"))
        if qty <= 0 or cartons <= 0 or min(l, w, h) <= 0:
            raise SystemExit(f"items[{i}] needs qty, pcs_per_ctn and ctn_l/w/h")
        gross_pc = fnum(src.get("gross_weight"))
        net_pc = fnum(src.get("net_weight"))
        if gross_pc <= 0 or net_pc > gross_pc:
            raise SystemExit(f"items[{i}] gross/net weight invalid")
        items.append({
            "id": i, "name": src.get("name") or f"货物 {i}",
            "l": l, "w": w, "h": h, "qty": cartons,
            "net": round(net_pc * pcs, 3),
            "tare": round(max(0.0, (gross_pc - net_pc) * pcs), 3),
            "pcsCtn": pcs,
            "packType": "none", "packMode": "thick", "packThick": 0, "packRate": 0,
            "stackLayers": 0, "stackLoad": 0,
            "dir": "any", "fragile": False,
            "gapType": "standard", "gapL": 0, "gapW": 0, "gapH": 0,
            "usePallet": False, "palletL": 120, "palletW": 100, "palletWeight": 20,
            "_adv": False,
        })
    return items


def build_html(items: list[dict], model: str) -> str:
    base = WORKBENCH.read_text(encoding="utf-8")
    payload = json.dumps(items, ensure_ascii=False).replace("</", "<\\/")
    inject = f"""
<script>
(function () {{
  var ITEMS = {payload};
  var MODEL = {json.dumps(model)};
  function draw() {{
    try {{
      LG.state.tab = 'container';
      LG.state.model = MODEL;
      LG.switchWs('loading');
      LG.state.items = ITEMS;
      LG.render();
      LG.calc();
      setTimeout(function () {{
        LG.resize();
        LG.calc();
        LG.buildPlan();
        document.body.classList.add('lg-printing');
        document.title = 'READY';
      }}, 350);
    }} catch (err) {{
      document.title = 'ERROR: ' + err.message;
      console.error(err);
    }}
  }}
  if (document.readyState === 'complete') setTimeout(draw, 400);
  else window.addEventListener('load', function () {{ setTimeout(draw, 400); }});
}})();
</script>
"""
    return base.replace("</body>", inject + "\n</body>", 1)


def main() -> None:
    parser = argparse.ArgumentParser(description="Render a container loading plan PDF.")
    parser.add_argument("shipment", type=Path)
    parser.add_argument("--container", default="40HQ", choices=sorted(CAPACITY), help="container/truck type")
    parser.add_argument("--out", type=Path, default=Path("outputs"))
    parser.add_argument("--chrome", default=None)
    parser.add_argument("--keep-html", action="store_true")
    args = parser.parse_args()

    shipment = load_json(args.shipment)
    items = to_items(shipment)

    cartons = sum(it["qty"] for it in items)
    cbm = sum(it["l"] * it["w"] * it["h"] * it["qty"] for it in items) / 1_000_000
    gw = sum((it["net"] + it["tare"]) * it["qty"] for it in items)
    n_est = max(1, math.ceil(cbm / (CAPACITY[args.container] * 0.85) - 1e-9),
                math.ceil(gw / (PAYLOAD[args.container] * 0.9) - 1e-9))
    util = cbm / CAPACITY[args.container] * 100

    print(f"container: {args.container} | {cartons:,} CTNS | {cbm:.3f} CBM | GW {gw:.2f} KG")
    print(f"volume fill: {util:.1f}% of {CAPACITY[args.container]} m3 | estimated containers: {n_est}")
    if util > 95:
        print("[warn] volume exceeds 95% of nominal capacity — the single-container plan will show unloaded cartons")

    chrome = find_chrome(args.chrome)
    args.out.mkdir(parents=True, exist_ok=True)
    pdf_path = args.out / f"{args.shipment.stem}_loading_{args.container}.pdf"

    html_path = Path(tempfile.gettempdir()) / f"_ft_loading_{uuid.uuid4().hex[:8]}.html"
    html_path.write_text(build_html(items, args.container), encoding="utf-8")
    try:
        print(f"rendering -> {pdf_path}")
        print_pdf(chrome, html_path, pdf_path)
    finally:
        if not args.keep_html:
            html_path.unlink(missing_ok=True)
    print(f"pdf     -> {pdf_path}  ({pdf_path.stat().st_size/1024:.0f} KB)")


if __name__ == "__main__":
    main()
