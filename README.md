# react-css-scanner

`react-css-scanner` audits how React source code uses CSS.

It scans source files, project CSS, CSS Modules, and imported external CSS, then reports deterministic findings for local development and CI.

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

Built-in defaults assume a typical `src`-based React project, enable CSS Modules by convention, understand `classnames` and `clsx`, and fail on `error` findings by default.

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

For a fuller config reference, see [docs/design/config-schema.md](./docs/design/config-schema.md) and [docs/design/config-contract.md](./docs/design/config-contract.md).

## Output And CI

The CLI returns a non-zero exit code when findings meet the configured `policy.failOnSeverity` threshold.

Default policy:

- `error` findings fail the scan
- `warning` and `info` do not

Human-readable output is stable and terminal-friendly. JSON output is deterministic and intended for tooling and CI.

## Publishing Notes

The package is structurally ready for npm publishing:

- the tarball contents are clean under `npm pack --dry-run`
- the CLI is exposed through the `bin` field
- `prepublishOnly` already runs typecheck, lint, and build

The main remaining publish decisions are metadata rather than code:

- choose whether the package should stay `UNLICENSED` or use an open-source license
- add `repository`, `homepage`, and `bugs` fields in `package.json` once you know the public repo URL
- confirm the final package name/version you want to publish

## Development

Repo commands:

- `npm run build`
- `npm run check`
- `npm run lint`
- `npm run format`
- `npm test`
- `npm run benchmark`

## Docs

- [docs/README.md](./docs/README.md)
- [docs/design/architecture.md](./docs/design/architecture.md)
- [docs/design/runtime-contracts.md](./docs/design/runtime-contracts.md)
- [docs/design/config-contract.md](./docs/design/config-contract.md)
- [docs/design/rules.md](./docs/design/rules.md)
- [docs/future-work/post-mvp-ideas.md](./docs/future-work/post-mvp-ideas.md)
