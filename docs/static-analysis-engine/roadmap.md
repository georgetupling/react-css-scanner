# Static Analysis Engine Roadmap

## Purpose

This document defines the implementation roadmap for the static-analysis-engine track.

It translates the high-level requirements and architecture into a staged delivery plan.

The roadmap is intentionally incremental.

It is designed to:

- prove the new architecture in bounded slices
- reduce risk before deeper investment
- keep the current production scanner stable while the new engine evolves beside it

## Roadmap Philosophy

The new engine should not be built as one giant rewrite attempt.

It should be built as a sequence of bounded milestones where each milestone answers a clear question.

The most important early question is:

- can the new engine support a real capability the current scanner cannot support cleanly?

That is why the roadmap is centered on the first flagship capability:

- ancestor-qualified selector satisfiability

## Strategic Framing

This roadmap assumes the following principles.

### 1. New engine first, migration second

The first goal is not immediate replacement of the current scanner.

The first goal is proving that the new engine can produce high-value analysis with a coherent architecture.

### 2. Vertical slices over broad parity

The new engine should first complete a few meaningful end-to-end slices rather than trying to reach full old-scanner parity before demonstrating new value.

### 3. Bounded complexity at every stage

Every milestone should define:

- what is supported
- what is intentionally unsupported
- what uncertainty states are expected

### 4. Explanation is part of the product

The roadmap should treat explanation and traceability as part of the engine, not as late polish.

## Phase Overview

The roadmap is divided into these phases:

1. foundation and boundaries
2. core IR and graph scaffolding
3. bounded same-file analysis
4. first selector satisfiability slice
5. bounded local component expansion
6. early cross-file reasoning
7. pilot rule migration and comparison
8. broader engine maturation
9. replacement planning

## Phase 1: Foundation And Boundaries

## Goal

Create a safe and explicit home for the new engine.

## Why this phase matters

Without strong boundaries early on, the new engine will drift into accidental coupling with the current scanner.

## Deliverables

- `docs/static-analysis-engine/requirements.md`
- `docs/static-analysis-engine/directory-structure-and-boundaries.md`
- `docs/static-analysis-engine/core-irs-and-type-shapes.md`
- `docs/static-analysis-engine/architecture.md`
- `src/static-analysis-engine/` root
- `test/static-analysis-engine/` root

## Exit criteria

- the directory boundaries are clear
- the new engine has its own doc home
- the new engine has its own code and test roots
- contributors can start implementation without ambiguity about ownership

## Status

This phase is substantially in place at the documentation level.

## Phase 2: Core IR And Graph Scaffolding

## Goal

Implement the first core internal data shapes and minimal pipeline skeleton.

## Main question

- can the new engine build its own internal models without depending on old-engine internals?

## Scope

Focus only on the first foundational IRs:

- module graph IR
- symbol IR
- abstract value IR
- abstract class set IR

## Deliverables

- initial `src/static-analysis-engine/types/`
- initial `src/static-analysis-engine/module-graph/`
- initial `src/static-analysis-engine/symbol-resolution/`
- initial `src/static-analysis-engine/abstract-values/`
- initial `src/static-analysis-engine/entry/scan.ts`
- unit tests for IR construction and symbol basics

## Not yet required

- render subtree IR
- selector satisfiability logic
- rule execution
- user-facing output

## Exit criteria

- a source file can be parsed into a new-engine module model
- top-level symbols can be identified and resolved in bounded cases
- class-bearing expressions can produce abstract value placeholders
- the new engine has a minimal internal pipeline that runs end to end on a trivial file

## Phase 3: Bounded Same-File Analysis

## Goal

Support same-file reasoning about JSX structure and class values.

## Main question

- can the new engine build a useful approximate render subtree from one source file?

## Scope

Support:

- intrinsic JSX elements
- fragments
- same-file class-bearing expressions
- basic conditionals
- same-file bounded class evaluation

## Deliverables

- initial `render-ir/` implementation
- basic same-file expression evaluator integration
- same-file render subtree construction
- same-file technical traces

## Not yet required

- local component expansion
- cross-file symbol tracing beyond basic references
- slot propagation
- selector matching beyond trivial prototypes

## Exit criteria

- the engine can build a same-file approximate render subtree
- elements carry abstract class sets
- conditionals preserve definite versus possible structure
- traces are available for debugging class and subtree derivation

## Phase 4: First Selector Satisfiability Slice

## Goal

Prove the first flagship capability:

- ancestor-qualified selector satisfiability under bounded same-file analysis

## Main question

- can the engine answer a genuinely new product question that the current scanner cannot answer cleanly?

## Scope

Support:

- simple selector constraint normalization
- same-node conjunction
- ancestor-descendant relationships
- same-file selector matching against render subtree IR
- explicit uncertainty states:
  - `definite`
  - `possible`
  - `unsupported`
  - `budget-exceeded`
  - `not-found-under-bounded-analysis`

## Deliverables

- `selector-analysis/` implementation for bounded selector shapes
- first satisfiability matcher
- debug-facing explanation output for match results
- tests for known satisfiable and unsatisfiable same-file examples

## Not yet required

- cross-file component expansion
- user-facing product rules
- CLI integration

## Exit criteria

- the engine can answer same-file ancestor-qualified selector satisfiability
- technical traces explain why the answer was reached
- unsupported cases are explicit rather than silently flattened

## Why this phase is critical

This is the first milestone where the new engine proves real analytical value beyond the current scanner.

## Phase 5: Bounded Local Component Expansion

## Goal

Extend render reasoning from same-file JSX to simple component composition.

## Main question

- can the engine inline simple local component usage without losing boundedness or explainability?

## Scope

Support:

- same-file local component expansion
- simple prop passing
- simple `children` insertion for local components
- bounded component expansion depth

## Deliverables

- `render-graph/` initial implementation
- same-file local component expansion in render subtree construction
- bounded prop-flow handling for simple cases
- tests for wrapper-style local patterns

## Not yet required

- cross-file component expansion
- named slot props
- render props

## Exit criteria

- local components can contribute to render subtree IR
- the engine still produces stable and understandable traces
- the first slice still performs acceptably with bounded local expansion

## Status

Complete.

## Phase 5 Support Matrix

Phase 5 is complete.

This support matrix now serves as:

- the record of what the completed Phase 5 milestone covers
- the boundary line between finished same-file work and Phase 6 cross-file work

### Implemented in Phase 5 so far

- same-file local component expansion
- simple prop passing
- `children` insertion
- generic same-file named JSX subtree props inserted via local component props
- bounded local component expansion depth
- explicit unresolved outcomes for:
  - unsupported parameter binding
  - unsupported prop passing
  - `children` not consumed
  - component expansion cycle
  - component expansion budget exceeded
- bounded same-file helper-call expansion
- explicit unresolved helper outcomes for:
  - helper recursion cycle
  - helper expansion budget exceeded
  - unsupported helper arguments
- local const alias tracking inside component bodies
- bounded control-flow lowering for:
  - ternaries
  - `&&`
  - `||`
  - `??`
  - direct `null` / `undefined`
  - simple `switch`
  - bounded statement-level `if / else`
  - bounded early-return statement bodies
- bounded exact evaluation for:
  - equality and relational comparisons
  - string predicates such as `includes`, `startsWith`, `endsWith`
  - collection predicates such as `find`, `some`, `every`, `includes`
- bounded exact collection rendering for:
  - array literals
  - `map(...)`
  - `filter(...)`
  - `filter(Boolean)`
  - `find(...)`
- explicit `repeated-region` render nodes for bounded unknown list output such as non-exact `map(...)`

### Closeout and stabilization work

These are useful maintenance tasks, but they are no longer required to call Phase 5 complete.

- continue cleanup of unsupported and budgeted outcomes where helpful
- keep support-matrix and boundary documentation aligned with implementation changes

### Explicitly out of scope for the rest of Phase 5

These should not quietly drift into the Phase 5 implementation.

- cross-file component expansion
- cross-file helper or constant reasoning
- render props
- function-as-children
- dynamic component identities
- higher-order components
- `as={SomeComponent}` polymorphism
- hooks-based control-flow reasoning
- broad framework-specific semantics
- arbitrary helper or value-flow interpretation

### Common patterns the current render IR still does not represent well

This list is useful both for triage and for preventing accidental scope drift.

#### Phase 6 candidates

- imported component expansion
- imported constants and helper summaries
- cross-file wrapper composition

#### Later than Phase 6 unless priorities change

- render props
- dynamic component identities
- higher-order components
- non-bounded general list/data-flow interpretation
- rich runtime behavior tied to hooks, effects, or framework semantics

## Phase 5 Outcome

Phase 5 is now complete.

The key result is:

- the engine can build a meaningfully rich same-file render IR across local component boundaries while staying bounded and explicit about uncertainty

That means the next milestone should no longer be framed as "finish same-file local expansion."

It should be framed as:

- move into bounded cross-file reasoning in Phase 6

## Practical Phase 5 exit criteria

Phase 5 should be considered complete when all of these are true:

- same-file wrapper-style local components work reliably for the common supported shapes
- unsupported and over-budget outcomes are explicit and stable
- helper and component expansion limits are no longer hidden in ad hoc control flow
- the supported same-file surface is documented clearly enough that future work can distinguish Phase 5 gaps from Phase 6 work
- the next most important missing behaviors are predominantly cross-file rather than same-file

## Phase 6: Early Cross-File Reasoning

## Goal

Expand the new engine from same-file reasoning into bounded cross-file component and symbol reasoning.

## Main question

- can the engine preserve correctness and boundedness when crossing module boundaries?

## Scope

Support:

- imported component calls
- imported constants where feasible
- imported helper summaries where feasible
- bounded cross-file expansion depth

## Deliverables

- stronger symbol resolution across modules
- component target resolution across files
- bounded cross-file component expansion
- early helper/function summaries
- tests for simple multi-file wrapper and page/component patterns

## Not yet required

- render props
- arbitrary higher-order component patterns
- broad framework-specific semantics

## Exit criteria

- the engine can reason across modules for a bounded subset of component and helper patterns
- the first flagship capability works beyond same-file toy examples
- technical-unknown states remain explicit

## Status

Complete.

### Phase 6 Support Matrix

Phase 6 is complete.

This support matrix now serves as:

- the record of what the completed Phase 6 milestone covers
- the boundary line between finished bounded cross-file reasoning and Phase 7 rule migration

### Implemented in Phase 6

- project-level multi-file analysis entrypoint
- merged module graph construction across provided source files
- direct relative named-import component expansion across files
- imported constant propagation for direct named exports
- imported helper summaries for direct named exports
- direct relative default-import component expansion across files
- imported constant propagation for direct default exports
- imported helper summaries for direct default exports
- bounded namespace-import resolution for components, constants, and helpers across direct relative source files
- bounded namespace re-export resolution for components and constants across direct relative source files
- bounded transitive imported-value propagation for constants and helpers across direct relative source chains
- bounded re-export resolution for named re-exports and `export *` chains
- bounded cross-file object-literal property access for imported constants used in class bindings and branch conditions
- scope-aware cross-file unsupported and budgeted outcomes for component and helper expansion

### Current intentional limits

- only bounded direct relative source imports
- only bounded imported component expansion, including named, default, namespace, and current re-export forms
- only bounded imported constants and helpers, including named, default, namespace, and current re-export forms
- transitive imported-value propagation is bounded and depth-limited
- re-export resolution is bounded and limited to direct relative source chains, including the current namespace re-export subset
- no arbitrary wildcard-import value propagation beyond the current bounded namespace-import surface
- no render-prop or higher-order patterns

### Closeout and stabilization work

These are useful maintenance tasks, but they are no longer required to call Phase 6 complete.

- keep the Phase 6 support matrix and closeout note aligned with implementation changes
- keep the documented support surface aligned with implementation if the bounded import model grows

### Explicitly out of scope for the rest of Phase 6

These should not quietly drift back into this milestone.

- render props
- function-as-children
- higher-order components
- dynamic component identities
- `as={SomeComponent}` polymorphism across modules
- arbitrary interprocedural JS evaluation
- framework-specific runtime semantics

## Phase 6 Outcome

Phase 6 is now complete.

The key result is:

- the engine can reason across module boundaries for a bounded but practically useful subset of component, helper, and constant flows

That means the next milestone should no longer be framed as:

- keep extending bounded import and re-export plumbing

It should be framed as:

- start Phase 7 rule migration and comparison on top of the now-established same-file and cross-file reasoning surface

### Practical Phase 6 completion signal

Phase 6 should feel complete when all of these are true:

- bounded cross-file component, helper, and constant reasoning works reliably across common import/export forms
- the remaining important gaps are mostly dynamic or product-integration concerns rather than missing basic cross-file import semantics
- cross-file unsupported and over-budget outcomes are explicit enough to debug confidently
- the team can describe the supported cross-file surface without reading implementation details
- the next most valuable work starts to look like Phase 7 rule migration rather than more import-shape plumbing

## Phase 7: Pilot Rule Migration And Comparison

## Goal

Start using the new engine for rule-like behavior and compare it against the current scanner.

## Main question

- can the new engine produce findings that are useful, explainable, and comparable to current behavior?

## Scope

The first pilot should focus on:

- selector-satisfiability-oriented diagnostics

Potential pilot outputs:

- debug-only selector satisfiability reports
- experimental `selector-never-satisfied`
- experimental suppression reasoning for ancestor-qualified selector cases

## Deliverables

- new-engine-native rule execution skeleton
- comparison harnesses for old versus new behavior
- fixture suite for motivating hard cases
- technical explanation payloads suitable for debugging differences

## Recommended comparison mode

Use shadow-mode comparison first.

Meaning:

- current scanner remains the shipped behavior
- new engine runs separately in tests or internal tooling
- differences are analyzed deliberately

## Exit criteria

- at least one rule-like output is powered by the new engine
- comparison fixtures exist for known hard cases
- the team can explain where the new engine is more accurate and where it is still incomplete

## Phase 8: Broader Engine Maturation

## Goal

Expand the new engine from one flagship capability into a broader replacement candidate.

## Main questions

- can the engine support more of the current scanner's rule space?
- can it do so without collapsing under complexity, performance, or explanation burden?

## Candidate areas

- stronger class-source tracing
- broader wrapper and slot reasoning
- richer helper summaries
- more selector forms
- route-aware satisfiability reasoning
- pilot migrations of selected existing rules

## Deliverables

- additional new-engine-native rules
- better explanation tooling
- benchmark or timing instrumentation
- broader integration suite

## Exit criteria

- the new engine is no longer just a one-capability prototype
- it supports several meaningful analysis paths with stable semantics
- its performance and explanation quality are understood well enough for replacement planning

## Phase 9: Replacement Planning

## Goal

Decide whether and how the new engine should replace the current scanner.

## Main question

- is the new engine mature enough to become the primary implementation?

## Deliverables

- migration strategy document
- rule-by-rule replacement or coexistence plan
- public API and CLI transition plan
- explicit list of intentional behavior changes

## Exit criteria

- the team can explain what the new engine does better
- the remaining gaps are understood and accepted
- replacement is a deliberate product decision, not an accidental drift

## First Technical Implementation Sequence

If implementation starts immediately, the recommended order is:

1. create the `src/static-analysis-engine/` and `test/static-analysis-engine/` skeleton
2. implement module graph types and constructors
3. implement symbol types and bounded same-file resolution
4. implement abstract value and abstract class set types
5. implement same-file render subtree IR
6. implement simple ancestor-descendant selector constraints
7. implement same-file satisfiability matching
8. add debug trace output

This is the smallest real vertical slice that proves the architecture.

## Parallel Workstreams

The roadmap is staged, but some work can proceed in parallel.

Examples of parallel-friendly work:

- docs and type-shape refinement
- test fixture construction
- source parsing helpers
- CSS selector normalization prototypes
- explanation payload design

Examples of work that should stay ordered:

- selector satisfiability after render subtree IR exists
- render subtree IR after abstract value and symbol reasoning exist
- cross-file expansion after same-file reasoning is stable

## Risks By Phase

## Early-phase risks

- over-design without implementation feedback
- importing too much old-engine logic into the new subsystem
- trying to support too many patterns before the first bounded slice works

## Mid-phase risks

- value evaluation becoming too broad too quickly
- render subtree expansion becoming hard to explain
- selector matching becoming overcomplicated before the simple case is solid

## Late-phase risks

- parity pressure overwhelming architectural discipline
- explanation and debugging burden growing faster than rule coverage
- replacement pressure arriving before performance and determinism are understood

## Success Signals

The roadmap is on the right track if:

- the first same-file selector satisfiability prototype works on real motivating examples
- unsupported cases are explicit rather than hidden
- traces are understandable enough to debug wrong answers
- the engine remains bounded and deterministic
- each milestone increases real capability rather than just internal complexity

## Anti-Goals For The Roadmap

The roadmap should not turn into:

- "rebuild the entire scanner before proving any new value"
- "silently migrate product behavior while the architecture is still unstable"
- "add more and more supported syntax without clear milestone exits"

## Recommendation

Use this roadmap as the working milestone plan for the static-analysis-engine track.

The immediate priority should be:

- Phase 2
- Phase 3
- Phase 4

because those phases produce the first real architectural proof:

- bounded same-file ancestor-qualified selector satisfiability with technical explanation support
