# Phase 6: Early Cross-File Reasoning

## Status

Complete.

This note now serves as the Phase 6 design-and-outcome record.

The implementation now covers a bounded but real cross-file reasoning surface for:

- imported components
- imported helpers
- imported constants
- common relative import and re-export forms
- explicit unsupported and over-budget outcomes across module boundaries

The next milestone is Phase 7:

- pilot rule migration and comparison

## Purpose

Phase 6 extends the new engine from rich same-file reasoning into bounded cross-file reasoning.

The goal is not broad interprocedural JavaScript understanding.

The goal is:

- reliable, explainable cross-file component and value reasoning across the common import/export shapes that matter most for React code

## Why This Phase Matters

Phase 5 proved that the render IR and selector-analysis pipeline could reason across same-file local component boundaries.

That still left a major practical gap:

- real projects do not keep most wrapper components, helpers, and class-bearing constants in a single file

Phase 6 exists to cross that boundary without giving up:

- boundedness
- determinism
- explainability

## Main Goal

The Phase 6 goal is:

- support bounded cross-file component, helper, and constant reasoning across common relative import/export forms

while keeping unsupported cases and budgets explicit.

## Non-Goals

This phase does not try to solve all module-level React semantics.

Still out of scope:

- render props
- function-as-children
- higher-order components
- dynamic component identities
- `as={SomeComponent}` polymorphism across modules
- arbitrary interprocedural JS evaluation
- hooks or framework-runtime semantics
- broad package-resolution semantics beyond the current bounded relative-source model

## Supported Cross-File Surface

### Import / export forms

Implemented support includes:

- direct named imports
- direct default imports
- namespace imports
- named re-exports
- aliased named re-exports
- `export *`
- namespace re-exports via `export * as ns from "./x"`
- bounded transitive relative-source chains

### Cross-file component reasoning

Implemented support includes:

- direct imported component expansion across files
- default-imported component expansion
- namespace-imported component expansion
- named-import access to namespace re-exports
- bounded multi-hop wrapper composition across files

### Cross-file helper reasoning

Implemented support includes bounded imported helper summaries for helpers that participate in:

- JSX return expressions
- class-bearing string returns
- exact boolean branch conditions

This includes:

- named imports
- default imports
- namespace imports
- bounded transitive propagation
- bounded re-exported helper access

### Cross-file constant reasoning

Implemented support includes imported constants used for:

- `className` bindings
- exact branch conditions
- imported object-literal property access such as `classes.open` or `flags.isOpen`

This includes:

- named imports
- default imports
- namespace imports
- bounded transitive propagation
- bounded re-exported constant access

## Current Intentional Limits

The current cross-file model is intentionally bounded.

### Import graph limits

- only bounded relative source imports
- only bounded transitive propagation
- no arbitrary package-level graph reasoning beyond the current provided source set

### Value-flow limits

- only the currently supported exact and bounded value shapes
- no arbitrary exported object construction
- no broad exported collection/data-flow interpretation
- no arbitrary wildcard-import value propagation beyond the current namespace-import surface

### Component-model limits

- no render-prop semantics
- no higher-order component semantics
- no dynamic component identity tracking
- no broad runtime polymorphism across modules

## Explicit Unsupported And Budgeted Outcomes

Phase 6 now preserves scope-aware unresolved outcomes instead of reusing same-file labels for cross-file failures.

Examples now include:

- `cross-file-component-expansion-budget-exceeded`
- `cross-file-component-expansion-cycle`
- `cross-file-component-expansion-unsupported:...`
- `cross-file-helper-expansion-budget-exceeded`
- `cross-file-helper-expansion-cycle`
- `cross-file-helper-expansion-unsupported-arguments`

This matters because it lets maintainers distinguish:

- a true same-file limitation

from:

- a cross-file boundary, budget, or unsupported-shape limitation

without reading implementation details.

## What Phase 6 Proves

At the end of this phase, the engine can now do all of the following in bounded form:

- follow common relative import/export edges
- inline imported wrapper components
- propagate imported class-bearing constants
- propagate imported helper summaries
- preserve selector-relevant render structure across module boundaries
- remain explicit when cross-file reasoning hits a cycle, budget, or unsupported shape

That means the engine is no longer missing the basic import/export semantics needed for meaningful cross-file render reasoning.

## Remaining Important Gaps

The important remaining gaps now look more like:

- dynamic composition concerns
- richer product-facing support-matrix communication
- rule migration and comparison work

not:

- missing basic cross-file import plumbing

## Practical Outcome

Phase 6 should be considered complete because all of these are now true:

- bounded cross-file component, helper, and constant reasoning works across the common supported import/export forms
- the remaining important gaps are mostly dynamic or higher-level product concerns
- cross-file unsupported and over-budget outcomes are explicit enough to debug confidently
- the supported cross-file surface can be described in a durable document
- the next most valuable work is better framed as Phase 7 rule migration than more import-shape plumbing

## Recommendation

Treat Phase 6 as complete.

The next work should focus on Phase 7:

- pilot rule migration and comparison

That is now a better use of effort than continuing to accumulate more bounded import-shape support without a rule-level payoff.
