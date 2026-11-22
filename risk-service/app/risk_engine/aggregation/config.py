"""Versioned scoring configuration. Changing any value requires a new version file so stored assessments stay
reproducible (each assessment records the version it used)."""
from __future__ import annotations

import hashlib
import json
from functools import lru_cache
from pathlib import Path
from typing import Any

CONFIG_DIR = Path(__file__).resolve().parents[2] / "config"


@lru_cache
def load_scoring(version: str = "scoring-v1") -> dict[str, Any]:
    if not version.replace("-", "").replace(".", "").isalnum():
        raise ValueError("invalid scoring version")
    cfg = json.loads((CONFIG_DIR / f"{version}.json").read_text())
    if cfg.get("version") != version:
        raise ValueError(f"config file {version}.json declares version {cfg.get('version')}")
    cfg["_sha256"] = hashlib.sha256(json.dumps(cfg, sort_keys=True).encode()).hexdigest()
    return cfg
