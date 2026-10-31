#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""Render foreign-trade documents (PI / CI / PL / SC / customs) to PDF.

The workbench HTML is the renderer. This script:
  1. reads a friendly shipment JSON,
  2. maps it to the workbench draft schema,
  3. injects the draft into a temporary copy of the workbench,
  4. prints the requested A4 documents with headless Chrome.

Examples
--------
    python render_docs.py assets/demo-shipment.json --out outputs
    python render_docs.py order.json --types PI PL --out outputs
    python render_docs.py order.json --validate-only

No third-party Python packages are required. Chrome/Edge must be installed.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WORKBENCH = ROOT / "assets" / "workbench.html"

DOC_ALIASES = {
    "QT": "QUOTATION", "QUOTATION": "QUOTATION",
    "PI": "PROFORMA INVOICE", "PROFORMA": "PROFORMA INVOICE", "PROFORMA INVOICE": "PROFORMA INVOICE",
    "CI": "COMMERCIAL INVOICE", "INVOICE": "COMMERCIAL INVOICE", "COMMERCIAL INVOICE": "COMMERCIAL INVOICE",
    "SC": "SALES CONTRACT", "CONTRACT": "SALES CONTRACT", "SALES CONTRACT": "SALES CONTRACT",
    "PL": "PACKING LIST", "PACKING": "PACKING LIST", "PACKING LIST": "PACKING LIST",
    "CD": "CUSTOMS DECLARATION", "CUSTOMS": "CUSTOMS DECLARATION", "CUSTOMS DECLARATION": "CUSTOMS DECLARATION",
    "POA": "CUSTOMS POA", "CUSTOMS POA": "CUSTOMS POA",
}
DEFAULT_TYPES = ["PROFORMA INVOICE", "COMMERCIAL INVOICE", "PACKING LIST"]
DOC_PREFIX = {
    "QUOTATION": "QT", "PROFORMA INVOICE": "PI", "COMMERCIAL INVOICE": "CI",
    "SALES CONTRACT": "SC", "PACKING LIST": "PL",
    "CUSTOMS DECLARATION": "CD", "CUSTOMS POA": "POA",
}


def norm_type(value: str) -> str:
    key = (value or "").strip().upper().replace("_", " ")
    if key not in DOC_ALIASES:
        raise SystemExit(f"Unknown document type: {value!r}. Use one of: {', '.join(sorted(DOC_ALIASES))}")
    return DOC_ALIASES[key]


def load_json(path: Path) -> dict:
    try:
        return json.loads(path.read_text(encoding="utf-8-sig"))
    except json.JSONDecodeError as exc:
        raise SystemExit(f"Cannot parse {path}: {exc}") from exc


def fnum(value, default=0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def build_draft(shipment: dict) -> dict:
    seller = shipment.get("seller") or {}
    bank = seller.get("bank") or {}
    buyer = shipment.get("buyer") or {}
    trade = shipment.get("trade") or {}
    costs = shipment.get("costs") or {}
    options = shipment.get("options") or {}

    draft = {
        "_v": 4,
        "docType": norm_type(shipment.get("doc_type") or "PROFORMA INVOICE"),
        "quoteDate": shipment.get("date") or "",
        "validityDays": str(shipment.get("validity_days", 15)),
        "quoteNo": shipment.get("ref_no") or "",
        "clientCompany": buyer.get("company", ""),
        "clientAddr": buyer.get("address", ""),
        "clientAttn": buyer.get("attn", "Purchasing Dept."),
        "companyName": seller.get("name", ""),
        "companyAddr": seller.get("address", ""),
        "sellerTaxNo": seller.get("tax_no", ""),
        "bankName": bank.get("name", ""),
        "bankAccNo": bank.get("account", ""),
        "bankSwift": bank.get("swift", ""),
        "bankAddr": bank.get("address", ""),
        "bankIntermediary": bank.get("intermediary", ""),
        "currency": (shipment.get("currency") or "USD").upper(),
        "exchangeRate": str(shipment.get("exchange_rate", 7.25)),
        "countryOrigin": trade.get("origin", "China"),
        "portName": trade.get("pol", "Shenzhen, China"),
        "portLoading": trade.get("pol", "Shenzhen, China"),
        "portDischarge": trade.get("pod", ""),
        "destCountry": trade.get("dest_country", ""),
        "consignee": buyer.get("consignee", ""),
        "notifyParty": buyer.get("notify", ""),
        "vesselVoyage": trade.get("vessel", ""),
        "blNo": trade.get("bl_no", ""),
        "shipmentDate": trade.get("shipment_date", ""),
        "contractNo": trade.get("contract_no", ""),
        "signPlace": trade.get("sign_place", "Shenzhen, China"),
        "partialShipment": "not_allowed" if str(trade.get("partial", "")).lower() in ("not_allowed", "no", "false") else "allowed",
        "arbitration": trade.get("arbitration", "CIETAC, Shenzhen, in accordance with its rules."),
        "shippingMarks": trade.get("marks", ""),
        "palletInfo": trade.get("pallet_info", ""),
        "paymentTerms": trade.get("payment", "30% T/T deposit, balance before shipment"),
        "leadTime": trade.get("lead_time", ""),
        "remarkBankCharge": trade.get("bank_charge_note", "Bank charges outside China are for buyer's account."),
        "remarkPacking": trade.get("packing_note", "Packing: Standard export carton packing."),
        "vatRate": str(costs.get("vat_rate", 13)),
        "refundRate": str(costs.get("refund_rate", 13)),
        "marginRate": str(costs.get("margin_rate", 20)),
        "bankFee": str(costs.get("bank_fee", 0)),
        "domesticFee": str(costs.get("domestic_fee", 0)),
        "domesticAlloc": costs.get("domestic_alloc", "qty"),
        "freightMode": costs.get("freight_mode", "sea_fcl"),
        "intlFreight": str(costs.get("intl_freight", 0)),
        "insuranceFee": str(costs.get("insurance", 0)),
        "airDimFactor": str(costs.get("air_dim_factor", 167)),
        "discountRate": str(costs.get("discount", 0)),
        "pricePrecision": str(costs.get("price_precision", 0.05)),
        "currentTerm": (shipment.get("term") or "FOB").upper(),
        "docLang": options.get("doc_lang", "en"),
        "docTheme": options.get("theme", "classic"),
        "bilingual": bool(options.get("bilingual", False)),
        "products": [],
    }

    for item in shipment.get("items") or []:
        pcs = int(fnum(item.get("pcs_per_ctn"), 0))
        ctn_l = fnum(item.get("ctn_l"))
        ctn_w = fnum(item.get("ctn_w"))
        ctn_h = fnum(item.get("ctn_h"))
        cbm_piece = (ctn_l * ctn_w * ctn_h / pcs) if pcs > 0 else (fnum(item.get("len")) * fnum(item.get("wid")) * fnum(item.get("hei")))
        draft["products"].append({
            "name": item.get("name", ""),
            "hscode": str(item.get("hs_code", "")),
            "unit": item.get("unit", "PCS"),
            "price": fnum(item.get("unit_price_cny")),
            "qty": int(fnum(item.get("qty"))),
            "weight": fnum(item.get("gross_weight")),
            "nw": fnum(item.get("net_weight")),
            "len": ctn_l,
            "wid": ctn_w,
            "hei": ctn_h,
            "vol": round(cbm_piece, 2),
            "pcsPerCtn": pcs,
            "ctnLen": ctn_l,
            "ctnWid": ctn_w,
            "ctnHei": ctn_h,
            "img": "",
        })

    # Escape hatch: any raw workbench field can be overridden explicitly.
    for key, value in (shipment.get("fields") or {}).items():
        draft[key] = value
    return draft


def validate(shipment: dict, draft: dict, types: list[str]) -> tuple[list[str], list[str]]:
    errors, warnings = [], []
    if not draft["companyName"].strip():
        errors.append("seller.name is required")
    if not draft["clientCompany"].strip():
        errors.append("buyer.company is required")
    if not draft["products"]:
        errors.append("items[] is empty")
    for i, item in enumerate(draft["products"], 1):
        tag = f"items[{i}] {item['name'] or '(no name)'}"
        if not item["name"].strip():
            errors.append(f"{tag}: name is required")
        if item["qty"] <= 0:
            errors.append(f"{tag}: qty must be > 0")
        if item["ctnLen"] <= 0 or item["ctnWid"] <= 0 or item["ctnHei"] <= 0:
            errors.append(f"{tag}: carton size (ctn_l/ctn_w/ctn_h) must be > 0")
        if item["weight"] <= 0:
            errors.append(f"{tag}: gross_weight (per piece) must be > 0")
        if item["nw"] > item["weight"]:
            errors.append(f"{tag}: net_weight must not exceed gross_weight")
        if "PACKING LIST" in types and item["pcsPerCtn"] <= 0:
            errors.append(f"{tag}: pcs_per_ctn is required for PACKING LIST")
        hs = "".join(ch for ch in str(item["hscode"]) if ch.isdigit())
        if hs and len(hs) < 6:
            warnings.append(f"{tag}: HS code shorter than 6 digits")

    if "PROFORMA INVOICE" in types or "COMMERCIAL INVOICE" in types:
        if not draft["bankAccNo"].strip():
            warnings.append("bank account is empty — PI/CI cannot be paid")
        if not draft["bankSwift"].strip():
            warnings.append("SWIFT code is empty")
    if not draft["portDischarge"].strip():
        warnings.append("port of destination is empty")
    if not draft["shippingMarks"].strip():
        warnings.append("shipping marks empty — will print N/M")
    if str(draft["currentTerm"]).upper() == "EXW" and fnum(draft["intlFreight"]) > 0:
        warnings.append("EXW usually excludes international freight")
    return errors, warnings


def totals(shipment: dict) -> dict:
    qty = cartons = 0
    cbm = gw = nw = 0.0
    for item in shipment.get("items") or []:
        q = int(fnum(item.get("qty")))
        pcs = int(fnum(item.get("pcs_per_ctn"), 1)) or 1
        ctns = (q + pcs - 1) // pcs
        vol = fnum(item.get("ctn_l")) * fnum(item.get("ctn_w")) * fnum(item.get("ctn_h")) * ctns / 1_000_000
        qty += q
        cartons += ctns
        cbm += vol
        gw += fnum(item.get("gross_weight")) * q
        nw += fnum(item.get("net_weight")) * q
    return {"qty": qty, "cartons": cartons, "cbm": cbm, "gw": gw, "nw": nw}


def find_chrome(explicit: str | None = None) -> str:
    candidates = [explicit, os.environ.get("CHROME_PATH")]
    candidates += [
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
        r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
    ]
    candidates += [shutil.which("google-chrome"), shutil.which("chromium"), shutil.which("chrome")]
    for path in candidates:
        if path and Path(path).is_file():
            return str(path)
    raise SystemExit("Chrome/Edge not found. Pass --chrome <path> or set CHROME_PATH.")


def build_html(draft: dict, types: list[str]) -> str:
    base = WORKBENCH.read_text(encoding="utf-8")
    payload = json.dumps(draft, ensure_ascii=False).replace("</", "<\\/")
    type_json = json.dumps(types, ensure_ascii=False)
    inject = f"""
<script>
(function () {{
  var DRAFT = {payload};
  var TYPES = {type_json};
  function ready() {{
    try {{
      applyDraftData(DRAFT);
      var dt = document.getElementById('docType');
      var pa = document.getElementById('printArea');
      if (TYPES.length === 1) {{
        dt.value = TYPES[0];
        calculate();
      }} else {{
        var pages = [];
        TYPES.forEach(function (t) {{
          dt.value = t;
          calculate();
          var page = pa.firstElementChild;
          if (page) {{ pa.removeChild(page); pages.push(page); }}
        }});
        pa.innerHTML = '';
        pages.forEach(function (p) {{ pa.appendChild(p); }});
      }}
      if (typeof preparePrintPages === 'function') preparePrintPages();
      document.title = 'READY';
    }} catch (err) {{
      document.title = 'ERROR: ' + err.message;
      console.error(err);
    }}
  }}
  if (document.readyState === 'complete') setTimeout(ready, 400);
  else window.addEventListener('load', function () {{ setTimeout(ready, 400); }});
}})();
</script>
"""
    return base.replace("</body>", inject + "\n</body>", 1)


def print_pdf(chrome: str, html_path: Path, pdf_path: Path) -> None:
    pdf_path.parent.mkdir(parents=True, exist_ok=True)
    cmd = [
        chrome,
        "--headless=new",
        "--disable-gpu",
        "--no-sandbox",
        "--hide-scrollbars",
        "--no-pdf-header-footer",
        "--print-to-pdf-no-header",
        f"--print-to-pdf={pdf_path.resolve()}",
        "--virtual-time-budget=15000",
        "--run-all-compositor-stages-before-draw",
        "--window-size=1400,1000",
        html_path.resolve().as_uri(),
    ]
    proc = subprocess.run(cmd, capture_output=True, timeout=180)
    if not pdf_path.exists() or pdf_path.stat().st_size < 4000:
        detail = (proc.stderr or proc.stdout or b"").decode("utf-8", "replace").strip()[-800:]
        raise SystemExit(f"Chrome failed to render {pdf_path.name}. Exit={proc.returncode}\n{detail}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Render trade documents from a shipment JSON.")
    parser.add_argument("shipment", type=Path, help="shipment.json")
    parser.add_argument("--out", type=Path, default=Path("outputs"), help="output directory (default: outputs)")
    parser.add_argument("--types", nargs="*", default=None,
                        help="documents to render, e.g. PI PL; default: doc_types[] or PI CI PL")
    parser.add_argument("--batch", action="store_true", help="render doc_types[] / all default types into one PDF")
    parser.add_argument("--validate-only", action="store_true", help="check the JSON without rendering")
    parser.add_argument("--chrome", default=None, help="path to chrome.exe / msedge.exe")
    parser.add_argument("--keep-html", action="store_true", help="keep the injected HTML for debugging")
    args = parser.parse_args()

    shipment = load_json(args.shipment)
    draft = build_draft(shipment)

    if args.types:
        types = [norm_type(t) for t in args.types]
    elif shipment.get("doc_types"):
        types = [norm_type(t) for t in shipment["doc_types"]]
    elif args.batch:
        types = list(DEFAULT_TYPES)
    else:
        types = [draft["docType"]]

    errors, warnings = validate(shipment, draft, types)
    for w in warnings:
        print(f"[warn] {w}")
    if errors:
        for e in errors:
            print(f"[error] {e}", file=sys.stderr)
        raise SystemExit(1)

    t = totals(shipment)
    print(f"shipment: {draft['clientCompany']} | {', '.join(types)}")
    print(f"items: {len(draft['products'])} | qty {t['qty']:,} PCS | {t['cartons']:,} CTNS | "
          f"{t['cbm']:.3f} CBM | GW {t['gw']:.2f} KG | NW {t['nw']:.2f} KG")
    print(f"term: {draft['currentTerm']} | {draft['portLoading']} -> {draft['portDischarge'] or '(no POD)'}")

    if args.validate_only:
        print("validation passed")
        return

    chrome = find_chrome(args.chrome)
    args.out.mkdir(parents=True, exist_ok=True)
    stem = args.shipment.stem

    html_path = Path(tempfile.gettempdir()) / f"_ft_render_{uuid.uuid4().hex[:8]}.html"
    html_path.write_text(build_html(draft, types), encoding="utf-8")
    try:
        if len(types) == 1:
            pdf_path = args.out / f"{stem}_{DOC_PREFIX.get(types[0], types[0].split()[0])}.pdf"
        else:
            pdf_path = args.out / f"{stem}_docs.pdf"
        print(f"rendering -> {pdf_path}")
        print_pdf(chrome, html_path, pdf_path)
    finally:
        if not args.keep_html:
            html_path.unlink(missing_ok=True)

    draft_path = args.out / f"{stem}.draft.json"
    draft_path.write_text(json.dumps(draft, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"draft   -> {draft_path}")
    print(f"pdf     -> {pdf_path}  ({pdf_path.stat().st_size/1024:.0f} KB)")


if __name__ == "__main__":
    main()
