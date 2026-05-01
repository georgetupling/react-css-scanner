# AGENTS.md

## Purpose

`scan-react-css` is a CLI + Node API for statically auditing how React code uses CSS.

Primary outputs:

- findings with rule id, severity, confidence, and location
- diagnostics for unsupported or invalid analysis inputs
- deterministic summaries for CI and local workflows

## Fast Orientation

Read in this order when re-entering the project after time away:

1. `README.md`
2. `src/project/scanProject.ts`
3. `src/static-analysis-engine/entry/scan.ts`
4. `src/rules/catalogue.ts`
5. `test/unit` (integration-heavy behavior contracts)

If code and docs disagree, trust `src/` + tests first and update docs in the same change.

## Product Surface

- CLI entry: `src/cli.ts` -> `src/cli/index.ts`
- Node API entry: `src/index.ts` -> `scanProject()`
- Config loading/validation: `src/config`
- Main analysis engine: `src/static-analysis-engine`
- Rule execution and finding synthesis: `src/rules`

## Current Analysis Pipeline (Authoritative)

Pipeline orchestration is in `src/static-analysis-engine/entry/scan.ts`.

Execution order:

1. `workspace-discovery`
2. `language-frontends`
3. `fact-graph`
4. `symbolic-evaluation`
5. `render-structure`
6. `selector-reachability`
7. `project-evidence`
8. `ownership-inference`
9. `run-rules` (outside engine, in `scanProject.ts`)

The phase names above are not cosmetic: tests and outputs depend on this staged flow and deterministic ordering.

## Stage Responsibilities At A Glance

- `workspace-discovery`: load config, discover files, read source/CSS/HTML, resolve HTML-linked CSS, package CSS imports, optional remote CSS, and produce project boundaries/resource edges.
- `language-frontends`: parse source files and stylesheets into structured frontend facts (module/react/expression/runtime-dom/CSS selector facts).
- `fact-graph`: normalize frontend facts into graph nodes/edges/indexes with deterministic sort order.
- `symbolic-evaluation`: evaluate class expressions into canonical class-expression facts + conditions + diagnostics.
- `render-structure`: project render model (components/elements/emissions/paths/regions/conditions/render graph).
- `selector-reachability`: compute selector branch/query reachability and element/branch matches against render structure.
- `project-evidence`: assemble rule-facing entities and relations (references, definitions, selectors, css-module facts, reachability/match relations).
- `ownership-inference`: infer ownership candidates/classifications and class/stylesheet ownership evidence.
- `run-rules`: generate final findings from evidence and config.

See `docs/design/architecture.md` for detailed contracts.

## Config Contract (Current)

- Config file name: `scan-react-css.json`
- Discovery order:
  1. explicit `--config` (resolved from `configBaseDir` / CLI cwd)
  2. `<configBaseDir>/scan-react-css.json`
  3. `SCAN_REACT_CSS_CONFIG_DIR/scan-react-css.json`
  4. first `scan-react-css.json` found on OS `PATH`
  5. built-in defaults
- One source only, no config merging.
- Unknown keys and unknown rule ids are config errors.

Current top-level config keys:

- `failOnSeverity`
- `rules`
- `cssModules.localsConvention`
- `externalCss`
- `ownership.sharedCss`
- `discovery.sourceRoots`
- `discovery.exclude`
- `ignore.classNames`
- `ignore.filePaths`

## CLI Contract (Current)

Supported flags (see `src/cli/args.ts`):

- `--config`
- `--focus`
- `--ignore-class`
- `--ignore-path`
- `--json`
- `--output-file`
- `--overwrite-output`
- `--output-min-severity`
- `--verbosity`
- `--timings`
- `--help`

Behavior highlights:

- `--focus` filters reporting after full-project analysis.
- `--output-file` and `--overwrite-output` require `--json`.
- Without `--overwrite-output`, JSON output path is preserved and suffixed if occupied.
- Exit code is `1` when scan failed threshold is met, else `0`; usage errors exit `2`.

## Rules

Rule catalogue source of truth:

- `src/rules/catalogue.ts`
- `docs/design/rules-catalogue.md`

Keep rule IDs and docs synchronized in the same change.

## Determinism Guardrails

When modifying analysis or reporting:

- preserve stable sorting of emitted entities/relations/findings
- avoid introducing nondeterministic iteration over Maps/Sets without explicit sort
- do not let `--focus` alter analysis scope
- do not leak raw internal engine structures through CLI/Node API output contracts

## Testing Expectations

Test style is intentionally integration-heavy (generated fixture projects).

Key helper:

- `test/support/TestProjectBuilder.js`

Typical verification before finalizing behavior changes:

```bash
npm.cmd run check
npm.cmd run lint
npm.cmd test
```

## Editing Docs

- Durable architecture/behavior docs live in `docs/design`
- Temporary plans belong in `docs/temp`
- If behavior changes, update docs and tests in the same PR

## High-Risk Areas

- Config discovery and validation (`src/config`)
- Pipeline stage interfaces (`src/static-analysis-engine/entry/stages`)
- Evidence assembly and relation stitching (`pipeline/project-evidence`)
- Ownership classification logic (`pipeline/ownership-inference`)
- CLI/reporting exit semantics (`src/cli`, `src/project/scanProject.ts`)
