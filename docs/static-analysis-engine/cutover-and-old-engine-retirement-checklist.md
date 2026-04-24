# Static Analysis Engine Cutover And Old-Engine Retirement Checklist

## Purpose

This document defines the staged cutover checklist for moving the shipped
scanner runtime onto the `static-analysis-engine` and retiring old-engine paths
deliberately.

It is the companion to:

- `replacement-readiness-plan.md`
- `replacement-acceptance-criteria-checklist.md`
- `rule-family-migration-matrix.md`
- `current-to-target-map.md`

Its job is to answer:

- how the project should stage cutover safely
- what must remain in place during early rollout
- when old-engine paths are actually safe to remove

## Scope

This checklist assumes the parity-first migration decision:

- replace the current shipped rule families first
- redesign rules and families later, as separate work

It also assumes:

- some first-release families may still be adapter-backed
- comparison tooling should survive longer than the first cutover switch
- old-engine retirement should happen in stages, not all at once

## Recommended Cutover Sequence

### Stage 0: Pre-Cutover Locking

- [ ] choose the intended rollout shape:
  shadow-only, opt-in, default-on with fallback, or full replacement
- [ ] pass the applicable items in
  `replacement-acceptance-criteria-checklist.md`
- [ ] write the parity contract for each native first-wave rule family
- [ ] freeze the first-wave family decisions:
  native, adapter-backed, or deferred
- [ ] inventory remaining old-engine dependencies and classify each one as:
  product-critical, adapter-backed, comparison-only, or ready to delete
- [ ] confirm rollback expectations for the chosen rollout shape

### Stage 1: Shadow-Mode Or Internal Comparison Cutover

- [ ] run the new engine in comparison without changing shipped product output
- [ ] keep the old engine as the only product-serving path
- [ ] maintain a reviewed divergence log
- [ ] keep comparison coverage focused on the first-wave rule families plus any
  adapter-backed families at risk

Exit gate:

- [ ] no unresolved blocking regressions remain in the shadow candidate
- [ ] the project understands which divergences are expected improvements and
  which are temporary gaps

### Stage 2: Opt-In Or Experimental User-Facing Cutover

- [ ] expose an explicit way to choose the new engine if the project wants an
  experimental release path
- [ ] document the supported family set and any adapter-backed families
- [ ] verify CLI and Node API behavior remain compatible for the opt-in path
- [ ] verify the old engine still works as the default or immediate fallback

Exit gate:

- [ ] the opt-in path is stable and deterministic
- [ ] the fallback path still works without special-case repair work

### Stage 3: Default-On With Fallback

- [ ] make the new engine the default for the chosen product surface
- [ ] keep an explicit fallback path to the old engine
- [ ] keep comparison tooling available during the stabilization window
- [ ] keep release notes and internal docs current about which families are
  native versus adapter-backed

Exit gate:

- [ ] the fallback path is used only as a safety valve, not as a normal
  production dependency
- [ ] there are no unresolved blocking regressions for the default-on scope
- [ ] remaining adapters have explicit retirement triggers

### Stage 4: Full Replacement

- [ ] remove the old engine as a normal product-serving runtime path
- [ ] keep only deliberate compatibility adapters or comparison helpers that are
  still actively justified
- [ ] update docs and product-facing guidance so the new engine is described as
  the main runtime path

Exit gate:

- [ ] every shipped rule is delivered through the new-engine-backed runtime path
- [ ] the old engine is no longer required for normal scan execution
- [ ] the remaining cleanup work is narrowed to explicit retirement tasks

### Stage 5: Old-Engine Retirement

- [ ] remove old-engine-only rule logic that is no longer reachable from the
  shipped runtime
- [ ] remove old-engine type leakage from CSS analysis and rule execution
- [ ] remove deep old-engine imports that survived only as migration scaffolding
- [ ] remove obsolete runtime selection flags, fallback plumbing, or duplicate
  product routing
- [ ] decide whether comparison tooling should remain for post-cutover auditing
  or be retired
- [ ] archive or downgrade now-historical migration-only docs when they are no
  longer active control documents

Exit gate:

- [ ] no shipped runtime path depends on the old engine
- [ ] no required migration adapter is removed prematurely
- [ ] docs accurately reflect the post-migration architecture

## Old-Engine Path Classification Checklist

Every remaining old-engine dependency should be labeled before deletion:

- [ ] `product-critical old path`:
  still required for shipped runtime behavior today
- [ ] `adapter-backed compatibility path`:
  still required, but only through a deliberate compatibility boundary
- [ ] `comparison-only path`:
  needed for validation, not for shipped product behavior
- [ ] `dead path`:
  no longer used by product runtime, adapters, or comparison

Only `dead path` items are safe to delete immediately.

## Minimum Evidence Before Deleting An Old-Engine Path

- [ ] a replacement path exists and is already exercised
- [ ] the replacement path is covered by the acceptance checklist and relevant
  tests
- [ ] no product runtime entry point still depends on the path
- [ ] rollback implications are understood
- [ ] the relevant migration docs are updated in the same change

## Special Hold Points

These areas should not be retired early:

- [ ] CSS Modules old-path logic stays until either a first-class CSS-Module
  layer exists or a deliberate compatibility adapter is proven
- [ ] external CSS old-path logic stays until the provider/import handling is
  ported or wrapped for the new engine
- [ ] ownership-family old-path logic stays until the project explicitly decides
  whether the first replacement release is adapter-first or native-first there
- [ ] comparison tooling stays at least through the first default-on
  stabilization window unless the project makes an explicit contrary decision

## Documentation Updates Required At Each Cutover Stage

- [ ] keep `current-to-target-map.md` current when a seam is retired, narrowed,
  or left behind as a deliberate adapter
- [ ] keep `replacement-readiness-plan.md` current when blockers or rollout
  assumptions change
- [ ] keep `rule-family-migration-matrix.md` current when a family changes
  cutover mode
- [ ] keep `replacement-acceptance-criteria-checklist.md` current with the live
  approval gate
- [ ] update `AGENTS.md` when the recommended doc set or runtime status changes

## Summary

The important rule for cutover is simple:

- switch product behavior first
- remove fallback and old-engine internals only after the new path is already
  stable

The important rule for retirement is equally simple:

- do not delete migration scaffolding just because the new engine exists
- delete it when the shipped runtime, validation story, and rollback plan no
  longer need it
