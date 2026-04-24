# Static Analysis Engine Architecture

## Purpose

This document defines the target product architecture for the `static-analysis-engine`.

It replaces the earlier first-slice framing with a clearer statement of what the finished engine is supposed to look like, even if some parts are still being implemented incrementally.

This architecture is now informed by:

- the current implementation under `src/static-analysis-engine/`
- `progress-snapshot-2026-04-19.md`
- `known-architectural-issues.md`

## Architectural Position

The target engine is:

- symbol-first
- stage-oriented
- explanation-aware
- internally bounded
- isolated from the old engine except for temporary comparison scaffolding

The most important architectural decision is that later semantic stages should increasingly consume normalized symbol, value, and render models rather than rebuilding cross-file meaning ad hoc.

## Target End-State

The target product should have:

- one top-level pipeline stage per subdirectory under `src/static-analysis-engine/pipeline/`
- shared engine libraries outside `pipeline/`
- explicit contracts for what each stage consumes and emits
- structured traces only where they help explain user-visible reasoning
- no permanent `buildProjectRenderContext`-style bridge owning cross-file semantic work
- no permanent dependence on old-engine runtime or fact types

## Non-Goals

This document does not try to freeze:

- the exact public CLI or API surface
- the exact final finding catalog
- every future supported React or CSS pattern

It does define the target internal pipeline and stage responsibilities.

## Stage Model

The target product pipeline should be:

1. parse
2. module-graph
3. symbol-resolution
4. abstract-values
5. render-graph
6. render-ir
7. css-analysis
8. reachability
9. selector-analysis
10. rule-execution

This is the intended steady-state pipeline. Some implementation scaffolding currently splits or bridges parts of this flow, but that is not the target architecture.

## Stage Contracts

### 1. `parse`

Purpose:
Parse source and CSS inputs into syntax-aware representations with stable source anchors.

Consumes:

- discovered source file inputs
- discovered CSS source inputs

Emits:

- parsed source files
- parsed CSS source records
- stable source anchors reused by later stages

Must not own:

- import resolution
- semantic symbol reasoning
- selector satisfiability decisions

Traceability expectation:
Only emit traces for meaningful parse failures or unsupported syntax that will affect later user-visible conclusions.

### 2. `module-graph`

Purpose:
Build the normalized project graph of modules, imports, exports, and non-semantic resource edges.

Consumes:

- parsed source files

Emits:

- `ModuleGraph`

Must not own:

- render reasoning
- abstract value evaluation
- selector reasoning

Traceability expectation:
Usually low-noise. Traces are only required when unresolved import/export structure becomes relevant to later user-visible uncertainty.

### 3. `symbol-resolution`

Purpose:
Resolve local and cross-file symbol identity on top of the module graph.

Consumes:

- parsed source files
- `ModuleGraph`

Emits:

- normalized symbol registry
- resolved imported binding summaries
- resolved namespace and re-export summaries
- explicit unresolved or bounded-resolution records

This stage is authoritative for:

- what a name refers to
- which exports resolve across module boundaries
- where symbol resolution stops because of unsupported structure or budgets

Traceability expectation:
Required for user-meaningful decisions such as unresolved imports, followed re-export chains, ambiguous resolution, and budget cutoffs.

### 4. `abstract-values`

Purpose:
Evaluate a bounded subset of expressions into reusable abstract values.

Consumes:

- parsed source files
- symbol-resolution outputs

Emits:

- abstract expression summaries
- abstract class/value sets
- explicit unknown or unsupported value records

This stage is authoritative for:

- what values an expression may produce within bounded analysis
- where exact reasoning was lost

Traceability expectation:
Required when exact values become possible values, unknowns, or unsupported outcomes in ways that affect later render or selector conclusions.

### 5. `render-graph`

Purpose:
Build the structural graph of component-to-component render relationships.

Consumes:

- parsed source files
- symbol-resolution outputs
- abstract-values outputs where needed for bounded component targeting

Emits:

- `RenderGraph`

This stage is authoritative for:

- which components may render which other components
- whether those render paths are definite, possible, or unresolved

Traceability expectation:
Required when component edges are unresolved, downgraded, or blocked in a way that affects reachability or selector explanations.

### 6. `render-ir`

Purpose:
Construct bounded approximate rendered subtrees and regions from renderable component structure.

Consumes:

- parsed source files
- symbol-resolution outputs
- abstract-values outputs
- `RenderGraph`

Emits:

- render subtree IR
- render region summaries
- explicit unknown, unsupported, cycle-stopped, or budget-stopped render nodes

This stage is authoritative for:

- approximate rendered structure
- placement of classes in renderable regions
- where render expansion stopped and why

Traceability expectation:
High. This is one of the main explanation-producing stages because it directly supports later answers about whether something could render.

### 7. `css-analysis`

Purpose:
Normalize CSS sources into bounded CSS facts used by later stages.

Consumes:

- parsed CSS source records

Emits:

- normalized stylesheet analysis records
- selector-entry records
- class definition summaries
- at-rule context summaries

This stage is authoritative for:

- what selectors and definitions exist in analyzed CSS
- where selector shapes are available to later analysis

Traceability expectation:
Low by default. Emit traces for unsupported CSS constructs only when that materially affects a later user-visible explanation.

### 8. `reachability`

Purpose:
Determine where CSS is available across source, component, subtree, and render-region contexts.

Consumes:

- `ModuleGraph`
- `RenderGraph`
- render subtree IR
- CSS analysis outputs

Emits:

- `ReachabilitySummary`

This stage is authoritative for:

- direct stylesheet availability
- inherited or propagated availability through render structure
- where availability becomes only possible or unknown

Traceability expectation:
Required. Reachability decisions are directly useful in human explanations for selector and finding results.

### 9. `selector-analysis`

Purpose:
Answer whether normalized selectors can match bounded rendered structure in contexts where their stylesheets are available.

Consumes:

- CSS analysis outputs
- render subtree IR
- `ReachabilitySummary`

Emits:

- normalized selector analysis results
- shared decision payloads for selector outcomes

This stage is authoritative for:

- whether a selector is definitely satisfied, possibly satisfied, unsupported, or not satisfied under bounded analysis

Traceability expectation:
Required. This is the most directly user-facing reasoning stage short of rule execution.

### 10. `rule-execution`

Purpose:
Turn engine analysis outputs into findings and other product-facing conclusions.

Consumes:

- CSS analysis outputs
- selector-analysis outputs
- other stage outputs as required by future rules

Emits:

- findings
- confidence/severity assignments
- explanation-ready references to upstream decisions and traces

This stage is authoritative for:

- final finding semantics
- mapping engine reasoning into product output

Traceability expectation:
Required. Findings should preserve or point to the upstream decisions that justify them.

## Target Data Flow

The intended high-level flow is:

`parse -> module-graph -> symbol-resolution -> abstract-values -> render-graph -> render-ir`

and in parallel on the CSS side:

`parse -> css-analysis`

then:

`module-graph + render-graph + render-ir + css-analysis -> reachability`

then:

`css-analysis + render-ir + reachability -> selector-analysis`

then:

`selector-analysis + css-analysis -> rule-execution`

## Authoritative Models

The target architecture should treat these outputs as authoritative:

- `ModuleGraph` for module-level source relationships
- symbol-resolution outputs for cross-file name meaning
- abstract-values outputs for bounded expression meaning
- `RenderGraph` for component composition relationships
- render subtree IR for approximate rendered structure
- `ReachabilitySummary` for stylesheet availability
- selector-analysis results for selector satisfaction outcomes

No later stage should recreate earlier semantic work if an authoritative stage output already exists for it.

## Temporary Structures That Should Not Survive Into The Final Product

The current implementation has useful temporary seams that should not define the target architecture.

Most importantly:

- ad hoc cross-file const/helper propagation inside render preparation should move toward symbol/value-owned summaries
- old-engine type reuse is temporary comparison scaffolding only

## Shared Libraries

The target product should keep shared reusable logic outside `pipeline/`.

Examples of likely shared-library areas:

- selector parsing and normalization
- source-anchor and trace helpers
- shared engine policy and budget definitions
- generic CSS parsing helpers

These are engine libraries, not pipeline stages. They may be consumed by multiple stages, but they should not blur stage ownership of semantic decisions.

See `subsystem-boundaries.md` for the boundary rules.

## Traceability Model

The target engine should not try to make every stage produce verbose user-facing traces.

Instead:

- traces are required where they support user-visible findings and explanations
- traces should be emitted by the stage that actually made the decision
- later stages should preserve and present those traces rather than reverse-engineering them from prose

See `end-to-end-traceability.md` for the detailed traceability rules.

## Budgeting And Boundedness

The target engine remains bounded.

Important architectural rules:

- stages must stop explicitly rather than silently dropping hard cases
- budget limits should live in shared engine policy modules, not in arbitrary stage-local files when they are cross-cutting
- unsupported, unknown, and budget-limited outcomes must remain distinguishable

## Isolation From The Old Engine

The target product should be fully new-engine-native.

During transition, compatibility wrappers are allowed for:

- comparison
- testing
- staged migration

But those should be treated as temporary scaffolding rather than part of the target subsystem design.

## Recommended Near-Term Refactor Direction

To move from current implementation to target architecture, the highest-value cleanup direction is:

1. document the stage contracts and boundary rules clearly
2. move shared libraries out of `pipeline/`
3. expose project render definitions, bindings, and component availability as
   direct stage outputs
4. shift cross-file semantic ownership toward symbol-resolution and abstract-values outputs
5. keep traces concentrated at decision-heavy stages

## Summary

The target `static-analysis-engine` is a symbol-first staged pipeline with explicit stage contracts and shared libraries outside `pipeline/`.

Its central architectural promise is:

- early stages determine what program structures mean
- middle stages determine what can render and where CSS is available
- later stages determine whether selectors and rules hold
- user-visible explanations are built from structured decisions made at the point where those conclusions were actually reached
