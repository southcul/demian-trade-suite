#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""Build a SkillHub-compliant zip from this repository.

    python build/package.py            # validate + dist/demian-trade-suite.zip
    python build/package.py --check    # validate only
    python build/package.py --out x.zip

The repo root also contains build/, docs/, README.md and LICENSE, which
SkillHub would reject. Only the skill payload is collected here:
SKILL.md + assets/ + references/ + scripts/.
"""

from __future__ import annotations

import argparse
import hashlib
import re
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
INCLUDE = ("SKILL.md", "assets", "references", "scripts")
EXCLUDE_DIRS = {"__pycache__", ".git", "dist", "outputs"}
EXCLUDE_SUFFIX = (".pyc", ".pyo", ".DS_Store", "Thumbs.db")
ALLOWED_PREFIXES = ("assets/", "references/", "scripts/")
ALLOWED_EXT = {".md", ".txt", ".json", ".yaml", ".yml", ".js", ".ts", ".py", ".sh", ".png", ".jpg", ".svg"}
SLUG_RE = re.compile(r"^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$")
SEMVER_RE = re.compile(r"^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$")
MAX_FILES = 100
MAX_FILE_BYTES = 1024 * 1024
MAX_TOTAL_BYTES = 10 * 1024 * 1024


def parse_frontmatter(path: Path) -> dict[str, str]:
    text = path.read_text(encoding="utf-8")
    if not text.startswith("---"):
        raise SystemExit("SKILL.md 缺少 frontmatter（首行必须是 ---）")
    lines = text.splitlines()
    end = -1
    for i in range(1, len(lines)):
        if lines[i].strip() == "---":
            end = i
            break
    if end < 0:
        raise SystemExit("SKILL.md frontmatter 缺少结束标记 ---")
    out: dict[str, str] = {}
    for raw in lines[1:end]:
        if ":" not in raw or raw.lstrip().startswith("#"):
            continue
        key, _, val = raw.partition(":")
        val = val.strip()
        if len(val) >= 2 and val[0] == val[-1] and val[0] in ("'", '"'):
            val = val[1:-1]
        out[key.strip()] = val
    return out


def collect() -> list[tuple[str, bytes]]:
    files: list[tuple[str, bytes]] = []
    for name in INCLUDE:
        p = ROOT / name
        if p.is_file():
            files.append((name, p.read_bytes()))
            continue
        if not p.is_dir():
            raise SystemExit(f"缺少发布内容: {name}")
        for f in sorted(p.rglob("*")):
            if not f.is_file():
                continue
            rel_path = f.relative_to(ROOT)
            if any(part in EXCLUDE_DIRS for part in rel_path.parts):
                continue
            if f.name.endswith(EXCLUDE_SUFFIX):
                continue
            files.append((rel_path.as_posix(), f.read_bytes()))
    return files


def validate(files: list[tuple[str, bytes]], meta: dict[str, str]) -> list[str]:
    errors: list[str] = []
    if not files:
        errors.append("没有可打包文件")
    for key in ("slug", "displayName", "version", "summary", "license"):
        if not meta.get(key):
            errors.append(f"frontmatter 缺少 {key}")
    if meta.get("slug") and (not SLUG_RE.match(meta["slug"]) or not 2 <= len(meta["slug"]) <= 128):
        errors.append("slug 必须是 2-128 位 kebab-case")
    if meta.get("version") and not SEMVER_RE.match(meta["version"]):
        errors.append("version 必须是 SemVer")
    total = sum(len(d) for _, d in files)
    if len(files) > MAX_FILES:
        errors.append(f"文件数 {len(files)} 超过 {MAX_FILES}")
    if total > MAX_TOTAL_BYTES:
        errors.append(f"总大小 {total / 1024 / 1024:.1f}MB 超过 10MB")
    for rel, data in files:
        if len(data) > MAX_FILE_BYTES:
            errors.append(f"{rel} 超过 1MB")
        if rel != "SKILL.md" and not rel.startswith(ALLOWED_PREFIXES) and Path(rel).suffix.lower() not in ALLOWED_EXT:
            errors.append(f"{rel} 不在白名单前缀/扩展名内")
        if any(part in rel for part in ("__pycache__", ".pyc")):
            errors.append(f"{rel} 是缓存文件")
    return errors


def main() -> None:
    parser = argparse.ArgumentParser(description="Build a SkillHub-compliant skill zip.")
    parser.add_argument("--check", action="store_true", help="validate only, do not write zip")
    parser.add_argument("--out", type=Path, default=None, help="output zip path")
    args = parser.parse_args()

    meta = parse_frontmatter(ROOT / "SKILL.md")
    files = collect()
    errors = validate(files, meta)

    total = sum(len(d) for _, d in files)
    peak = max((len(d) for _, d in files), default=0)
    print(f"files : {len(files)}")
    print(f"total : {total / 1024:.1f} KB")
    print(f"max   : {peak / 1024:.1f} KB")
    for rel, data in sorted(files):
        print(f"  {len(data) / 1024:8.1f} KB  {rel}")

    if errors:
        for e in errors:
            print(f"[error] {e}", file=sys.stderr)
        raise SystemExit(1)
    print(f"OK check passed: {meta['slug']}@{meta['version']}")

    if args.check:
        return

    slug = meta["slug"]
    out = args.out or (ROOT / "dist" / f"{slug}.zip")
    out.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as zf:
        for rel, data in sorted(files):
            info = zipfile.ZipInfo(filename=f"{slug}/{rel}")
            info.create_system = 3
            info.compress_type = zipfile.ZIP_DEFLATED
            zf.writestr(info, data)

    digest = hashlib.sha256(out.read_bytes()).hexdigest()
    print(f"zip   : {out}  ({out.stat().st_size / 1024:.1f} KB)")
    print(f"sha256: {digest}")


if __name__ == "__main__":
    main()
