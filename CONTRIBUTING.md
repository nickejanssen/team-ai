# Contributing

## Development setup

```bash
nvm use            # Node 22 (see .nvmrc)
npm install
npm run check      # lint + typecheck + test
```

`npm run check` must pass before you open a pull request.

## Commit messages

This project uses [Conventional Commits](https://www.conventionalcommits.org/).
Commit messages are enforced by commitlint via a `commit-msg` hook. Examples:

```
feat: add interview branch for platform selection
fix: correct citation link parsing
docs: expand adoption guide
```

## Rules

**Framework code carries no team's content.** `src/`, `schemas/`, and `catalog/` must contain no team, partner, or product names. `npm run check` runs `team-ai check-agnostic` (added in a later task) which enforces this.

**Walk the quality bar before merging.** Every change must keep every answer in [`docs/quality-bar.md`](docs/quality-bar.md) honest. The PR template asks which of the 17 lines your change touches.

**Reusable workflows track `main` via the `v0` branch until 1.0.** If you change a reusable workflow, the `v0` branch must be updated to match.
