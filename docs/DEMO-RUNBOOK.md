# DEMO-RUNBOOK.md — Full-Capacity Golden Demo

This runbook defines one deterministic capture pass that feeds all marketing assets:
- README/website hero GIF
- 45-90 second product video
- feature micro-GIF set
- screenshot pack

Use this as the single source of truth for scenes, prompts, timings, and success checks.

---

## Preflight (must pass before recording)

1. Start services:
   - `docker compose up -d`
2. Verify health:
   - `http://localhost:3000/api/health`
   - `http://localhost:4001/api/health`
   - `http://localhost:4002/health`
3. Confirm clean UI state:
   - Dark theme
   - No stale test channels in view
   - Left panel and chat area visible
4. Confirm demo agents online (2-3 agents):
   - `Planner Bot`
   - `Builder Bot`
   - `Reviewer Bot`
5. Browser setup:
   - 16:9 window, 1920x1080
   - 100% zoom
   - Disable noisy notifications/system overlays

---

## Deterministic Demo Dataset

Use this exact workspace naming for consistency:
- Server: `Tavok Demo Lab`
- Channel: `#launch-war-room`
- DM participant: `Alex Product`
- Charter mode: `Code Review Sprint`

Use these message seeds before recording:
- `Pinned Note`: "Goal: Ship launch-ready API reliability patch today."
- Prior context message: "Current blockers: flaky retries, missing benchmark harness."
- One human message from another user to show multi-user activity.

---

## Golden Capture Timeline (master session)

Target total: 75-90 seconds raw.  
Keep each beat tight so it can be split into GIF clips later.

### Scene A (0s-8s): Familiar Discord-like Orientation
- Enter `Tavok Demo Lab` and `#launch-war-room`.
- Pan/hover lightly across server list, channel list, member list.
- Success signal: viewer instantly sees "Discord-like but AI-native."

### Scene B (8s-18s): Trigger Multi-Agent Collaboration
- Send this exact prompt:
  - "Team, produce a launch patch plan: root cause, fix, tests, rollout. @Planner Bot @Builder Bot @Reviewer Bot"
- Success signal: multiple agents start responding in same channel.

### Scene C (18s-35s): Streaming + Thinking Timeline
- Keep camera centered on active streams.
- Ensure thinking states are visible (Planning -> Searching -> Drafting -> Finalizing).
- Success signal: token-by-token output appears concurrently from multiple agents.

### Scene D (35s-50s): Typed Messages and Rich Output
- Capture at least one of each:
  - TOOL_CALL card
  - TOOL_RESULT card
  - CODE_BLOCK card
  - STATUS indicator
- Success signal: output is structured, not plain text blobs.

### Scene E (50s-62s): Charter/Swarm Controls
- Open channel settings/swarm control and show mode indicator.
- Tap `Pause` then `Resume` (or `End`) once.
- Success signal: human has orchestration control over agent collaboration.

### Scene F (62s-75s): Outcome + High-Quality Final Response
- Land on final polished agent summary with clear deliverables.
- Briefly show continuity of channel history.
- Success signal: end-to-end usefulness, not a toy stream.

### Scene G (75s-90s): SDK Velocity Beat
- Show terminal snippet and "agent appears in chat" moment.
- Use exact beat:
  1. `pip install tavok-sdk`
  2. run demo agent script
  3. agent posts/streams in channel
- Success signal: "10 lines to production-like agent behavior."

---

## Scripted Prompt Set (copy/paste)

Primary prompt:
- `Team, produce a launch patch plan: root cause, fix, tests, rollout. @Planner Bot @Builder Bot @Reviewer Bot`

Tool-heavy prompt:
- `Builder Bot, run a fast risk sweep and show exact test commands for smoke, break, and benchmark.`

Charter control prompt:
- `Switch to Code Review Sprint mode and enforce turn-by-turn agent handoff.`

SDK proof prompt:
- `Echo a readiness check from SDK agent and stream a 3-step checklist.`

---

## Capture Rules

- Do not scroll fast while tokens are streaming.
- Keep cursor movement minimal and intentional.
- Avoid modal popups unless they are part of the scene.
- If a scene stalls longer than 8 seconds, restart from Scene B.
- Record two takes minimum; keep the cleaner one as master.

---

## Export Mapping (from one master)

- Hero GIF source: Scene B + C + D (10-20s loop)
- Product video source: Scene A -> G full narrative (45-90s)
- Feature GIFs source:
  - Multi-stream: Scene B/C
  - Thinking timeline: Scene C
  - Typed messages: Scene D
  - Charter controls: Scene E
  - SDK in minutes: Scene G
- Screenshots source: strongest frame in each scene

---

## Failure Checklist (abort and redo take)

- Agents do not stream concurrently
- Thinking timeline not visible
- Typed cards missing in run
- UI flicker, layout glitch, or unreadable text
- Health endpoints degraded during recording
