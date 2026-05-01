# Product Contract

## Purpose

This document resets the project around a simpler shape:

- `src/static-analysis-engine` becomes the analysis core.
- A new product shell is rebuilt around it for filesystem loading, config, reporting, CLI behavior, and publishing.
- Rules should consume normalized analysis data directly instead of rebuilding indexes, reachability tables, or ad hoc match state inside each rule.

The main design goal is to stop the project from drifting into repeated refactors where every rule has to rediscover facts that the analysis already knows.

## Layering

The product should enforce four layers.

### 1. Project loading

Responsibilities:

- discover files
- read source, CSS, and HTML inputs
- resolve config and defaults
- normalize scan root and target paths
- collect operational diagnostics

This layer should live outside the engine.

### 2. Engine analysis

Responsibilities:

- parse source files
- build module and symbol relationships
- build render IR and render graph
- analyze CSS selectors and definitions
- analyze stylesheet reachability
- analyze CSS Module imports and member references
- analyze selected usage-only runtime DOM class references
- analyze class references
- analyze class ownership evidence from imports, consumers, and path conventions
- build direct reference-to-definition and selector-to-context evidence
- expose stable indexes over the analyzed project

This layer should produce a normalized `ProjectAnalysis` object.

### 3. Rule evaluation

Responsibilities:

- read `ProjectAnalysis`
- emit deterministic findings
- avoid recomputing project-wide indexes or matching state

Rules should be thin. If a rule needs a project-wide map, that map probably belongs in the analysis layer.

### 4. Product reporting

Responsibilities:

- collate findings
- build summaries
- filter visible output
- format text and JSON
- decide exit codes

This layer should also live outside the engine.

## Contract Overview

The internal contract should center on `ProjectAnalysis`, not on `Finding`.

`Finding` is a presentation artifact built from analysis. The project should avoid using the finding shape as the main interchange format between stages.

## Public API

The package should expose one stable public entry point.

```ts
type ScanProjectInput = {
  rootDir?: string;
  sourceFilePaths?: string[];
  cssFilePaths?: string[];
  htmlFilePaths?: string[];
  configPath?: string;
  configBaseDir?: string;
  onProgress?: (event: ScanProgressEvent) => void;
  collectPerformance?: boolean;
};

async function scanProject(input?: ScanProjectInput): Promise<ScanProjectResult>;
```

Recommended intent:

- `scanProject()` is the product API that loads a real project from disk, runs analysis and rules, and returns user-facing results.
- engine-facing APIs may exist internally, but they are not part of the stable package contract
- raw analysis is not exposed through public JSON output

`rootDir` drives default discovery. Explicit `sourceFilePaths` or `cssFilePaths` replace default
discovery for that file kind; they are not additive include lists. This keeps targeted tests and
programmatic scans deterministic while preserving a simple project-scan default.

`configBaseDir` controls explicit `configPath` resolution and default `scan-react-css.json`
discovery for the Node API. If omitted, it defaults to `rootDir`. The CLI passes the command
directory as `configBaseDir`, so users can scan nested roots while keeping config in the directory
where they invoked `scan-react-css`.

`onProgress` receives stage lifecycle events with `{ stage, status, message, durationMs? }`.
These events are advisory user feedback only; they must not affect scan results. When
`collectPerformance` is true, `scanProject()` includes an optional `performance` block with total
and per-stage durations. Performance timings are intentionally opt-in because they are
environment-dependent.

The root package export should not expose `analyzeProject`, discovery helpers, rule runners, config
loaders, or raw analysis types as part of the stable product API.

## Internal Engine Result

The static-analysis-engine should continue to expose analysis to internal product code.
That engine-facing result is not the public Node API.

Internal diagnostics are operational or analysis diagnostics, not rule findings.
Examples include:

- source file could not be parsed
- module resolution was unsupported
- selector analysis hit a budget limit
- HTML stylesheet discovery was skipped

## ProjectAnalysis

`ProjectAnalysis` should be the single normalized object that rules consume.

An initial implementation now exists under `src/static-analysis-engine/pipeline/project-analysis`.
It is a final projection stage over the existing pipeline outputs and is the only data exposed by
`StaticAnalysisEngineResult`. Feature-specific extraction should happen before this projection when
it needs raw syntax or stage-specific context. For example, CSS Module import and member-reference
extraction lives in `cssModuleAnalysisStage` and `pipeline/css-modules`, and usage-only runtime DOM
class extraction lives in `languageFrontendsStage` under `pipeline/language-frontends/source/runtime-dom-syntax`; `ProjectAnalysis` indexes
those records for rules instead of walking parsed source text itself.

This first slice intentionally covers the rule-facing contract that current stages can support:

- source files, stylesheets, components, render subtrees, class references, class definitions, selector context classes, and selector queries
- selector branches for branch-level selector-list findings
- class ownership records with consumer summaries and owner candidates
- module imports, component render edges, stylesheet reachability, class-reference matches, selector matches, and declared-provider class satisfactions
- deterministic indexes for class names, source files, stylesheets, reachability, selector queries, matches, and ownership lookups

It does not yet claim full CSS Module binding semantics, fixed ownership classification, or a complete external CSS ingestion contract.

The current CSS Module contract is defined in `docs/design/css-modules-contract.md`. In brief, the
current slice supports relative CSS Module imports, static member reads such as `styles.root` and
`styles["root"]`, member-to-class-definition match relations, missing module member findings,
unused module class findings, computed member diagnostics, and `localsConvention` matching for
`asIs`, `camelCase`, and `camelCaseOnly`. It also supports simple same-file destructured member
bindings such as `const { root, button: buttonClass } = styles` and simple same-file aliases such
as `const s = styles; s.root`. It does not yet claim `composes`, generic class-reference projection,
or re-exported CSS Module semantics.

Rule execution now lives outside the static-analysis engine in `src/rules`.
The engine entry points return analysis only; rule runners should be invoked as a layer above
`ProjectAnalysis`. Rule code should not consume intermediate engine stages directly.

Low-level CSS fact shapes live in `src/static-analysis-engine/types/css.ts`.
CSS text parsing lives in `src/static-analysis-engine/libraries/css-parsing`, and selector parsing
or selector fact projection lives in `src/static-analysis-engine/libraries/selector-parsing`.

```ts
type ProjectAnalysis = {
  meta: ProjectAnalysisMeta;
  inputs: ProjectAnalysisInputs;
  entities: ProjectAnalysisEntities;
  relations: ProjectAnalysisRelations;
  indexes: ProjectAnalysisIndexes;
};
```

### Meta

```ts
type ProjectAnalysisMeta = {
  rootDir: string;
  sourceFileCount: number;
  cssFileCount: number;
  htmlFileCount: number;
  engineVersion: string;
  analysisBudgets: Record<string, number>;
};
```

### Inputs

These are the normalized inputs that actually entered the engine.

```ts
type ProjectAnalysisInputs = {
  sourceFiles: SourceFileRecord[];
  cssFiles: CssFileRecord[];
  htmlFiles: HtmlFileRecord[];
  externalCss: ExternalCssInputRecord;
};
```

### Entities

These are first-class analyzed records, not presentation-layer summaries.

```ts
type ProjectAnalysisEntities = {
  sourceFiles: SourceFileAnalysis[];
  stylesheets: StylesheetAnalysis[];
  classReferences: ClassReferenceAnalysis[];
  classDefinitions: ClassDefinitionAnalysis[];
  classContexts: ClassContextAnalysis[];
  selectorQueries: SelectorQueryAnalysis[];
  selectorBranches: SelectorBranchAnalysis[];
  cssModuleImports: CssModuleImportAnalysis[];
  cssModuleMemberReferences: CssModuleMemberReferenceAnalysis[];
  cssModuleReferenceDiagnostics: CssModuleReferenceDiagnosticAnalysis[];
  components: ComponentAnalysis[];
  renderSubtrees: RenderSubtreeAnalysis[];
  classOwnership: ClassOwnershipAnalysis[];
};
```

Recommended design points:

- Every entity should have a stable id.
- Entities should carry location once, then be referenced by id elsewhere.
- A rule should usually be able to find its subject by traversing ids and indexes, not by reparsing strings.

### Relations

These are the core edges rules repeatedly need.

```ts
type ProjectAnalysisRelations = {
  moduleImports: ModuleImportRelation[];
  componentRenders: ComponentRenderRelation[];
  stylesheetReachability: StylesheetReachabilityRelation[];
  referenceMatches: ClassReferenceMatchRelation[];
  selectorMatches: SelectorMatchRelation[];
  cssModuleMemberMatches: CssModuleMemberMatchRelation[];
};
```

Critical requirement:

- The analysis layer should emit direct `referenceMatches` and `selectorMatches`.
- Rules should not have to rebuild reachability maps, definition sets, or candidate match groups.
- Reference matches should carry the matched `className`, whether the token came from a definite or
  possible reference, reachability, match kind, reasons, and traces.
- Declared external-provider satisfactions should be represented as explicit relations and indexed
  by reference and class name.
- A serializable debug snapshot should be produced through an explicit serializer rather than by
  relying on `JSON.stringify()` to understand in-memory `Map` indexes.

### Indexes

These exist specifically to keep rules thin and deterministic.

```ts
type ProjectAnalysisIndexes = {
  definitionsByClassName: Map<string, string[]>;
  contextsByClassName: Map<string, string[]>;
  referencesByClassName: Map<string, string[]>;
  referencesBySourceFileId: Map<string, string[]>;
  reachableStylesheetsBySourceFileId: Map<string, string[]>;
  reachableStylesheetsByComponentId: Map<string, string[]>;
  selectorQueriesByStylesheetId: Map<string, string[]>;
  contextsByStylesheetId: Map<string, string[]>;
  matchesByReferenceId: Map<string, string[]>;
  selectorMatchesByQueryId: Map<string, string[]>;
  classOwnershipByClassDefinitionId: Map<string, string>;
  classOwnershipByStylesheetId: Map<string, string[]>;
  classOwnershipByOwnerComponentId: Map<string, string[]>;
  classOwnershipByConsumerComponentId: Map<string, string[]>;
};
```

The exact structure can change, but the rule should be:

- expensive grouping belongs here
- domain records belong in `entities`
- edges belong in `relations`

## Analysis Records That Should Exist Explicitly

The following records should become first-class parts of the analysis model.

### ClassReferenceAnalysis

```ts
type ClassReferenceAnalysis = {
  id: string;
  sourceFileId: string;
  componentId?: string;
  suppliedByComponentId?: string;
  emittedByComponentId?: string;
  classNameComponentIds?: Record<string, string>;
  location: SourceLocation;
  origin: "render-ir" | "runtime-dom" | "unknown";
  expressionKind: "exact-string" | "string-set" | "dynamic" | "unsupported";
  rawExpressionText: string;
  definiteClassNames: string[];
  possibleClassNames: string[];
  unknownDynamic: boolean;
  confidence: Confidence;
  traces: AnalysisTrace[];
};
```

`componentId` identifies the component that supplied/authored the class expression for ownership
rules. When a parent render tree expands a child component, class references from the child's
implementation are supplied by and emitted by the child component, while placement and render-subtree
fields preserve the parent render context. When a caller passes a class string into a primitive
component, `componentId` and `suppliedByComponentId` point at the caller that authored the class
expression, while `emittedByComponentId` points at the primitive whose intrinsic DOM applies it.
When one emitted `className` expression combines local primitive classes with caller-supplied
classes, `classNameComponentIds` records per-token supplier ownership.
Selector and render matching continue to use render placement/emission context rather than
architectural ownership attribution.

`runtime-dom` references come from recognized non-JSX DOM APIs. The current adapter recognizes static
ProseMirror `EditorView` `attributes.class` / `attributes.className` strings as usage evidence. These
references participate in class-definition matching and unused-class suppression, but they do not
claim render IR placement or selector layout context.
When `EditorView` is proven to come from `prosemirror-view`, the runtime reference may carry
`runtimeLibraryHint` metadata. That metadata is explanatory only: JavaScript imports do not satisfy
CSS classes, while imported package CSS and linked stylesheets remain normal CSS evidence.

### ClassDefinitionAnalysis

```ts
type ClassDefinitionAnalysis = {
  id: string;
  stylesheetId: string;
  className: string;
  selectorText: string;
  selectorKind: "simple-root" | "compound" | "contextual" | "complex" | "unsupported";
  line: number;
  atRuleContext: AtRuleContextEntry[];
  declarationProperties: string[];
  declarationSignature: string;
  isCssModule: boolean;
};
```

### StylesheetAnalysis

```ts
type StylesheetAnalysis = {
  id: string;
  filePath: string;
  origin: "project-css" | "css-module" | "external-import" | "html-linked-remote";
  moduleKind: "local" | "external";
  definitions: string[];
  selectors: string[];
};
```

### ClassReferenceMatchRelation

```ts
type ClassReferenceMatchRelation = {
  referenceId: string;
  definitionId: string;
  reachability: "definite" | "possible";
  matchKind: "local-css" | "css-module" | "external-css" | "provider-declared";
  reasons: string[];
};
```

This relation is the most important missing contract. It lets rules ask obvious questions directly:

- does this reference have any reachable definitions?
- which reachable definitions are only possible?
- which stylesheet is backing this token?
- is this coming from a CSS Module or external provider?

## Finding Contract

Findings should be simple and stable.

```ts
type Finding = {
  id: string;
  ruleId: RuleId;
  severity: Severity;
  confidence: Confidence;
  summary: string;
  primaryLocation?: SourceLocation;
  relatedLocations: SourceLocation[];
  subject: AnalysisEntityRef;
  evidence: AnalysisEntityRef[];
  traces: AnalysisTrace[];
  data?: Record<string, unknown>;
};
```

### AnalysisEntityRef

```ts
type AnalysisEntityRef =
  | { kind: "source-file"; id: string }
  | { kind: "component"; id: string }
  | { kind: "stylesheet"; id: string }
  | { kind: "class-reference"; id: string }
  | { kind: "class-definition"; id: string }
  | { kind: "selector-query"; id: string };
```

Design rules:

- `summary` should be human-readable and stable.
- `subject` should identify what the finding is about.
- `evidence` should point to already-analyzed records.
- `traces` should preserve the reasoning path used to produce the finding.
- `data` is optional extra structured material for JSON output.

This keeps findings expressive without turning them into a second analysis model.

## ScanProjectResult

```ts
type ScanProjectResult = {
  meta: {
    rootDir: string;
    durationMs: number;
    toolVersion: string;
    configSource: ConfigSource;
  };
  config: ResolvedScanConfig;
  diagnostics: ScanDiagnostic[];
  findings: Finding[];
  summary: ScanSummary;
};
```

Recommended intent:

- `findings` is always present.
- `summary` is derived from findings and diagnostics, not vice versa.
- `summary.findingsByRule` and `summary.findingsBySeverity` expose separate deterministic count
  matrices for tooling and trend reports.
- raw `ProjectAnalysis` is not part of the public result contract
- debug information should be surfaced through diagnostics, traces, and stable summary fields rather than by dumping engine internals
- JSON output should be human-readable, deterministic, and close to the public result shape

The first product shell exposes a narrower interim contract:

```ts
type ScanProjectInput = {
  rootDir?: string;
  sourceFilePaths?: string[];
  cssFilePaths?: string[];
  htmlFilePaths?: string[];
  configPath?: string;
  configBaseDir?: string;
  onProgress?: (event: ScanProgressEvent) => void;
  collectPerformance?: boolean;
};

type ScanProjectResult = {
  rootDir: string;
  config: ResolvedScannerConfig;
  diagnostics: ScanDiagnostic[];
  findings: Finding[];
  summary: ScanSummary;
  performance?: ScanPerformance;
  failed: boolean;
  files: {
    sourceFiles: ProjectFileRecord[];
    cssFiles: ProjectFileRecord[];
  };
};
```

The implementation uses raw analysis internally to run rules and build summary counts, but it does
not include `analysis` in the public `ScanProjectResult`.

## Diagnostics

Diagnostics are not findings.

```ts
type ScanDiagnostic = {
  code: string;
  severity: "debug" | "info" | "warning" | "error";
  message: string;
  location?: SourceLocation;
  phase:
    | "config"
    | "discovery"
    | "loading"
    | "parse"
    | "symbol-resolution"
    | "render-ir"
    | "selector-analysis"
    | "rule-evaluation"
    | "output";
};
```

This separation matters because unsupported or budget-limited analysis should not always become user-facing rule findings.

Unsupported analysis and unresolved dynamic class expressions should normally be emitted as `debug`
diagnostics or findings. A rule may still produce a user-facing finding when uncertainty itself is
the subject of that rule, but the default product behavior should keep bounded-analysis detail out
of normal finding lists unless a project raises the rule severity.

CLI text and JSON output hide `debug` diagnostics and findings by default through the
`--output-min-severity info` threshold. Users may lower the reporting threshold to `debug` to inspect
scanner-internal uncertainty findings without changing `failOnSeverity` or the scan failure state.

## Focused CLI Output

`--focus` is a reporting filter, not a scan-root shortcut. The CLI must still discover and analyze
the full `rootDir` project so imports, global CSS, external stylesheets, render relationships, and
reachability context remain available to rules.

Focused output semantics:

- `--focus path-or-glob` may be provided more than once.
- A single `--focus` value may contain comma-separated paths or globs.
- Non-glob values match the exact file or directory subtree.
- File focus values may include a pasted `:line` or `:line:column` suffix from CLI output.
- Glob values use project-relative `/` paths and support `*`, `?`, and `**`.
- CLI `findings` are filtered to findings whose primary location, subject/evidence path, or trace
  anchor is inside one of the focus paths.
- Source file, CSS file, class reference, class definition, and selector query counts continue to
  describe the full project context.
- Finding counts and finding severity counts describe the visible focused findings.
- Error diagnostics are not hidden by focus and still affect `failed`.
- The CLI exit code follows the focused `failed` value, so findings outside focus do not fail a
  focused run.

## Explicit Ignores

Ignores are post-rule suppression, not analysis evidence. They hide findings that are known and
accepted by the project, but they must not create class definitions, declared-provider matches,
selector context, stylesheet reachability, or ownership evidence.

Ignore semantics:

- config supports top-level `ignore.classNames` and `ignore.filePaths` arrays
- CLI supports repeatable `--ignore-class class-or-glob` and `--ignore-path path-or-glob`
- CLI ignore entries are additive with config ignore entries
- class ignores match individual CSS class tokens with glob-like `*`, `?`, and `**` support
- path ignores match project-relative `/` file paths involved in a finding
- ignores are applied after rule evaluation and before output/failure calculation
- ignored findings do not contribute to `failed`
- summaries include `ignoredFindingCount`

## Minimal Config Contract

The first stable config should stay intentionally small.

```ts
type ScanConfig = {
  failOnSeverity?: "debug" | "info" | "warn" | "error";
  rules?: Record<RuleId, RuleSeverity | "off">;
  cssModules?: {
    localsConvention?: "asIs" | "camelCase" | "camelCaseOnly";
  };
  externalCss?: {
    fetchRemote?: boolean;
    globals?: Array<{
      provider: string;
      match: string[];
      classPrefixes: string[];
      classNames: string[];
    }>;
    remoteTimeoutMs?: number;
  };
  ownership?: {
    sharedCss?: string[];
  };
  ignore?: {
    classNames?: string[];
    filePaths?: string[];
  };
};
```

Design rules:

- config format is JSON
- no config merging
- CLI config discovery checks the command directory before env and PATH fallbacks
- API config discovery uses `configBaseDir`, defaulting to `rootDir`
- CSS Module `localsConvention` defaults to `camelCase`
- local package CSS imports and local HTML-linked stylesheets are loaded by default because they are
  deterministic project inputs
- `externalCss` defaults to `fetchRemote: false`, plus built-in provider declarations for Font
  Awesome, Material Design Icons, Bootstrap Icons, Animate.css, UIkit, and Pure.css
- `externalCss.fetchRemote` is the only option that permits network requests
- user-supplied `externalCss.globals` entries append to built-in providers
- declared-provider matching and static HTML stylesheet-link ingestion are active; matching
  HTML/CDN links can satisfy configured provider classes without an HTTP fetch
- local `.css` files linked from HTML are loaded, parsed, and treated as project-wide reachable;
  provider-matched linked CSS is classified as external, while ordinary local linked CSS remains
  project CSS
- local HTML module scripts identify app entry source files; CSS imported by those entry source
  files and transitive local CSS `@import` dependencies are treated as project-wide reachable only
  inside the nearest app boundary inferred from the HTML file and script path
- JavaScript and TypeScript package CSS imports are resolved under `node_modules`, loaded, parsed,
  classified as external imports, and treated as reachable from the importing source file
- package CSS resolution searches upward from the importing file for usable `node_modules`
  directories, falling back to the nearest package root for deterministic missing-file diagnostics
- package CSS imports do not activate declared providers; provider declarations are an alternative to
  fetching externally linked stylesheets such as CDNs, not a substitute for parsed package CSS
- CSS `@import` package entries are resolved under `node_modules`, loaded, parsed, classified as
  external imports, and treated as reachable through the importing stylesheet
- local CSS `@import` entries are treated as project CSS and inherit reachability from the importing
  stylesheet
- remote HTML stylesheet links are fetched only when `externalCss.fetchRemote` is `true`; fetched CSS is
  parsed into concrete class definitions, uses `remoteTimeoutMs`, is treated as project-wide
  external CSS, and fetch failures emit warning diagnostics
- ownership-style rules apply stylesheet intent in this order: strong private component owner
  evidence, then configured `ownership.sharedCss` patterns, then built-in broad/shared stylesheet
  conventions, then relational ownership evidence
- `style-used-outside-owner` is a conservative private-owner warning: same-directory owner-family
  consumers, generic state tokens, and scoped primitive overrides are not treated as leaks
- ownership-style findings consolidate repeated selector/media definition evidence and expose
  aggregate counts and definition locations in finding data
- `ownership.sharedCss` is an array of project-relative stylesheet path/glob patterns that extends
  built-in broad/shared stylesheet conventions for ownership rules
- default source discovery excludes common test-only source files and directories before analysis,
  including `**/test/**`, `**/tests/**`, `**/__tests__/**`, `**/*.test.*`, and `**/*.spec.*`
- `discovery.sourceRoots` contains exact project-relative source directories; when set, default
  source discovery is limited to those directories
- `discovery.exclude` contains project-relative source globs appended to the built-in test-source
  exclusions
- explicit API `sourceFilePaths` are exact overrides and are not filtered by discovery exclusions
- `ignore.classNames` and `ignore.filePaths` are arrays of non-empty suppression patterns, not CSS
  evidence declarations
- default rule severities come from `docs/design/rules-catalogue.md` and the rule catalogue code
- rule ids follow the rule catalogue; old scanner rule ids are not part of the clean contract
- missing config should resolve to built-in defaults
- unsupported or unknown config keys should produce error diagnostics rather than silently changing behavior
- unknown rule IDs should produce error diagnostics rather than being ignored

Additional include/exclude behavior for CSS and HTML discovery can be added once the source
discovery contract settles.

## CLI JSON Contract

CLI JSON should be deterministic and readable by a person reviewing CI output.

`--json` writes a report file instead of printing the JSON payload to stdout.

Output path behavior:

- default path is a timestamped `scan-react-css-reports/report-YYYY-MM-DD-HH-mm-ss.json` file in
  the current working directory
- `--output-file <path>` selects a custom report path and requires `--json`
- existing report files are preserved by writing the next suffixed path, such as
  `report-YYYY-MM-DD-HH-mm-ss-1.json`, unless `--overwrite-output` is supplied
- `--overwrite-output` replaces the selected output path and requires `--json`
- stdout contains only a short human-readable confirmation and final failure status
- the CLI exit code still follows the scan failure state after the report is written
- JSON mode does not print progress updates
- `--output-min-severity` filters reported diagnostics, findings, and report summary counts without
  changing scan analysis or failure status
- JSON report summaries include separate `findingsByRule` and `findingsBySeverity` count matrices
- `ignoredFindingCount` is retained in the summary after output severity filtering
- `--timings` adds the optional `performance` block to JSON output

The JSON object written to disk should contain:

- `rootDir`
- `config`
- `diagnostics`
- `findings`
- `summary`
- optional `performance`, only when timings are requested
- `failed`

It should not contain:

- raw `ProjectAnalysis`
- engine intermediate stages
- compatibility fields for the deleted scanner
- old rule id aliases

## CLI Text Contract

Human-readable output is optimized for local inspection.

Text output should:

- group findings by primary location file
- separate file sections with blank lines
- print finding locations as `path/to/file:line` targets that common terminals and VS Code can open
- sort findings within a file by severity, line, rule id, and message
- apply `--output-min-severity` to reported diagnostics and findings
- support text-only `--verbosity low|medium|high`; `medium` is the default grouped output, `low`
  prints compact finding rows, and `high` prints per-finding blocks with confidence, subject,
  selected structured details, and evidence
- warn that `--verbosity` has no effect when JSON output is requested
- put the summary at the end
- color severity labels in interactive terminals
- suppress color when stdout is not a TTY or `NO_COLOR` is set
- print active scan progress to `stderr` for interactive terminals
- include a timings section only when `--timings` is supplied
- omit trace details from CLI output

## Rebuild Scope Around The Core

The following deleted product capabilities need to be rebuilt outside the engine:

- package entrypoint
- CLI entrypoint
- config loading and validation
- project file discovery
- source, CSS, and HTML file loading
- HTML stylesheet-link extraction
- rule registry and rule enablement config
- summary building
- JSON formatter
- text formatter
- exit-code policy
- tests
- user docs

## Safe Trims For The Product

The following should be treated as optional until the new contract is stable. The first two have already been removed from `src/static-analysis-engine`:

- current-scanner comparison mode
- current-scanner migration adapters
- public `experimental` naming
- shadow or baseline reporting
- PATH-based config discovery
- `SCAN_REACT_CSS_CONFIG_DIR`
- `print-config`
- remote external CSS fetching
- ownership-style rules
- public raw-analysis JSON output
- old scanner rule id compatibility aliases

## Recommended Implementation Order

1. Define `ProjectAnalysis`, `Finding`, `ScanDiagnostic`, and `ScanProjectResult`.
2. Keep `scanProject()` as the only stable package API and remove the root `analyzeProject` export.
3. Keep engine analysis available to product internals without exposing raw analysis in CLI JSON.
4. Rebuild rules to consume the normalized analysis graph.
5. Add summary building and deterministic JSON/text output.
6. Reintroduce CLI exit-code behavior and tests.

## Success Criteria

The product is on track when:

- rules are mostly short and read from normalized analysis data
- analysis owns the expensive grouping and matching logic
- the product shell no longer depends on deleted legacy code
- the package has one stable Node API, `scanProject()`, and one deterministic CLI JSON contract
- the engine can evolve without leaking comparison or migration scaffolding into the main surface
