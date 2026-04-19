# Static Analysis Engine Subsystem Boundaries

## Purpose

This document defines the intended subsystem boundaries for the target `static-analysis-engine`.

Its main job is to answer:

- what counts as a pipeline stage
- what counts as a shared library
- which dependencies are allowed between them

## Boundary Rules

The target product follows these rules:

1. `pipeline/` is reserved for real top-level pipeline stages.
2. One stage subdirectory equals one pipeline stage.
3. Shared reusable logic does not live under `pipeline/`.
4. Stages should consume earlier stage outputs and shared libraries, not deep internals of sibling stages.
5. Old-engine imports are temporary scaffolding only and should disappear from the final product.

## Target Top-Level Layout

The target subsystem shape should be approximately:

- `entry/`
- `pipeline/`
- `libraries/`
- `types/`
- `runtime/`
- `comparison/`

This is a recommendation, not a frozen filesystem migration plan. The important design point is that `pipeline/` and shared libraries should be visibly different things.

## What Belongs In `pipeline/`

The target stage directories are:

- `pipeline/parse/`
- `pipeline/module-graph/`
- `pipeline/symbol-resolution/`
- `pipeline/abstract-values/`
- `pipeline/render-graph/`
- `pipeline/render-ir/`
- `pipeline/css-analysis/`
- `pipeline/reachability/`
- `pipeline/selector-analysis/`
- `pipeline/rule-execution/`

Each stage directory should own:

- its stage input/output types
- the main stage implementation
- stage-local helpers that are not intended to be shared broadly

Each stage directory should not become:

- a catch-all shared utility area
- a home for helpers consumed equally by unrelated stages

## What Belongs In Shared Libraries

Shared libraries should hold reusable logic that is intentionally multi-consumer and not itself a stage output.

Likely shared-library areas:

- `libraries/selector-parsing/`
- `libraries/css-parsing/`
- `libraries/anchors/`
- `libraries/traces/`
- `libraries/policy/`

Possible future areas:

- `libraries/path-normalization/`
- `libraries/ordering/`
- `libraries/collections/`

These shared libraries may be consumed by multiple stages, but they should avoid owning semantic conclusions that belong to a specific stage contract.

## Recommended Ownership By Concern

### Parsing and anchors

Owned by:

- `pipeline/parse/`
- shared anchor helpers under `libraries/anchors/`

### Selector parsing and normalization

Owned by:

- shared library, not a stage

Reason:

- it is a reusable normalization layer consumed by CSS analysis and selector analysis
- it is not a standalone top-level semantic product stage in the target pipeline

### Cross-file symbol meaning

Owned by:

- `pipeline/symbol-resolution/`

Reason:

- later stages should consume symbol-owned summaries rather than recreating import semantics ad hoc

### Bounded expression meaning

Owned by:

- `pipeline/abstract-values/`

### Component composition structure

Owned by:

- `pipeline/render-graph/`

### Approximate rendered structure

Owned by:

- `pipeline/render-ir/`

### Stylesheet availability

Owned by:

- `pipeline/reachability/`

### Selector satisfaction

Owned by:

- `pipeline/selector-analysis/`

### Findings

Owned by:

- `pipeline/rule-execution/`

## Allowed Dependency Pattern

The intended rule is:

- a stage may depend on shared libraries
- a stage may depend on earlier stage outputs
- a stage should not depend on deep internal helpers from a sibling stage

Examples of good dependency patterns:

- `selector-analysis` consuming selector parsing from a shared library
- `reachability` consuming `RenderGraph` and render IR outputs
- `rule-execution` consuming selector-analysis outputs

Examples of bad dependency patterns:

- `symbol-resolution` importing policy constants from `render-ir/shared/...`
- `render-ir` rebuilding its own cross-file import semantics instead of consuming symbol/value summaries
- one stage reaching into another stage's internal helper structure instead of using its published output

## Stage Publication Rule

Every stage should publish a small, intentional surface:

- exported stage runner
- exported stage input/output types
- exported authoritative model types

If another stage needs something more granular than that published surface, that is a signal to either:

- move the shared logic into a shared library
- or strengthen the upstream stage's published output

## Temporary Exceptions During Migration

Some current code does not yet satisfy the target boundary rules.

Examples include:

- `buildProjectRenderContext.ts` acting as a temporary bridge
- old-engine fact/runtime type reuse in experimental rule execution and CSS analysis

These are allowed as migration scaffolding, but they should be documented as temporary and not copied into new target-product design work.

## Decision-Heavy Stages Vs Library-Only Modules

The easiest rule of thumb is:

- if a subsystem produces an authoritative semantic answer used by later stages, it is probably a stage
- if a subsystem mainly normalizes, parses, or assists multiple stages, it is probably a shared library

Using that rule:

- selector parsing is a shared library
- trace formatting is a shared library
- reachability is a stage
- selector analysis is a stage

## `buildProjectRenderContext` In The Target Architecture

`buildProjectRenderContext` should not be a lasting subsystem boundary.

It is currently acting as a compression seam between:

- symbol/binding knowledge
- helper/const propagation
- render preparation

In the target product:

- symbol-resolution should own symbol and import meaning
- abstract-values should own bounded expression meaning
- render stages should consume those outputs directly or through thinner published summaries

That means `buildProjectRenderContext` should shrink over time and ideally disappear.

## Policy And Budget Ownership

Cross-cutting policies and budgets should live in shared library space, not inside stage-private helper files when they are consumed across stages.

Examples:

- cross-file propagation depth
- render expansion budgets
- selector complexity budgets

This keeps ownership clear and avoids stage-specific modules becoming accidental global configuration points.

## Comparison And Compatibility Surface

`comparison/` is not part of the target analysis pipeline.

It exists to support:

- experimentation
- validation
- staged migration

Similarly, runtime compatibility types should not define the target new-engine boundaries. They are temporary adapters only.

## Summary

The target boundary model is simple:

- `pipeline/` contains only real stages
- shared reusable logic lives outside `pipeline/`
- stages publish outputs, not internals
- semantic ownership should sit with the stage that actually determines the answer
- temporary migration seams should be removed rather than normalized into the final architecture
