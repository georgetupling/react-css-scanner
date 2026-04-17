# Architecture Design

## Purpose

This document describes a proposed architecture for `react-css-scanner` as a standalone React/CSS analysis tool.

The goal is to support:

- a CLI and Node API on top of the same analysis engine
- configurable rules and policies
- CSS/runtime reachability analysis

## Architectural principles

- Build once, query many times.
- Separate parsing from reasoning.
- Keep raw facts separate from derived relationships.
- Prefer conservative analysis when certainty is low.
- Make rule execution depend on a stable project model, not on ad hoc file scanning.
- Keep the system extensible so new rules do not require redesigning the indexing pipeline.

## Recommended implementation model

The recommended model is a hybrid of:

- a graph-first project representation for relationships and reachability
- query-friendly derived indexes for efficient rule execution

In practice, this means:

1. Parse source files and CSS files into raw facts.
2. Build a normalized graph of modules, CSS resources, class definitions, and references.
3. Derive cached indexes and projections from that graph.
4. Run rules against the normalized project model and its indexes.

The graph is the source of truth for relationships.

The indexes are projections of that same source of truth for fast rule queries.

## Why this model

Pure map/index models are easy to start with, but they become awkward once rules depend on runtime reachability and ownership boundaries.

Pure graph models are expressive, but they can make rule implementation and debugging clumsy if every query requires manual traversal.

The hybrid model gives both:

- graph power for import/reachability questions
- map ergonomics for rule execution

## Top-level pipeline

The scanner should follow a staged pipeline:

1. File discovery
2. Fact extraction
3. Graph construction
4. Reachability analysis
5. Derived index construction
6. Rule execution
7. Reporting and policy enforcement

Each stage should have clearly defined inputs and outputs.

## Stage 1: File discovery

This stage identifies the files and resources the scan cares about.

### Responsibilities

- collect React/source files
- collect project CSS files
- identify candidate config files
- identify CSS imports from third-party packages
- apply include/exclude rules from config

### Notes

- MVP should support `.js`, `.jsx`, `.ts`, `.tsx`, and `.css`.
- The scanner should not eagerly scan all files in `node_modules`.
- External CSS that is actually imported by the project should be discovered, resolved, parsed, and represented.
- In other words, MVP should index imported dependency CSS, not the entire dependency tree.
- Source include/exclude patterns should be treated as repo-relative globs.

## Stage 2: Fact extraction

This stage parses each file independently and emits local facts only.

No cross-file reasoning should happen here.

### Source-file facts

For React/source files, extract facts such as:

- file path
- source imports
- CSS imports
- external CSS imports
- class references
- helper-library usage such as `classnames` and `clsx`
- CSS Module imports
- uncertainty/confidence markers for each reference

### CSS-file facts

For CSS files, extract facts such as:

- file path
- selector definitions
- class definitions
- at-rule context
- broad selector metadata
- import metadata where applicable for scanned CSS resources

For external CSS in MVP:

- parse external CSS files that are directly imported by project source files
- extract class definitions from those imported files
- tag those definitions as originating from an `external` CSS resource

MVP does not need to recursively scan unrelated dependency CSS that is never imported by the project.

### Key design rule

Facts should describe what was observed, not what it means globally.

For example:

- good fact: `source file X imports ./Button.css`
- not a fact: `Button.css is reachable by all descendants`

That second statement belongs in later stages.

## Stage 3: Graph construction

This stage resolves facts into a normalized project graph.

### Node types

The graph should include at least these conceptual node types:

- `SourceFile`
- `CssFile`
- `ExternalCssResource`
- `ClassDefinition`
- `ClassReference`

Not every node type must be a full standalone object in code, but the model should support those concepts explicitly.

### Edge types

The graph should support relationships such as:

- source file imports source file
- source file imports CSS file
- source file imports external CSS resource
- CSS file defines class
- source file references class
- CSS Module import alias points to CSS file

### Resolution responsibilities

- resolve relative imports
- normalize absolute file paths
- classify CSS resources into categories
- classify CSS ownership into explicit ownership kinds
- connect CSS Module aliases to module CSS files
- associate class references with their containing source files

## CSS ownership model

In addition to reachability, the scanner should classify CSS into explicit ownership kinds.

Suggested ownership enum:

- `component`
- `page`
- `global`
- `utility`
- `external`
- `unclassified`

### Meaning

- `component`: CSS intended to belong to a specific component or component area
- `page`: CSS intended to belong to a page or route-level area
- `global`: CSS intentionally reachable across the application
- `utility`: reusable utility-class CSS used for advisory/replacement analysis
- `external`: CSS imported from third-party packages
- `unclassified`: CSS the scanner cannot confidently place into a stronger ownership kind

### Why this matters

- Reachability alone is not enough for ownership-oriented rules.
- `unclassified` is important so the scanner does not force incorrect assumptions.
- Ownership-sensitive rules should be able to operate conservatively when CSS is `unclassified`.

## CSS reachability categories

The graph and later reachability analysis should classify CSS into:

- `local`
- `global`
- `external`

### Meaning

- `local`: CSS intended for a specific implementation/module scope
- `global`: CSS from configured global directories or configured global entrypoints
- `external`: CSS imported from third-party packages

These categories are essential for ownership rules.

## Stage 4: Reachability analysis

This stage computes which CSS resources are available to which source modules at runtime.

This is the heart of the scanner.

### Why it exists

Many important rules cannot be answered by direct import checks alone.

Examples:

- a component may rely on CSS imported by a parent entrypoint
- globally configured CSS may be valid everywhere
- external package CSS may be available without local definitions

### Reachability outputs

For each source file, derive a reachability view describing:

- reachable local CSS
- reachable global CSS
- reachable external CSS

### Suggested output type

```ts
type ReachabilityInfo = {
  localCss: Set<string>;
  globalCss: Set<string>;
  externalCss: Set<string>;
};
```

### Modeling guidance

- Direct CSS imports should be reachable from the importing module.
- Configured global CSS should be reachable everywhere.
- MVP reachability should focus on direct CSS imports, configured global CSS, imported external CSS, and optionally configured app entry files.
- When the model cannot prove reachability confidently, rules should still be able to emit lower-confidence findings.

## Stage 5: Derived indexes

This stage builds query-friendly projections from the graph and reachability results.

These are not a separate source of truth.

They are cached views over the normalized project model.

### Recommended indexes

- `sourceFileByPath`
- `cssFileByPath`
- `externalCssBySpecifier`
- `classDefinitionsByName`
- `classReferencesByName`
- `reachabilityBySourceFile`
- `cssModuleImportsBySourceFile`

### Why they matter

Rules should not need to traverse the graph manually for every simple question.

Examples:

- "Where is class `button` defined?"
- "Where is class `button` referenced?"
- "What CSS is reachable from `src/components/Button.tsx`?"
- "Is this CSS file global, local, or external?"

These should be fast lookups.

## Stage 6: Rule execution

Rules should run against the normalized project model plus derived indexes.

Rules should not re-scan source files or CSS files directly.

### Rule inputs

Each rule should have access to:

- resolved config
- project graph
- derived indexes
- reachability info
- utility helpers for locations, confidence, and finding construction

### Rule outputs

Each rule should emit findings with at least:

- rule ID
- severity
- message
- location(s)
- relevant class name, selector, or resource
- metadata
- confidence

### Confidence vs severity

These must be separate.

- `severity` describes policy importance
- `confidence` describes analysis certainty

`confidence` should use a simple enum:

- `low`
- `medium`
- `high`

A low-confidence finding can still be important.
A high-severity rule can still produce a low-confidence finding when certainty is limited.

## Stage 7: Reporting and enforcement

This stage turns findings into output and exit behavior.

### Responsibilities

- human-readable formatter
- JSON formatter
- policy-threshold evaluation
- process exit code selection

### Policy model

The scanner should support:

- threshold-based failures by severity

## Proposed core model

The exact implementation can vary, but the architecture should support a model similar to this:

```ts
type ProjectModel = {
  config: ResolvedConfig;
  graph: ProjectGraph;
  indexes: ProjectIndexes;
};
```

```ts
type ProjectIndexes = {
  sourceFileByPath: Map<string, SourceFileNode>;
  cssFileByPath: Map<string, CssFileNode>;
  externalCssBySpecifier: Map<string, ExternalCssNode>;
  classDefinitionsByName: Map<string, CssClassDefinition[]>;
  classReferencesByName: Map<string, ClassReference[]>;
  reachabilityBySourceFile: Map<string, ReachabilityInfo>;
};
```

### Suggested source-file shape

```ts
type SourceFileNode = {
  path: string;
  sourceImports: string[];
  cssImports: string[];
  externalCssImports: string[];
  cssModuleImports: Array<{
    localName: string;
    cssPath: string;
  }>;
};
```

### Suggested CSS-file shape

```ts
type CssFileNode = {
  path: string;
  category: "local" | "global" | "external";
  ownership:
    | "component"
    | "page"
    | "global"
    | "utility"
    | "external"
    | "unclassified";
  classDefinitions: CssClassDefinition[];
};
```

### Suggested external CSS shape

```ts
type ExternalCssNode = {
  specifier: string;
  importedBy: string[];
};
```

### Suggested class-reference shape

```ts
type ClassReference = {
  className: string;
  sourceFile: string;
  kind:
    | "static"
    | "dynamic"
    | "helper-call"
    | "css-module-property"
    | "css-module-dynamic-property";
  confidence: "high" | "medium" | "low";
  location: SourceLocation;
  metadata?: Record<string, unknown>;
};
```

## CSS Modules model

CSS Modules should be treated as a first-class reference mode, not as plain string classes.

### MVP expectations

- track CSS Module imports
- connect import aliases to module CSS files
- recognize direct property access such as `styles.button`
- degrade gracefully for dynamic property access such as `styles[variant]`

### Why this matters

Without explicit CSS Module handling, the scanner will produce false positives for missing classes and ownership.

## External CSS model

MVP should not deeply scan all CSS in `node_modules`.

Instead:

- detect external CSS imports from project source files
- resolve those imports to actual dependency CSS files
- parse those imported CSS files
- represent them as `external` CSS resources
- include them in reachability calculations
- include their class definitions in class-definition indexes

This means Bootstrap-style imports can be validated against the actual imported stylesheet without treating the whole dependency tree as scan input.

### Explicit MVP boundary

- Parse external CSS files that are directly imported by the project.
- Do not eagerly scan unrelated dependency CSS.

## Helper-library support

MVP native helper support should target:

- `classnames`
- `clsx`

Unknown helper wrappers should not be assumed equivalent unless configured or proven by later analysis features.

## Global CSS model

Global CSS should be configured explicitly.

The architecture should allow the user to declare:

- global CSS directories
- global entrypoint files

Configured global CSS should become reachable across the project without weakening local ownership rules for everything else.

## Selector complexity

The scanner is class-focused, but it must tolerate CSS beyond simple `.className` selectors.

### MVP handling

- extract class definitions where possible
- preserve selector and at-rule context
- allow broad/non-class selectors to reduce certainty where appropriate

This prevents the analysis from overclaiming confidence in complex CSS cases.

## Rule examples enabled by this architecture

This design should make the following rules straightforward to implement:

- missing CSS class definition
- unreachable CSS usage
- unused CSS class
- component-local CSS used outside its allowed boundary
- global CSS that is only used in one place
- dynamic usage with lower confidence

## Performance guidance

- parse each file once per scan
- avoid re-reading files in rules
- keep reachability results cached in the project model

## Suggested first implementation order

1. Config loading and file discovery
2. Source/CSS fact extraction
3. Basic graph construction
4. Reachability model for local, global, and external CSS
5. Derived indexes
6. A small initial rule set on top of the new model
7. CLI reporting and policy enforcement

This sequence builds the foundation before expanding rule coverage.

## Design summary

The recommended architecture is:

- graph-first for relationships
- indexed projections for rule ergonomics
- reachability as a dedicated analysis stage
- rules built on a normalized project model

That structure should give the project a solid foundation for robust scanning without locking it into the assumptions of the legacy Loremaster implementation.
