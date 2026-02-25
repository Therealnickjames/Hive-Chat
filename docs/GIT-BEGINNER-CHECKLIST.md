# Git + GitHub Beginner Checklist

Use this for day-to-day work in HiveChat.

## One-time setup (already mostly done)

1. Keep one working folder for this project: `C:/Users/njlec/Hive-Chat`
2. Keep this repo connected to GitHub (`origin` remote).
3. Never commit `.env` or secret keys.

## Daily workflow (copy/paste)

1. Pull latest changes:

```bash
git pull
```

1. Check what changed:

```bash
git status
```

1. Run checks before commit:

```bash
corepack pnpm --filter web lint
corepack pnpm --filter web typecheck
node --test packages/web/lib/*.test.mjs
```

1. Commit your work:

```bash
git add .
git commit -m "fix(web): short clear message"
```

1. Push to GitHub:

```bash
git push
```

## Commit message style

- `fix(scope): ...` for bug fixes
- `feat(scope): ...` for new behavior
- `docs(scope): ...` for docs only
- `chore(scope): ...` for maintenance

Example:

```bash
git commit -m "fix(web): block cross-server bot mutation"
```

## Safety rules

- Make small commits (one focused change at a time).
- Push at least once per day (cloud backup).
- If confused, run `git status` first.
- If something looks wrong, stop and ask before running destructive commands.

## Quick recovery

See recent history:

```bash
git log --oneline -20
```

Inspect a specific commit:

```bash
git show <commit-hash>
```

Create a backup branch before risky work:

```bash
git checkout -b backup/<short-name>
```
