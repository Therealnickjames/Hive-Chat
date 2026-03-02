# DEMO-ASSETS.md — Demo Asset Inventory and Naming

This document defines where demo assets live, naming rules, and export targets for
README, website landing pages, and social posts.

---

## Directory Layout

- Raw captures: `assets/demos/raw/`
- Final exported media: `assets/demos/exports/`
- Still screenshots: `assets/demos/screenshots/`
- Capture metadata: `assets/demos/metadata/`

---

## Naming Convention

Format:
- `<asset-type>_<scene-or-feature>_<resolution>_<vN>.<ext>`

Examples:
- `hero_multistream_1600w_v1.gif`
- `video_fullcapacity_1080p_v1.mp4`
- `feature_typed-messages_1200w_v1.gif`
- `shot_scene-c-streaming_2x_v1.png`

Rules:
- Use lowercase and hyphens for feature/scene keys.
- Increment `vN` only when content changes materially.
- Keep one "latest" alias by copying/renaming for consumers if needed.

---

## Asset Inventory (Current Pack)

### Hero
- `assets/demos/exports/hero_full-capacity_1600w_v1.gif`

### Product Video
- `assets/demos/exports/video_full-capacity_1080p_v1.mp4`
- `assets/demos/exports/video_full-capacity_1080p_v1.webm`

### Feature GIFs
- `assets/demos/exports/feature_multistream_1200w_v1.gif`
- `assets/demos/exports/feature_thinking-timeline_1200w_v1.gif`
- `assets/demos/exports/feature_typed-messages_1200w_v1.gif`
- `assets/demos/exports/feature_charter-controls_1200w_v1.gif`
- `assets/demos/exports/feature_sdk-velocity_1200w_v1.gif`
- `assets/demos/exports/feature_outcome-quality_1200w_v1.gif`

### Screenshots
- `assets/demos/screenshots/shot_scene-a-orientation_2x_v1.png`
- `assets/demos/screenshots/shot_scene-b-trigger_2x_v1.png`
- `assets/demos/screenshots/shot_scene-c-streaming_2x_v1.png`
- `assets/demos/screenshots/shot_scene-d-typed-cards_2x_v1.png`
- `assets/demos/screenshots/shot_scene-e-controls_2x_v1.png`
- `assets/demos/screenshots/shot_scene-f-outcome_2x_v1.png`
- `assets/demos/screenshots/shot_scene-g-sdk_2x_v1.png`
- `assets/demos/screenshots/shot_feature-multi-agent_2x_v1.png`

---

## Encoding Targets

- Hero GIF: 1400-1800px width, <= 12MB target.
- Feature GIFs: 1000-1400px width, <= 8MB each target.
- Video: 1080p MP4 (primary), WebM (secondary).
- Screenshots: PNG at 2x scale.

---

## Deterministic Capture Setup

Use:
- `scripts/demo/setup-demo-env.ps1`
- `scripts/demo/verify-demo-env.ps1`

These scripts:
- Set stable naming/version defaults.
- Ensure required folders exist.
- Save machine-readable capture context under `assets/demos/metadata/`.

---

## Placement Map

- README hero section: hero GIF + product video link.
- README features section: feature GIF strip.
- Landing page sections:
  - Multi-agent: `feature_multistream`
  - Transparency: `feature_thinking-timeline`, `feature_typed-messages`
  - Control: `feature_charter-controls`
  - Developer speed: `feature_sdk-velocity`
- Social teasers:
  - 15-20 second excerpt from `video_full-capacity_1080p_v1.mp4`
