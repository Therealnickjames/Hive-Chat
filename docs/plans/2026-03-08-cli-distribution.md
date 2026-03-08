# Tavok CLI Distribution Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add Tavok install/distribution paths so one tagged release can power `npx tavok`, `curl -fsSL https://tavok.dev/install.sh | bash`, and a Homebrew tap formula.

**Architecture:** Build a small standalone Go CLI binary as the canonical release artifact, then add a Node package in `packages/cli` that downloads and executes that same binary for `npx tavok`. Release automation will build platform archives, publish npm from the monorepo package, generate checksums, and expose an install script plus Homebrew formula template that both point at GitHub Releases.

**Tech Stack:** Go 1.23, Node 20+, pnpm workspace, GitHub Actions, bash, Homebrew formula Ruby.

---

### Task 1: Add a scoped plan and verify current release surface

**Files:**

- Create: `docs/plans/2026-03-08-cli-distribution.md`
- Inspect: `.github/workflows/ci.yml`
- Inspect: `README.md`
- Inspect: `scripts/setup.sh`

**Step 1: Confirm the work stays outside runtime contracts**

Check that no changes are needed in `docs/PROTOCOL.md` because this task adds packaging and distribution only.

**Step 2: Keep scope tight**

Do not alter agent orchestration, Gateway transport, or existing web APIs except to expose a static install script if needed.

### Task 2: Write failing tests for CLI asset naming and npm wrapper resolution

**Files:**

- Create: `packages/cli/src/install-target.ts`
- Create: `packages/cli/src/install-target.test.ts`
- Create: `packages/cli/src/runner.ts`
- Create: `packages/cli/src/runner.test.ts`

**Step 1: Write failing tests**

Cover:

- platform/architecture normalization (`win32/x64`, `darwin/arm64`, `linux/arm64`)
- unsupported platform failures
- expected release asset archive names and extracted binary names
- npm wrapper execution path selection and versioned release URL generation

**Step 2: Run the tests and watch them fail**

Run: `pnpm --dir packages/cli test`

Expected: missing module / compile failures before implementation exists.

### Task 3: Implement the Go bootstrap CLI binary

**Files:**

- Create: `cli/go.mod`
- Create: `cli/cmd/tavok/main.go`
- Create: `cli/internal/bootstrap/bootstrap.go`
- Create: `cli/internal/bootstrap/bootstrap_test.go`

**Step 1: Write failing Go tests**

Cover:

- `.env` rendering for localhost vs custom domain
- secure-secret field presence
- overwrite guard behavior isolated behind a prompt/IO abstraction

**Step 2: Run failing Go tests**

Run: `go test ./...`
Working directory: `cli`

**Step 3: Implement minimal bootstrap behavior**

The binary should provide:

- `tavok init`
- `tavok version`
- default help output

`tavok init` should replace the current shell-script-only setup path by generating `.env` portably with Go.

### Task 4: Implement the npm wrapper package

**Files:**

- Create: `packages/cli/package.json`
- Create: `packages/cli/tsconfig.json`
- Create: `packages/cli/bin/tavok.js`
- Create: `packages/cli/src/index.ts`
- Create: `packages/cli/src/install-target.ts`
- Create: `packages/cli/src/runner.ts`

**Step 1: Resolve the correct binary asset**

Map runtime platform/arch to GitHub Release archive names:

- `tavok-darwin-arm64.tar.gz`
- `tavok-darwin-amd64.tar.gz`
- `tavok-linux-amd64.tar.gz`
- `tavok-linux-arm64.tar.gz`
- `tavok-windows-amd64.zip`

**Step 2: Download/cache/exec**

Cache extracted binaries under a user cache directory keyed by CLI version. Execute the binary with inherited stdio and pass through arguments.

**Step 3: Wire workspace scripts**

Add package scripts for `build`, `test`, and `typecheck`. Add root scripts only if needed for CI/release ergonomics.

### Task 5: Add release automation and installer assets

**Files:**

- Create: `.github/workflows/release.yml`
- Create: `scripts/install.sh`
- Create: `packaging/homebrew/Formula/tavok.rb`

**Step 1: Release workflow**

On tag push `v*`:

- run CLI tests
- build Go binaries for target matrix
- package archives
- generate SHA256 checksums
- upload release assets
- publish npm package from `packages/cli`

**Step 2: Install script**

`scripts/install.sh` should:

- detect OS/arch
- download the matching archive from GitHub Releases
- extract `tavok`
- install to `/usr/local/bin` or `$HOME/.local/bin` fallback

**Step 3: Homebrew formula template**

Create a formula in-repo as the source template for the external `homebrew-tavok` tap. It should consume the release archives and placeholders for SHA values updated on release.

### Task 6: Update docs for new install paths

**Files:**

- Modify: `README.md`

**Step 1: Document install options**

Add concise sections for:

- `npx tavok init`
- `curl -fsSL .../install.sh | bash`
- Homebrew tap usage

**Step 2: Keep current clone-based path**

Retain the existing clone + `scripts/setup.sh` flow as the lowest-level/manual path.

### Task 7: Verify before any completion claim

**Files:**

- Verify all touched files

**Step 1: Run focused checks**

Run:

- `pnpm --dir packages/cli test`
- `pnpm --dir packages/cli build`
- `go test ./...` in `cli`

**Step 2: Run repo-level checks relevant to touched areas**

Run:

- `pnpm --filter web typecheck` only if web files changed
- `pnpm --filter web test -- --runInBand` only if web logic/tests changed

**Step 3: Report manual follow-ups separately**

Do not claim publish/release is complete locally. Leave these as explicit manual steps:

- create npm org/account and token
- create GitHub release/tag
- create external `homebrew-tavok` repository
- wire `tavok.dev/install.sh` to serve the committed installer asset
