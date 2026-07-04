# CLAUDE.md — hevc.js

> Instruction document for AI agents (Claude Code, etc.) working on this repo.
> Loaded automatically by Claude Code at the start of each session.

## Project context

This is a public pnpm monorepo (https://github.com/privaloops/hevc.js) shipping
two npm packages under the `@hevcjs` scope:

- `packages/core/` → `@hevcjs/core` — HEVC WASM decoder + MSE intercept +
  HEVC → H.264 transcode pipeline
- `packages/dashjs-plugin/` → `@hevcjs/dashjs-plugin` — dash.js plugin
  consuming `@hevcjs/core` to play HEVC streams in browsers without native
  HEVC support

The HEVC decoder lives in `src/` (C++ compiled to WASM via Emscripten); the
JS packages are TypeScript bundled with tsup.

Every commit, PR, tag, release, and npm publish is publicly visible. Treat
each git action accordingly.

## mdma

- **Workflow**: `default` (see `~/.claude/rules/mdma/workflow-default.md`)
- **Git**: `default` (see `~/.claude/rules/mdma/git-default.md`)

## Release workflow — Changesets

This repo uses [Changesets](https://github.com/changesets/changesets) to
manage versioning and publishing.

### When you change code in `packages/*/src/`

1. Before finalizing the PR, run `pnpm changeset` and pick the bump type
   (`patch` / `minor` / `major`) for each affected package.
2. Write a short, clear summary of the change — it ends up in the
   per-package CHANGELOG.md.
3. Commit the generated `.changeset/<random-name>.md` with the PR.
4. PRs touching only docs / CI / tests / build config don't need a changeset.

### Never

- **Never** bump `version` manually in any `package.json` — Changesets
  rewrites it at release time.
- **Never** edit per-package `CHANGELOG.md` by hand — Changesets generates
  the entries from the changeset files.
- **Never** run `pnpm publish` locally for a real publish — the GitHub
  Action `release.yml` is the only authority. Local `pnpm publish --dry-run`
  is fine for verification.

### Release cycle

1. Feature/fix PR includes a changeset → reviewed → merged into `main`.
2. The Changesets GitHub Action opens (or updates) a "Release PR" that
   consolidates pending changesets.
3. When you want to ship: merge the Release PR.
4. The Action then bumps versions, generates CHANGELOGs, publishes to npm,
   and creates GitHub releases + tags automatically.

## Commands

| Command | What it does |
|---|---|
| `pnpm install` | Install workspace dependencies |
| `pnpm build` | Full build (WASM + JS) — requires Emscripten |
| `pnpm build:js` | JS-only build (fast) |
| `pnpm build:demo` | Bundle for `demo/` (served on GitHub Pages) |
| `pnpm test` | C++ unit tests (ctest) — fastest signal on decoder logic |
| `pnpm test:unit` | JS unit tests (vitest) |
| `pnpm test:e2e` | E2E Playwright tests (use `LOCAL_DEMO=1 pnpm test:e2e` for the local web server variant) |

## Testing discipline

- Any new pure JS/TS utility added to `packages/*/src/` SHOULD ship with
  tests in a colocated `*.test.ts` file. Vitest setup lives in
  `packages/core/`.
- C++ decoder changes MUST keep `pnpm test` green (102+ unit tests +
  pixel-perfect oracle suite). Do not skip oracle tests.
- E2E (`pnpm test:e2e`) is not in CI yet. Run it locally before merging
  any change touching `mse-intercept.ts`, `segment-transcoder.ts`, or the
  `dashjs-plugin` glue code.

## Security

- `pnpm audit --prod` MUST return 0 CVEs. The CI fails on prod-level
  vulnerabilities. Dev-only CVEs are acceptable temporarily and tracked in
  the local `BACKLOG.md` (gitignored).
- All GitHub Actions are pinned by SHA (supply chain protection).
- Never commit secrets. Repo-level secrets live in GitHub Settings.

## Documentation conventions

- All public-facing docs (README, CHANGELOG, CONTRIBUTING, this file,
  release notes) are written in **English** so non-French maintainers
  watching the repo can read them.
- Inline code comments and commit messages are also in English.
