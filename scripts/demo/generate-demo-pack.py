#!/usr/bin/env python
"""
Generate a premium demo media pack from a deterministic timeline.

Usage:
  python scripts/demo/generate-demo-pack.py capture-master
  python scripts/demo/generate-demo-pack.py export-assets
  python scripts/demo/generate-demo-pack.py all
"""

from __future__ import annotations

import argparse
import json
import math
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

import imageio.v2 as imageio
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont


REPO_ROOT = Path(__file__).resolve().parents[2]
DEMO_ROOT = REPO_ROOT / "assets" / "demos"
RAW_DIR = DEMO_ROOT / "raw"
EXPORTS_DIR = DEMO_ROOT / "exports"
SHOTS_DIR = DEMO_ROOT / "screenshots"
META_DIR = DEMO_ROOT / "metadata"

W = 1920
H = 1080
FPS = 16

X_GRID = np.linspace(0.0, 1.0, W, dtype=np.float32)
Y_GRID = np.linspace(0.0, 1.0, H, dtype=np.float32)
XX, YY = np.meshgrid(X_GRID, Y_GRID)


@dataclass(frozen=True)
class Scene:
    key: str
    title: str
    subtitle: str
    chapter: str
    duration: float
    accent: tuple[int, int, int]


SCENES: list[Scene] = [
    Scene("A", "Discord-like Orientation", "Familiar layout and immediate context", "Setup", 7.5, (117, 170, 255)),
    Scene("B", "Multi-Agent Trigger", "Three agents start in parallel in one channel", "Trigger", 9.0, (119, 214, 158)),
    Scene("C", "Streaming + Thinking Timeline", "Planning -> Searching -> Drafting -> Finalizing", "Live Streaming", 15.0, (255, 208, 112)),
    Scene("D", "Typed Message Cards", "Tool calls, code blocks, artifacts, and status", "Structured Output", 14.0, (227, 138, 255)),
    Scene("E", "Charter Controls", "Pause and resume with human-in-control mode", "Control Layer", 11.0, (255, 166, 118)),
    Scene("F", "Outcome Quality", "Actionable final response with clear deliverables", "Outcome", 12.0, (126, 229, 215)),
    Scene("G", "SDK Velocity", "Install, run, and stream in minutes", "Developer Experience", 10.0, (191, 173, 255)),
]

BOT_RESPONSES = {
    "A": [
        "Planner Bot online and synced to launch context.",
        "Builder Bot idle and waiting for mention trigger.",
        "Reviewer Bot ready to validate risk and tests.",
    ],
    "B": [
        "Breaking scope into root-cause, fix, tests, rollout.",
        "Preparing implementation path with rollback strategy.",
        "Running risk sweep while stream is in progress.",
    ],
    "C": [
        "Planning milestones and assigning ownership...",
        "Searching contracts and failure evidence...",
        "Drafting reliable break/smoke/benchmark strategy...",
    ],
    "D": [
        "Calling web_search for benchmark baselines.",
        "Tool result shows 3 critical and 5 medium gaps.",
        "Generating code-ready command sheet and checks.",
    ],
    "E": [
        "Mode switched: Code Review Sprint in effect.",
        "Pausing turn handoff to await human signal.",
        "Resuming sequence with explicit turn ownership.",
    ],
    "F": [
        "Final plan ready: scope, gates, and thresholds.",
        "Implementation checklist includes smoke + chaos + load.",
        "Quality gate passed: deterministic and reproducible.",
    ],
    "G": [
        "SDK agent connected and streaming checklist now.",
        "pip install tavok-sdk completed in one minute.",
        "Agent registered and posting in shared channel.",
    ],
}


def ensure_dirs() -> None:
    for p in (RAW_DIR, EXPORTS_DIR, SHOTS_DIR, META_DIR):
        p.mkdir(parents=True, exist_ok=True)


def scene_boundaries() -> list[tuple[Scene, float, float]]:
    bounds: list[tuple[Scene, float, float]] = []
    cursor = 0.0
    for scene in SCENES:
        bounds.append((scene, cursor, cursor + scene.duration))
        cursor += scene.duration
    return bounds


def get_scene_at(t: float) -> tuple[Scene, float]:
    for scene, start, end in scene_boundaries():
        if start <= t < end:
            return scene, (t - start) / scene.duration
    last = SCENES[-1]
    return last, 1.0


def _font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    names = ["SegoeUI-Bold.ttf", "arialbd.ttf"] if bold else ["SegoeUI.ttf", "arial.ttf"]
    for name in names:
        try:
            return ImageFont.truetype(name, size=size)
        except OSError:
            pass
    return ImageFont.load_default()


def _clamp(value: float) -> int:
    return max(0, min(255, int(value)))


def make_background(scene: Scene, timestamp: float) -> Image.Image:
    accent = np.array(scene.accent, dtype=np.float32)
    wave = np.sin((XX * 7.0 + YY * 4.0 + timestamp * 0.9) * math.pi)
    vignette = np.clip(1.2 - np.sqrt((XX - 0.52) ** 2 + (YY - 0.52) ** 2) * 1.5, 0.2, 1.0)

    base_r = 10 + YY * 14 + wave * (accent[0] / 120.0) * 5
    base_g = 14 + XX * 12 + wave * (accent[1] / 120.0) * 5
    base_b = 24 + (1.0 - YY) * 24 + wave * (accent[2] / 120.0) * 6

    glow = np.exp(-((XX - 0.70) ** 2 / 0.03 + (YY - 0.22) ** 2 / 0.02))
    base_r += glow * (accent[0] * 0.18)
    base_g += glow * (accent[1] * 0.18)
    base_b += glow * (accent[2] * 0.20)

    rgb = np.stack([base_r * vignette, base_g * vignette, base_b * vignette], axis=2)
    rgb = np.clip(rgb, 0, 255).astype(np.uint8)
    return Image.fromarray(rgb, mode="RGB")


def draw_glass_card(canvas: Image.Image, box, radius: int, fill_rgba, border_rgba, blur: int = 0) -> None:
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    d.rounded_rectangle(box, radius=radius, fill=fill_rgba, outline=border_rgba, width=2)

    shadow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ds = ImageDraw.Draw(shadow)
    x1, y1, x2, y2 = box
    ds.rounded_rectangle((x1 + 2, y1 + 6, x2 + 2, y2 + 6), radius=radius, fill=(0, 0, 0, 92))
    if blur > 0:
        shadow = shadow.filter(ImageFilter.GaussianBlur(blur))

    canvas.alpha_composite(shadow)
    canvas.alpha_composite(layer)


def clipped_text(text: str, progress: float, min_chars: int = 16) -> str:
    if progress >= 0.995:
        return text
    count = max(min_chars, int(len(text) * progress))
    return text[:count] + "..."


def draw_ui_frame(scene: Scene, progress: float, timestamp: float) -> np.ndarray:
    base = make_background(scene, timestamp).convert("RGBA")
    draw = ImageDraw.Draw(base)

    f_h1 = _font(40, bold=True)
    f_h2 = _font(26, bold=True)
    f_body = _font(22)
    f_small = _font(18)
    f_mono = _font(20)

    pan_x = int(math.sin(timestamp * 0.35) * 8)
    board = (170 + pan_x, 70, 1750 + pan_x, 1010)
    draw_glass_card(base, board, 26, (24, 29, 43, 215), (255, 255, 255, 42), blur=2)

    # Layout columns
    draw.rectangle((board[0], board[1], board[0] + 90, board[3]), fill=(31, 36, 50, 245))
    draw.rectangle((board[0] + 90, board[1], board[0] + 355, board[3]), fill=(35, 41, 57, 245))
    draw.rectangle((board[2] - 228, board[1], board[2], board[3]), fill=(31, 36, 50, 245))
    draw.rectangle((board[0] + 355, board[1], board[2] - 228, board[1] + 74), fill=(29, 34, 49, 250))
    draw.rectangle((board[0] + 355, board[1] + 74, board[2] - 228, board[3]), fill=(20, 25, 37, 245))

    # Header and branding
    draw.text((board[0] + 388, board[1] + 20), "Tavok Demo Lab  #launch-war-room", fill=(239, 245, 255), font=f_h2)
    draw.text((board[0] + 108, board[1] + 24), "Servers", fill=(176, 189, 214), font=f_small)
    draw.text((board[0] + 125, board[1] + 104), "Channels", fill=(176, 189, 214), font=f_small)
    draw.text((board[2] - 208, board[1] + 24), "Members", fill=(176, 189, 214), font=f_small)

    # Hero statement
    statement = "AI teammates that stream, reason, and deliver in real time"
    draw.text((board[0] + 382, board[1] + 88), statement, fill=(220, 232, 255), font=f_body)

    # Prompt bubble
    prompt_box = (board[0] + 380, board[1] + 130, board[0] + 1120, board[1] + 205)
    draw_glass_card(base, prompt_box, 12, (64, 76, 103, 215), (*scene.accent, 110))
    draw.text(
        (prompt_box[0] + 16, prompt_box[1] + 20),
        "You: Team, produce a launch patch plan: root cause, fix, tests, rollout.",
        fill=(238, 244, 255),
        font=f_small,
    )

    # Scene chip
    chip = (board[0] + 1128, board[1] + 132, board[2] - 250, board[1] + 204)
    draw_glass_card(base, chip, 12, (44, 52, 73, 230), (*scene.accent, 140))
    draw.text((chip[0] + 16, chip[1] + 12), f"Scene {scene.key}: {scene.title}", fill=scene.accent, font=f_small)
    draw.text((chip[0] + 16, chip[1] + 38), scene.subtitle, fill=(217, 226, 244), font=f_small)

    # Multi-agent stream cards
    names = ["Planner Bot", "Builder Bot", "Reviewer Bot"]
    statuses = ["planning", "executing", "validating"]
    start_y = board[1] + 226
    for idx, name in enumerate(names):
        top = start_y + idx * 132
        card = (board[0] + 380, top, board[0] + 1120, top + 108)
        border = tuple([_clamp(c + 18) for c in scene.accent]) + (115,)
        draw_glass_card(base, card, 14, (35, 42, 63, 222), border)

        draw.text((card[0] + 18, card[1] + 14), name, fill=(197, 219, 255), font=f_small)
        draw.text((card[0] + 188, card[1] + 14), statuses[idx].upper(), fill=(165, 181, 208), font=f_small)

        text = BOT_RESPONSES[scene.key][idx]
        per_bot_progress = min(1.0, max(0.0, progress * 1.2 - idx * 0.12))
        typed = clipped_text(text, per_bot_progress, min_chars=22)
        draw.text((card[0] + 18, card[1] + 52), typed, fill=(222, 232, 249), font=f_small)

        # progress shimmer
        bar_x1, bar_y = card[0] + 18, card[1] + 88
        bar_w = 280
        draw.rounded_rectangle((bar_x1, bar_y, bar_x1 + bar_w, bar_y + 8), radius=4, fill=(57, 66, 88))
        fill_w = int(bar_w * min(1.0, per_bot_progress + 0.08))
        draw.rounded_rectangle((bar_x1, bar_y, bar_x1 + fill_w, bar_y + 8), radius=4, fill=scene.accent)

    # Typed cards column
    cards_x = board[2] - 214
    panel1 = (cards_x, board[1] + 228, cards_x + 186, board[1] + 326)
    panel2 = (cards_x, board[1] + 340, cards_x + 186, board[1] + 446)
    panel3 = (cards_x, board[1] + 460, cards_x + 186, board[1] + 596)
    if scene.key in ("C", "D", "F"):
        draw_glass_card(base, panel1, 11, (44, 56, 86, 230), (129, 179, 255, 135))
        draw.text((cards_x + 12, panel1[1] + 12), "TOOL_CALL", fill=(173, 212, 255), font=f_small)
        draw.text((cards_x + 12, panel1[1] + 43), "web_search()", fill=(228, 236, 249), font=f_small)

        draw_glass_card(base, panel2, 11, (41, 65, 52, 230), (139, 232, 171, 135))
        draw.text((cards_x + 12, panel2[1] + 12), "TOOL_RESULT", fill=(188, 243, 205), font=f_small)
        draw.text((cards_x + 12, panel2[1] + 43), "success", fill=(228, 236, 249), font=f_small)

        draw_glass_card(base, panel3, 11, (49, 49, 80, 230), (210, 184, 255, 135))
        draw.text((cards_x + 12, panel3[1] + 12), "CODE_BLOCK", fill=(226, 203, 255), font=f_small)
        draw.text((cards_x + 12, panel3[1] + 43), "make smoke", fill=(228, 236, 249), font=f_small)
        draw.text((cards_x + 12, panel3[1] + 68), "make benchmark", fill=(228, 236, 249), font=f_small)

    # Charter controls / SDK terminal beat
    if scene.key in ("E", "F"):
        control = (board[0] + 380, board[1] + 654, board[0] + 1120, board[1] + 742)
        draw_glass_card(base, control, 14, (46, 54, 72, 225), (255, 172, 126, 145))
        draw.text((control[0] + 18, control[1] + 18), "Mode: Code Review Sprint   Turn 3/8", fill=(255, 220, 196), font=f_small)
        pause = (control[0] + 470, control[1] + 17, control[0] + 575, control[1] + 60)
        resume = (control[0] + 587, control[1] + 17, control[0] + 712, control[1] + 60)
        draw_glass_card(base, pause, 9, (98, 58, 60, 240), (255, 164, 164, 120))
        draw_glass_card(base, resume, 9, (50, 106, 67, 240), (174, 245, 194, 120))
        draw.text((pause[0] + 24, pause[1] + 12), "Pause", fill=(255, 233, 233), font=f_small)
        draw.text((resume[0] + 25, resume[1] + 12), "Resume", fill=(228, 255, 233), font=f_small)

    if scene.key == "G":
        terminal = (board[0] + 380, board[1] + 654, board[0] + 1120, board[1] + 838)
        draw_glass_card(base, terminal, 14, (15, 20, 31, 236), (158, 136, 220, 138))
        draw.text((terminal[0] + 16, terminal[1] + 14), "SDK setup in minutes", fill=(208, 214, 239), font=f_small)
        lines = [
            "$ pip install tavok-sdk",
            "$ python examples/llm_agent.py",
            "Agent connected to #launch-war-room",
            "Streaming: smoke + break + benchmark checklist",
        ]
        for i, line in enumerate(lines):
            typed = clipped_text(line, min(1.0, progress * 1.5 - i * 0.18), min_chars=8)
            color = (175, 245, 206) if i >= 2 else (228, 236, 249)
            draw.text((terminal[0] + 16, terminal[1] + 48 + i * 34), typed, fill=color, font=f_mono)

    # Chapter lower-third caption for muted playback clarity
    lower = (board[0] + 22, board[3] - 112, board[2] - 22, board[3] - 26)
    draw_glass_card(base, lower, 12, (22, 27, 40, 212), (255, 255, 255, 42))
    draw.text((lower[0] + 18, lower[1] + 18), f"{scene.chapter}  |  {scene.title}", fill=(245, 248, 255), font=f_h2)
    draw.text((lower[0] + 18, lower[1] + 50), scene.subtitle, fill=(202, 215, 239), font=f_small)
    draw.text((lower[2] - 270, lower[1] + 18), f"t={timestamp:05.1f}s", fill=(170, 186, 214), font=f_small)

    # Opening hero title
    if timestamp < 2.0:
        alpha = max(0.0, 1.0 - timestamp / 2.0)
        splash = Image.new("RGBA", (W, H), (0, 0, 0, int(132 * alpha)))
        base.alpha_composite(splash)
        sdraw = ImageDraw.Draw(base)
        sdraw.text((620, 460), "TAVOK", fill=(255, 255, 255), font=_font(72, bold=True))
        sdraw.text((620, 540), "Full-capacity multi-agent collaboration", fill=(219, 230, 252), font=f_h2)

    return np.asarray(base.convert("RGB"))


def write_video(path: Path, frames: Iterable[np.ndarray], fps: int, codec: str, ffmpeg_params=None) -> None:
    writer = imageio.get_writer(
        str(path),
        fps=fps,
        codec=codec,
        macro_block_size=1,
        ffmpeg_params=ffmpeg_params or [],
    )
    try:
        for frame in frames:
            writer.append_data(frame)
    finally:
        writer.close()


def render_timeline(total_seconds: float, fps: int) -> list[np.ndarray]:
    out: list[np.ndarray] = []
    for i in range(int(total_seconds * fps)):
        t = i / fps
        scene, p = get_scene_at(t)
        out.append(draw_ui_frame(scene, p, t))
    return out


def write_master_capture() -> dict:
    total_seconds = scene_boundaries()[-1][2]
    frames = render_timeline(total_seconds, FPS)
    out_path = RAW_DIR / "master_full-capacity_1080p_v1.mp4"
    write_video(
        out_path,
        frames,
        FPS,
        codec="libx264",
        ffmpeg_params=["-crf", "18", "-preset", "slow", "-pix_fmt", "yuv420p"],
    )

    bounds = scene_boundaries()
    scene_meta = {
        "totalSeconds": total_seconds,
        "fps": FPS,
        "resolution": f"{W}x{H}",
        "master": str(out_path.relative_to(REPO_ROOT)).replace("\\", "/"),
        "scenes": [
            {
                "key": scene.key,
                "title": scene.title,
                "chapter": scene.chapter,
                "start": start,
                "end": end,
            }
            for scene, start, end in bounds
        ],
    }
    meta_path = META_DIR / "master-timeline_v1.json"
    meta_path.write_text(json.dumps(scene_meta, indent=2), encoding="utf-8")
    return scene_meta


def _slice_frames(start: float, end: float, fps: int) -> list[np.ndarray]:
    frames: list[np.ndarray] = []
    for i in range(int((end - start) * fps)):
        t = start + i / fps
        scene, p = get_scene_at(t)
        frames.append(draw_ui_frame(scene, p, t))
    return frames


def _resize(frames: list[np.ndarray], width: int) -> list[np.ndarray]:
    out: list[np.ndarray] = []
    for frame in frames:
        img = Image.fromarray(frame)
        h = int(img.height * (width / img.width))
        out.append(np.asarray(img.resize((width, h), Image.Resampling.LANCZOS)))
    return out


def write_gifs_and_screenshots() -> None:
    # Hero loop from core differentiator segment.
    hero_frames = _resize(_slice_frames(9.0, 19.0, FPS), 1400)
    imageio.mimsave(EXPORTS_DIR / "hero_full-capacity_1600w_v1.gif", hero_frames, fps=7, loop=0)

    feature_ranges = [
        ("feature_multistream_1200w_v1.gif", 8.2, 13.4),
        ("feature_thinking-timeline_1200w_v1.gif", 18.0, 23.0),
        ("feature_typed-messages_1200w_v1.gif", 31.0, 36.2),
        ("feature_charter-controls_1200w_v1.gif", 46.0, 50.8),
        ("feature_outcome-quality_1200w_v1.gif", 57.2, 62.0),
        ("feature_sdk-velocity_1200w_v1.gif", 69.0, 73.8),
    ]
    for name, start, end in feature_ranges:
        frames = _resize(_slice_frames(start, end, FPS), 1200)
        imageio.mimsave(EXPORTS_DIR / name, frames, fps=7, loop=0)

    shot_points = [
        ("shot_scene-a-orientation_2x_v1.png", 3.4),
        ("shot_scene-b-trigger_2x_v1.png", 10.5),
        ("shot_scene-c-streaming_2x_v1.png", 20.0),
        ("shot_scene-d-typed-cards_2x_v1.png", 34.5),
        ("shot_scene-e-controls_2x_v1.png", 48.0),
        ("shot_scene-f-outcome_2x_v1.png", 61.5),
        ("shot_scene-g-sdk_2x_v1.png", 72.5),
        ("shot_feature-multi-agent_2x_v1.png", 25.0),
    ]
    for name, t in shot_points:
        scene, p = get_scene_at(t)
        frame = draw_ui_frame(scene, p, t)
        Image.fromarray(frame).save(SHOTS_DIR / name, format="PNG")


def write_exports() -> None:
    total = scene_boundaries()[-1][2]
    video_frames = _slice_frames(0.0, total, FPS)

    video_mp4 = EXPORTS_DIR / "video_full-capacity_1080p_v1.mp4"
    write_video(
        video_mp4,
        video_frames,
        FPS,
        codec="libx264",
        ffmpeg_params=["-crf", "18", "-preset", "slow", "-pix_fmt", "yuv420p"],
    )

    video_webm = EXPORTS_DIR / "video_full-capacity_1080p_v1.webm"
    write_video(
        video_webm,
        video_frames,
        FPS,
        codec="libvpx-vp9",
        ffmpeg_params=["-b:v", "2200k", "-crf", "30"],
    )

    write_gifs_and_screenshots()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=["capture-master", "export-assets", "export-gifs", "all"])
    args = parser.parse_args()

    ensure_dirs()

    if args.command in ("capture-master", "all"):
        meta = write_master_capture()
        print(json.dumps({"masterCapture": meta["master"], "seconds": meta["totalSeconds"]}, indent=2))

    if args.command in ("export-assets", "all"):
        write_exports()
        print("Exported hero/video/feature GIFs/screenshots.")

    if args.command == "export-gifs":
        write_gifs_and_screenshots()
        print("Exported hero/feature GIFs and screenshots.")


if __name__ == "__main__":
    main()
