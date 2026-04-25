# AGENTS.md

## Project Purpose

`scan-react-css` is a standalone npm tool for auditing how React code uses CSS.

The current rebooted product includes:

- a CLI and one stable Node API, `scanProject()`
- JSON config discovery and validation
- source and CSS discovery
- static-analysis-engine based project analysis
- CSS Module analysis
- deterministic rule findings with severity and confidence
- text and JSON CLI reporting
- focus-path filtering
- CI-friendly exit-code behavior

## Current Status

The rebooted product shell is active. Treat `src/`, tests, and durable docs as the source of truth.
Extend the implementation carefully instead of re-planning the architecture from scratch each session.

The static-analysis-engine under `src/static-analysis-engine` is now the analysis core for the
rebooted shell. Keep its staged pipeline and internal reasoning model coherent, and do not pull in
legacy scanner structure.

## Doc Map

Start here:

- [README.md](./README.md)
- [docs/user-guide.md](./docs/user-guide.md)
- [docs/README.md](./docs/README.md)

Design docs:

- [docs/design/reboot-contract.md](./docs/design/reboot-contract.md)
- [docs/design/rules-catalogue.md](./docs/design/rules-catalogue.md)
- [docs/design/css-modules-contract.md](./docs/design/css-modules-contract.md)
- [docs/design/current-product-assessment.md](./docs/design/current-product-assessment.md)
- [docs/design/current-engine-assessment.md](./docs/design/current-engine-assessment.md)

Temporary plans:

- [docs/temp](./docs/temp)

## Source Of Truth Hierarchy

When working on product behavior, use this priority order:

1. `src/` and the tests
2. [docs/design/reboot-contract.md](./docs/design/reboot-contract.md)
3. [docs/design/rules-catalogue.md](./docs/design/rules-catalogue.md)
4. [docs/design/css-modules-contract.md](./docs/design/css-modules-contract.md)
5. [docs/user-guide.md](./docs/user-guide.md)
6. assessment docs under `docs/design`

If docs disagree with code and tests, do not silently guess. Either align them in the same change or call out the mismatch explicitly.

## Important Product Decisions

### Public API

- `scanProject()` is the stable package API.
- Raw `ProjectAnalysis` and engine stages are not public product output.
- Explicit `sourceFilePaths` or `cssFilePaths` replace default discovery for that file kind.

### CLI

- Current command shape is `scan-react-css [rootDir] [--config path] [--focus path] [--json]`.
- `--focus` filters emitted findings and diagnostics while preserving full-project analysis.
- Text and JSON formatting lives under `src/cli/`.
- JSON output must stay deterministic and human-readable.
- Debug diagnostics and traces are shown only when config `verbosity` is `high`.

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
- `failOnSeverity` defaults to `error`.
- `verbosity` defaults to `medium`.
- `cssModules.localsConvention` defaults to `camelCase`.

### Rules

The rule catalog is described in [docs/design/rules-catalogue.md](./docs/design/rules-catalogue.md).

Current implemented rules include:

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

Rules should consume `ProjectAnalysis` and stay thin. If a rule needs a project-wide map, that map probably belongs in the analysis layer.

### CSS Modules

The durable CSS Module contract is [docs/design/css-modules-contract.md](./docs/design/css-modules-contract.md).

Supported behavior includes default, namespace, and named CSS Module imports; static member reads;
string-literal element reads; simple destructuring; simple same-file aliases; `localsConvention`
matching; and projection of CSS Module reads into generic class-reference evidence.

Unsupported CSS Module patterns should usually produce debug diagnostics instead of broad guesses.

### Ownership

Ownership rules are evidence-based. Do not force a stronger classification when the scanner cannot justify it.

Do not reintroduce `shared` as a separate ownership tier unless docs and code are intentionally changed together.

### Confidence

Confidence is:

- `low`
- `medium`
- `high`

Severity and confidence are separate.

## Current Code Structure

- `src/config`: config loading and validation
- `src/project`: project discovery and `scanProject()`
- `src/static-analysis-engine`: staged analysis core
- `src/rules`: rule catalog, rule execution, and finding suppression
- `src/cli.ts`: CLI argument parsing and process behavior
- `src/cli`: JSON/text/filter/trace formatting helpers
- `test/unit`: file-oriented unit and integration-style coverage

## Testing Expectations

Use the existing Node test runner setup and generated fake React projects.

Common checks:

```bash
npm.cmd run check
npm.cmd run lint
npm.cmd test
```

On non-Windows shells, use the equivalent `npm` commands.

## When Editing Docs

- Keep durable implementation docs under `docs/design` or `docs/user-guide.md`.
- Keep non-implemented or exploratory work under `docs/temp` until it graduates.
- Do not mix future ideas into durable docs unless they become real product behavior.
- If you add or change operational behavior, update the relevant user and design docs in the same change.

When returning a completed block of work, suggest a concise commit message that summarizes it.

## Things To Be Careful About

- Do not silently merge config files.
- Do not expose raw engine internals in public CLI JSON.
- Do not make output formatting nondeterministic.
- Do not make `--focus` narrow analysis inputs; it is an output and failure filter.
- Do not assume unsupported syntax means a correctness finding should be emitted.
- Do not regress finding suppression for more-specific CSS Module findings.
- Do not use legacy code as architecture unless explicitly asked.
