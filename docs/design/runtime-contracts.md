# Runtime Contracts

## Purpose

This document defines the main runtime-facing contracts for `scan-react-css`.

It is the operational companion to:

- [architecture.md](./architecture.md)
- [config-schema.md](./config-schema.md)
- [config-contract.md](./config-contract.md)
- [rules.md](./rules.md)

## Runtime surface areas

The scanner has two primary runtime surfaces:

- CLI
- Node API

Both use the same analysis engine and the same finding model.

## Config resolution contract

### Resolution order

The scanner resolves config in this order:

1. explicit CLI or API config path
2. project-root `scan-react-css.json`
3. `SCAN_REACT_CSS_CONFIG_DIR/scan-react-css.json`
4. first `scan-react-css.json` found on the OS `PATH`
5. built-in defaults

### Resolution behavior

- Exactly one config source is loaded.
- Config files are not merged.
- If no config file is found, built-in defaults are used.
- If built-in defaults are used because no config file was found, the CLI emits an operational warning.

## CLI contract

### Core command

```bash
scan-react-css
```

### Supported syntax

```bash
scan-react-css [targetPath] [--focus path/to/focus] [--config path/to/scan-react-css.json] [--json] [--output-min-severity warning] [--print-config on] [--output-file ./reports/scan-react-css.json] [--overwrite-output] [--verbosity medium]
```

### Supported flags

- `--config path/to/scan-react-css.json`
- `--focus path/to/focus`
- `--json`
- `--output-min-severity debug|info|warning|error`
- `--print-config on|off`
- `--output-file path/to/report.json`
- `--overwrite-output`
- `--verbosity low|medium|high`

### CLI behavior

- If `targetPath` is omitted, the scanner uses the current working directory as the project root.
- If `source.include` is omitted, built-in defaults auto-discover React source roots by scanning the project root and nested package roots for React-bearing `package.json` files plus common source directories such as `src`, `app`, and `client/src`.
- If auto-discovery finds no React source roots, the scan fails with a fatal error instead of silently scanning nothing.
- If source resolution succeeds but produces no scanable project files, the scan fails with a fatal error instead of reporting a successful empty scan.
- If `--focus` is provided, the scanner still indexes the full project but only emits findings that touch the focused path.
- If `--config` is provided, it overrides discovery.
- If `--json` is provided, the scanner emits machine-readable JSON.
- Without `--json`, the scanner emits human-readable terminal output.
- `--output-file` requires `--json`.
- `--output-min-severity` filters both human-readable and JSON output.
- If `--output-min-severity` is omitted, the scanner uses `config.output.minSeverity`.
- `--print-config on` includes the full resolved config in either output mode.
- `--print-config off` omits config from either output mode and is the default.
- If `--output-file` points to an existing file and `--overwrite-output` is not set, the CLI writes to the first available suffixed filename such as `report-1.json`.
- If `--overwrite-output` is provided, the CLI may overwrite the destination file.
- `--verbosity` controls how much human-readable detail is printed.

## Node API contract

Current package exports include:

- `scan`
- `scanReactCss`

Current shape:

```ts
type ScanInput = {
  targetPath?: string;
  focusPath?: string;
  configPath?: string;
  config?: RawScanReactCssConfig;
  cwd?: string;
  outputMinSeverity?: FindingSeverity;
};

type ScanResult = {
  config: ResolvedScanReactCssConfig;
  configSource: ResolvedConfigSource;
  operationalWarnings: string[];
  findings: Finding[];
  summary: ScanSummary;
};
```

## Finding contract

Core finding shape:

```ts
type Finding = {
  ruleId: string;
  family: string;
  severity: "debug" | "info" | "warning" | "error";
  confidence: "low" | "medium" | "high";
  message: string;
  primaryLocation?: FindingLocation;
  relatedLocations: FindingLocation[];
  subject?: FindingSubject;
  metadata: Record<string, unknown>;
};
```

Location shape:

```ts
type FindingLocation = {
  filePath: string;
  line?: number;
  column?: number;
  context?: string;
};
```

Subject shape:

```ts
type FindingSubject = {
  className?: string;
  cssFilePath?: string;
  sourceFilePath?: string;
};
```

## Severity and confidence

Finding severity:

- `debug`
- `info`
- `warning`
- `error`

Config-only severity:

- `off`

Confidence:

- `low`
- `medium`
- `high`

Severity and confidence are separate.

## Exit-code contract

- `0` when no configured policy threshold is breached
- non-zero when configured policy thresholds are breached
- non-zero for operational failures such as invalid config, invalid CLI arguments, unreadable explicit paths, or fatal runtime errors

With default config, `error` findings fail the scan. `warning` and `info` do not.

Output filtering does not change policy evaluation.

## Human-readable output contract

The human-readable output includes:

- scan target
- optional focus path
- config source used
- findings in a stable order
- summary counts in a footer

Human-readable findings are grouped by the directory of the primary finding location.

Within each directory block, findings are ordered by:

1. severity
2. display file path
3. line number
4. rule ID

Human-readable verbosity levels:

- `low`
- `medium`
- `high`

Verbosity behavior:

- `low` prints one compact row per finding with severity, rule ID, location, and subject
- `medium` prints grouped finding blocks with severity, rule ID, location, and the full message
- `high` prints grouped investigation-friendly blocks and includes confidence, related locations, and metadata

Confidence is omitted from `low` and `medium` output and rendered explicitly in `high` output.

Finding locations are shortened for readability:

- use the basename when it is unique among displayed finding locations
- otherwise use the shortest disambiguating relative suffix

Human-readable output may use ANSI colors for severity labels when writing to a TTY and `NO_COLOR` is not set.

## JSON output contract

JSON output is deterministic and structured.

`--output-min-severity` affects both human-readable and JSON output.
If omitted, both output modes default to `config.output.minSeverity`.
`--print-config on` includes the full resolved config in either output mode.
By default, config is omitted in both output modes.

When present, `operationalWarnings` are also included in JSON output.

## Determinism contract

For the same file tree, config, and CLI options, the scanner should produce:

- the same findings
- the same summary
- the same exit-code behavior
- stable output ordering

Auto-discovery is part of this contract: for the same project tree and config, the resolved source roots should be stable.

## Operational warnings

Warnings that are not findings should be used sparingly.

The main expected operational warning is:

- no config file discovered, built-in defaults used

## External CSS behavior

- Imported external CSS from source files is modeled when it is discoverable from the project import graph.
- HTML files under the scan root are inspected for stylesheet links.
- In the default `declared-globals` mode, matching HTML-linked provider presets such as Font Awesome can satisfy known external class families without network fetches.
- In `fetch-remote` mode, remote HTML-linked stylesheet URLs are fetched directly for the current scan and failures degrade to operational warnings plus fallback external-css behavior.
