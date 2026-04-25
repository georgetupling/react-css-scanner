# Reboot Contract

## Purpose

This document resets the project around a simpler shape:

- `src/static-analysis-engine` becomes the analysis core.
- A new product shell is rebuilt around it for filesystem loading, config, reporting, CLI behavior, and publishing.
- Rules should consume normalized analysis data directly instead of rebuilding indexes, reachability tables, or ad hoc match state inside each rule.

The main design goal is to stop the project from drifting into repeated refactors where every rule has to rediscover facts that the analysis already knows.

## Layering

The reboot should enforce four layers.

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
- analyze class references
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
  configPath?: string;
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
`StaticAnalysisEngineResult`.

This first slice intentionally covers the rule-facing contract that current stages can support:

- source files, stylesheets, components, render subtrees, class references, class definitions, and selector queries
- module imports, component render edges, stylesheet reachability, class-reference matches, selector matches, and declared-provider class satisfactions
- deterministic indexes for class names, source files, stylesheets, reachability, selector queries, and matches

It does not yet claim full CSS Module binding semantics, ownership classification, or a complete external CSS ingestion contract.

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
  selectorQueries: SelectorQueryAnalysis[];
  components: ComponentAnalysis[];
  renderSubtrees: RenderSubtreeAnalysis[];
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
  cssModuleBindings: CssModuleBindingRelation[];
};
```

Critical requirement:

- The analysis layer should emit direct `referenceMatches` and `selectorMatches`.
- Rules should not have to rebuild reachability maps, definition sets, or candidate match groups.

### Indexes

These exist specifically to keep rules thin and deterministic.

```ts
type ProjectAnalysisIndexes = {
  definitionsByClassName: Map<string, string[]>;
  referencesByClassName: Map<string, string[]>;
  referencesBySourceFileId: Map<string, string[]>;
  reachableStylesheetsBySourceFileId: Map<string, string[]>;
  reachableStylesheetsByComponentId: Map<string, string[]>;
  selectorQueriesByStylesheetId: Map<string, string[]>;
  matchesByReferenceId: Map<string, string[]>;
  selectorMatchesByQueryId: Map<string, string[]>;
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
  location: SourceLocation;
  origin: "jsx-className" | "helper-call" | "css-module-member" | "unknown";
  expressionKind: "exact-string" | "string-set" | "dynamic" | "unsupported";
  rawExpressionText: string;
  definiteClassNames: string[];
  possibleClassNames: string[];
  unknownDynamic: boolean;
  confidence: Confidence;
  traces: AnalysisTrace[];
};
```

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
- raw `ProjectAnalysis` is not part of the public result contract
- debug information should be surfaced through diagnostics, traces, and stable summary fields rather than by dumping engine internals
- JSON output should be human-readable, deterministic, and close to the public result shape

The first reboot shell exposes a narrower interim contract:

```ts
type ScanProjectInput = {
  rootDir?: string;
  sourceFilePaths?: string[];
  cssFilePaths?: string[];
  configPath?: string;
};

type ScanProjectResult = {
  rootDir: string;
  config: ResolvedScannerConfig;
  diagnostics: ScanDiagnostic[];
  findings: Finding[];
  summary: ScanSummary;
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
    | "module-graph"
    | "symbol-resolution"
    | "render-ir"
    | "selector-analysis"
    | "rule-evaluation"
    | "output";
};
```

This separation matters because unsupported or budget-limited analysis should not always become user-facing rule findings.

Unsupported analysis should normally be emitted as `debug` diagnostics. A rule may still produce a
user-facing finding when uncertainty itself is the subject of that rule, but the default product
behavior should keep bounded-analysis detail out of normal finding lists.

CLI text output should hide `debug` diagnostics by default. CLI JSON may include debug diagnostics
when debug output is explicitly requested, but it should still avoid raw analysis snapshots.

## Minimal Config Contract

The first stable reboot config should stay intentionally small.

```ts
type ScanConfig = {
  failOnSeverity?: "debug" | "info" | "warn" | "error";
  rules?: Record<RuleId, RuleSeverity | "off">;
};
```

Design rules:

- config format is JSON
- no config merging
- default rule severities come from `docs/design/rules-catalogue.md` and the rule catalogue code
- rule ids follow the reboot catalogue; old scanner rule ids are not part of the clean contract
- missing config should resolve to built-in defaults
- unsupported or unknown config keys should produce diagnostics rather than silently changing behavior

Additional include/exclude behavior, external provider declarations, CSS Module conventions, and
ownership conventions can be added once the public result shape and CLI output are stable.

## CLI JSON Contract

CLI JSON should be deterministic and readable by a person reviewing CI output.

The JSON object should contain:

- `rootDir`
- `config`
- `diagnostics`
- `findings`
- `summary`
- `failed`

It should not contain:

- raw `ProjectAnalysis`
- engine intermediate stages
- compatibility fields for the deleted scanner
- old rule id aliases

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

## Safe Trims For The Reboot

The following should be treated as optional until the new contract is stable. The first two have already been removed from `src/static-analysis-engine`:

- current-scanner comparison mode
- current-scanner migration adapters
- public `experimental` naming
- shadow or baseline reporting
- PATH-based config discovery
- `SCAN_REACT_CSS_CONFIG_DIR`
- `print-config`
- multiple verbosity tiers
- remote external CSS fetching
- advanced output-file suffix behavior
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

The reboot is on track when:

- rules are mostly short and read from normalized analysis data
- analysis owns the expensive grouping and matching logic
- the product shell no longer depends on deleted legacy code
- the package has one stable Node API, `scanProject()`, and one deterministic CLI JSON contract
- the engine can evolve without leaking comparison or migration scaffolding into the main surface
