#!/usr/bin/env python3
"""Classify Catalyst eggs by runtime family."""
from __future__ import annotations

import json
import sys
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
EGGS = ROOT / "eggs"


def load_eggs() -> list[tuple[Path, dict]]:
    out = []
    for path in sorted(EGGS.rglob("egg-*.json")):
        try:
            data = json.loads(path.read_text())
        except json.JSONDecodeError:
            continue
        if not isinstance(data, dict) or "startup" not in data:
            continue
        out.append((path.relative_to(ROOT), data))
    return out


def family(egg: dict) -> str:
    images = " ".join((egg.get("docker_images") or {}).values()).lower()
    install = ((egg.get("scripts") or {}).get("installation") or {}).get("script") or ""
    startup = str(egg.get("startup") or "").lower()
    features = egg.get("features") or []
    if "steamcmd" in images or "steamcmd" in install.lower() or "srcds_appid" in install.lower():
        if "wine" in images or "wine" in startup or "winetricks" in install.lower():
            return "steamcmd-wine"
        return "steamcmd-linux"
    if "java" in images or "paper" in images or "purpur" in images or "forge" in images:
        return "java"
    if "bedrock" in images or "pocketmine" in images or "nukkit" in images:
        return "bedrock"
    if "node" in images or "npm " in install.lower():
        return "node"
    if "dotnet" in images or "mono" in images:
        return "dotnet"
    if "python" in images:
        return "python"
    if "steam_disk_space" in features:
        return "steamcmd-linux"
    return "other"


def app_id(egg: dict) -> str:
    for var in egg.get("variables") or []:
        name = str(var.get("env_variable") or "").upper()
        if name in {"SRCDS_APPID", "STEAM_APPID", "STEAMAPPID", "APPID"}:
            return str(var.get("default_value") or "")
    return ""


def main() -> int:
    eggs = load_eggs()
    counts: Counter[str] = Counter()
    by_family: dict[str, list[str]] = defaultdict(list)
    for path, egg in eggs:
        fam = family(egg)
        counts[fam] += 1
        extra = app_id(egg)
        label = f"{path}  {egg.get('name','?')}"
        if extra:
            label += f"  app={extra}"
        by_family[fam].append(label)

    print(f"eggs: {len(eggs)}")
    print("families:")
    for fam, n in counts.most_common():
        print(f"  {n:4d}  {fam}")
    print()
    for fam in sorted(by_family):
        print(f"## {fam}")
        for line in by_family[fam][:8]:
            print(f"  {line}")
        if len(by_family[fam]) > 8:
            print(f"  ... {len(by_family[fam]) - 8} more")
        print()
    return 0


if __name__ == "__main__":
    sys.exit(main())
