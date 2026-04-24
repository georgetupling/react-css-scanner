# Current To Target Map

## Purpose

This document is the execution map from the current `static-analysis-engine`
implementation to the target architecture described in:

- `architecture.md`
- `subsystem-boundaries.md`
- `end-to-end-traceability.md`

It is intentionally more concrete than those docs.

Its job is to reduce ad hoc architecture drift by naming:

- the real current subsystem topology
- the durable target topology
- the temporary seams between them
- the current and target ownership of important responsibilities
- the allowed dependency directions
- the concrete exit criteria for removing migration scaffolding

This is a working architectural map, not a permanent freeze of every helper
file. It should be precise at subsystem boundaries and flexible inside them.

## Scope

This document covers the in-flight subsystem under:

- `src/static-analysis-engine/`
- `test/static-analysis-engine/`
- `docs/static-analysis-engine/`

It does not redefine the main product architecture outside the subsystem.

## How To Use This Document

Use this doc when making changes that affect:

- stage boundaries
- cross-file semantic ownership
- shared-library extraction
- trace ownership
- migration scaffolding
- replacement-readiness planning

If code changes alter a boundary, ownership rule, temporary seam, or migration
target described here, update this doc in the same change.

## Stability Model

The contents of this doc are divided into three categories:

- durable targets: intended to survive into the final subsystem architecture
- temporary seams: allowed during migration but not intended as final boundaries
- current implementation facts: true of the codebase today, but not a promise

When these categories conflict, use this priority order:

1. durable targets
2. explicit temporary seam rules
3. current implementation facts

## Current Implemented Topology

The current top-level orchestration flow is the one wired in:

- `src/static-analysis-engine/entry/scan.ts`

For project analysis, the live flow is:

1. parse
2. symbol resolution
3. module graph
4. abstract values
5. project binding resolution
6. render context assembly
7. render graph
8. render IR
9. CSS analysis
10. external CSS summary
11. reachability
12. selector analysis
13. rule execution

For single-file analysis, the flow is simpler and bypasses some project-wide
scaffolding, but it still mirrors the same broad pipeline shape.

## Durable Target Topology

The intended steady-state pipeline remains:

1. parse
2. module-graph
3. symbol-resolution
4. abstract-values
5. render-graph
6. render-ir
7. css-analysis
8. external-css-summary
9. reachability
10. selector-analysis
11. rule-execution

The intended durable top-level subsystem shape is:

- `entry/`
- `pipeline/`
- `libraries/`
- `types/`
- `runtime/`
- `comparison/`

That shared-library shape is now partially implemented in code:

- `libraries/selector-parsing/`
- `libraries/policy/`

## Current To Target Stage Map

| Current live step | Current implementation owner | Target status | Target owner |
| --- | --- | --- | --- |
| parse | `entry/stages/basicStages.ts`, `pipeline/source-file-parsing/`, `parser/` | durable | `pipeline/parse/` plus shared parsing libraries |
| symbol resolution | `pipeline/symbol-resolution/` | durable | `pipeline/symbol-resolution/` |
| module graph | `pipeline/module-graph/` | durable | `pipeline/module-graph/` |
| abstract values | `pipeline/abstract-values/` | durable | `pipeline/abstract-values/` |
| project binding resolution | `pipeline/symbol-resolution/resolveProjectBindings.ts` | temporary explicit seam | absorbed into published symbol-resolution outputs |
| project render summaries | `entry/scan.ts`, `entry/stages/basicStages.ts`, `pipeline/render-ir/buildProjectRenderDefinitions.ts`, `pipeline/render-ir/buildProjectRenderBindings.ts`, `pipeline/render-graph/buildProjectComponentAvailability.ts` | temporary explicit seam | promoted into explicit durable stage contracts |
| render graph | `entry/stages/renderGraphStage.ts`, `pipeline/render-graph/` | durable | `pipeline/render-graph/` |
| render IR | `entry/stages/renderIrStage.ts`, `pipeline/render-ir/` | durable | `pipeline/render-ir/` |
| CSS analysis | `pipeline/css-analysis/`, `parser/` | durable | `pipeline/css-analysis/` plus shared CSS libraries |
| external CSS summary | `pipeline/external-css/` | durable | `pipeline/external-css/` plus native reachability/rule inputs |
| reachability | `pipeline/reachability/` | durable | `pipeline/reachability/` |
| selector parsing | `libraries/selector-parsing/` | shared infrastructure, not a durable stage | `libraries/selector-parsing/` |
| selector analysis | `pipeline/selector-analysis/` | durable | `pipeline/selector-analysis/` |
| rule execution | `pipeline/rule-execution/` | durable | `pipeline/rule-execution/` |

## Durable Ownership By Concern

### 1. Parsing

Durable owner:

- `pipeline/parse/`

Owns:

- source parsing entrypoints
- CSS parsing entrypoints
- stable source-anchor creation
- parse-failure and unsupported-syntax traces when user-visible

Must not own:

- import resolution
- symbol meaning
- selector satisfiability

### 2. Module-level project structure

Durable owner:

- `pipeline/module-graph/`

Owns:

- modules
- imports
- exports
- non-semantic resource edges

Must not own:

- abstract value interpretation
- render reasoning
- selector reasoning

### 3. Cross-file symbol meaning

Durable owner:

- `pipeline/symbol-resolution/`

Owns:

- symbol identity
- imported binding resolution
- namespace import resolution
- re-export traversal
- explicit unresolved or budget-limited symbol outcomes
- published project-wide binding summaries used by later stages

Must not own:

- render subtree construction
- selector evaluation

### 4. Bounded expression meaning

Durable owner:

- `pipeline/abstract-values/`

Owns:

- reusable expression summaries
- class/value sets
- unknown and unsupported value outcomes
- published value summaries consumed by render stages

Must not own:

- import graph traversal
- render placement
- reachability decisions

### 5. Component composition structure

Durable owner:

- `pipeline/render-graph/`

Owns:

- component-to-component render relationships
- definite, possible, or unresolved render edges

Must not own:

- transitive import propagation logic
- general abstract value evaluation

### 6. Approximate rendered structure

Durable owner:

- `pipeline/render-ir/`

Owns:

- bounded rendered subtrees
- render regions
- cycles, budgets, unknown render nodes, and unsupported render nodes

Must not own:

- primary ownership of cross-file import semantics
- cross-engine policy ownership

### 7. CSS normalization

Durable owner:

- `pipeline/css-analysis/`

Owns:

- normalized stylesheet facts
- selector entry extraction
- class definition summaries
- at-rule context summaries

Must not own:

- selector satisfiability
- render reasoning

### 8. External stylesheet activation

Durable owner:

- `pipeline/external-css/`

Owns:

- declared external provider activation
- project-wide remote stylesheet activation summaries
- normalized external CSS summary outputs consumed by reachability and rule
  execution

Must not own:

- stylesheet parsing
- runtime-specific network fetch or warning policy
- render reasoning
- finding-level policy decisions

Current migration note:

- first-release fetch-remote retrieval, fallback handling, and operational-
  warning shaping remain a runtime/current-scanner adapter concern
- `pipeline/external-css/` should consume normalized HTML/provider inputs and
  publish activation summaries, not own network policy

### 9. Stylesheet availability

Durable owner:

- `pipeline/reachability/`

Owns:

- stylesheet availability across source-file, component, subtree-root, and
  render-region contexts
- definite, possible, unknown, and unavailable reachability outcomes
- reachability traces

Must not own:

- selector semantics
- cross-file name meaning

### 10. Selector satisfaction

Durable owner:

- `pipeline/selector-analysis/`

Owns:

- normalized selector query results
- supported, unsupported, satisfied, possible, and unsatisfied selector
  decisions
- preservation of upstream traces relevant to selector decisions

Must not own:

- low-level selector parsing infrastructure
- stylesheet availability decisions

### 11. Findings and product-facing conclusions

Durable owner:

- `pipeline/rule-execution/`

Owns:

- experimental and future migrated rule outputs
- mapping engine reasoning into findings
- preservation of explanation lineage to upstream decisions

Must not own:

- CSS parsing
- render expansion
- first-order selector evaluation

## Current Authoritative Models

The current and target architecture should both treat these outputs as
authoritative at their layer:

- `ModuleGraph` for module-level source relationships
- symbol-resolution outputs for cross-file name meaning
- abstract-value outputs for bounded expression meaning
- `RenderGraph` for component composition structure
- render subtree IR and render regions for approximate rendered structure
- `ExternalCssSummary` for declared-provider activation and project-wide
  external stylesheet activation
- `ReachabilitySummary` for stylesheet availability
- selector-analysis results for selector satisfaction outcomes

No later stage should recreate an earlier stage's semantic work when a published
authoritative model already exists.

## Temporary Seams

The following seams are allowed today, but are not target-state boundaries.

### Temporary Seam 1: Project binding resolution as a distinct orchestration step

Current owner:

- `pipeline/symbol-resolution/resolveProjectBindings.ts`

What it owns today:

- project-wide imported binding resolution
- namespace import resolution
- symbol enrichment with resolved imported targets

Why it is temporary:

- it is conceptually part of symbol-resolution rather than a durable extra stage

Target end-state:

- symbol-resolution publishes project-wide binding summaries directly as part of
  its normal stage output

Exit criteria:

- project analysis no longer requires a separate orchestration seam named
  `project binding resolution`
- later stages consume a published symbol-resolution output contract rather than
  a special extra pass

### Temporary Seam 2: `buildProjectRenderContext` (retired)

Current owner:

- `pipeline/render-ir/buildProjectRenderDefinitions.ts`
- `pipeline/render-ir/buildProjectRenderBindings.ts`
- `pipeline/render-graph/buildProjectComponentAvailability.ts`

What it owns today:

- same-file render definition discovery lives under render-IR
- helper and namespace binding materialization lives under render-IR
- component availability assembly lives under render-graph
- `entry/scan.ts` wires these summaries directly into render graph and render IR
  stages

Why it is temporary:

- the remaining cleanup is stage-shape polish, not bridge ownership
- the deleted seam should not be reintroduced as a convenience packaging layer

Allowed current role:

- no remaining bridge layer; render stages consume the published summaries
  directly

Target end-state:

- symbol-resolution owns cross-file import meaning
- abstract-values owns reusable expression meaning
- render stages consume those published outputs directly or through a minimal
  adapter

Exit criteria:

- transitive const/helper propagation no longer lives in
  the removed `buildProjectRenderContext.ts` seam
- component availability assembly is published upstream
- the file is deleted and later stages consume the summaries directly

### Temporary Seam 3: Selector input as a separate entry step (retired)

Current state:

- selector query assembly now happens inside selector-analysis stage wiring
  rather than as a named top-level entry step

What changed:

- direct selector queries and CSS-derived selector queries are still combined
- that assembly is now local stage input preparation rather than a separately
  named pipeline seam

Why this is now considered retired:

- the pipeline no longer exposes selector-input assembly as a first-class step
- selector-analysis now owns the last-mile query assembly it consumes

Target end-state:

- selector-analysis consumes a normalized query input shape assembled without a
  named top-level pipeline seam

Exit criteria:

- the pipeline no longer describes `selector input` as a first-class stage-like
  step

Migration note:

- selector parsing is no longer a separate top-level orchestration seam
- selector-input assembly now lives as local selector-analysis preparation

### Temporary Seam 5: Old-engine compatibility at the rule/CSS edge

Current owners:

- `pipeline/rule-execution/`
- `pipeline/css-analysis/`
- compatibility/runtime adapters

What it owns today:

- compatibility with current severity/confidence and reused CSS fact shapes
- bounded current-scanner adapters that let shipped rule families migrate in
  slices before every rule input is fully new-engine-native

Why it is temporary:

- these imports are migration scaffolding, not target new-engine boundaries

Target end-state:

- new-engine-native rule and CSS contracts, with adapters only at explicit
  migration boundaries

Exit criteria:

- rule-execution and CSS-analysis no longer depend directly on old-engine
  implementation types

Current migration note:

- `adapters/current-scanner/` now carries the bounded optimization-family
  migration wave plus the full `definition-and-usage-integrity` family adapter
- the definition-and-usage adapter now rebuilds
  direct/import/render/global/external reachability from native engine outputs,
  while current definition lookup and plain-class candidate policy remain
  deliberate adapter-owned parity scaffolding

## Shared Infrastructure That Should Move Or Be Clarified

The following areas are already functionally shared infrastructure and should be
treated that way in future changes.

### Selector parsing

Current location:

- `libraries/selector-parsing/`

Durable target:

- `libraries/selector-parsing/`

Migration note:

- this is now the shared-library home
- future work should keep shared selector infrastructure here rather than
  reintroducing stage-looking ownership

### CSS parsing helpers

Current location:

- `parser/`

Durable target:

- shared CSS/source parsing library space plus `pipeline/parse/`

Migration note:

- acceptable current placement
- future work should avoid making parser helpers look like stage-owned logic if
  they are intentionally multi-consumer

### Cross-engine policy and budgets

Current location:

- `libraries/policy/` for shared budgets
- `pipeline/render-ir/shared/expansionSemantics.ts` for render-specific
  expansion reasons and helper semantics

Durable target:

- `libraries/policy/`

Migration note:

- tranche 4 moved cross-cutting budgets and propagation limits into shared
  policy space
- tranche 4 also split render-local expansion semantics out of the old
  compatibility shim, so render-IR-specific reasoning no longer masquerades as
  shared policy
- any new cross-cutting budget or propagation limit should continue to land in
  shared policy modules, not in stage-private helpers

## Dependency Rules

These rules are intended to prevent new ad hoc coupling.

### Durable dependency rules

- `entry/` may orchestrate stages and adapters, but should not become the long
  term owner of semantic work.
- a stage may consume shared libraries
- a stage may consume earlier stage outputs
- a stage may not depend on deep internal helpers from a sibling stage
- shared infrastructure should not own semantic conclusions that belong to a
  stage contract
- `comparison/` may depend on the engine pipeline and compatibility adapters,
  but it is not a pipeline stage

### Explicitly disallowed new coupling

Do not introduce new code that:

- places cross-cutting policy constants in a stage-private helper and reuses
  them from other stages
- adds more cross-file semantic ownership to `buildProjectRenderContext.ts`
- reintroduces a deleted render-context bridge instead of publishing explicit
  stage outputs
- treats `libraries/selector-parsing/` as selector-analysis-private
- imports deep render-IR helpers into symbol-resolution
- imports old-engine implementation types deeper into the new engine

### Current named exceptions

These exceptions exist today and are allowed only as migration scaffolding:

- rule execution and CSS analysis still reuse some old-engine-compatible types

Do not copy these patterns into new code unless the change is explicitly part of
retiring the exception.

## Current Files That Define The Main Seams

These files should be treated as the main architectural pressure points for the
next phase of work:

- `src/static-analysis-engine/entry/scan.ts`
- `src/static-analysis-engine/entry/stages/basicStages.ts`
- `src/static-analysis-engine/entry/stages/renderGraphStage.ts`
- `src/static-analysis-engine/entry/stages/renderIrStage.ts`
- `src/static-analysis-engine/pipeline/symbol-resolution/resolveProjectBindings.ts`
- `src/static-analysis-engine/pipeline/reachability/buildReachabilitySummary.ts`
- `src/static-analysis-engine/pipeline/rule-execution/types.ts`

Changes to any of these files should be checked against this document before
adding more responsibility to them.

## Reachability Contract In Current State

The reachability stage is already substantial enough to deserve a locked current
contract.

### Current authoritative contexts

Today reachability is authoritative for availability across:

- source-file contexts
- component contexts
- render-subtree-root contexts
- render-region contexts

### Current availability vocabulary

Today reachability uses:

- `definite`
- `possible`
- `unknown`
- `unavailable`

Current meaning:

- `definite`: analyzed structure establishes stylesheet availability for the
  context
- `possible`: at least one bounded path or renderer establishes availability,
  but not as a universal or definite guarantee
- `unknown`: bounded analysis encountered a barrier that prevents a firmer
  answer
- `unavailable`: no analyzed path establishes availability

### Current migration note

The current reachability model is real and authoritative for the present engine,
but some propagation policy may still evolve. Future changes should preserve the
same vocabulary unless the docs and consuming stages are updated together.

## Trace Ownership Map

The current target remains producer-owned traces.

Lock this rule now:

- parse owns parse-failure traces
- symbol-resolution owns import/re-export/unresolved-resolution traces
- abstract-values owns exact/possible/unknown value traces
- render-graph owns render-edge certainty and unresolved-edge traces
- render-ir owns expansion-stop, cycle, budget, and unknown-node traces
- css-analysis owns unsupported CSS traces when user-visible
- reachability owns availability traces
- selector-analysis owns selector outcome traces
- rule-execution owns finding-level explanation lineage

Later stages should preserve relevant upstream traces, not rewrite them into new
freeform reasons.

### Current implemented trace contract

The current engine should now be treated as following this practical trace
contract:

- a stage owns the trace that explains its own decision
- when a later stage depends on earlier-stage reasoning, it should usually add a
  wrapping trace of its own and preserve the earlier traces as `children`
- later stages should not discard relevant upstream traces and replace them only
  with freeform reason strings
- if a rule result does not depend on richer upstream semantic lineage, it
  should still emit a rule-owned `rule-evaluation` trace so the rule contract
  remains uniform

Current implemented examples:

- symbol-resolution publishes import/export/unresolved-binding traces
- render-graph wraps relevant symbol-resolution traces on edge decisions
- reachability wraps relevant render-graph and symbol-resolution traces on
  availability contexts
- selector-analysis wraps relevant reachability traces on selector decisions
- rule-execution wraps selector-derived decisions and still emits rule-owned
  traces for CSS-structure findings that do not have deeper upstream lineage

## Migration Sequence

This is the intended order of cleanup unless a specific change says otherwise.

### Tranche 1: docs and boundary locking

Goals:

- make the live architecture explicit
- prevent new drift

Done when:

- this document exists and is current
- live docs clearly distinguish durable targets from temporary seams

### Tranche 2: symbol/value ownership cleanup

Goals:

- move at least one cross-file propagation path out of
  the old render-context seam
- publish a clearer upstream summary contract

Done when:

- later render work consumes at least one upstream summary that it does not
  reconstruct itself

### Tranche 3: trace adoption expansion

Goals:

- extend producer-owned traces into symbol-resolution and render expansion

Done when:

- one non-trivial rule result can be traced back through selector, reachability,
  render, and symbol decisions without ad hoc prose reconstruction

### Tranche 4: shared-library and policy cleanup

Goals:

- move or clearly re-home shared infrastructure
- centralize cross-engine budgets and policy

Done when:

- selector parsing and shared policy ownership are no longer architecturally
  misleading

### Tranche 5: replacement-readiness validation

Goals:

- improve feature/integration coverage
- use comparison tooling for measured confidence

Done when:

- replacement-readiness is grounded in explicit validation criteria rather than
  only local confidence

## What This Document Does Not Freeze

This document does not freeze:

- every helper file name
- every internal refactor within a stage
- the final breadth of abstract-value support
- the final rule catalog
- the final public migration timing

It does freeze:

- the intended durable subsystem boundaries
- the temporary seam list
- the direction of responsibility movement
- the coupling patterns that should not grow further

## Summary

The subsystem is already beyond proof-of-concept and now needs explicit
execution discipline more than more vague architecture prose.

The core rule is:

- push semantic ownership upward to the stage that should authoritatively own it
- keep render and selector stages consuming published summaries instead of
  rebuilding them
- move shared infrastructure out of stage-looking locations over time
- treat temporary seams as things to retire, not normalize

## Addendum: Tranche 2 Landed

Tranche 2 is now in.

Completed changes:

- imported const-expression propagation no longer lives only inside
  the old `entry/stages/buildProjectRenderContext.ts` seam
- symbol-resolution now publishes upstream expression-binding summaries used by
  later render work
- symbol-resolution now also publishes imported-component binding summaries so
  render preparation does not decide for itself which imported bindings are
  component-shaped
- helper and namespace binding materialization now lives in
  `pipeline/render-ir/buildProjectRenderBindings.ts`
- component availability assembly now lives in
  `pipeline/render-graph/buildProjectComponentAvailability.ts`
- `entry/scan.ts` now wires these summaries directly into render graph and
  render IR stages without a `buildProjectRenderContext.ts` bridge

Why this counts for tranche 2:

- later render work now consumes upstream-published summaries that it does not
  reconstruct itself
- at least one real cross-file propagation path has moved upward out of the
  render-context seam

What did not change yet:

- same-file component discovery still remains close to render work
- helper semantics are still not owned by a fuller abstract-values summary layer
- the project still needs clearer first-class stage contracts for these new
  project render summaries

This means tranche 2 should now be treated as complete for the bounded scope
described in this document.

## Addendum: Tranche 3 Landed

Tranche 3 is now in for the bounded scope described in this document.

Completed changes:

- symbol-resolution now emits producer-owned traces for resolved imported
  bindings, unresolved imports, and export-resolution paths
- render-graph now emits producer-owned traces on resolved and unresolved
  component edges, preserving relevant symbol-resolution children
- reachability now preserves its own availability traces while nesting upstream
  render-graph and symbol-resolution provenance beneath them
- selector-analysis now preserves those reachability-backed traces in selector
  decisions instead of flattening them into prose-only explanations
- rule-execution now emits finding-level `rule-evaluation` traces that wrap the
  selector decision traces, so a rule result can preserve upstream reasoning
  lineage directly

Current practical trace contract:

- upstream stages still own their own traces
- later stages may add a new wrapping trace for their own decision
- later stages should preserve relevant upstream traces as `children` rather
  than replacing them

Why this counts for tranche 3:

- one non-trivial selector-derived rule result can now be traced through
  `rule-execution -> selector-analysis -> reachability -> render-graph ->
  symbol-resolution`
- the main current-user-facing explanation path no longer depends on ad hoc
  prose reconstruction alone

What did not change yet:

- trace coverage is strongest on selector-derived results, not yet equally rich
  across every rule family
- some producer categories still have shallower trace coverage than the
  long-term target
- later tranches can still broaden and refine explanation coverage, but tranche
  3's stated success condition is now met

This means tranche 3 should now be treated as complete for the bounded scope
described in this document, while tranche 4 is the next active cleanup target.

## Addendum: Tranche 4 Landed

Tranche 4 is now in for the bounded scope described in this document.

Completed changes:

- shared selector parsing now lives under `libraries/selector-parsing/`
- CSS parsing and selector-analysis imports now reference that shared-library
  home instead of a stage-looking path
- cross-engine budget constants now live under `libraries/policy/`
- symbol-resolution and render preparation no longer import shared budget
  constants from render-IR-private helpers
- render-IR-specific expansion reasons and unsupported-parameter semantics now
  live in a render-IR-local helper instead of a policy compatibility shim

Why this counts for tranche 4:

- selector parsing is no longer architecturally misleading as if it were a
  pipeline stage
- shared policy ownership for cross-engine budgets is now explicit in a
  top-level library space
- render-local semantics are now clearly separated from shared cross-engine
  policy

What did not change yet:

- render-IR-specific expansion reasons still live with render-IR helpers, which
  is acceptable because they are render-local semantics rather than cross-engine
  policy
- old-engine compatibility seams at the CSS and rule edge still remain for
  later cleanup

This means tranche 4 should now be treated as complete for the bounded scope
described in this document, while tranche 5 is the next active cleanup target.

## Addendum: Tranche 5 Landed

Tranche 5 is now in for the bounded scope described in this document.

Completed changes:

- `test/static-analysis-engine/feature/` now exists as a first-class
  static-analysis-engine feature validation bucket
- replacement-readiness coverage now includes multi-file selector-plus-
  reachability scenarios for:
  - definite stylesheet reachability through component composition
  - possible selector satisfaction through conditional composition
  - unknown reachability barrier preservation during unsupported cross-file
    helper expansion
- the bounded validation slice now exercises the comparison harness against the
  current scanner in a feature-shaped scenario instead of only unit-shaped
  cases
- replacement-readiness confidence is now grounded in explicit validation
  scenarios rather than only local confidence in individual stage helpers

Why this counts for tranche 5:

- the static-analysis-engine track now has a dedicated feature-level validation
  bucket, which was the main missing test-structure step called out in the
  tranche goals
- comparison tooling is now used in a measured replacement-readiness scenario,
  not only in isolated harness tests
- the current bounded readiness story is now stated as concrete validation
  cases that can be rerun and extended deliberately

What did not change yet:

- this does not by itself establish full replacement criteria for the whole
  scanner
- broader integration coverage, migration gating, and product-rule replacement
  planning still need their own explicit close-out work
- temporary architectural seams such as project render summary stage-shape
  polish and old-engine compatibility at the CSS/rule edge still remain

This means tranche 5 should now be treated as complete for the bounded scope
described in this document. Any further work should be planned as explicit
close-out or migration tranches rather than as missing tranche-5 validation.
