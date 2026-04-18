# Static Analysis Engine Roadmap Status And Organization Review

## Purpose

This note benchmarks the current static-analysis-engine implementation against the roadmap and records a light code-organization review.

It is intended as a quick progress snapshot rather than a new architecture proposal.

## Overall Status

The static-analysis-engine track has completed Phase 5 and is ready to treat Phase 6 as the next major milestone.

In practical terms:

- the new engine has its own bounded pipeline
- it can parse source, build bounded same-file render structure, normalize selectors, and answer selector satisfiability questions
- it already supports a broader selector subset than the original minimum target for Phase 4
- it can now expand bounded same-file local component composition with explicit uncertainty and budget boundaries

The biggest remaining gap is that the engine is still mostly same-file, which makes bounded cross-file reasoning the clear next step.

## Roadmap Benchmark

### Phase 1: Foundation And Boundaries

Status: complete

Evidence:

- the static-analysis-engine doc set exists under `docs/static-analysis-engine/`
- the code lives under `src/static-analysis-engine/`
- tests live under `test/static-analysis-engine/`
- the subsystem has explicit staged boundaries

### Phase 2: Core IR And Graph Scaffolding

Status: complete for the intended first slice

Evidence:

- module graph scaffolding exists under `pipeline/module-graph/`
- symbol collection exists under `pipeline/symbol-resolution/`
- abstract value and abstract class set work exists under `pipeline/abstract-values/`
- the staged entrypoint exists in `entry/scan.ts`

Notes:

- this is still intentionally bounded
- the engine does not yet have broad multi-module reasoning

### Phase 3: Bounded Same-File Analysis

Status: complete for the intended first slice

Evidence:

- same-file render subtree construction exists under `pipeline/render-ir/`
- intrinsic JSX, fragments, and conditionals are supported
- element nodes carry class summaries
- unresolved component references are preserved explicitly instead of being guessed at

Notes:

- same-file local component expansion now exists, so this phase remains complete as the foundation under the richer Phase 5 work

### Phase 4: First Selector Satisfiability Slice

Status: complete and slightly ahead of the original minimum

Evidence:

- selector extraction exists
- selector parsing and normalization exist
- selector-analysis dispatch exists
- selector-specific adapters exist
- same-file selector satisfiability is implemented
- unsupported cases are explicit
- source anchors and debug-oriented structure are preserved

Currently supported selector shapes:

- same-node conjunction: `.a.b`
- ancestor-descendant: `.a .b`
- parent-child: `.a > .b`
- adjacent sibling: `.a + .b`
- general sibling: `.a ~ .b`

CSS-side context preserved:

- source anchors
- comma-separated selector splitting
- `@media` ancestry as preserved context only

Notes:

- this is ahead of the roadmap’s original Phase 4 minimum, which focused mainly on ancestor-descendant and same-node support

### Phase 5: Bounded Local Component Expansion

Status: complete

Evidence:

- same-file local component inlining is implemented
- simple prop passing is implemented
- `children` insertion is implemented
- generic named JSX subtree props are implemented
- bounded component expansion depth is enforced explicitly
- helper-expansion and component-expansion failures now preserve explicit unresolved reasons
- statement-level bounded control flow and bounded list rendering now feed the expanded render IR

### Phase 6: Early Cross-File Reasoning

Status: not started in a meaningful way

What is missing:

- imported component expansion
- imported constant propagation for render reasoning
- imported helper summaries for render reasoning
- bounded cross-file component traversal

### Phase 7: Pilot Rule Migration And Comparison

Status: not started

What is missing:

- new-engine-native rule execution skeleton
- shadow-mode comparison harnesses
- comparison fixtures for old vs new behavior

### Phase 8: Broader Engine Maturation

Status: not started

### Phase 9: Replacement Planning

Status: not started

## Plain-Language Benchmark

The project is currently here:

- architecture proof: yes
- bounded same-file render reasoning: yes
- first flagship capability: yes
- richer-than-planned initial selector support: yes
- local component composition reasoning: yes
- cross-file reasoning: no
- rule migration: no
- replacement planning: no

The simplest honest summary is:

- the engine is a successful Phase 5 prototype with Phase 6 as the next milestone

## Code Organization Review

## High-Level Verdict

The code organization is generally good.

Responsibilities are mostly split clearly by stage, and the selector-analysis stage in particular now has a noticeably cleaner shape than earlier iterations.

The current organization is good enough to continue building on without a restructuring pause.

## What Is Working Well

### 1. Stage boundaries are real

The pipeline structure in `src/static-analysis-engine/pipeline/` is meaningful rather than cosmetic.

Examples:

- `parse/`
- `module-graph/`
- `symbol-resolution/`
- `abstract-values/`
- `render-ir/`
- `selector-analysis/`

This matches the architecture docs well.

### 2. The entrypoint is acting like orchestration

`entry/scan.ts` now reads like a true staged pipeline:

- parse stage
- symbol stage
- module graph stage
- abstract value stage
- render IR stage
- selector input stage
- selector parsing stage
- selector analysis stage

That is exactly the right direction.

### 3. Selector-analysis responsibilities are now much cleaner

This stage is in a good state structurally.

There is now a sensible internal split between:

- extraction
- parsing / normalization
- orchestration
- adapters
- traversal helpers
- evaluation helpers

That is a strong single-responsibility improvement over the earlier monolithic selector file.

### 4. Shared helpers are mostly local to the stage that needs them

Examples:

- `renderInspection.ts`
- `selectorEvaluationUtils.ts`

These are shared where needed, but still scoped to selector-analysis rather than promoted prematurely into a fake global framework.

That is a good architectural choice.

## Where Responsibilities Are Starting To Blur

These are not urgent problems, but they are worth watching.

### 1. `buildSameFileRenderSubtrees.ts` is carrying a lot

This file currently handles:

- component-like declaration discovery
- return-expression detection
- render-node construction
- JSX element normalization
- `className` extraction
- source-anchor creation
- expression unwrapping

That is still acceptable for the current bounded slice, but it is one of the clearest candidates to split later.

Likely future split points:

- component discovery
- JSX-to-render-node conversion
- shared source-anchor helpers
- class attribute extraction

### 2. `classExpressions.ts` is doing both collection and evaluation

This file currently contains:

- AST walking to collect `className` expressions
- expression summarization
- conversion to abstract class sets
- tokenization helpers
- source-anchor helpers

This is still manageable, but it is close to being more than one responsibility.

A future split might separate:

- collection
- expression evaluation
- abstract class set derivation

### 3. `extractSelectorQueriesFromCssText.ts` is now doing real parsing work

This was originally just a tiny extractor.

Now it:

- strips comments
- walks CSS blocks
- handles nested `@media`
- finds matching braces
- splits selector preludes
- computes anchors

That is still coherent because it is all part of CSS selector-source extraction, but it has clearly graduated from “tiny helper” into “mini CSS extraction stage.”

That is fine.

It just means future CSS-side work may eventually want:

- a small CSS block walker
- then selector extraction layered on top

### 4. The selector adapters are not yet stylistically uniform

The adapter split is good, but the implementations are not all using the same internal style yet.

Examples:

- `parentChild.ts` uses the render inspection adapter pattern
- `ancestorDescendant.ts` uses its own direct traversal
- `sibling.ts` uses sequence expansion logic
- `sameNodeConjunction.ts` uses simpler direct recursion

This is not a bug.

Some variation is natural because the constraints differ.

But it does mean the stage is still in “stabilizing local patterns” mode rather than “fully converged style” mode.

## Single-Responsibility Assessment

At a rough level:

- most directories: good
- most stage entry files: good
- selector-analysis files: good to very good
- render-ir and abstract-values core files: acceptable now, likely future split candidates

So the answer is:

- yes, responsibilities are mostly clearly split
- no, the system is not drifting into one giant blob
- but a few files are naturally becoming “dense bounded implementations” and should be watched as the next expansion phases begin

## Best Current Example Of Good Organization

The selector-analysis stage is probably the best current example of the intended architecture working in code.

Why:

- parsing is separate from extraction
- orchestration is separate from constraint handlers
- constraint handlers live in `adapters/`
- stage-local shared helpers exist
- types are explicit

That is a healthy pattern to imitate elsewhere.

## Most Likely Next Refactor Candidates

If future work makes certain files too large, the best candidates to split are:

1. `pipeline/render-ir/buildSameFileRenderSubtrees.ts`
2. `pipeline/abstract-values/classExpressions.ts`
3. `pipeline/selector-analysis/extractSelectorQueriesFromCssText.ts`

These are all still reasonable today, but they are the most likely places to accumulate “just one more helper” pressure.

## Recommendation

The project should continue forward without a broad restructuring pass.

Recommended stance:

- keep the current stage layout
- keep selector-analysis as the model for good local organization
- only split heavier files when the next capability slice creates real pressure

In other words:

- structure is good enough to keep shipping bounded slices
- no immediate cleanup detour is required

## Recommended Next Milestone

The roadmap benchmark suggests the next major milestone is Phase 6:

- early cross-file reasoning

That is now the clearest next capability jump and the biggest remaining gap relative to the roadmap sequence.
