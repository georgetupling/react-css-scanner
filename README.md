# react-css-scanner

`react-css-scanner` audits how React source code uses CSS.

It scans source files, project CSS, CSS Modules, imported external CSS, and matching HTML-linked external stylesheets, then reports deterministic findings for local development and CI.

## What It Checks

The current rules cover:

- missing or unreachable class usage
- unused CSS classes
- CSS Module mistakes
- ownership and organization issues
- dynamic class usage with explicit confidence levels
- imported external CSS validation
- duplicate class-definition checks

Findings always carry both severity and confidence.

## Install

```bash
npm install --save-dev react-css-scanner
```

Node `20+` is required.

For one-off runs without adding it to the project:

```bash
npx react-css-scanner
```

For a globally installed CLI:

```bash
npm install -g react-css-scanner
react-css-scanner
```

For full usage and configuration docs, start at [docs/user-guide/README.md](./docs/user-guide/README.md).

## Quick Start

1. Install the package:

```bash
npm install --save-dev react-css-scanner
```

2. Add a config file:

```json
{
  "css": {
    "global": ["src/styles/global.css"]
  }
}
```

3. Run the scanner:

```bash
npx react-css-scanner
```

4. Use JSON output in CI or scripts:

```bash
npx react-css-scanner --json --output-file ./reports/react-css-scanner.json
```

## CLI Usage

Scan the current project:

```bash
npx react-css-scanner
```

Scan a specific path:

```bash
npx react-css-scanner ./packages/web
```

In most cases, prefer running from the project root and using `--focus` for a subdirectory instead of scanning a nested path directly. That keeps full-project imports, reachability, and external usages visible and helps avoid false reports.

Focus emitted findings on a subdirectory while still indexing the full project:

```bash
npx react-css-scanner ./packages/web --focus src/features/payments
```

Emit JSON:

```bash
npx react-css-scanner --json
```

Write JSON to a file:

```bash
npx react-css-scanner --json --output-file ./reports/react-css-scanner.json
```

Useful flags:

- `--config path/to/react-css-scanner.json`
- `--focus path/to/subdirectory`
- `--json`
- `--output-file path/to/report.json`
- `--overwrite-output`
- `--config-summary off|default|verbose`
- `--output-mode minimal|default|verbose`
- `--output-min-severity info|warning|error`

`--output-min-severity` only affects human-readable output and cannot be combined with `--json`.

If the package is installed globally, npm creates the `react-css-scanner` command for you from the package `bin` entry. You do not need to manually add `dist/` to your `PATH`.

## Node API

```ts
import { scanReactCss } from "react-css-scanner";

const result = await scanReactCss({
  targetPath: process.cwd(),
});

console.log(result.summary);
console.log(result.findings);
```

The package also exports `scan` as an alias.

## Config

The config file is JSON and defaults to `react-css-scanner.json`.

Discovery order:

1. explicit `--config` or API `configPath`
2. project-root `react-css-scanner.json`
3. `REACT_CSS_SCANNER_CONFIG_DIR/react-css-scanner.json`
4. the first `react-css-scanner.json` found on the OS `PATH`
5. built-in defaults

Only one config source is loaded. There is no config merging.

Built-in defaults assume a typical `src`-based React project, enable CSS Modules by convention, understand `classnames` and `clsx`, recognize common HTML-linked external providers such as Font Awesome, Bootstrap Icons, Material Design Icons, Animate.css, UIkit, and Pure.css, and fail on `error` findings by default.

If you want the scanner to fetch remote HTML-linked stylesheets directly for a scan, set `externalCss.mode` to `fetch-remote`. Fetch failures surface as operational warnings and fall back to external-css heuristics instead of crashing the scan.

Example:

```json
{
  "rootDir": ".",
  "css": {
    "global": ["src/styles/global.css"]
  },
  "ownership": {
    "pagePatterns": ["src/pages/**/*", "src/routes/**/*"]
  },
  "policy": {
    "failOnSeverity": "warning"
  }
}
```

For full configuration docs, see [docs/user-guide/README.md](./docs/user-guide/README.md).

## Output And CI

The CLI returns a non-zero exit code when findings meet the configured `policy.failOnSeverity` threshold.

Default policy:

- `error` findings fail the scan
- `warning` and `info` do not

Human-readable output is stable and terminal-friendly. JSON output is deterministic and intended for tooling and CI.
