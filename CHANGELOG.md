# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.3.1] - 2026-09-13

### Fixed

- **`team-ai adopt` misdetected CRLF-opened front matter as missing entirely.**
  `raw.startsWith("---\n")` returns `false` for a file opening with `---\r\n`,
  which real files in the wild do. At apply time that would have prepended a
  second front-matter block on top of a real one instead of leaving the file
  alone. Fixed with a single shared `hasFrontmatter()` (`/^---\r?\n/`) used by
  both plan-time detection and apply-time's own guard, so the two can no
  longer disagree with each other.
- **A single file with front matter that fails strict YAML parsing crashed
  the entire adoption scan.** Once CRLF front matter is correctly detected as
  present, it gets parsed — and a real file's YAML, tolerated by some tooling
  but rejected by this parser, threw an uncaught `YAMLParseError` that
  aborted the whole repo scan instead of flagging just that file.
  `parseFrontmatter` failures now become a normal backfill conflict for a
  human to resolve.

## [0.3.0] - 2026-09-12

### Added

- **`team-ai adopt --interactive` can now correct a backfill item's `status`,
  not just its `owner`.** `inferFrontmatter` always assigns a newly-backfilled
  doc `status: active` — it has no way to know a doc is a placeholder awaiting
  real content (a story-bible stub ahead of its GDD, for example). "edit" now
  also prompts for `status` (`draft | active | deprecated`); blank keeps the
  current value, and an invalid entry is rejected with the original kept
  rather than writing something unvalidated. This is the mechanism for
  telling the KB "this is provisional" instead of adopting placeholder
  content as if it were as authoritative as real, invested-in source
  material.

## [0.2.0] - 2026-09-12

### Changed

- **`team-ai adopt` anchors `review_by` on last git edit, not on "today".**
  Backfilling front matter for a pre-existing doc previously assigned every
  doc a fresh `today + horizonDays` review date, so long-neglected content
  read as freshly reviewed. `review_by` now anchors on the doc's actual last
  git commit date when one is known (one additional single-pass `git log`
  traversal, same shape as the existing author-collection pass), falling
  back to `today` only when there is no git history. Already-overdue content
  now surfaces as overdue immediately on adoption, not six months later.
  `docs/adoption-plan.md` and the `adopt` CLI summary both report an
  "already due for review on arrival" count, and each affected backfill row
  carries a warning label.

## [0.1.0] - 2026-08-30

First tagged release. The deterministic layer and the interview are complete and
tested (~520 tests). Anything needing a running service or a second retrieval
driver ships as an honest stub — see `docs/definition-of-done.md` and the
"Known limitations" section of `README.md`.

### Added

- **Guided interview.** One question bank (`src/interview/questions.yaml`,
  ~25 questions, Acts 0–5, three confirmation gates) driven by a deterministic
  engine. Runs as a CLI (`team-ai init`) or as a Claude skill
  (`skills/scaffold-interview/`). Preflight scans for existing AI infrastructure
  and steers toward extend, coexist, or stand down. Answers persist to
  `team-profile.yaml` for `resume`, `review`, and `upgrade`.
- **Non-destructive generator.** Renders an instance, spoke, attach config, or
  MCP-server template from the team profile and catalog presets. Reconciliation
  diffs template output against hand-edited files and never clobbers them,
  writing `*.team-ai-new` siblings instead.
- **`team-ai adopt`.** Deterministic measurement of an existing repo against the
  framework standard: front-matter backfill plan, namespace map, quality-bar gap
  table, template collisions. Writes only `adoption-plan.yaml` and
  `docs/adoption-plan.md` under `--out`; never writes into the measured repo.
- **18 CLI commands.** 10 deterministic scripts that call no model
  (`validate-kb`, `validate-citations`, `validate-spoke`, `reindex`,
  `assemble-manifest`, `freshness-audit`, `run-evals`, `check-agnostic`,
  `doctor`, `search`) plus 8 interview/generator commands (`init`, `adopt`,
  `spoke`, `attach`, `resume`, `review`, `upgrade`, `emit`).
- **Lexical retrieval.** SQLite FTS5 ranked keyword search behind a
  `RetrievalAdapter` interface. The `vector-embedded`, `vector-pgvector`,
  `vector-hosted`, `graph`, and `hybrid` drivers are real classes whose methods
  throw `NotImplementedError` pointing at the phase-8 index checkpoint.
- **Catalogs.** Four namespace presets (`engineering`, `generic`,
  `generic-partner-facing`, `support`) plus role, persona, and skill catalogs,
  resolved toolkit → org catalog → instance. Custom entries generate a TODO stub,
  never a guess.
- **Agent / skill / persona templates and emitters.** Neutral entity definitions
  in `templates/instance/`; `team-ai emit` targets claude-code, mcp-only, or
  generic surfaces from the same profile.
- **Eval harness.** Replays a golden set for hit rate, routing accuracy, refusal
  behaviour, per-question tier ceiling, and cost per answer, gated against
  `DEFAULT_GATES`. One EXAMPLE golden file ships and is skipped by `run-evals`.
- **Optional local MCP server template** (`templates/mcp-server/`) — a generated
  stdio server, off by default. No hosted or remote server, no auth, no
  deployment.
- **JSON schemas** for every artifact (agent, role, spoke, manifest, golden,
  frontmatter, questions, team-profile, namespace-preset, skill-catalog,
  adoption-plan) with a shared loader and validator.
- **Repo scaffolding**: ESLint flat config, Prettier, lefthook, commitlint,
  reusable GitHub Actions workflows (`ci.yml` plus `validate-kb`,
  `validate-spoke`, `evals` reusable workflows), `CONTRIBUTING.md`,
  `SECURITY.md`, `CODEOWNERS`, Apache-2.0 `LICENSE`.
- **`docs/quality-bar.md`** — the 17 questions the framework is judged against,
  each with the answer the architecture gives and the files that enforce it.
- **Dogfood** (`docs/dogfood-notes.md`) — three runs of the framework against
  itself and the five bugs they fixed.

[Unreleased]: https://github.com/nickejanssen/team-ai/compare/v0.3.1...HEAD
[0.3.1]: https://github.com/nickejanssen/team-ai/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/nickejanssen/team-ai/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/nickejanssen/team-ai/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/nickejanssen/team-ai/releases/tag/v0.1.0
