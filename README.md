# scan-react-css

`scan-react-css` audits how React source code uses CSS.

It scans React source files, project CSS, and CSS Modules, then reports deterministic findings for local development and CI. The current package is the product shell around the static analysis engine in `src/static-analysis-engine`.

## Current Status

The active public contract is documented in:

- [Product Contract](./docs/design/product-contract.md)
- [Rules Catalogue](./docs/design/rules-catalogue.md)
- [CSS Modules Contract](./docs/design/css-modules-contract.md)
- [Current Product Assessment](./docs/design/current-product-assessment.md)

Some historical scanner features are being reintroduced deliberately. Unsupported historical flags fail fast instead of being ignored.

## Install

```bash
npm install --save-dev scan-react-css
```

Node `20+` is required.

For one-off runs:

```bash
npx scan-react-css
```

## Quick Start

Scan the current directory:

```bash
npx scan-react-css
```

Scan a specific project root:

```bash
npx scan-react-css ./packages/web
```

Focus reported findings on a subtree while still analyzing the full project context:

```bash
npx scan-react-css ./packages/web --focus src/features/payments
```

Write a JSON report file:

```bash
npx scan-react-css --json
```

By default this creates a timestamped report such as
`scan-react-css-reports/report-2026-04-25-19-42-08.json`.

## CLI Usage

```bash
scan-react-css [rootDir] [--config path] [--focus path-or-glob] [--ignore-class class-or-glob] [--ignore-path path-or-glob] [--json] [--output-file path] [--overwrite-output] [--output-min-severity severity] [--verbosity low|medium|high] [--timings]
```

Supported flags:

- `--config path/to/scan-react-css.json`
- `--focus path-or-glob`
- `--ignore-class class-name-or-glob`
- `--ignore-path path-or-glob`
- `--json`
- `--output-file path/to/report.json`
- `--overwrite-output`
- `--output-min-severity debug|info|warn|error`
- `--verbosity low|medium|high`
- `--timings`
- `--help`

`rootDir` must be a directory. File paths and missing paths fail with a clear diagnostic.

### Focused Output

`--focus` is an output filter, not a smaller analysis root. The scanner still loads and analyzes the full project root so imports, global CSS, render relationships, and reachability context remain available.

Details:

- `--focus` can be provided more than once.
- A focus value can contain comma-separated paths.
- Non-glob values match an exact file or directory subtree.
- File focus values may include a pasted `:line` or `:line:column` suffix from CLI output.
- Glob values use project-relative `/` paths and support `*`, `?`, and `**`.
- Source, CSS, class-reference, class-definition, and selector-query counts describe the full project context.
- Finding counts and the CLI exit code are based on the focused findings.
- Error diagnostics are not hidden by focus.

Examples:

```bash
npx scan-react-css --focus src/components
npx scan-react-css --focus src/components/Button.tsx
npx scan-react-css --focus src/components/Button.tsx:31
npx scan-react-css --focus src/components,src/pages
npx scan-react-css --focus "src/features/**/components"
```

### Current Unsupported Flags

These historical flags are recognized but not supported in this build yet:

- `--print-config`

`--output-file` and `--overwrite-output` require `--json`.

`--output-min-severity` filters diagnostics and findings in text output and JSON reports. It
defaults to `info`, which hides debug scanner-internal uncertainty findings. Use
`--output-min-severity debug` to include debug findings in the report. This does not change
`failOnSeverity` or the CLI exit code.

`--verbosity` controls human-readable text output only. `low` prints a compact findings table,
`medium` is the default grouped-by-file output, and `high` prints one block per finding with
confidence, subject, selected details, and evidence. In JSON mode, `--verbosity` has no effect and
the CLI prints a warning.

Interactive text-mode scans print the active scan stage to `stderr` while analysis is running, for
example `Building reachability graph`. JSON mode keeps progress output disabled so automation sees
only the report confirmation on stdout.

Use `--timings` to include stage duration data in text output or in the JSON report.

### Ignores

Ignores suppress findings after analysis and rule evaluation. They are intended for unavoidable false
positives such as marker-only runtime classes, generated classes, or legacy areas being triaged.
Ignored classes and paths do not create CSS definitions, provider matches, selector context, or
reachability evidence.

Details:

- `--ignore-class` can be provided more than once and matches individual class tokens.
- `--ignore-path` can be provided more than once and matches project-relative `/` paths.
- Ignore patterns support `*`, `?`, and `**`.
- CLI ignores are additive with config ignores for one-off local triage.
- Ignored findings do not contribute to the CLI exit code.
- Text and JSON summaries include `ignoredFindingCount` for auditability.
- JSON summaries include finding count matrices by rule and by severity.

Examples:

```bash
npx scan-react-css --ignore-class ProseMirror
npx scan-react-css --ignore-class "generated-*"
npx scan-react-css --ignore-path "src/legacy/**"
```

### JSON Reports

`--json` writes a deterministic JSON report to a file and prints a short confirmation to stdout.
It does not dump the JSON payload to the terminal.

Default behavior:

- writes to a timestamped file like `scan-react-css-reports/report-2026-04-25-19-42-08.json`
- preserves existing reports by adding a numeric suffix if a selected report path already exists
- applies `--output-min-severity` to reported diagnostics, findings, and their summary counts
- includes separate `summary.findingsByRule` and `summary.findingsBySeverity` count matrices
- exits non-zero after writing the report if the scan failed

Custom output:

```bash
npx scan-react-css --json --output-file ./reports/scan-react-css.json
npx scan-react-css --json --output-file ./reports/scan-react-css.json --overwrite-output
```

## Config

The config file is JSON and defaults to `scan-react-css.json`.

CLI discovery order:

1. explicit `--config`, resolved from the directory where the command is run
2. `scan-react-css.json` in the directory where the command is run
3. `SCAN_REACT_CSS_CONFIG_DIR/scan-react-css.json`
4. first `scan-react-css.json` found on the OS `PATH`
5. built-in defaults

The Node API uses `configBaseDir` for explicit `configPath` resolution and project config discovery.
If `configBaseDir` is omitted, it defaults to `rootDir`.

Only one config source is loaded. There is no config merging.
Unknown config keys and unknown rule IDs are errors. Legacy scanner keys such as `css`, `source`,
and `classComposition` must be removed or migrated before the scan can pass.

Current config shape:

```json
{
  "failOnSeverity": "error",
  "rules": {
    "unused-css-class": "warn",
    "dynamic-class-reference": "debug",
    "unsupported-syntax-affecting-analysis": "off"
  },
  "cssModules": {
    "localsConvention": "camelCase"
  },
  "externalCss": {
    "fetchRemote": false,
    "remoteTimeoutMs": 5000,
    "globals": [
      {
        "provider": "custom-icons",
        "match": ["**/custom-icons.css"],
        "classPrefixes": ["ci-"],
        "classNames": ["ci"]
      }
    ]
  },
  "ownership": {
    "sharedCss": ["src/styles/**/*.css", "src/**/Card.css"]
  },
  "discovery": {
    "sourceRoots": ["src", "packages/ui/src"],
    "exclude": ["**/*.stories.tsx", "**/fixtures/**"]
  },
  "ignore": {
    "classNames": ["ProseMirror", "generated-*"],
    "filePaths": ["src/legacy/**"]
  }
}
```

`failOnSeverity` accepts `debug`, `info`, `warn`, or `error`.

Rule values accept `off`, `debug`, `info`, `warn`, or `error`.

CSS Module `localsConvention` accepts:

- `asIs`
- `camelCase`
- `camelCaseOnly`

External CSS config controls provider declarations and optional remote fetching. Built-in defaults
include Font Awesome, Material Design Icons, Bootstrap Icons, Animate.css, UIkit, and Pure.css
provider declarations; custom `externalCss.globals` entries are appended to those defaults. Static
HTML/CDN stylesheet links activate matching declared providers, so a Font Awesome CDN link can
satisfy `fa-*` references without an HTTP fetch. Local HTML-linked `.css` files are loaded, parsed,
and treated as project-wide reachable. JavaScript and TypeScript package CSS imports such as
`import "bootstrap-icons/font/bootstrap-icons.css"` are resolved under `node_modules`, loaded,
parsed, and treated as external imports. Provider declarations are only activated by configured
external stylesheet evidence such as HTML/CDN links, not by package CSS imports. Package CSS loaded
through CSS `@import` is also resolved under `node_modules`, parsed, and treated as reachable through
the importing stylesheet. Local CSS `@import` chains also inherit reachability from their importing
stylesheet. HTML module scripts such as `<script type="module" src="/src/main.tsx">` mark CSS
imported by that entry source, and local CSS imported from it, as project-wide reachable inside the
nearest app boundary inferred from the HTML file and script path. Local CSS imported by a source file
is treated as reachable across source modules connected by static imports, so wrapper component CSS
remains available to callers that render slotted children through that wrapper. Package CSS resolution searches
upward from the importing file for usable `node_modules` directories, so subdirectory scans can still
resolve workspace-level packages.
Remote stylesheet links are fetched only when `externalCss.fetchRemote` is `true`; fetched CSS is
parsed into concrete classes, uses `remoteTimeoutMs`, and fetch failures are reported as warning
diagnostics. Default scans perform no network requests.

Ownership config lets projects explicitly mark project CSS paths as intentionally shared. Patterns
in `ownership.sharedCss` are project-relative globs and extend the built-in broad stylesheet
conventions, including names such as `global.css`, `shared.css`, `layout.css`, and `layouts.css`.
Strong private component-owner evidence, such as `Layout.tsx` paired with `Layout.css`, takes
precedence over configured and built-in shared path signals. Otherwise, matching shared stylesheets
are not reported as shared-without-owner CSS.

Discovery config controls which source files are loaded into the analysis graph during default
project discovery. `discovery.sourceRoots` is an array of exact project-relative directories; when
provided, source discovery is limited to those roots. `discovery.exclude` is an array of
project-relative globs appended to the built-in source exclusions for common test files and
directories such as `**/__tests__/**`, `**/test/**`, `**/*.test.tsx`, and `**/*.spec.tsx`.
Explicit Node API `sourceFilePaths` bypass discovery exclusions.

Ignore config suppresses matching findings after rules run. `ignore.classNames` matches individual
CSS class tokens, while `ignore.filePaths` matches project-relative file paths involved in a
finding. These entries are suppression only and should not be used to model external stylesheets; use
real CSS evidence or `externalCss.globals` provider declarations for that.

The scanner also recognizes a small set of usage-only runtime DOM class APIs. ProseMirror
`new EditorView(..., { attributes: { class: "..." } })` static class strings are indexed as
`runtime-dom` class references so CSS used by the editor surface is not reported as unused. These
references prove usage only; they do not add render-tree placement for selector layout matching.
When `EditorView` is imported from `prosemirror-view`, missing runtime classes include a
finding-level hint if no package CSS import from `prosemirror-view` was loaded. JavaScript package
imports are advisory only; classes are satisfied only by real CSS evidence such as local CSS,
imported package CSS, or linked stylesheets.

## Rules

Default rules:

- `missing-css-class` defaults to `error`
- `css-class-unreachable` defaults to `error`
- `unused-css-class` defaults to `warn`
- `missing-css-module-class` defaults to `error`
- `unused-css-module-class` defaults to `warn`
- `unsatisfiable-selector` defaults to `warn`
- `compound-selector-never-matched` defaults to `warn`
- `unused-compound-selector-branch` defaults to `warn`
- `selector-only-matches-in-unknown-contexts` defaults to `debug`
- `single-component-style-not-colocated` defaults to `info`
- `style-used-outside-owner` defaults to `warn`
- `style-shared-without-shared-owner` defaults to `info`
- `dynamic-class-reference` defaults to `debug`
- `unsupported-syntax-affecting-analysis` defaults to `debug`

Findings carry both severity and confidence. Debug findings are hidden from CLI output by the
default `--output-min-severity info` threshold. The scanner-internal uncertainty rules
`dynamic-class-reference` and `unsupported-syntax-affecting-analysis` default to debug so routine
bounded-analysis traces do not appear as user-facing findings unless a project opts in with
`--output-min-severity debug` or a rule severity override.

Compound selector context classes, such as the ancestor class in `.shell .button`, count as CSS
evidence for `missing-css-class` but are not indexed as ordinary definitions for
`unused-css-class`.

Ownership rules are conservative about private CSS. A single importing component is not enough to
prove private ownership; the scanner looks for stronger mirrored naming or component-folder evidence
before reporting `style-used-outside-owner`. Generic family stylesheets such as `Card.css` used by
`ArticleCard` and `TopicCard` are treated as intentionally shared. Projects can also mark shared
paths explicitly with `ownership.sharedCss`.

`style-used-outside-owner` does not report same-directory owner-family consumers, generic state
tokens such as `is-*` and `has-*`, or scoped primitive overrides such as
`.site-header__account-menu .popover__panel` as private-owner leaks. Repeated ownership evidence
from grouped selectors or media overrides is consolidated into one finding with definition counts
and locations in JSON data.

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

`scanProject()` accepts:

```ts
type ScanProjectInput = {
  rootDir?: string;
  sourceFilePaths?: string[];
  cssFilePaths?: string[];
  htmlFilePaths?: string[];
  configPath?: string;
  configBaseDir?: string;
  ignore?: {
    classNames?: string[];
    filePaths?: string[];
  };
  onProgress?: (event: ScanProgressEvent) => void;
  collectPerformance?: boolean;
  includeTraces?: boolean;
};
```

`onProgress` receives `{ stage, status, message, durationMs? }` events while project loading,
engine analysis, and rule execution run. It is optional and does not change scan results.
`collectPerformance` adds an optional `performance` block with total and per-stage timings.

The result contains:

- `rootDir`
- `config`
- `diagnostics`
- `findings`
- `summary`
- optional `performance`
- `failed`
- discovered `files`

Raw engine internals are not exposed through the public API result.

## Output And CI

The CLI exits non-zero when:

- an error diagnostic is produced, or
- a finding meets `failOnSeverity`

Default policy:

- `error` findings fail the scan
- `warn`, `info`, and `debug` findings do not

Human-readable output is intended for local use. The default `medium` verbosity groups findings by
file, separates groups with blank lines, and ends with a summary. Finding locations are printed as
`path/to/file:line` targets so VS Code and common terminals can open them directly. Interactive
terminals get severity colors, unless `NO_COLOR` is set.

JSON output is deterministic and intended for tooling and CI.
