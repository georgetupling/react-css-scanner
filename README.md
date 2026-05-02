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
scan-react-css [rootDir] [--config path] [--focus path-or-glob] [--ignore-class class-or-glob] [--ignore-path path-or-glob] [--json] [--output-file path] [--overwrite-output] [--output-min-severity severity] [--verbosity low|medium|high] [--timings]
```

Supported flags:

- `--config`
- `--focus` (reporting filter only; analysis scope stays full-project)
- `--ignore-class`
- `--ignore-path`
- `--json`
- `--output-file` (requires `--json`)
- `--overwrite-output` (requires `--json`)
- `--output-min-severity` (`debug|info|warn|error`)
- `--verbosity` (`low|medium|high`, text mode only)
- `--timings`
- `--help`

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

| Key                                     | Allowed values                          | Default            | Notes                                                                  |
| --------------------------------------- | --------------------------------------- | ------------------ | ---------------------------------------------------------------------- |
| `failOnSeverity`                        | `debug \| info \| warn \| error`        | `error`            | Findings at or above this severity fail the scan.                      |
| `rules.<ruleId>`                        | `off \| debug \| info \| warn \| error` | per rule catalogue | Override severity for a specific rule id. Unknown rule ids are errors. |
| `cssModules.localsConvention`           | `asIs \| camelCase \| camelCaseOnly`    | `camelCase`        | Controls CSS Module export-name normalization.                         |
| `externalCss.fetchRemote`               | `true \| false`                         | `false`            | Enables fetching remote CSS from HTML links.                           |
| `externalCss.remoteTimeoutMs`           | positive number                         | `5000`             | Timeout used when `fetchRemote` is enabled.                            |
| `externalCss.globals[]`                 | array of provider objects               | built-in providers | Optional custom external CSS providers (appended to built-ins).        |
| `externalCss.globals[].provider`        | non-empty string                        | `n/a`              | Provider label.                                                        |
| `externalCss.globals[].match[]`         | string globs                            | `[]`               | Stylesheet path/url match patterns for provider activation.            |
| `externalCss.globals[].classPrefixes[]` | strings                                 | `[]`               | Prefixes this provider satisfies (for example `fa-`).                  |
| `externalCss.globals[].classNames[]`    | strings                                 | `[]`               | Exact class names this provider satisfies.                             |
| `ownership.sharedCss[]`                 | non-empty string globs                  | `[]`               | Marks project stylesheet paths as intentionally shared.                |
| `ownership.sharingPolicy`               | `strict \| balanced \| permissive`      | `balanced`         | Policy for intentional-sharing suppression in ownership checks.        |
| `discovery.sourceRoots[]`               | non-empty directory paths               | `[]`               | Restricts source discovery to listed project-relative roots.           |
| `discovery.exclude[]`                   | non-empty glob patterns                 | `[]`               | Additional source discovery exclusions.                                |
| `ignore.classNames[]`                   | non-empty class names/globs             | `[]`               | Suppresses matching findings after analysis.                           |
| `ignore.filePaths[]`                    | non-empty project-relative path globs   | `[]`               | Suppresses findings involving matching files.                          |

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
  }
}
```

## Rule Coverage

Default checks include:

- missing class references (`missing-css-class`, `missing-css-module-class`)
- unreachable or unsatisfiable selectors (`css-class-unreachable`, `unsatisfiable-selector`)
- dead CSS (`unused-css-class`, `unused-css-module-class`, unused compound selector branches)
- style ownership risks (`style-used-outside-owner`, `style-shared-without-shared-owner`)
- bounded-analysis uncertainty surfaced as debug (`dynamic-class-reference`, `unsupported-syntax-affecting-analysis`)

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

## Docs

- [Rules Catalogue](./docs/design/rules-catalogue.md)
- [Architecture](./docs/design/architecture.md)
