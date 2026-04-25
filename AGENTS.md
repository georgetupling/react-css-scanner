# AGENTS.md

## Project Purpose

`scan-react-css` is a standalone npm tool for auditing how React code uses CSS.

The active rebooted product includes:

- a CLI and Node API
- JSON config discovery and validation
- project source/CSS discovery
- CSS source and CSS Module analysis
- a static analysis engine with render, reachability, selector, ownership, and rule models
- deterministic findings with severity and confidence
- CI-friendly JSON/text output and exit-code behavior

## Current Status

The product shell is being rebuilt around the replacement static analysis engine under:

- `src/static-analysis-engine`

Treat `src/`, tests, and the durable design docs as the source of truth. Extend the current implementation carefully instead of re-planning the architecture from scratch.

## Doc Map

Start here:

- [README.md](./README.md)
- [docs/design/reboot-contract.md](./docs/design/reboot-contract.md)
- [docs/design/rules-catalogue.md](./docs/design/rules-catalogue.md)
- [docs/design/css-modules-contract.md](./docs/design/css-modules-contract.md)
- [docs/design/current-product-assessment.md](./docs/design/current-product-assessment.md)
- [docs/design/current-engine-assessment.md](./docs/design/current-engine-assessment.md)

Observation and planning notes:

- [docs/observations/scan-react-css-observations-0.1.4.md](./docs/observations/scan-react-css-observations-0.1.4.md)
- [docs/temp/0.1.4-observation-remediation-plan.md](./docs/temp/0.1.4-observation-remediation-plan.md)
- [docs/temp/reboot-progress-and-outstanding-work.md](./docs/temp/reboot-progress-and-outstanding-work.md)

## Source Of Truth Hierarchy

When working on product behavior, use this priority order:

1. `src/` and the tests
2. [docs/design/reboot-contract.md](./docs/design/reboot-contract.md)
3. [docs/design/rules-catalogue.md](./docs/design/rules-catalogue.md)
4. [docs/design/css-modules-contract.md](./docs/design/css-modules-contract.md)
5. assessment docs under `docs/design`

If docs disagree with code and tests, align them in the same change or call out the mismatch explicitly.

## Important Product Decisions

### Config

- Config format is JSON.
- CLI discovery order is:
  1. explicit `--config`, resolved from the directory where the command is run
  2. `scan-react-css.json` in the directory where the command is run
  3. `SCAN_REACT_CSS_CONFIG_DIR/scan-react-css.json`
  4. first `scan-react-css.json` found on OS `PATH`
  5. built-in defaults
- The Node API uses `configBaseDir` for explicit `configPath` resolution and project config
  discovery. If omitted, `configBaseDir` defaults to `rootDir`.
- Only one config source is loaded.
- No config merging.
- Current config keys are `failOnSeverity`, `rules`, `cssModules.localsConvention`, and
  `externalCss`.
- Unknown config keys, unknown nested keys, and unknown rule IDs are config errors. Do not silently
  accept legacy keys such as `css`, `source`, or `classComposition`.
- `externalCss` resolves provider declarations and built-in defaults. Static HTML stylesheet links
  can activate matching provider declarations, and local HTML-linked `.css` files are loaded as
  project-wide stylesheets. Package CSS loading and remote fetch behavior are staged follow-up work
  unless implemented in the same change.

### CLI

Supported flags:

- `--config`
- `--focus`
- `--json`
- `--output-file`
- `--overwrite-output`
- `--trace`
- `--debug`
- `--help`

Currently unsupported historical flags are recognized and fail fast:

- `--print-config`
- `--verbosity`
- `--output-min-severity`

Current behavior:

- `--json` writes a JSON report file and prints a short confirmation to stdout.
- `--output-file` selects the JSON report path and requires `--json`.
- `--overwrite-output` replaces the chosen JSON report path and requires `--json`.
- Without `--overwrite-output`, existing JSON reports are preserved with suffixed paths.
- Human-readable output groups findings by file, prints clickable `file:line` targets, and keeps the
  summary at the end.
- `--focus` filters reported findings after full-project analysis.
- `rootDir` must be a directory.
- Debug findings are hidden unless `--debug` or `--trace` is used.

### Reachability And Render Context

Current reachability focuses on:

- source imports
- CSS imports
- CSS Modules
- render graph context from the static analysis engine

Do not quietly introduce broad new heuristics into the main analysis path without tests and contract docs.

### Ownership Model

The reboot uses relational ownership evidence rather than fixed ownership buckets. Ownership rules ask where classes are defined, where they are consumed, and what owner path/name conventions imply.

Class references from expanded child components should be attributed to the child component that emitted the class expression, while render-subtree and placement metadata preserve the parent context.

### Confidence Model

Confidence is:

- `low`
- `medium`
- `high`

Severity and confidence are separate.

### Rules

The active rule catalogue is described in:

- [docs/design/rules-catalogue.md](./docs/design/rules-catalogue.md)
- `src/rules/catalogue.ts`

Active rule ids:

- `missing-css-class`
- `css-class-unreachable`
- `unused-css-class`
- `missing-css-module-class`
- `unused-css-module-class`
- `unsatisfiable-selector`
- `compound-selector-never-matched`
- `unused-compound-selector-branch`
- `single-component-style-not-colocated`
- `style-used-outside-owner`
- `style-shared-without-shared-owner`
- `dynamic-class-reference`
- `unsupported-syntax-affecting-analysis`

## Current Code Structure

- `src/cli.ts`: CLI parsing, formatting, focus filtering, and exit behavior
- `src/config`: config loading and validation
- `src/project`: project discovery and `scanProject`
- `src/rules`: public rule catalogue and rule execution
- `src/static-analysis-engine`: staged analysis engine
- `test/unit`: integration-heavy unit tests using generated projects

## Testing Expectations

Testing is intentionally integration-heavy.

Use generated fake React projects through:

- `test/support/TestProjectBuilder.js`

Before completing behavioral changes, usually run:

```bash
npm.cmd run check
npm.cmd run lint
npm.cmd test
```

Focused tests are fine while iterating, but finish with the broad suite when practical.

## When Editing Docs

- Keep durable implementation docs under `docs/design`.
- Keep transient planning notes under `docs/temp`.
- Keep observations under `docs/observations`.
- If you add or change operational behavior, update README and the relevant design doc.
- When returning a completed block of work, suggest a concise commit message.

## Things To Be Careful About

- Do not silently merge config files.
- Do not document unsupported flags as active behavior.
- Do not make focus reduce the analysis root; it is output filtering over full-project context.
- Do not regress determinism in findings, summary output, JSON output, or exit-code behavior.
- Do not expose raw static analysis internals through the public `scanProject()` result or CLI JSON.
- Do not import deep legacy helpers into `src/static-analysis-engine`.
