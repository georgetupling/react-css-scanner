# AGENTS.md

## Project purpose

`scan-react-css` is a standalone npm tool for auditing how React code uses CSS.

The implemented product includes:

- a CLI and Node API
- JSON config discovery and validation
- fact extraction for source files, CSS files, CSS Modules, and imported external CSS
- a normalized project model with ownership and reachability
- deterministic findings with severity and confidence
- CI-friendly reporting and exit-code behavior

## Current status

The MVP implementation is complete.

Work should now treat the codebase and the durable design docs as the source of truth. Extend the implementation carefully instead of re-planning the architecture from scratch each session.

There is also in-flight work on a replacement static-analysis-engine track.
That subsystem is intentionally being developed beside the current scanner rather than merged into the production analysis path yet.

## Doc map

Start here:

- [README.md](./README.md)
- [docs/README.md](./docs/README.md)

Design docs:

- [docs/design/architecture.md](./docs/design/architecture.md)
- [docs/design/runtime-contracts.md](./docs/design/runtime-contracts.md)
- [docs/design/config-contract.md](./docs/design/config-contract.md)
- [docs/design/config-schema.md](./docs/design/config-schema.md)
- [docs/design/rules.md](./docs/design/rules.md)
- [docs/design/testing-plan.md](./docs/design/testing-plan.md)

Future-only docs:

- [docs/future-work/post-mvp-ideas.md](./docs/future-work/post-mvp-ideas.md)
- [docs/future-work/future-notes.md](./docs/future-work/future-notes.md)

Static-analysis-engine docs:

- [docs/static-analysis-engine/architecture.md](./docs/static-analysis-engine/architecture.md)
- [docs/static-analysis-engine/subsystem-boundaries.md](./docs/static-analysis-engine/subsystem-boundaries.md)
- [docs/static-analysis-engine/end-to-end-traceability.md](./docs/static-analysis-engine/end-to-end-traceability.md)
- [docs/static-analysis-engine/current-to-target-map.md](./docs/static-analysis-engine/current-to-target-map.md)
- [docs/static-analysis-engine/known-architectural-issues.md](./docs/static-analysis-engine/known-architectural-issues.md)
- [docs/static-analysis-engine/progress-snapshot-2026-04-19.md](./docs/static-analysis-engine/progress-snapshot-2026-04-19.md)
- [docs/static-analysis-engine/archive/requirements.md](./docs/static-analysis-engine/archive/requirements.md)
- [docs/static-analysis-engine/archive/directory-structure-and-boundaries.md](./docs/static-analysis-engine/archive/directory-structure-and-boundaries.md)
- [docs/static-analysis-engine/archive/core-irs-and-type-shapes.md](./docs/static-analysis-engine/archive/core-irs-and-type-shapes.md)

## Source of truth hierarchy

When working on product behavior, use this priority order:

1. `src/` and the tests
2. `docs/design/runtime-contracts.md`
3. `docs/design/config-contract.md`
4. `docs/design/rules.md`
5. `docs/design/architecture.md`
6. `docs/design/config-schema.md`
7. `docs/design/testing-plan.md`

If docs disagree with code and tests, do not silently guess. Either align them in the same change or call out the mismatch explicitly.

## Important product decisions

### Config

- Config format is JSON.
- Discovery order is:
  1. explicit `--config` or API `configPath`
  2. project-root `scan-react-css.json`
  3. `SCAN_REACT_CSS_CONFIG_DIR/scan-react-css.json`
  4. first `scan-react-css.json` found on OS `PATH`
  5. built-in defaults
- Only one config source is loaded.
- No config merging.
- If no config is found, built-in defaults are used and the CLI warns.

### Ownership model

CSS ownership kinds are:

- `component`
- `page`
- `global`
- `utility`
- `external`
- `unclassified`

`unclassified` is important. Do not force a stronger classification if the scanner cannot justify it.

### Reachability model

Current reachability focuses on:

- direct CSS imports
- configured global CSS
- imported external CSS
- inheritance through the source import graph

Do not quietly introduce post-MVP render-tree ancestry heuristics into the main analysis path.

### Confidence model

Confidence is:

- `low`
- `medium`
- `high`

Severity and confidence are separate.

### Runtime behavior

- `--output-min-severity` is for human-readable output only.
- It must error if used with `--json`.
- `--output-file` requires `--json`.
- `--output-file` must not overwrite by default.
- Use suffixed filenames like `-1`, `-2`, and so on unless `--overwrite-output` is provided.

### Rules

The rule catalog is described in:

- [docs/design/rules.md](./docs/design/rules.md)

Tier 1 rules:

- `missing-css-class`
- `unreachable-css`
- `unused-css-class`
- `component-style-cross-component`
- `global-css-not-global`
- `utility-class-replacement`
- `dynamic-class-reference`
- `missing-css-module-class`

Tier 2 rules:

- `page-style-used-by-single-component`
- `dynamic-missing-css-class`
- `unused-css-module-class`
- `missing-external-css-class`
- `duplicate-css-class-definition`
- `component-css-should-be-global`

`unused-css-class` remains `warning` by default.

## Current code structure

The current implementation is organized around:

- `src/config`: config loading and validation
- `src/files`: file discovery
- `src/facts`: raw source and CSS fact extraction
- `src/model`: normalized graph, indexes, ownership, reachability
- `src/rules`: rule catalog and execution
- `src/runtime`: scan result and finding helpers
- `src/cli`: CLI parsing, formatting, and output handling

The in-flight static-analysis-engine work is organized separately under:

- `src/static-analysis-engine`
- `test/static-analysis-engine`
- `docs/static-analysis-engine`

Treat that subsystem as a project-within-the-project.
Its staged pipeline, types, and internal reasoning model should remain coherent and should not casually depend on old-engine internals.

## Legacy code warning

There is legacy reference material in:

- `legacy-code-not-part-of-mvp/`

Treat it as reference material only unless explicitly needed. Do not let legacy structure dictate the new architecture.

## Testing expectations

Testing is intentionally integration-heavy.

Read:

- [docs/design/testing-plan.md](./docs/design/testing-plan.md)

Important testing decisions:

- no Docker for the main test strategy
- use generated fake React projects
- use a file-oriented `TestProjectBuilder`
- support resource-file loading helpers
- keep deterministic golden-output coverage selective and stable

## When editing docs

- Keep durable implementation docs under `docs/design`
- Keep non-implemented ideas under `docs/future-work`
- Do not mix future-work ideas back into the design docs unless they become real product behavior

If you add or change operational behavior, update the relevant docs in `docs/design`.

## Things to be careful about

- Do not reintroduce `shared` as a separate ownership tier unless the docs and code are intentionally changed.
- Do not treat rule thresholds as top-level ownership config.
- Do not silently merge config files.
- Do not make output filtering affect JSON unless the runtime contract is intentionally changed.
- Do not assume every non-page thing is a component; `unclassified` exists for a reason.
- Do not regress determinism in findings, summary output, or exit-code behavior.
- Do not blur the in-flight static-analysis-engine work back into the old scanner architecture without an explicit migration decision.
- Do not import deep old-engine helpers into `src/static-analysis-engine`; follow the boundary rules in `docs/static-analysis-engine/subsystem-boundaries.md`.

## If you need to reorient quickly

Read in this order:

1. [docs/design/runtime-contracts.md](./docs/design/runtime-contracts.md)
2. [docs/design/config-contract.md](./docs/design/config-contract.md)
3. [docs/design/rules.md](./docs/design/rules.md)
4. [docs/design/architecture.md](./docs/design/architecture.md)
5. [docs/design/testing-plan.md](./docs/design/testing-plan.md)

If you are working on the static-analysis-engine track, read in this order:

1. [docs/static-analysis-engine/architecture.md](./docs/static-analysis-engine/architecture.md)
2. [docs/static-analysis-engine/subsystem-boundaries.md](./docs/static-analysis-engine/subsystem-boundaries.md)
3. [docs/static-analysis-engine/end-to-end-traceability.md](./docs/static-analysis-engine/end-to-end-traceability.md)
4. [docs/static-analysis-engine/current-to-target-map.md](./docs/static-analysis-engine/current-to-target-map.md)
5. [docs/static-analysis-engine/known-architectural-issues.md](./docs/static-analysis-engine/known-architectural-issues.md)
6. [docs/static-analysis-engine/progress-snapshot-2026-04-19.md](./docs/static-analysis-engine/progress-snapshot-2026-04-19.md)
