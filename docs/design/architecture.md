# Architecture

## Scope

This document describes the current architecture of `scan-react-css` as implemented in `src/`.

Authoritative execution path:

- CLI: `src/cli.ts` -> `src/cli/index.ts` -> `scanProject()`
- Node API: `src/index.ts` -> `scanProject()`
- Analysis orchestrator: `src/static-analysis-engine/entry/scan.ts`

## Top-Level Flow

1. `scanProject()` builds a workspace snapshot and runs the static-analysis engine pipeline.
2. Engine returns analysis evidence:
   - `projectEvidence`
   - `runtimeCssLoading`
   - `selectorReachability`
   - `ownershipInference`
3. `runRules()` converts evidence + config into findings.
4. CLI applies output filtering/formatting and sets exit code.

## Layering

- `src/config`: parse/validate scanner config and defaults.
- `src/static-analysis-engine/pipeline`: staged internal analysis pipeline.
- `src/rules`: rule catalogue and finding generation over evidence.
- `src/project`: public scan surface, summary/failure calculation.
- `src/cli`: args, UX formatting, JSON/text output handling.

Design intent: rules consume stable evidence models, not raw AST or ad-hoc one-off parsers.

## Pipeline Stages

Defined and ordered in `src/static-analysis-engine/entry/scan.ts`.

### 1. Workspace Discovery

Module:

- `pipeline/workspace-discovery/buildProjectSnapshot.ts`

Responsibilities:

- resolve `rootDir`
- load config via discovery order (`load-config`)
- discover source/CSS/HTML files (`discover-files`)
- read file contents (`load-files`)
- extract HTML stylesheet/script links
- load local HTML-linked CSS (`load-html-css`)
- load package CSS imports (`load-package-css`)
- optionally fetch remote CSS (`fetch-remote-css`) when enabled
- derive stylesheet/source import edges
- derive project boundaries and resource edges
- collect diagnostics from all discovery/file loading steps

Primary output:

- `ProjectSnapshot` containing config, discovered/loaded files, boundaries, edges, external-css settings, diagnostics.

### 2. Language Frontends

Module:

- `pipeline/language-frontends/buildLanguageFrontends.ts`

Responsibilities:

- parse source files into TypeScript AST-backed frontend facts
- extract module syntax facts (imports/exports/declarations)
- extract React syntax facts (components, render sites, element templates, class expression sites)
- extract runtime DOM class sites
- build deduped expression syntax facts for symbolic evaluation
- parse CSS style rules and selector entries from stylesheet text

Primary output:

- `LanguageFrontendsResult` with structured `source` and `css` facts indexed by file.

### 3. Fact Graph

Module:

- `pipeline/fact-graph/buildFactGraph.ts`

Responsibilities:

- convert frontend facts + snapshot edges into typed graph nodes/edges:
  - files/modules/components/render/class-expression nodes
  - stylesheet/rule/selector/selector-branch nodes
  - import/contains/renders/defines-selector/reference edges
- create owner-candidate seed nodes/edges
- include external resource nodes for import edges
- build graph indexes and graph diagnostics
- sort nodes/edges deterministically

Primary output:

- `FactGraphResult` containing graph, indexes, diagnostics, and stage metadata.

### 4. Symbolic Evaluation

Module:

- `pipeline/symbolic-evaluation/evaluateSymbolicExpressions.ts`

Responsibilities:

- iterate class-expression sites from fact graph
- resolve linked expression syntax nodes
- evaluate symbolic class expressions through evaluator registry
- emit canonical class-expression facts and condition facts
- emit diagnostics for missing syntax/unresolved expressions
- build indexes for evaluated expressions/conditions
- sort expressions, conditions, diagnostics deterministically

Primary output:

- `SymbolicEvaluationResult` with evaluated expression model + diagnostics.

### 5. Render Structure

Module:

- `pipeline/render-structure/buildRenderStructure.ts`

Responsibilities:

- project render behavior from graph + symbolic evaluation
- build render model entities:
  - rendered components and boundaries
  - rendered elements
  - emission sites
  - render paths/regions
  - placement conditions
  - render graph projection
- build indexes and render-structure diagnostics

Primary output:

- `RenderStructureResult` with `renderModel`, indexes, and diagnostics.

### 6. Selector Reachability

Module:

- `pipeline/selector-reachability/buildSelectorReachability.ts`

Responsibilities:

- parse selector branches
- project branch requirements and structural constraints
- match branch subjects and structural constraints against render elements
- compute element and branch matches
- classify branch status/confidence (`matchable`, `possibly-matchable`, etc.)
- aggregate branch-level results into selector-query reachability
- build reachability indexes and diagnostics

Primary output:

- `SelectorReachabilityResult` containing branch/query reachability, matches, diagnostics, indexes.

### 7. Runtime CSS Loading

Module:

- `pipeline/runtime-css-loading/buildRuntimeCssLoading.ts`

Responsibilities:

- infer app-entry CSS loading surfaces from valid HTML script entries
- fall back to conventional `main.*` source entries when HTML entries are absent or unresolved
- walk static source import closures while treating dynamic imports as lazy boundaries
- collect global CSS imports and stylesheet import closures for each runtime entry
- emit source-file stylesheet availability records for project evidence

Primary output:

- `RuntimeCssLoadingResult` containing sorted runtime CSS availability records.

### 8. Project Evidence Assembly

Modules:

- `pipeline/project-evidence/entities.ts`
- `pipeline/project-evidence/relations.ts`
- stage wrapper in `entry/stages/projectEvidenceStage.ts`

Responsibilities:

- build normalized, sorted analysis entities for rule consumption:
  - source files, stylesheets, components, render subtrees
  - class definitions, contexts, references, skipped/unsupported references
  - selector queries/branches
  - CSS module imports/aliases/destructuring/member refs/diagnostics
- index entities for relation building
- build relations:
  - module imports
  - component render relations
  - stylesheet reachability
  - class reference matches
  - selector matches
  - provider class satisfactions and provider-backed stylesheets
  - CSS module member matches
- assemble final evidence object with indexes/meta

Primary output:

- `ProjectEvidenceAssemblyResult`.

### 9. Ownership Inference

Module:

- `pipeline/ownership-inference/buildOwnershipInference.ts`

Responsibilities:

- derive class definition consumer evidence
- infer stylesheet ownership evidence and owner candidates
- infer class ownership evidence
- apply selector-context evidence adjustments
- produce ownership classifications and indexes

Primary output:

- `OwnershipInferenceResult` with class ownership, stylesheet ownership, candidates, classifications.

### 10. Rule Execution (Post-Pipeline)

Module:

- `src/project/scanProject.ts` -> `runRules()`

Responsibilities:

- run configured rules over analysis evidence
- include external package-css import context
- compute `failed` based on diagnostics + `failOnSeverity`
- compute scan summary counts
- apply ignore filters (`ignore.classNames`, `ignore.filePaths` + runtime overrides)

Primary output:

- public `ScanProjectResult` contract returned by Node API and consumed by CLI.

## Data Contracts and Boundaries

- Internal pipeline data structures are intentionally richer than public output.
- Public API/CLI should expose findings/diagnostics/summary/files, not raw graph internals.
- Stage outputs include `meta.generatedAtStage` and sorted collections to preserve deterministic behavior.

## Determinism Strategy

Determinism is enforced by:

- sorting files, nodes, edges, entities, relations, diagnostics
- stable id generation per stage
- avoiding order leakage from non-deterministic traversal

When changing internals, preserve sort/id stability to avoid test and output churn.

## Extension Guidelines

- Add new analysis behavior in the correct stage rather than bypassing with ad-hoc rule logic.
- If a rule needs new evidence, evolve project-evidence entities/relations first.
- Keep stage responsibilities narrow; avoid cross-stage implicit coupling.
- Update tests and docs in the same change when stage contracts change.
