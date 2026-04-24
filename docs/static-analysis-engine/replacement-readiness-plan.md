# Static Analysis Engine Replacement Readiness Plan

## Purpose

This document defines the close-out plan for replacing the current shipped
scanner implementation with the `static-analysis-engine`.

It exists because tranche 5 established bounded replacement-readiness
validation, but did not by itself define the full replacement gate for the
product.

This plan is intentionally:

- parity-first with the current shipped rules and rule families
- explicit about what still blocks replacement
- separate from any later rule-catalog redesign work

## Decision: Parity First, Redesign Later

The replacement target is:

- first replace the shipped scanner with a new-engine-backed implementation that
  preserves the current shipped rule families and product contract as closely as
  practical
- then treat rule and family redesign as a separate follow-on workstream

Why this is the chosen baseline:

- it keeps replacement measurable
- it avoids mixing engine replacement with product semantics redesign
- it makes comparison results easier to interpret
- it gives later rule redesign a cleaner and safer baseline

This means this document does **not** treat rule-family rework as part of the
replacement gate unless a specific rule is proven to block parity-first
replacement.

## Replacement Target

The target end-state is:

- the main scanner is powered by the `static-analysis-engine`
- the current shipped rule families are available on top of the new engine
- temporary architectural seams have been either removed or reduced to explicit
  migration adapters
- replacement confidence is grounded in comparison, scenario coverage, and
  deliberate migration gates rather than intuition

The target is **not**:

- "new engine plus a redesigned rule catalog"
- "perfect support for every React abstraction style"
- "full runtime simulation"

The engine remains bounded and explicit about uncertainty.

## What Is Already In Place

The current subsystem already has meaningful replacement foundations:

- project-wide parsing, symbol resolution, module graph, render graph, render
  IR, reachability, selector analysis, and experimental rule execution
- comparison tooling against the current scanner
- producer-owned trace propagation through the main selector-derived reasoning
  path
- a static-analysis-engine-specific feature validation bucket under
  `test/static-analysis-engine/feature/`

This is enough to plan close-out deliberately rather than continuing with open-
ended exploratory work.

## Remaining Workstreams

The remaining work falls into five workstreams.

### 1. Architecture close-out

Goal:

- make the live engine match the documented target subsystem boundaries closely
  enough that replacement does not rely on temporary internal seams

Still open:

- reduce or remove `entry/stages/buildProjectRenderContext.ts` as a semantic
  owner
- remove direct old-engine type leakage from CSS analysis and rule execution
- continue shifting helper/prop flow and cross-file semantic ownership toward
  reusable symbol-resolution and abstract-value summaries
- keep later stages consuming authoritative upstream outputs instead of
  re-deriving meaning

Done when:

- `buildProjectRenderContext.ts` is deleted or reduced to a thin adapter with no
  cross-file semantic ownership
- CSS analysis and rule execution use new-engine-native contracts at their
  durable subsystem boundary
- the live entry pipeline shape matches the documented target architecture or
  any remaining seams are documented as deliberate migration adapters

### 2. Capability completion for parity-first replacement

Goal:

- cover the bounded capability set needed to replace the current shipped scanner
  on its real rule set

Important framing:

- this is not "support every imaginable React pattern"
- this is "support enough bounded render/value cases to replace the shipped
  product with acceptable confidence"

Current capability notes:

- `children` flow and JSX-valued subtree props are already supported in bounded
  forms
- imported constants and imported helper behavior are already supported in
  several bounded cross-file cases
- unsupported helper argument flows still degrade to explicit unknown outcomes,
  which is acceptable as long as the product contract handles them deliberately
- the current engine does **not** yet expose a first-class CSS-Module semantic
  layer equivalent to the shipped scanner's CSS-Module import/property model
- the current engine **does** now propagate directly imported external CSS and
  fetch-remote project-wide HTML-linked external stylesheets through native
  reachability
- the current engine now publishes a first-class `externalCssSummary` with
  active declared providers, and the first native
  `missing-external-css-class` slice now consumes that summary together with
  native reachability and class-expression evidence
- first-release decision:
  runtime-specific fetch-remote retrieval, failure fallback, and operational-
  warning shaping stay adapter-backed in the current scanner/runtime layer while
  the new engine consumes fetched stylesheet texts and normalized external CSS
  summary inputs
- broad render-prop or arbitrary component-as-prop support is **not** assumed to
  be part of the current replacement baseline unless a shipped rule truly needs
  it

Still open:

- decide exactly which currently shipped rules require additional render/value
  capability before they can migrate cleanly
- add any missing bounded support required for those rules
- add a first-class CSS-Module semantic layer before native CSS-Module rule
  cutover
- finish parity validation and cutover planning for the native external CSS
  rule slice, with the first-release adapter decision now locked for runtime-
  specific fetch/fallback behavior
- distinguish "needed for parity-first replacement" from "nice follow-on engine
  expansion"

Done when:

- every shipped rule family has a documented dependency on existing engine
  capabilities, planned engine work, or an explicit migration adapter
- no shipped rule migration is blocked by an unowned capability gap

### 3. Rule migration and parity

Goal:

- move from experimental new-engine rules to deliberate support for the current
  shipped rule families

Still open:

- define which current rules migrate directly onto the new engine
- define where temporary adapters or shadow-mode coexistence remain acceptable
- confirm severity, confidence, deterministic finding identity, and output
  semantics match the shipped product contract closely enough

Recommended migration order:

1. rules already closest to selector/reachability evidence
2. CSS-structure rules already partially implemented experimentally
3. ownership and broader file-organization rules
4. remaining rule families that need explicit compatibility decisions

Done when:

- each shipped rule family is marked as one of:
  - migrated to new-engine-native implementation
  - wrapped through an explicit temporary compatibility adapter
  - intentionally deferred with a written replacement decision
- product-facing output semantics are documented and verified for migrated rule
  families

### 4. Validation, testing, and comparison gate

Goal:

- prove replacement readiness with scenario coverage and measured comparison

Still open:

- extend feature coverage beyond the initial tranche-5 validation slice
- add stronger integration-style validation for multi-file React projects and
  real scanner entry behavior
- define comparison expectations rule-family by rule-family rather than only in
  ad hoc scenarios
- make replacement gates explicit enough that a future switch can be approved or
  rejected deliberately

Required validation layers:

- unit validation for stage-local behavior
- feature validation for multi-stage scenarios
- comparison validation against the current scanner
- integration validation for end-to-end scan behavior

Minimum replacement gate:

- critical migrated rule families have scenario coverage for:
  - direct success paths
  - bounded possible/unknown paths
  - representative cross-file composition paths
- comparison results are reviewed intentionally rather than treated as raw pass/
  fail numbers
- known divergences are cataloged as:
  - expected improvement
  - acceptable temporary gap
  - blocking regression

Done when:

- the repo has a stable replacement-readiness suite, not only exploratory tests
- the comparison story is explicit enough to support a deliberate ship/no-ship
  decision

### 5. Product cutover and deprecation plan

Goal:

- switch to the new engine deliberately, with clear rollback and follow-up work

Still open:

- choose the first product-facing cutover shape
- document whether rollout is:
  - internal/shadow only
  - opt-in
  - default-on with fallback
  - full replacement
- define when comparison tooling remains in the repo after cutover
- define when old-engine-only rule logic can be removed

Done when:

- there is a written cutover sequence
- ownership of post-cutover cleanup is explicit
- removal criteria for old-engine internals are named

## Current Blocking Items

These are the main blockers to full replacement today.

### Blocker 1: `buildProjectRenderContext.ts` still owns too much cross-file meaning

Why it blocks close-out:

- the target architecture says later stages should consume normalized upstream
  summaries
- this file still performs transitive helper propagation, component availability
  assembly, and namespace materialization

Required close-out action:

- move remaining cross-file semantic ownership upward into symbol-resolution or
  abstract-value-owned summaries instead of leaving it in render-context glue,
  then leave only a thin render adapter if one is still useful

### Blocker 2: old-engine type leakage still exists at the CSS/rule edge

Why it blocks close-out:

- the target architecture explicitly says these edges should become
  new-engine-native
- durable replacement should not depend on deep old-engine fact/runtime types at
  the new-engine boundary

Required close-out action:

- replace reused old-engine shapes with new-engine-native contracts or thin
  compatibility wrappers that live only at deliberate migration boundaries

### Blocker 3: rule-family replacement planning is started but not detailed enough

Why it blocks close-out:

- the migration matrix establishes the family-level shape, but it is not yet the
  same thing as family-specific cutover decisions
- replacement still cannot be approved from engine capability alone
- the shipped product is defined by its rule behavior and output contract

Required close-out action:

- turn the migration matrix into explicit family-level parity contracts,
  adapter decisions, known divergences, and cutover readiness checks

### Blocker 4: replacement-grade validation is still too narrow

Why it blocks close-out:

- tranche 5 added the first real feature bucket, but that is only the start of
  a replacement gate
- the project still needs broader scenario and integration coverage

Required close-out action:

- expand the validation suite to cover the highest-risk shipped rule families
  and real multi-file project patterns
- define explicit replacement acceptance criteria and comparison expectations so
  cutover confidence is measured rather than intuitive

### Blocker 5: CSS Modules are not yet first-class native, and external CSS
cutover is not finished

Why it blocks close-out:

- the shipped CSS-Module rules depend on semantics that the current new engine
  does not yet publish as a first-class layer
- the shipped external CSS story now has a first meaningful native rule path,
  but it still needs parity validation before cutover even though the first-
  release decision is now to keep runtime-specific fetch/fallback behavior
  adapter-backed

Required close-out action:

- add the missing CSS-Module semantic layer needed for native rule migration
- complete external CSS parity validation on top of the native summary,
  reachability, and rule surfaces while keeping runtime-specific fetch/fallback
  behavior in an explicit first-release adapter boundary

### Blocker 6: cutover mechanics are still undefined

Why it blocks close-out:

- even a technically ready engine is not ready to replace production behavior
  without a rollout and cleanup plan

Required close-out action:

- write the cutover sequence and the criteria for removing old-engine paths

## Recommended Execution Order

This is the recommended close-out sequence.

### Phase 1: lock the replacement contract

Deliverables:

- this parity-first replacement plan
- a per-rule-family migration matrix
- a short definition of what counts as a blocking regression versus an expected
  improvement

Why first:

- it keeps the rest of the work measurable

### Phase 2: finish architectural cleanup

Deliverables:

- thinner or removed `buildProjectRenderContext.ts`
- reduced temporary seam count
- new-engine-native CSS/rule boundary contracts
- more cross-file meaning owned by reusable symbol/value summaries rather than
  render-context assembly

Why second:

- it lowers long-term maintenance risk before rule migration goes broader

### Phase 3: migrate rule families in priority order

Deliverables:

- parity-first implementations or explicit compatibility adapters for shipped
  rule families
- documented output-contract checks

Why third:

- this is the first point where replacement can become product-real

### Phase 4: broaden replacement validation

Deliverables:

- larger feature suite
- targeted integration coverage
- curated comparison baselines and reviewed known divergences
- written acceptance criteria for parity-first cutover decisions

Why fourth:

- this is where local confidence becomes release confidence

### Phase 5: plan and execute cutover

Deliverables:

- rollout decision
- cutover checklist
- post-cutover cleanup plan

Why fifth:

- replacement should be the last deliberate act, not an implicit drift

## What Is Explicitly Deferred

These areas are not part of the parity-first replacement gate unless they prove
necessary for a shipped rule family.

- broad rule-family redesign
- speculative new rule families
- arbitrary render props
- arbitrary component-as-prop modeling
- full general-purpose JS evaluation
- framework-specific abstractions that are not required for current parity

These may become follow-on work once parity-first replacement is complete.

## Documentation Discipline During Close-Out

The close-out phase still needs explicit documentation discipline while seams
are moving.

Required rule:

- keep the live docs synchronized with the current implementation and target
  replacement plan

In practice this means:

- keep `current-to-target-map.md` current when a temporary seam changes status
- keep `replacement-readiness-plan.md` current when the replacement gate or
  blockers change
- keep `rule-family-migration-matrix.md` current when a family moves from
  experimental coverage to native migration or adapter-backed cutover
- keep "current vs target vs temporary" wording explicit whenever a seam is
  narrowed, promoted, or retired

The goal is to avoid reintroducing drift between:

- current implementation facts
- temporary migration seams
- durable target architecture

## Immediate Next Close-Out Artifacts

The next highest-value close-out artifacts after this plan, the migration
matrix, the acceptance checklist, and the cutover checklist are:

- a short parity contract for the first native migration wave
- a family-level divergence log or review record for known comparison
  differences
- targeted per-family cutover checklists where a generic global checklist is not
  precise enough

Those artifacts should make these things explicit:

- which divergences count as blocking regressions versus expected improvements
- which comparison thresholds and feature/integration scenarios must pass before
  cutover
- which family-specific semantics map engine outcomes onto shipped findings
- which adapters are allowed in the first replacement release and what retires
  them later

## Summary

The static-analysis-engine track is now past exploratory architecture work and
past bounded tranche-5 validation.

The remaining task is not "keep proving the engine exists." The remaining task
is:

- close the architectural seams
- migrate the shipped rules deliberately
- define the replacement gate explicitly
- cut over on purpose

One important nuance for close-out tracking:

- tranche 5 validation is complete for its bounded scope
- the remaining work is broader replacement validation, native migration, and
  cutover planning rather than an uncompleted tranche 5

The core strategic decision is now locked:

- replace the current shipped rule families first
- redesign rules and families later, as separate work
