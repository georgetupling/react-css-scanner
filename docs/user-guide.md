# User Guide

## Overview

`scan-react-css` analyzes React source and CSS files, then reports findings about missing classes, unreachable CSS, unused CSS, CSS Modules, selector semantics, ownership, and unsupported syntax that affects analysis.

The scanner has one stable product API, `scanProject()`, and one CLI command, `scan-react-css`.

## CLI

```bash
npx scan-react-css [rootDir] [--config path] [--focus path] [--json]
```

Common runs:

```bash
npx scan-react-css
npx scan-react-css ./packages/web
npx scan-react-css --config ./scan-react-css.json
npx scan-react-css --focus src/features/payments
npx scan-react-css --json
```

`rootDir` controls project discovery. When it is omitted, the current working directory is scanned.

`--focus` filters the emitted findings and diagnostics to a relative file or directory path. The scanner still analyzes the full project, so imports, reachability, and ownership evidence outside the focused path can still affect results. The focused result also drives summary counts, `failed`, and the CLI exit code.

## Config

Config is JSON. The default filename is `scan-react-css.json`.

Discovery order:

1. explicit `--config` or API `configPath`
2. project-root `scan-react-css.json`
3. `SCAN_REACT_CSS_CONFIG_DIR/scan-react-css.json`
4. first `scan-react-css.json` found on the OS `PATH`
5. built-in defaults

Only one config file is loaded. Config files are not merged.

```json
{
  "failOnSeverity": "error",
  "verbosity": "medium",
  "rules": {
    "missing-css-class": "error",
    "unused-css-class": "warn",
    "unsupported-syntax-affecting-analysis": "debug"
  },
  "cssModules": {
    "localsConvention": "camelCase"
  }
}
```

### `failOnSeverity`

Controls whether findings fail the scan.

Allowed values:

- `debug`
- `info`
- `warn`
- `error`

The default is `error`.

### `verbosity`

Controls CLI output detail.

Allowed values:

- `low`: one table row per finding
- `medium`: summary, visible diagnostics, and findings
- `high`: medium output plus debug diagnostics and finding traces

The default is `medium`.

### `rules`

Rules can use their default severity, be overridden, or be disabled with `off`.

```json
{
  "rules": {
    "unused-css-class": "off",
    "style-used-outside-owner": "info"
  }
}
```

Rule ids and intended behavior are documented in the [Rules Catalogue](./design/rules-catalogue.md).

### `cssModules.localsConvention`

Controls how CSS Module export names are matched to CSS class names.

Allowed values:

- `asIs`
- `camelCase`
- `camelCaseOnly`

The default is `camelCase`. See the [CSS Modules Contract](./design/css-modules-contract.md) for supported import forms, member reads, destructuring, aliases, named imports, and unsupported-pattern diagnostics.

## Output

Text output is meant for terminals. JSON output is meant for CI and tooling.

```bash
npx scan-react-css --json
```

JSON output contains:

- `rootDir`
- optional `focusPath`
- resolved `config`
- `diagnostics`
- `findings`
- `summary`
- `failed`

Raw static-analysis-engine internals are intentionally not included.

Debug diagnostics and debug summary counts are hidden unless `verbosity` is `high`.

## Node API

```ts
import { scanProject } from "scan-react-css";

const result = await scanProject({
  rootDir: process.cwd(),
  focusPath: "src/components",
  configPath: "scan-react-css.json"
});
```

`scanProject()` accepts:

- `rootDir?: string`
- `focusPath?: string`
- `sourceFilePaths?: string[]`
- `cssFilePaths?: string[]`
- `configPath?: string`

Explicit `sourceFilePaths` or `cssFilePaths` replace default discovery for that file kind. They are useful for tests and controlled programmatic scans.

## Exit Codes

The CLI exits with:

- `0` when no visible finding meets `failOnSeverity`
- `1` when at least one visible finding meets `failOnSeverity`

When `--focus` is used, only focused findings affect the exit code.
