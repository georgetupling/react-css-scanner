# Static Analysis Engine Known Architectural Issues

## Purpose

This note is a focused companion to `progress-snapshot-2026-04-19.md`.

The snapshot is broad status and re-entry guidance. This document is narrower:

- current architectural pressure points in the live implementation
- why they matter
- what kind of cleanup each issue likely wants

It is intentionally based on the current code under `src/static-analysis-engine/`, not only on the archived design docs.

## Scope Of The Current Pipeline

The actual top-level pipeline stages are the ones wired in `src/static-analysis-engine/entry/scan.ts`:

- parse
- symbol resolution
- module graph
- abstract values
- project binding resolution
- render context assembly
- render graph
- render IR
- CSS analysis
- external CSS summary
- reachability
- selector analysis
- rule execution

That is useful to state explicitly because many folders under `src/static-analysis-engine/pipeline/` are not entry stages in that sense. Several are internal subsystems or helper libraries used by one or more stages.

That is not automatically a problem, but it does mean the current `pipeline/` directory name is broader than "entry pipeline stages".

## Issue 1: Later Stages Still Bypass The Symbol Model

### What is happening

There is a real symbol layer:

- `pipeline/symbol-resolution/collectSymbols.ts`
- `pipeline/symbol-resolution/resolveProjectBindings.ts`

There is also a real module/import graph layer:

- `pipeline/module-graph/buildModuleGraph.ts`

But later project-wide render stages do not consume a richer symbol/value summary model directly.

Instead, `entry/stages/buildProjectRenderContext.ts` assembles a render-oriented bridge object by combining:

- same-file component discovery from `pipeline/render-ir/`
- resolved imported bindings from `pipeline/symbol-resolution/`
- ad hoc exported const collection
- ad hoc exported helper collection
- transitive import propagation for consts and helpers
- namespace import expansion for consts, helpers, and components

Then `entry/stages/renderIrStage.ts` and `entry/stages/renderGraphStage.ts` consume that bridge object rather than a normalized symbol-first project model.

### Why it matters

- symbol resolution exists, but render-oriented code still owns too much cross-file semantic assembly
- it becomes harder to explain which layer is authoritative for "what is imported, exported, and usable here"
- the render stages are harder to refactor because they depend on bridge-specific precomputation

### Evidence in code

- `src/static-analysis-engine/entry/scan.ts`
- `src/static-analysis-engine/entry/stages/buildProjectRenderContext.ts`
- `src/static-analysis-engine/entry/stages/renderIrStage.ts`
- `src/static-analysis-engine/entry/stages/renderGraphStage.ts`

### Likely cleanup direction

Move more cross-file const/helper/component availability into a reusable project summary layer owned closer to symbol/value resolution, then let render stages consume that summary instead of recreating their own import semantics.

## Issue 2: `buildProjectRenderContext.ts` Has Become A Catch-All Seam

### What is happening

`buildProjectRenderContext.ts` is doing several different jobs:

- local component discovery
- exported component indexing
- imported component availability assembly
- exported const collection
- exported helper collection
- transitive const propagation
- transitive helper propagation
- namespace import materialization

This is the clearest single "pressure file" in the current implementation.

### Why it matters

- it mixes discovery, resolution, summarization, and render preparation
- it duplicates some concerns that already partially exist in symbol resolution
- future cleanup gets harder the more subsystems depend on this exact bridge shape

### Evidence in code

- `src/static-analysis-engine/entry/stages/buildProjectRenderContext.ts`

### Likely cleanup direction

Keep a render-context bridge if it is useful, but narrow it so it only adapts already-resolved project summaries into render-stage inputs. The cross-file propagation logic itself should probably live elsewhere.

## Issue 3: Pipeline Folder Boundaries Do Not Match Entry-Stage Boundaries

### What is happening

The `pipeline/` directory mixes:

- actual stage implementations such as `module-graph`, `reachability`, `rule-execution`
- reusable analysis libraries such as `selector-parsing`
- internal render-IR collection and resolution helpers

For example:

- `selector-analysis` depends on `selector-parsing`
- `parser/parseCssStyleRules.ts` also depends on `selector-parsing`
- `symbol-resolution/resolveProjectBindings.ts` imports shared budget policy from
  `libraries/policy/`

### Why it matters

- the code is reusing useful logic, but the folder layout makes it less clear which modules are stable stage outputs versus internal helper packages
- policy constants are leaking across stage boundaries
- the architecture reads more cleanly than the implementation is currently partitioned

### Evidence in code

- `src/static-analysis-engine/pipeline/selector-analysis/buildParsedSelectorQueries.ts`
- `src/static-analysis-engine/parser/parseCssStyleRules.ts`
- `src/static-analysis-engine/pipeline/symbol-resolution/resolveProjectBindings.ts`
- `src/static-analysis-engine/libraries/policy/analysisBudgets.ts`

### Likely cleanup direction

Promote shared libraries that are intentionally multi-consumer into clearer shared subsystem names, or explicitly document that `pipeline/` contains both stages and reusable engine libraries.

## Issue 4: Selector Parsing Is Shared Infrastructure, But Not Named As Such

### What is happening

Your intuition was directionally correct.

`css-analysis` does not import `selector-parsing` directly. But it does call
`parser/parseCssStyleRules.ts`, and that parser uses
`libraries/selector-parsing/` to parse selector preludes into selector branch
facts.

Separately:

- `selector-analysis/extractSelectorQueriesFromCssText.ts` uses `selector-parsing`
- `selector-analysis/buildParsedSelectorQueries.ts` uses `selector-parsing`

So selector parsing is already shared infrastructure for multiple later concerns:

- CSS fact extraction
- selector query preparation
- selector normalization and constraint projection

### Why it matters

- this is probably healthy reuse, not inherently a bug
- but the current layout can make it look like selector parsing belongs only to selector analysis
- if more consumers appear, the naming/documentation mismatch will get worse

### Evidence in code

- `src/static-analysis-engine/parser/parseCssStyleRules.ts`
- `src/static-analysis-engine/pipeline/selector-analysis/extractSelectorQueriesFromCssText.ts`
- `src/static-analysis-engine/pipeline/selector-analysis/buildParsedSelectorQueries.ts`
- `src/static-analysis-engine/libraries/selector-parsing/index.ts`

### Likely cleanup direction

Treat selector parsing as a shared CSS-selector normalization library. That does not necessarily require a new entry stage, but it probably does justify clearer subsystem naming or documentation.

## Issue 5: Reachability Relies On Simpler Structural Models More Than On Richer Symbol Outputs

### What is happening

`reachability/buildReachabilitySummary.ts` consumes:

- `ModuleGraph`
- `RenderGraph`
- `RenderSubtree[]`
- CSS source inputs

It does not consume the symbol table directly.

That is not wrong by itself, because reachability is mostly about import availability and render placement. But in the current implementation it reinforces the broader pattern that later stages lean on simpler structural models and render-oriented summaries more than on the normalized symbol layer.

### Why it matters

- this is part of why the symbol system feels under-consumed relative to its intended importance
- it makes the engine feel like "symbol resolution plus a separate render/reachability pipeline" rather than one layered model
- the current whole-stylesheet reachability summary is still broader than the
  shipped class-level rule contract in some partial render-path scenarios;
  native reachability no longer feeds child availability back into
  whole-component availability across sibling paths, and the new family adapter
  now narrows the remaining gap by deriving render-context classification from
  render-graph routes first, but it still keeps compatibility fallback for
  `css-class-missing-in-some-contexts` and `unreachable-css` until the
  class-safe handoff is published

### Evidence in code

- `src/static-analysis-engine/entry/stages/basicStages.ts`
- `src/static-analysis-engine/pipeline/reachability/buildReachabilitySummary.ts`

### Likely cleanup direction

This may not need a direct reachability-to-symbol dependency. But the project
should decide more explicitly which later stages are supposed to consume
symbol/value summaries and which are intentionally structural. For replacement
work, the follow-on need is even narrower: publish class-safe reachability
inputs at the reachability/rule boundary so the shipped definition-and-usage
adapter can retire its compatibility classifier.

## Issue 6: Shared Policy Ownership Is Better, But Render Seams Still Need Cleanup

### What is happening

Cross-engine budget constants now live in `libraries/policy/`, which is the
right ownership direction.

The remaining pressure point is different:

- render-IR-specific expansion semantics still live near render-IR, as they
  should
- but `buildProjectRenderContext.ts` still carries cross-file helper and
  component availability work that should keep shrinking over time

### Why it matters

- policy ownership is clearer now, which is good
- the next architecture pressure point is no longer shared budgets; it is the
  remaining render-context bridge responsibility

### Evidence in code

- `src/static-analysis-engine/libraries/policy/analysisBudgets.ts`
- `src/static-analysis-engine/pipeline/render-ir/shared/expansionSemantics.ts`
- `src/static-analysis-engine/entry/stages/buildProjectRenderContext.ts`

### Likely cleanup direction

Keep shared budgets in shared policy modules, keep render-specific semantics
local to render-IR, and continue shrinking `buildProjectRenderContext.ts` so it
acts more like a thin adapter than a semantic owner.

## Issue 7: Old-Engine Coupling Still Leaks Through Experimental Rule Execution

### What is happening

The new engine is not fully isolated yet at the rule-execution edge.

Examples:

- `pipeline/rule-execution/types.ts` imports severity/confidence compatibility types from `src/static-analysis-engine/runtime/compatTypes.ts`
- `pipeline/rule-execution/rules/cssDefinitionUtils.ts` imports CSS fact types from `src/facts/types.ts`
- `pipeline/css-analysis/analyzeCssSources.ts` also imports CSS fact types from `src/facts/types.ts`

### Why it matters

- this is survivable during WIP
- but it means the subsystem is not yet fully self-describing at its product-facing edge

### Evidence in code

- `src/static-analysis-engine/pipeline/rule-execution/types.ts`
- `src/static-analysis-engine/pipeline/rule-execution/rules/cssDefinitionUtils.ts`
- `src/static-analysis-engine/pipeline/css-analysis/analyzeCssSources.ts`

### Likely cleanup direction

Either accept this boundary as intentional comparison scaffolding for now, or wrap the reused types behind new-engine-native shapes so the dependency stops leaking through implementation details.

## Issue 8: The Live Docs Need To Stay Aligned With The Code

### What is happening

The live `docs/static-analysis-engine/` directory now contains a rebuilt core doc set:

- `architecture.md`
- `subsystem-boundaries.md`
- `end-to-end-traceability.md`
- `progress-snapshot-2026-04-19.md`
- `archive/`

That is a big improvement. The remaining risk is that these new docs could drift again unless future architecture changes update them deliberately.

### Why it matters

- the project is moving quickly and architectural seams are still changing
- if the live docs lag again, readers will end up back in the same "archive or code spelunking" situation

### Likely cleanup direction

Keep the snapshot as the return-to-work note, and keep the live doc set current:

- current architecture and stage map
- known architectural issues
- current reachability/render-context model
- current traceability model

## Practical Takeaway

An architectural cleanup pass looks justified.

But the likely target is not "turn every helper package into an entry stage". The more useful cleanup is:

1. clarify which `pipeline/` modules are true stages versus shared engine libraries
2. shrink `buildProjectRenderContext.ts` into a thinner adapter
3. move cross-file summary ownership closer to symbol/value layers
4. make shared policy knobs live in shared policy modules
5. document the intended long-term role of selector parsing as shared infrastructure

That would make the implementation easier to explain without requiring a ground-up rewrite.
