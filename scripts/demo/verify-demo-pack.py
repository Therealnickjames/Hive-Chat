#!/usr/bin/env python
from __future__ import annotations

import json
from pathlib import Path

from PIL import Image


REPO_ROOT = Path(__file__).resolve().parents[2]
EXPORTS = REPO_ROOT / "assets" / "demos" / "exports"
SHOTS = REPO_ROOT / "assets" / "demos" / "screenshots"
META = REPO_ROOT / "assets" / "demos" / "metadata"

MAX_HERO_MB = 12.0
MAX_FEATURE_MB = 8.0


def mb(size_bytes: int) -> float:
    return round(size_bytes / (1024 * 1024), 2)


def file_info(path: Path) -> dict:
    size = path.stat().st_size
    width = height = None
    if path.suffix.lower() in {".gif", ".png"}:
        with Image.open(path) as im:
            width, height = im.size
    return {
        "path": str(path.relative_to(REPO_ROOT)).replace("\\", "/"),
        "sizeBytes": size,
        "sizeMB": mb(size),
        "width": width,
        "height": height,
    }


def main() -> None:
    required_exports = [
        "hero_full-capacity_1600w_v1.gif",
        "video_full-capacity_1080p_v1.mp4",
        "video_full-capacity_1080p_v1.webm",
        "feature_multistream_1200w_v1.gif",
        "feature_thinking-timeline_1200w_v1.gif",
        "feature_typed-messages_1200w_v1.gif",
        "feature_charter-controls_1200w_v1.gif",
        "feature_outcome-quality_1200w_v1.gif",
        "feature_sdk-velocity_1200w_v1.gif",
    ]
    required_shots = [
        "shot_scene-a-orientation_2x_v1.png",
        "shot_scene-b-trigger_2x_v1.png",
        "shot_scene-c-streaming_2x_v1.png",
        "shot_scene-d-typed-cards_2x_v1.png",
        "shot_scene-e-controls_2x_v1.png",
        "shot_scene-f-outcome_2x_v1.png",
        "shot_scene-g-sdk_2x_v1.png",
        "shot_feature-multi-agent_2x_v1.png",
    ]

    missing = []
    for name in required_exports:
        if not (EXPORTS / name).exists():
            missing.append(str((EXPORTS / name).relative_to(REPO_ROOT)).replace("\\", "/"))
    for name in required_shots:
        if not (SHOTS / name).exists():
            missing.append(str((SHOTS / name).relative_to(REPO_ROOT)).replace("\\", "/"))

    export_infos = [file_info(EXPORTS / name) for name in required_exports if (EXPORTS / name).exists()]
    shot_infos = [file_info(SHOTS / name) for name in required_shots if (SHOTS / name).exists()]

    hero = next((f for f in export_infos if f["path"].endswith("hero_full-capacity_1600w_v1.gif")), None)
    feature_gifs = [f for f in export_infos if "/feature_" in f["path"]]

    checks = {
        "missingFiles": len(missing) == 0,
        "heroMaxSize": bool(hero and hero["sizeMB"] <= MAX_HERO_MB),
        "featureMaxSize": all(f["sizeMB"] <= MAX_FEATURE_MB for f in feature_gifs),
        "screenshotCount": len(shot_infos) >= 8,
    }

    report = {
        "checks": checks,
        "missing": missing,
        "exports": export_infos,
        "screenshots": shot_infos,
    }
    META.mkdir(parents=True, exist_ok=True)
    report_path = META / "demo-pack-report_v1.json"
    report_path.write_text(json.dumps(report, indent=2), encoding="utf-8")

    print(json.dumps({"report": str(report_path.relative_to(REPO_ROOT)).replace("\\", "/"), "checks": checks}, indent=2))


if __name__ == "__main__":
    main()
