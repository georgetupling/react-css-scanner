# scan-react-css

`scan-react-css` audits how React projects use CSS.

It scans source files and CSS files, builds a normalized project analysis, then reports deterministic findings for local development and CI.

## Install

```bash
npm install --save-dev scan-react-css
```

Node `20+` is required.

Run it from a project root:

```bash
npx scan-react-css
```

## CLI

```bash
npx scan-react-css [rootDir] [--config path] [--focus path] [--json]
```

Examples:

```bash
npx scan-react-css
npx scan-react-css ./packages/web
npx scan-react-css ./packages/web --focus src/features/payments
npx scan-react-css --json
```

`--focus` filters emitted findings, diagnostics, summary failure state, and exit-code behavior to a path while still analyzing the full project. Prefer `--focus` over scanning a nested directory when cross-file reachability matters.

## Config

The config file is JSON and defaults to `scan-react-css.json`.

```json
{
  "failOnSeverity": "error",
  "verbosity": "medium",
  "rules": {
    "unused-css-class": "warn",
    "unsupported-syntax-affecting-analysis": "off"
  },
  "cssModules": {
    "localsConvention": "camelCase"
  }
}
```

Discovery order:

1. explicit `--config` or API `configPath`
2. project-root `scan-react-css.json`
3. `SCAN_REACT_CSS_CONFIG_DIR/scan-react-css.json`
4. first `scan-react-css.json` found on the OS `PATH`
5. built-in defaults

Only one config source is loaded. Config files are not merged.

## Output

Text output uses the configured `verbosity`:

- `low`: one table row per finding
- `medium`: summary, visible diagnostics, and findings
- `high`: medium output plus debug diagnostics and finding traces

JSON output is deterministic and human-readable. It includes `rootDir`, optional `focusPath`, resolved config, diagnostics, findings, summary, and `failed`. Debug diagnostics and debug summary counts are only included when `verbosity` is `high`.

The CLI exits with code `1` when visible findings meet or exceed `failOnSeverity`; otherwise it exits `0`.

## Node API

```ts
import { scanProject } from "scan-react-css";

const result = await scanProject({
  rootDir: process.cwd(),
  focusPath: "src/components",
});

console.log(result.summary);
console.log(result.findings);
```

`scanProject()` is the stable public API. Raw static-analysis-engine internals are not part of the package contract.

## Docs

- [User Guide](./docs/user-guide.md)
- [Reboot Contract](./docs/design/reboot-contract.md)
- [Rules Catalogue](./docs/design/rules-catalogue.md)
- [CSS Modules Contract](./docs/design/css-modules-contract.md)
