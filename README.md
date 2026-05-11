# scan-react-css

`scan-react-css` is a static analysis scanner for React + CSS that catches styling problems before they ship.

It finds missing classes, dead selectors, unreachable CSS, CSS Module mistakes, and ownership issues with deterministic output you can trust in CI.

## Why teams use it

- Finds real regressions early: broken class references, unreachable selectors, and unused styles.
- Understands modern React styling patterns: plain CSS, CSS Modules, imported package CSS, and HTML-linked stylesheets.
- CI-friendly by design: deterministic findings, stable summaries, and configurable failure thresholds.
- Scales to large codebases: full-project analysis with focused reporting so context stays accurate.

## Install

```bash
npm install --save-dev scan-react-css
```

Node `20+` is required.

## Quick Start

```bash
npx scan-react-css
```

Scan a specific root:

```bash
npx scan-react-css ./packages/web
```

Focus output on an area while still analyzing the full project:

```bash
npx scan-react-css ./packages/web --focus src/features/payments
```

Generate a JSON report:

```bash
npx scan-react-css --json
```

## CLI

```bash
scan-react-css [rootDir] [--config path] [--focus path-or-glob] [--ignore-class class-or-glob] [--ignore-path path-or-glob] [--json] [--trace] [--debug-runtime-css] [--output-file path] [--overwrite-output] [--output-min-severity severity] [--verbose] [--timings]
```

Supported flags:

- `--config`
- `--focus` (reporting filter only; analysis scope stays full-project)
- `--ignore-class`
- `--ignore-path`
- `--json`
- `--trace` (JSON mode only; includes finding traces in JSON report only)
- `--debug-runtime-css` (JSON mode only; includes inferred runtime CSS entries/chunks and related debug diagnostics)
- `--output-file` (JSON mode only)
- `--overwrite-output` (JSON mode only)
- `--output-min-severity` (`debug|info|warn|error`)
- `--verbose` (text mode only; enables detailed finding blocks)
- `--timings`
- `--help`

`--json`, `--trace`, `--debug-runtime-css`, and overwrite behavior can also be set from config via `reporting`.

## JSON Reports

`--json` writes a deterministic report file and prints a short confirmation to stdout.

Default behavior:

- writes to `scan-react-css-reports/report-<timestamp>.json`
- avoids overwriting existing files unless `--overwrite-output` is set
- applies `--output-min-severity` to diagnostics, findings, and summary counts
- exits non-zero after writing the report if failure conditions are met

## Config

Config file name: `scan-react-css.json`

Discovery order:

1. `--config` path
2. `<cwd>/scan-react-css.json`
3. `SCAN_REACT_CSS_CONFIG_DIR/scan-react-css.json`
4. first `scan-react-css.json` on OS `PATH`
5. built-in defaults

Important rules:

- one config source only (no merging)
- unknown top-level keys are errors
- unknown rule ids are errors

### Config reference

| Key                                     | Allowed values                           | Default            | Notes                                                                                                                  |
| --------------------------------------- | ---------------------------------------- | ------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| `failOnSeverity`                        | `debug \| info \| warn \| error`         | `error`            | Findings at or above this severity fail the scan.                                                                      |
| `rules.<ruleId>`                        | `off \| debug \| info \| warn \| error`  | per rule catalogue | Override severity for a specific rule id. Unknown rule ids are errors.                                                 |
| `cssModules.localsConvention`           | `asIs \| camelCase \| camelCaseOnly`     | `camelCase`        | Controls CSS Module export-name normalization.                                                                         |
| `externalCss.fetchRemote`               | `true \| false`                          | `false`            | Enables fetching remote CSS from HTML links.                                                                           |
| `externalCss.remoteTimeoutMs`           | positive number                          | `5000`             | Timeout used when `fetchRemote` is enabled.                                                                            |
| `externalCss.globals[]`                 | array of provider objects                | built-in providers | Optional custom external CSS providers (appended to built-ins).                                                        |
| `externalCss.globals[].provider`        | non-empty string                         | `n/a`              | Provider label.                                                                                                        |
| `externalCss.globals[].match[]`         | string globs                             | `[]`               | Stylesheet path/url match patterns for provider activation.                                                            |
| `externalCss.globals[].classPrefixes[]` | strings                                  | `[]`               | Prefixes this provider satisfies (for example `fa-`).                                                                  |
| `externalCss.globals[].classNames[]`    | strings                                  | `[]`               | Exact class names this provider satisfies.                                                                             |
| `externalCss.globals[].stylesheetRole`  | `external-global \| third-party-runtime` | `external-global`  | Use `third-party-runtime` for library/widget CSS that styles DOM created outside React, such as TinyMCE or CodeMirror. |
| `ownership.sharedCss[]`                 | non-empty string globs                   | `[]`               | Marks project stylesheet paths as intentionally shared.                                                                |
| `ownership.sharingPolicy`               | `strict \| balanced \| permissive`       | `balanced`         | Policy for intentional-sharing suppression in ownership checks.                                                        |
| `discovery.sourceRoots[]`               | non-empty directory paths                | `[]`               | Restricts source discovery to listed project-relative roots.                                                           |
| `discovery.exclude[]`                   | non-empty glob patterns                  | `[]`               | Additional source discovery exclusions.                                                                                |
| `ignore.classNames[]`                   | non-empty class names/globs              | `[]`               | Suppresses matching findings after analysis.                                                                           |
| `ignore.filePaths[]`                    | non-empty project-relative path globs    | `[]`               | Suppresses findings involving matching files.                                                                          |
| `reporting.verbose`                     | `true \| false`                          | `false`            | Enables verbose text reporting by default.                                                                             |
| `reporting.json`                        | `true \| false`                          | `false`            | Emits JSON reports by default without requiring `--json`.                                                              |
| `reporting.trace`                       | `true \| false`                          | `false`            | Includes finding traces in JSON reports by default.                                                                    |
| `reporting.debugRuntimeCss`             | `true \| false`                          | `false`            | Includes runtime CSS debug data in JSON reports by default.                                                            |
| `reporting.outputDirectory`             | non-empty string                         | `n/a`              | Default directory used for timestamped JSON reports.                                                                   |
| `reporting.overwriteOutput`             | `true \| false`                          | `false`            | Overwrites JSON output files by default instead of suffixing.                                                          |

Minimal example:

```json
{
  "failOnSeverity": "error",
  "rules": {
    "unused-css-class": "warn",
    "dynamic-class-reference": "debug"
  },
  "cssModules": {
    "localsConvention": "camelCase"
  },
  "ownership": {
    "sharingPolicy": "balanced",
    "sharedCss": ["src/styles/**/*.css"]
  },
  "reporting": {
    "verbose": false,
    "json": false,
    "trace": false,
    "debugRuntimeCss": false,
    "outputDirectory": "scan-react-css-reports",
    "overwriteOutput": false
  }
}
```

## Rule Catalogue

Rules can be disabled or given a different severity with `rules.<ruleId>` in config.

| Rule id                                     | Default severity | Description                                                                                                            |
| ------------------------------------------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `missing-css-class`                         | `error`          | Reports statically known class references with no matching reachable project CSS definition or provider match.         |
| `css-class-unreachable`                     | `error`          | Reports class references whose definition exists, but only in stylesheets that cannot reach the usage context.         |
| `unused-css-class`                          | `warn`           | Reports project CSS class definitions with no known reachable source reference or selector-context use.                |
| `missing-css-module-class`                  | `error`          | Reports CSS Module member references, such as `styles.root`, that do not exist in the imported module.                 |
| `unused-css-module-class`                   | `warn`           | Reports CSS Module classes that are exported by a module stylesheet but never consumed by known imports.               |
| `css-module-import-not-used`                | `warn`           | Reports CSS Module imports whose imported object is never read through known member, destructured, or computed use.    |
| `orphan-css-file`                           | `warn`           | Reports project stylesheets that define classes but have no reachable source, component, or render context.            |
| `duplicate-class-definition`                | `info`           | Reports duplicate same-selector class definitions in the same stylesheet and at-rule context.                          |
| `declaration-always-shadowed`               | `off`            | Opt-in cascade cleanup rule for declarations proven to always lose to stronger candidates wherever they apply.         |
| `unsatisfiable-selector`                    | `warn`           | Reports selectors that cannot match any known renderable structure under bounded selector/render analysis.             |
| `compound-selector-never-matched`           | `warn`           | Reports compound selectors, such as `.button.primary`, whose required classes are never observed on one node.          |
| `unused-compound-selector-branch`           | `warn`           | Reports unused branches in selector lists or compound selectors when other branches may still be useful.               |
| `selector-only-matches-in-unknown-contexts` | `debug`          | Reports selectors that can only match through unresolved render paths, unknown dynamic classes, or unsupported syntax. |
| `single-component-style-not-colocated`      | `off`            | Opt-in ownership rule for styles used by one component but defined outside that component's expected location.         |
| `style-used-outside-owner`                  | `off`            | Opt-in ownership rule for private component styles used by components outside the inferred owner.                      |
| `style-shared-without-shared-owner`         | `off`            | Opt-in ownership rule for styles shared by multiple components but not located in an intentionally shared place.       |
| `dynamic-class-reference`                   | `debug`          | Reports class expressions that cannot be reduced to a finite exact or possible set of class names.                     |
| `unsupported-syntax-affecting-analysis`     | `debug`          | Reports unsupported syntax that caused class, selector, module, render, or reachability analysis to degrade.           |

## Node API

```ts
import { scanProject } from "scan-react-css";

const result = await scanProject({
  rootDir: process.cwd(),
  configPath: "scan-react-css.json",
});

console.log(result.summary);
console.log(result.findings);
```

## Exit behavior

CLI exits non-zero when:

- an error diagnostic is produced, or
- a finding meets `failOnSeverity`

Default `failOnSeverity` is `error`.
