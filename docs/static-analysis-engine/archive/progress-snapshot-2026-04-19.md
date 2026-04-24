# Static Analysis Engine Progress Snapshot 2026-04-19

## Purpose

This note is a return-to-work snapshot for the in-flight `static-analysis-engine` effort.

For a narrower implementation-grounded list of current pressure points, see `known-architectural-issues.md`.

It compares the current implementation under `src/static-analysis-engine/` against the original design direction archived in:

- `docs/static-analysis-engine/archive/requirements.md`
- `docs/static-analysis-engine/archive/directory-structure-and-boundaries.md`
- `docs/static-analysis-engine/archive/core-irs-and-type-shapes.md`
- `docs/static-analysis-engine/archive/architecture.md`
- `docs/static-analysis-engine/archive/end-to-end-traceability.md`

It focuses on:

- what is already implemented
- where the implementation has drifted from the original plan
- which requirements still look unfinished
- which decisions still feel ambiguous
- what to do first when work resumes

## Bottom Line

The project is in a good place.

This is no longer just a same-file proof of concept. The current engine already has:

- project-wide parsing, module-graph construction, and symbol records
- cross-file imported binding resolution, including re-export handling
- a distinct render-graph stage
- a much richer render-IR pipeline than the original first slice described
- selector parsing and selector analysis for same-node, ancestor-descendant, parent-child, and sibling relationships
- a real reachability stage with render-context-aware availability records
- shared decision and trace types for uncertainty/explanation
- experimental rule execution on top of the new-engine outputs

So the work is clearly past the original "can we prove the concept?" stage.

The main risk now is not lack of capability. The main risk is architectural blurring:

- cross-file binding propagation is still concentrated in render-context assembly instead of being owned more cleanly by symbol/value layers
- the render IR has grown faster than some of its architectural seams
- some old-engine reuse still exists inside the new subsystem
- the docs no longer describe the real implemented scope clearly enough

## Progress Vs Original Plan

### Requirements that are meaningfully underway or already satisfied in bounded form

#### 1. Module and symbol resolution

Status: substantial progress

Evidence:

- `pipeline/module-graph/` exists and is wired into the entry pipeline
- `pipeline/symbol-resolution/` defines `EngineSymbol`, imported bindings, namespace imports, and project binding resolution
- project analysis resolves relative imports and re-exports into target modules and target symbols

Assessment:

- this is no longer aspirational
- it is real enough to support cross-file work
- but later stages still bypass the symbol model more than the original architecture intended

#### 2. Expression and value evaluation

Status: bounded slice implemented

Evidence:

- `pipeline/abstract-values/` exists and is in the entry path
- tests cover exact strings, conditional class sets, and unknown fallback behavior

Assessment:

- enough exists to support useful class-oriented reasoning
- this is still narrower than the long-term abstract-value vision in the requirements
- class-bearing expressions are ahead of general-purpose value modeling

#### 3. Prop/value flow and helper modeling

Status: partial but meaningful

Evidence:

- render expansion handles `children` and JSX-valued props
- same-file and imported helper definitions are collected and threaded into render work
- imported expression bindings and namespace bindings are propagated into project render context

Assessment:

- this is already beyond the original first slice
- however, helper and prop flow are represented operationally more than through a clean, reusable summary layer

#### 4. Render graph construction

Status: implemented

Evidence:

- `entry/stages/renderGraphStage.ts`
- `pipeline/render-graph/`
- `RenderGraph` with nodes and edges, including `renderPath`

Assessment:

- this was previously a gap and is now present as a distinct stage
- the seam exists, which is good
- it is still fairly lightweight compared with the richer IR sketched in `core-irs-and-type-shapes.md`

#### 5. Approximate rendered subtree modeling

Status: implemented and actively expanded

Evidence:

- `pipeline/render-ir/` is the largest subsystem in the track
- render regions are collected and reused by reachability
- budgets, cycles, unknown nodes, conditional nodes, repeated regions, component references, and subtree insertion are all in play

Assessment:

- this is the strongest part of the current engine
- it clearly surpasses the original same-file-only architecture slice

#### 6. CSS selector constraint modeling and selector satisfiability

Status: implemented for a bounded but useful subset

Evidence:

- `pipeline/selector-parsing/`
- `pipeline/selector-analysis/`
- adapters exist for `sameNodeConjunction`, `ancestorDescendant`, `parentChild`, and `sibling`

Assessment:

- this is a real vertical slice already
- supported selector scope is ahead of the architecture doc's initial target
- unsupported handling remains explicit, which matches the original intent

#### 7. Reachability in the new model

Status: implemented in meaningful WIP form

Evidence:

- `pipeline/reachability/` exists
- reachability uses module graph, render graph, render subtrees, and render regions
- stylesheet availability is attached to source-file, component, render-subtree-root, and render-region contexts
- reachability now emits traces

Assessment:

- this was a major gap in older evaluations and is now materially addressed
- the new engine can now answer more of the intended question: can this selector match, and where is the stylesheet available?
- the current reachability model still looks heuristic and WIP, but it is definitely a first-class stage now

#### 8. Confidence, uncertainty, and explanation

Status: partial but clearly underway

Evidence:

- `types/analysis.ts` now defines `AnalysisDecision`, `AnalysisTrace`, derived confidence, and shared statuses
- selector parsing/analysis and reachability use traces and decisions
- reachability records preserve structured traces instead of only freeform strings

Assessment:

- this is aligned with `end-to-end-traceability.md`
- explanation is still technical and unevenly adopted, but it is no longer just an idea

#### 9. Rule execution on top of the new engine

Status: experimental slice implemented

Evidence:

- `pipeline/rule-execution/`
- experimental rule results exist for selector satisfaction and several CSS-quality checks

Assessment:

- this is enough for comparison and validation
- it is not yet broad rule migration, which still seems like the right call

### Plan areas that are still incomplete or only partially realized

#### 1. A stronger symbol-first architecture

The original plan wanted later stages to consume a normalized symbol/value layer.

Current state:

- symbol structures exist
- but `buildProjectRenderContext.ts` still does a lot of ad hoc cross-file binding propagation itself

Why this matters:

- render-oriented code is still carrying too much name-resolution responsibility
- that makes the system harder to explain and harder to refactor

#### 2. A fuller abstract-value subsystem

The long-term plan described a broader abstract-value IR for strings, objects, arrays, unions, subtree payloads, and summaries.

Current state:

- class-oriented value handling is real
- but the broader evaluator vision is still only partly realized

Why this matters:

- helper summaries, prop summaries, and future rules will probably want a clearer reusable value layer

#### 3. Dedicated explanation ownership across all stages

The plan called for explanation as a first-class concern.

Current state:

- shared trace types exist
- reachability and selector analysis are using them
- adoption is still uneven across module graph, symbol resolution, abstract values, and render expansion

Why this matters:

- the current trace model is promising, but not yet end-to-end

#### 4. Performance and budget instrumentation

The requirements call out explicit budgets, soft failure, determinism, and instrumentation.

Current state:

- budgets and bounded fallbacks clearly exist in parts of the pipeline
- but there is not yet a clear, centralized "engine budgets and cost visibility" story

Why this matters:

- as capability expands, performance uncertainty will become harder to reason about without clearer instrumentation

#### 5. Test-structure maturity

The directory-plan doc suggested `unit/`, `feature/`, `integration/`, `fixtures/`, and `support/`.

Current state:

- `test/static-analysis-engine/unit/` exists and has useful coverage
- `feature/`, `integration/`, `fixtures/`, and `support/` are not yet present as first-class structure

Why this matters:

- current tests prove local behavior well
- but the project still needs more explicit mid-level and end-to-end story coverage if replacement confidence is the goal

## Drift From The Original Plan

### Drift 1: The docs still describe a smaller engine than the code now implements

The architecture doc still frames the work around a narrow first slice:

- same-file intrinsic JSX first
- simple direct local expansion first
- ancestor-descendant as the flagship selector case

Current reality is broader:

- project-wide analysis
- cross-file binding propagation
- imported helpers/constants
- render graph
- render regions
- reachability contexts
- sibling and child combinator analysis
- experimental rules

Assessment:

- this is good implementation progress
- but the docs are now lagging far enough behind that they create confusion instead of clarity

### Drift 2: Some architectural follow-up docs in the plan are missing or renamed

The static-analysis-engine doc map and some architecture notes mention docs like:

- `roadmap.md`
- `uncertainty-and-decision-model.md`
- `module-and-symbol-graph.md`
- `abstract-values.md`
- `render-ir.md`
- `selector-analysis.md`

Current reality:

- several of those files are not present
- some of the content appears to have been replaced by newer focused notes like `end-to-end-traceability.md` and reachability notes

Assessment:

- this is a documentation drift problem, not an implementation problem
- it is still worth fixing, because the current map sends future-you to docs that do not exist

### Drift 3: Directory structure is broadly aligned, but some planned areas are still collapsed

The code has major planned areas like:

- `entry/`
- `parser/`
- `pipeline/module-graph/`
- `pipeline/symbol-resolution/`
- `pipeline/render-graph/`
- `pipeline/render-ir/`
- `pipeline/reachability/`
- `pipeline/selector-analysis/`
- `pipeline/rule-execution/`

But some planned separation is still weak:

- render-context assembly is doing a lot of transitive import/helper/const propagation
- there is no dedicated `config/`, `explain/`, `support/`, or `experimental/` split matching the early directory sketch

Assessment:

- this is acceptable for WIP
- but `buildProjectRenderContext.ts` is now a strong signal that some responsibilities want to be redistributed

### Drift 4: Boundary discipline is better than before, but not fully clean

There is still direct reuse from outside the subsystem, especially:

- `src/static-analysis-engine/pipeline/rule-execution/rules/cssDefinitionUtils.ts` imports from `src/facts/types`
- `src/static-analysis-engine/pipeline/rule-execution/types.ts` imports from `src/runtime/compatTypes`

Assessment:

- this is not catastrophic
- but it does violate the spirit of the original isolation rules
- the rule-execution layer is the main place where old-engine coupling still visibly leaks through

### Drift 5: The current implementation is more "engine plus experimental product surface" than the original doc framing

The original plan emphasized a carefully staged engine before broad rule work.

Current reality:

- experimental rules and comparison tooling already exist and are useful

Assessment:

- this is probably the right practical trade-off
- but the docs should name this explicitly as validation scaffolding, not leave it implied

## Unfinished Requirements

These feel like the most important unfinished requirements relative to the original charter.

### 1. Cleaner ownership of cross-file binding logic

Still unfinished:

- imported constants, helpers, and component definitions are propagated for render use
- but this logic is not yet cleanly owned by a normalized symbol/value summary layer

### 2. Broader abstract-value coverage

Still unfinished:

- the engine does not yet look like it has the richer general-purpose abstract-value model originally envisioned

### 3. End-to-end explanation adoption

Still unfinished:

- traces exist, but not every major stage seems to emit them as a first-class output yet

### 4. Budget/config centralization

Still unfinished:

- budgets exist in practice
- but there is not yet a clear config/budget subsystem matching the original design direction

### 5. Replacement-grade integration testing

Still unfinished:

- there is good unit coverage
- but replacement confidence will need stronger feature/integration coverage around multi-file React patterns and selector/reachability interactions

### 6. Clear migration/replacement story

Still unfinished:

- the original requirements describe eventual replacement criteria
- the code is progressing well, but the project still does not appear to have a current migration or staged adoption document

## Ambiguities To Resolve Later

These are not necessarily bugs. They are decisions that still feel underspecified.

### 1. What is the intended long-term boundary between symbol resolution and render-context preparation?

Right now `buildProjectRenderContext.ts` is useful, but it also looks like a catch-all seam.

Question to resolve later:

- should it stay as a deliberate bridge object
- or should more of its work move into reusable symbol/value summaries before render assembly begins?

### 2. How much of reachability is meant to be structural truth vs bounded heuristic?

The current reachability stage is real and valuable, but it is also quite policy-heavy.

Question to resolve later:

- is the current model the intended baseline
- or is it a temporary bridge until a cleaner render-context/reachability model is defined?

### 3. How much rule-execution coupling to old-engine types is acceptable during WIP?

Current coupling is concentrated and probably survivable.

Question to resolve later:

- should rule execution remain intentionally compatibility-oriented for a while
- or should it become fully new-engine-native sooner

### 4. What is the next "serious vertical slice" success condition?

The original first slice has already been surpassed.

Question to resolve later:

- is the next milestone "architectural cleanup"
- "better explanations"
- "stronger reachability"
- or "one migrated product rule family"

Right now the repo does not state that clearly.

## Recommended Next Steps When Work Resumes

These are ordered for fast re-entry and highest leverage.

### 1. Update the static-analysis-engine docs to match reality

Do this first.

Suggested scope:

- add the current capability envelope to `architecture.md`
- update the doc map so it only references docs that actually exist
- explicitly note that render graph, reachability, and structured decisions/traces are now implemented in WIP form

Why first:

- future-you will re-onboard faster
- this also reduces the risk of "fixing" behavior that is actually intentional current scope

### 2. Decide whether `buildProjectRenderContext.ts` is a temporary bridge or a long-term seam

Suggested output:

- a short design note or code comment-level decision
- list which responsibilities should stay there and which should move out

Why second:

- this is the clearest architectural pressure point in the current codebase

### 3. Pull cross-file constant/helper propagation toward clearer symbol/value ownership

Suggested bounded slice:

- identify one propagation path, probably imported const expressions first
- move it behind a more explicit summary/result shape that render code consumes

Why:

- this will reduce further architecture blur without requiring a giant rewrite

### 4. Expand trace adoption in render expansion and symbol resolution

Suggested bounded slice:

- unresolved imported binding
- helper expansion failure
- component expansion stop because of budget/cycle/unsupported shape

Why:

- explanation is already started
- these are the next highest-value trace points

### 5. Add one feature-level test bucket for multi-file selector-plus-reachability cases

Suggested first feature test themes:

- direct-import stylesheet availability through component composition
- selector satisfiability plus possible/definite reachability
- unknown barriers caused by unresolved component references

Why:

- this will give better confidence than adding more unit-only cases

### 6. Clean up the most obvious old-engine coupling in rule execution

Suggested first cleanup:

- remove or wrap old-engine fact/runtime type reuse where practical

Why:

- this keeps the subsystem honest without blocking ongoing analysis work

## Good Re-Entry Starting Points

If time is tight when work resumes, start with one of these:

1. Doc cleanup only: align `architecture.md` and the doc map with the current implementation.
2. Seam cleanup only: tighten `buildProjectRenderContext.ts` responsibility boundaries.
3. Trace adoption only: add structured traces to the next two or three key render/symbol failure paths.

If there is more time, the best combined sequence is:

1. docs cleanup
2. render-context seam decision
3. one focused propagation refactor
4. one feature-level test pass

## Summary

The static-analysis-engine work is healthy and worth continuing.

The project has already crossed the line from "experimental idea" to "real bounded engine with meaningful capabilities." The immediate need is not more cleverness. The immediate need is consolidation:

- make the docs match the real scope
- tighten cross-file ownership seams
- keep explanation adoption moving
- add a little more feature-level validation

That should make the next stretch of work faster, safer, and much easier to re-enter after time away.
