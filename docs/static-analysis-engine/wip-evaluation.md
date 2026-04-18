# Static Analysis Engine WIP Evaluation

## Purpose

This document records a work-in-progress evaluation of the in-flight implementation under `src/static-analysis-engine/` against:

- [requirements.md](./requirements.md)
- [architecture.md](./architecture.md)
- [directory-structure-and-boundaries.md](./directory-structure-and-boundaries.md)

It is intended to help the team decide whether to:

- adjust the implementation to better fit the intended architecture
- adjust the docs to reflect intentional evolution
- or make explicit product decisions where the requirements are still underspecified

This is a snapshot of the current state, not a replacement architecture.

## Overall Assessment

The new engine is not off the rails.

It already demonstrates several real capabilities that go beyond the first bounded slice described in `architecture.md`, including:

- bounded cross-file component expansion
- bounded cross-file helper and constant propagation
- `children` and JSX-valued prop insertion
- explicit budget and cycle outcomes
- selector analysis for ancestor-descendant, parent-child, sibling, and same-node compound selectors
- experimental rule execution and comparison harnesses

That is meaningful progress.

However, the implementation has drifted from the documented staged architecture in a few important ways:

- some capabilities have expanded faster than the architectural seams
- some required subsystems are still missing as first-class stages
- some old-engine reuse has leaked into the new subsystem outside the preferred boundary shape

The main conclusion is:

- the implementation is promising
- but the subsystem needs architectural tightening before it grows much further

## What Appears Aligned

The following areas are broadly aligned with the requirements and architecture.

### 1. Isolation as a separate subsystem

The work lives under:

- `src/static-analysis-engine/`
- `test/static-analysis-engine/`
- `docs/static-analysis-engine/`

This matches the intended project-within-a-project structure.

### 2. Bounded analysis mindset

The implementation already preserves several bounded-analysis outcomes rather than pretending to know more than it does.

Examples include:

- unresolved component references
- unsupported prop passing
- helper expansion failure reasons
- cycle detection
- budget-exceeded outcomes

This is consistent with the requirements emphasis on explicit uncertainty and boundedness.

### 3. Render-structure reasoning is real

The new engine is already reasoning about approximate rendered structure rather than only file-level class-token presence.

That is the most important architectural departure from the old scanner, and it is visible in the current render IR and selector analysis code.

### 4. Comparison-first development remains intact

The subsystem can still be evaluated beside the current scanner through the experimental comparison harnesses.

That is healthy and consistent with the coexistence requirement.

## Main Drift Areas

These are the most important ways the current implementation no longer cleanly matches the docs.

### 1. Reachability is not yet a real stage in the new engine

This is the clearest architectural gap.

The requirements and architecture both say the new engine should answer questions of the form:

- can this selector match?
- and is the stylesheet available where it could match?

The current implementation does not yet appear to have a first-class reachability stage inside `src/static-analysis-engine/`.

Instead:

- CSS sources are parsed into selector inputs and CSS summaries
- selector matching runs against render subtrees
- rule execution consumes selector results and CSS file facts

What is missing is a normalized new-engine concept like:

- `ReachabilitySummary`
- render-context stylesheet availability
- definite versus possible stylesheet availability tied to selector matching

This means the implementation currently satisfies only part of the flagship query described in the architecture.

### 2. Symbol resolution is underpowered relative to how much work depends on it

There is a symbol-resolution subsystem, but the actual cross-file reasoning path is not strongly centered on it yet.

In practice, much of the cross-file behavior is currently handled by render-stage orchestration that:

- collects exported component definitions
- collects exported helper definitions
- collects exported const bindings
- walks re-exports and imports directly
- builds file-level imported binding maps for render expansion

That is functional, but it does not yet match the architectural intention that:

- module graph construction should model source relationships
- symbol resolution should answer binding questions over that graph
- later stages should consume a normalized symbol model

Current risk:

- the render stage is becoming the place where resolution logic accumulates
- explanation and debugging will get harder as more special-case propagation is added there

### 3. The staged architecture is partially collapsed in `entry/scan.ts`

The architecture doc describes a clean progression through distinct stages and IRs.

The current implementation still has stages in spirit, but some boundaries are blurred:

- render IR orchestration is doing substantial import/export resolution work
- there is no separate render graph stage
- there is no separate reachability stage
- explanation is not represented as a dedicated subsystem

This is not a correctness failure yet.

It is a maintainability concern.

If left as-is, future features are likely to pile onto:

- `entry/scan.ts`
- render expansion helpers
- selector-analysis result strings

rather than landing in clearer domain-specific stages.

### 4. The first-slice docs no longer describe the current capability envelope

`architecture.md` frames the first bounded slice as roughly:

- same-file intrinsic JSX
- same-file class evaluation
- direct local component expansion only when simple and bounded
- no arbitrary list expansion

The implementation now goes materially beyond that.

It already includes:

- cross-file component expansion
- multi-hop import and re-export handling
- helper resolution across files
- bounded array handling and repeated regions
- sibling selector support

That is good engineering progress, but the docs are now underselling the implemented scope while also failing to define where the new practical boundary now sits.

### 5. Some old-engine reuse crosses the preferred boundary

The boundary docs say the new engine should avoid deep imports from old-engine internals except through deliberate compatibility boundaries.

The implementation currently includes direct reuse from outside `src/static-analysis-engine/`, especially around CSS parsing and scanner comparison.

Not all of that reuse is bad.

Two different cases should be distinguished:

- comparison harness reuse is acceptable in spirit, because coexistence requires contact points
- deep parsing/fact reuse inside the new engine pipeline is more architecturally questionable

Current concern:

- the code is starting to depend on old-engine parsing and fact shapes as if they were neutral infrastructure
- that weakens the claim that the new engine owns its own reasoning path

## Concrete Recommendations

The recommendations below are ordered by priority rather than by ease.

### Recommendation 1: Add a real WIP reachability stage before further selector/rule growth

This should be the next major architectural correction.

Suggested deliverable:

- introduce a `pipeline/reachability/` subsystem
- define a small `ReachabilitySummary` type owned by the new engine
- thread reachability into selector satisfiability instead of leaving it implicit or external

Suggested first bounded scope:

- model stylesheet availability from direct CSS imports only
- distinguish `definite`, `possible`, and `unknown`
- attach availability at file or component-entry context first
- do not attempt route modeling in the first new-engine reachability slice

Why this should happen soon:

- the docs explicitly make reachability part of the flagship capability
- otherwise the engine will keep expanding selector sophistication on top of an incomplete product question

### Recommendation 2: Promote symbol resolution into a true dependency for later stages

The next architectural tightening should move cross-file binding logic out of render-stage orchestration and into a more explicit symbol/value resolution layer.

Suggested deliverable:

- extend the symbol model so imported symbols can resolve to actual target symbols or explicit unresolved records
- add symbol-resolution outputs that later stages consume directly
- reduce direct ad hoc re-export walking from `entry/scan.ts`

Suggested near-term shape:

- keep the current helper/component/const concepts
- but represent them through normalized symbol records or symbol summaries
- make render IR depend on those normalized summaries rather than rebuilding import logic itself

Why this matters:

- it will keep render IR focused on structure
- it will make later explanation and trace support much easier

### Recommendation 3: Keep the current render IR capability, but freeze expansion breadth until the seams are repaired

The engine is already doing ambitious work in render expansion.

That is a strength, but it is also where drift is currently accumulating.

Suggested decision:

- pause adding major new render-language features
- use the next iteration to stabilize stage boundaries instead

Concrete examples of features that should probably wait:

- broader list/iteration modeling
- more advanced helper signatures
- more dynamic intrinsic tag reasoning
- richer slot conventions

Concrete examples of work that should proceed:

- factor resolution responsibilities out of render orchestration
- formalize reachability
- formalize explanation payloads

### Recommendation 4: Introduce a minimal explanation subsystem now, before traces become harder to recover

The current engine returns useful `reasons`, but mostly as flat strings.

That is enough for tests today, but it is not yet the “explainable model” described in the requirements.

Suggested deliverable:

- add `types/explain.ts` or `pipeline/explain/`
- define a compact structured trace type
- attach trace objects to a small number of key decisions first

Suggested first traced decisions:

- imported symbol resolution
- component expansion success/failure
- helper expansion success/failure
- selector match outcome classification

Important constraint:

- keep the first trace schema technical and small
- do not try to design final user-facing prose yet

### Recommendation 5: Separate “comparison/adapters” from “engine pipeline” more explicitly

The current experimental comparison tooling is useful and should stay.

But the repo should make the new-engine boundary more legible.

Suggested deliverable:

- move or rename comparison-facing integration points under an explicit adapter/compatibility area
- keep pipeline code free of old-engine dependencies wherever possible

Practical effect:

- it becomes easier to see which code is intrinsic to the new engine
- and which code exists only because the old and new systems must coexist for now

### Recommendation 6: Update the architecture docs to reflect the current actual scope

Some of the current implementation has gone beyond the first-slice architecture in a good way.

The docs should acknowledge that instead of continuing to describe only the earliest same-file slice.

Suggested doc change:

- keep the original first-slice description as historical intent
- add a section that states the current implemented capability envelope
- state which parts are experimental but intentionally in scope

This would reduce confusion for future contributors and avoid repeated “is this drift or planned expansion?” uncertainty.

## Suggested Short-Term Work Plan

The most useful near-term sequence is likely:

1. Define a minimal new-engine `ReachabilitySummary`.
2. Thread reachability into selector satisfiability results.
3. Define a compact structured explanation payload for selector and expansion outcomes.
4. Refactor cross-file binding propagation so more of it is represented through symbol/value summaries instead of render-entry orchestration.
5. After those seams are in place, decide whether to continue expanding render capabilities or begin migrating a clearer product rule slice.

This sequence preserves momentum while reducing architectural debt.

## Product Decisions And Remaining Ambiguities

The following decisions have now been clarified.

Where a recommendation has been accepted, this document records that as the working direction for the static-analysis-engine track.

### 1. What is the intended status of reachability in the first replacement-worthy engine?

The docs currently imply that selector satisfiability without reachability is incomplete.

Decision:

- reachability is required before the engine counts as having a meaningful vertical slice

Working direction:

- do not treat selector satisfiability alone as sufficient
- implement a first-class reachability stage before claiming a replacement-worthy engine slice
- allow the first new-engine reachability model to be narrow and bounded, such as direct-import-driven availability first

Implication:

- future roadmap and architecture updates should describe reachability as part of the first serious end-to-end slice, not as an optional later enhancement

### 2. Should the render graph remain a distinct stage, or has the project intentionally collapsed it into render IR?

The architecture says render graph and render subtree IR are distinct.

The current code does not strongly preserve that distinction.

Decision:

- keep the concept distinct in the architecture
- allow a lightweight render-graph summary rather than forcing a heavyweight standalone subsystem immediately

Working direction:

- future cleanup should restore an explicit render-graph seam
- that seam can remain small if it is enough to preserve the architectural distinction between component-composition reasoning and rendered-subtree reasoning

### 3. How strict should isolation be around parser and fact reuse?

The current docs prefer explicit porting or adapter boundaries.

The current code already reuses some old-engine parsing/fact code directly.

Decision:

- be strict

Working direction:

- long-term new-engine pipeline code should not depend on old-engine parser or fact internals
- if similar logic needs to exist in the new engine, it should be re-implemented or explicitly ported into `src/static-analysis-engine/`
- comparison and compatibility code may still bridge to the old scanner, but those contacts should remain explicit and localized

Implication:

- existing direct reuse inside the pipeline should now be treated as architectural cleanup work, not as an acceptable steady state

### 4. What is the target public shape of new-engine explanations?

The requirements want explanation and traceability, but they do not yet specify how much should be:

- internal-only debug metadata
- exposed through tests
- surfaced in comparison tooling
- surfaced in future user-facing output

Decision:

- start with developer-facing structured traces only
- defer user-facing explanation wording until rule migration is farther along

Working direction:

- the next explanation work should focus on structured trace payloads for maintainers and tests
- avoid prematurely locking in user-facing prose or UI-oriented explanation formats

### 5. Is the current cross-file expansion breadth intentional product scope, or should some of it be treated as provisional experimentation?

The implementation already supports substantial cross-file reasoning.

What is unclear is whether the team views that as:

- part of the intended bounded baseline
- or useful experimentation that may later be narrowed or reshaped

This matters for docs, tests, and refactoring risk tolerance.

Decision:

- the current cross-file component/helper/const expansion breadth was deliberate

Working direction:

- update the docs so they describe that cross-file reasoning as intentional current scope
- continue treating it as bounded and budgeted
- avoid describing it as accidental drift or purely provisional experimentation

### 6. When should rule migration begin in earnest?

The engine already has experimental rule execution, but some foundational seams are still missing.

Decision:

- prioritize getting the engine finished first

Working direction:

- do not accelerate broad rule migration yet
- complete the missing engine foundations first, especially reachability and clearer architectural seams
- continue using experimental rule execution and comparison work as validation support rather than as the main near-term focus

## Consequences For The Near-Term Plan

Given the decisions above, the near-term priorities should now be read as:

1. add first-class reachability to the new engine before claiming a serious vertical slice
2. restore or introduce an explicit lightweight render-graph seam
3. remove old-engine parser/fact reuse from the long-term pipeline path
4. add developer-facing structured traces
5. update the docs to describe intentional cross-file reasoning accurately
6. postpone broad rule migration until those foundations are in place

## Proposed Exit Criteria For The Next Architecture-Cleanup Phase

The next cleanup phase should be considered successful when all of the following are true:

- the new engine has a first-class reachability stage, even if narrow
- selector satisfiability results can explain structural outcome and availability outcome separately
- cross-file binding logic is less concentrated in `entry/scan.ts`
- comparison/adaptation boundaries are more explicit
- docs describe the current implemented scope honestly

At that point, the project will be in a better position to decide whether to:

- continue deepening the engine
- migrate a clearer rule slice
- or revise the architecture docs around intentional simplifications

## Recommendation

Treat the current implementation as a successful experimental expansion that now needs a deliberate architecture-consolidation pass.

The main near-term focus should be:

- reachability
- stronger symbol/value seam ownership
- minimal structured explanation
- clearer subsystem boundaries

Those changes are more important right now than adding another round of clever render or selector cases.
