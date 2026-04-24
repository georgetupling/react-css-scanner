# Static Analysis Engine Replacement Acceptance Criteria Checklist

## Purpose

This document defines the explicit ship/no-ship checklist for approving
parity-first replacement of the current scanner runtime with the
`static-analysis-engine`.

It is the companion to:

- `replacement-readiness-plan.md`
- `rule-family-migration-matrix.md`
- `current-to-target-map.md`
- `docs/design/rules.md`
- `docs/design/runtime-contracts.md`

Its job is to answer:

- what must be true before a product-facing cutover is approved
- what counts as a blocking regression versus an acceptable difference
- what evidence must exist before the project can say the new engine is ready

## Scope

This checklist is for parity-first replacement.

It allows:

- new-engine-native rule migrations
- explicit temporary compatibility adapters
- staged cutover shapes such as shadow-only or default-on with fallback

It does **not** treat future rule redesign as part of the acceptance gate.

## Decision Vocabulary

Use these labels consistently when reviewing comparison and validation results:

- `expected improvement`: the new engine is more precise, more explainable, or
  more context-aware without breaking the shipped rule family or runtime
  contract
- `acceptable temporary gap`: a known limitation is still present for first
  replacement, but the gap is documented, bounded, owned, and paired with an
  explicit adapter, fallback path, or retirement trigger
- `blocking regression`: the new engine breaks a shipped rule, runtime contract,
  deterministic behavior, or required user-visible behavior in a way that is not
  explicitly accepted

## Required Evidence Pack

Before any product-facing cutover review, these artifacts should exist and be
current:

- `current-to-target-map.md`
- `replacement-readiness-plan.md`
- `rule-family-migration-matrix.md`
- a parity contract for each native first-wave rule family
- a reviewed divergence log for known comparison differences
- current feature, integration, and comparison results
- `cutover-and-old-engine-retirement-checklist.md`

## Checklist

### 1. Architecture And Boundary Readiness

- [ ] all remaining temporary seams are documented in `current-to-target-map.md`
- [ ] `buildProjectRenderContext.ts` is either removed or reduced to a thin
  adapter with no cross-file semantic ownership
- [ ] the named `selector input` seam is retired or preserved only as an
  explicit documented adapter
- [ ] CSS analysis and rule execution no longer treat old-engine types as their
  durable contract surface
- [ ] any remaining old-engine reuse lives only behind explicit migration
  adapters
- [ ] cross-file helper and prop meaning is published through reusable
  symbol/value summaries rather than render-context glue
- [ ] the CSS Modules story is explicit for cutover:
  first-class native layer or deliberate compatibility adapter
- [ ] the external CSS story is explicit for cutover:
  imported and fetch-remote project-wide propagation are covered natively,
  active declared providers are published natively, and
  `missing-external-css-class` is delivered through the native rule path while
  runtime-specific fetch/fallback behavior stays behind the deliberate first-
  release compatibility adapter

### 2. Shipped Rule Catalog Coverage

- [ ] every shipped rule ID in `docs/design/rules.md` is available through the
  cutover build, whether natively or through an explicit compatibility adapter
- [ ] every shipped rule family has a recorded cutover mode:
  native, adapter-backed, or intentionally deferred with written approval
- [ ] any adapter-backed family has a documented reason, owner, and retirement
  trigger
- [ ] no shipped rule is lost silently because its migration path was assumed
  rather than written down

### 3. Product Contract Parity

- [ ] rule IDs, families, and default severities remain aligned with
  `docs/design/rules.md` unless a difference is documented as an expected
  improvement
- [ ] finding shape remains compatible with `docs/design/runtime-contracts.md`
- [ ] confidence remains deliberate and separate from severity
- [ ] CLI behavior remains compatible with the runtime contract for config
  resolution, focus behavior, JSON output, human-readable output, and
  operational warnings
- [ ] Node API behavior remains compatible with the runtime contract
- [ ] exit-code behavior remains compatible with the runtime contract
- [ ] repeated runs on the same inputs remain deterministic

### 4. Validation And Comparison Readiness

- [ ] unit coverage exists for stage-local behavior touched by migrated rules
- [ ] feature coverage exists for multi-file React, selector, and reachability
  interactions in the in-scope families
- [ ] integration coverage exists for scanner entry behavior and user-visible
  output in the in-scope families
- [ ] comparison baselines exist for every in-scope shipped rule family
- [ ] known divergences are reviewed and classified as expected improvement,
  acceptable temporary gap, or blocking regression
- [ ] there are no unresolved blocking regressions in the cutover candidate
- [ ] replacement confidence is grounded in reviewed evidence, not only in
  anecdotal local tests

### 5. Family-Specific Minimum Gates

#### `definition-and-usage-integrity`

- [ ] wrapper and ancestor-route scenarios are covered
- [ ] partial-context reachability scenarios are covered
- [ ] direct match, possible match, unknown barrier, and unavailable stylesheet
  cases are covered
- [ ] contextual selector evidence is checked against the shipped plain-class
  contract

#### `dynamic-analysis`

- [ ] exact versus unresolved class-value scenarios are covered
- [ ] imported helper and imported constant scenarios are covered
- [ ] mapping from bounded unknown outcomes to shipped dynamic findings is
  written and reviewed

#### `ownership-and-organization`

- [ ] the first cutover explicitly chooses adapter-first or native-first
  semantics
- [ ] parity checks exist against the shipped ownership heuristics for the
  cutover shape being used

#### `css-modules`

- [ ] a first-class CSS-Module semantic layer exists, or the first replacement
  release has an explicit compatibility adapter
- [ ] parity checks exist for import/property resolution behavior
- [ ] parity checks exist for unused-definition behavior

#### `external-css`

- [ ] `missing-external-css-class` has an explicit cutover mode:
  native, with runtime-specific fetch/fallback behavior adapter-backed in the
  first replacement release
- [ ] parity checks exist for imported external CSS behavior
- [ ] parity checks exist for declared-global/provider behavior
- [ ] parity checks exist for fetch-remote and unavailable external stylesheet
  behavior

#### `optimization-and-migration`

- [ ] parity and comparison review exists for the experimentally migrated rules
- [ ] `utility-class-replacement` has an explicit first-wave decision:
  included now or deferred as follow-on work

### 6. Rollout-Shape Approval Gates

#### Shadow-Only Or Internal Comparison

- [ ] the new engine can run comparison safely without changing shipped output
- [ ] divergence review is active and current
- [ ] no old-engine retirement happens at this stage

#### Opt-In Or Experimental User-Facing Path

- [ ] the opt-in path is documented and intentionally scoped
- [ ] the old engine remains the default or immediate fallback
- [ ] the user-visible contract is stable enough for deliberate early use

#### Default-On With Fallback

- [ ] all applicable checklist items above are satisfied
- [ ] the fallback path is still available and tested
- [ ] adapter-backed families are explicitly documented for the release
- [ ] rollback can be performed without reconstructing removed logic

#### Full Replacement

- [ ] all shipped rules are delivered through the new-engine-backed runtime path
- [ ] any remaining adapters are deliberate, documented, and compatible with the
  shipped product contract
- [ ] the old engine is no longer needed for normal product operation
- [ ] the cutover and retirement checklist is ready to execute

## Non-Approval Conditions

Cutover should not be approved if any of these remain true:

- a shipped rule family has no explicit cutover mode
- a blocking regression is still open
- the runtime contract has drifted without an intentional product decision
- deterministic output is not stable
- CSS Modules or external CSS still depend on unwritten assumptions
- the fallback and retirement story is still undefined for the chosen rollout
  shape

## Summary

Replacement is ready only when the project can say all of these things at the
same time:

- the architecture is close enough to the target shape
- the shipped rule catalog still exists through the cutover build
- runtime behavior is still compatible with the product contract
- validation and comparison evidence is strong enough to support a deliberate
  ship/no-ship decision

That is the bar for "ready to replace," not just "the new engine looks
promising."
