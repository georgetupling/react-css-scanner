# Current Product Assessment

## Purpose

This document summarizes the product shell around the static-analysis engine.

For the user-facing contract, use:

- [User Guide](../user-guide.md)
- [Reboot Contract](./reboot-contract.md)
- [Rules Catalogue](./rules-catalogue.md)
- [CSS Modules Contract](./css-modules-contract.md)

## Current State Summary

The rebooted product shell is now a usable CLI and Node API around `src/static-analysis-engine`.

Implemented areas include:

- root package export for `scanProject()`
- CLI entrypoint: `scan-react-css [rootDir] [--config path] [--focus path] [--json]`
- root-based project discovery for source and CSS inputs
- explicit source/CSS path overrides for controlled scans and tests
- JSON config discovery and validation
- rule severity overrides and disabled rules
- `failOnSeverity` exit-code policy
- `verbosity` output policy with `low`, `medium`, and `high`
- focus-path output filtering without narrowing analysis inputs
- deterministic text and JSON formatting under `src/cli`
- rule execution above `ProjectAnalysis`
- finding suppression for more-specific CSS Module findings
- integration-style tests around CLI, config, project scanning, and rules

The product shell is intentionally thin. It loads projects, invokes normalized engine analysis, runs
rules, formats stable results, and avoids exposing raw engine internals through public output.

## Current Public Surface

### Node API

```ts
import { scanProject } from "scan-react-css";

const result = await scanProject({
  rootDir: process.cwd(),
  focusPath: "src/components"
});
```

`scanProject()` is the stable product API. Engine-facing APIs are internal to the product and tests.

### CLI

```bash
scan-react-css [rootDir] [--config path] [--focus path] [--json]
```

`--focus` filters emitted findings, diagnostics, summary failure state, and exit-code behavior after
full-project analysis has run.

### Config

The current stable config fields are:

- `failOnSeverity`
- `verbosity`
- `rules`
- `cssModules.localsConvention`

Discovery order is documented in the [User Guide](../user-guide.md).

## Implemented Rule Surface

The current registry contains:

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

The remaining catalogue ideas should be added only when their analysis and product policy are clear.

## Product Work Still Open

### External CSS

The product still needs a stronger external CSS story before external-specific rules become stable:

- imported external CSS versus declared providers
- remote fetching policy
- provider matching diagnostics
- `missing-external-css-class`

### Config Growth

The current config is intentionally small. Likely future additions:

- CSS Module filename patterns beyond `.module.css`
- ignore patterns for generated/public/global classes
- configurable broad/global path conventions
- external provider declarations
- analysis budgets

### Reporting Polish

The current formatter is deterministic and tested. Useful future work:

- rule documentation links in findings
- grouped human-readable output
- selective golden JSON fixtures
- optional output-file behavior if the CLI needs it again

### Docs

The main user docs are now in place. Future docs should stay close to implemented behavior and avoid
reintroducing old scanner compatibility promises.

## Product Principle

Keep the shell boring:

- load files
- resolve config
- invoke analysis
- run thin rules
- format stable output
- decide exit codes

When behavior needs project-wide maps, matching, or ownership evidence, prefer adding it to
`ProjectAnalysis` instead of rebuilding it in a rule or formatter.
