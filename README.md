# scan-react-css

`scan-react-css` audits how React source code uses CSS.

It scans source files, project CSS, CSS Modules, imported external CSS, and matching HTML-linked external stylesheets, then reports deterministic findings for local development and CI.

## Reboot Status

The repository is currently being rebuilt around the static analysis engine that remains under `src/static-analysis-engine`.

Current design and assessment docs:

- [Reboot Contract](./docs/design/reboot-contract.md)
- [Current Engine Assessment](./docs/design/current-engine-assessment.md)
- [Current Product Assessment](./docs/design/current-product-assessment.md)

The detailed CLI, config, and API sections below describe the pre-reboot package surface and should be treated as historical reference until the new product shell is rebuilt.

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
npm install --save-dev scan-react-css
```

Node `20+` is required.

For one-off runs without adding it to the project:

```bash
npx scan-react-css
```

For a globally installed CLI:

```bash
npm install -g scan-react-css
scan-react-css
```

For the current reboot docs, start with the [Reboot Contract](./docs/design/reboot-contract.md).

## Quick Start

1. Install the package:

```bash
npm install --save-dev scan-react-css
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
npx scan-react-css
```

4. Use JSON output in CI or scripts:

```bash
npx scan-react-css --json --output-file ./reports/scan-react-css.json
```

## CLI Usage

Scan the current project:

```bash
npx scan-react-css
```

Scan a specific path:

```bash
npx scan-react-css ./packages/web
```

In most cases, prefer running from the project root and using `--focus` for a subdirectory instead of scanning a nested path directly. That keeps full-project imports, reachability, and external usages visible and helps avoid false reports.

Focus emitted findings on a subdirectory while still indexing the full project:

```bash
npx scan-react-css ./packages/web --focus src/features/payments
```

Emit JSON:

```bash
npx scan-react-css --json
```

Write JSON to a file:

```bash
npx scan-react-css --json --output-file ./reports/scan-react-css.json
```

Useful flags:

- `--config path/to/scan-react-css.json`
- `--focus path/to/subdirectory`
- `--json`
- `--output-file path/to/report.json`
- `--overwrite-output`
- `--print-config on|off`
- `--verbosity low|medium|high`
- `--output-min-severity debug|info|warning|error`

`--output-min-severity` affects both human-readable and JSON output.
`--print-config on` includes the full resolved config in either output mode.

If the package is installed globally, npm creates the `scan-react-css` command for you from the package `bin` entry. You do not need to manually add `dist/` to your `PATH`.

## Node API

```ts
import { scanReactCss } from "scan-react-css";

const result = await scanReactCss({
  targetPath: process.cwd(),
});

console.log(result.summary);
console.log(result.findings);
```

The package also exports `scan` as an alias.

## Config

The config file is JSON and defaults to `scan-react-css.json`.

Discovery order:

1. explicit `--config` or API `configPath`
2. project-root `scan-react-css.json`
3. `SCAN_REACT_CSS_CONFIG_DIR/scan-react-css.json`
4. the first `scan-react-css.json` found on the OS `PATH`
5. built-in defaults

Only one config source is loaded. There is no config merging.

Built-in defaults auto-discover React source roots by looking for React-bearing `package.json` files and common source directories such as `src`, `app`, and `client/src`, enable CSS Modules by convention, understand `classnames` and `clsx`, recognize common HTML-linked external providers such as Font Awesome, Bootstrap Icons, Material Design Icons, Animate.css, UIkit, and Pure.css, and fail on `error` findings by default.

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

For the current config direction, see the [Reboot Contract](./docs/design/reboot-contract.md) and [Current Product Assessment](./docs/design/current-product-assessment.md).

## Output And CI

The CLI returns a non-zero exit code when findings meet the configured `policy.failOnSeverity` threshold.

Default policy:

- `error` findings fail the scan
- `warning` and `info` do not

Human-readable output is stable and terminal-friendly. JSON output is deterministic and intended for tooling and CI.
