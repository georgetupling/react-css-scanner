# Static Analysis Engine Shared Selector Parsing

## Purpose

This document defines the design direction for consolidating selector parsing inside the static-analysis-engine.

Today the subsystem effectively parses selectors more than once:

- CSS analysis parses selector branches into CSS-oriented facts
- selector-analysis parses selector queries into selector-analysis-oriented constraints

Those consumers are asking different questions, but they should not each own separate branch-parsing logic.

The goal of this note is to define a shared parsing layer that:

- parses selector branches once
- is at least as robust as the current consumer-specific parsers
- preserves enough information for both CSS-oriented and selector-analysis-oriented consumers
- stays modular and easy to navigate

## Why this matters

The architecture docs already point toward selector handling as a first-class stage.

That implies:

- parse once into a shared selector IR
- project that IR into consumer-specific views

This is better than:

- reparsing raw selector text differently in multiple places
- letting one consumer's parsing shortcuts constrain another consumer's needs

It also makes it easier to:

- improve selector robustness in one place
- preserve `@media` and source-anchor context consistently
- keep CSS duplicate detection and selector satisfiability reasoning aligned

## Current Problem Shape

The current implementation has two related but distinct parsing paths.

### CSS analysis path

The CSS analysis path parses selector branches into facts such as:

- subject classes
- context classes
- negative classes
- match kind such as `standalone`, `compound`, `contextual`, or `complex`
- subject modifiers and unknown semantics

That information is used by CSS-oriented rules such as:

- duplicate class definitions
- redundant declaration blocks
- root-class classification helpers

### Selector-analysis path

The selector-analysis path parses selector text into:

- normalized selector chains
- selector constraints such as:
  - same-node conjunction
  - ancestor-descendant
  - parent-child
  - sibling
- unsupported outcomes for shapes outside the bounded supported slice

That information is used to evaluate selectors against the render IR.

### The gap

Both paths are parsing selector structure, but they preserve different information and use different parsing code.

The result is:

- duplicated logic
- inconsistent robustness ceilings
- unnecessary friction when extending selector support

## Design Goal

Introduce one shared selector-branch parser that becomes the source of truth for selector structure.

The shared parser should:

- parse a selector list into individual branches
- parse each branch into an explicit step/combinator structure
- preserve class requirements, negative classes, and modifier information per step
- preserve enough classification inputs for CSS analysis
- preserve enough structure for selector-analysis projection

Then:

- CSS analysis should derive CSS selector facts from the shared branch IR
- selector-analysis should derive normalized selector constraints from the same shared branch IR

## Boundary Of This Refactor

This refactor is about consolidating selector branch parsing.

It is not required to fully unify every CSS text walk in one pass immediately.

In particular:

- CSS rule parsing can remain responsible for walking CSS blocks and at-rule nesting
- selector query extraction from CSS text can remain responsible for source anchors and query enumeration

The shared layer should own:

- splitting top-level selector lists
- parsing a selector branch into structured steps
- deriving shared branch-level metadata

That is enough to remove the duplicated selector parsing logic while keeping the rest of the pipeline stable.

## Shared IR Requirements

The shared selector IR must be rich enough to satisfy both current consumers.

At minimum, a parsed selector branch should preserve:

- raw selector branch text
- ordered steps
- combinator between steps
- required classes per step
- negative classes on the subject step
- whether the subject step has modifiers such as attributes, pseudos, tag constraints, or IDs
- whether any unknown semantics were encountered
- whether combinators are present
- enough information to classify the branch as:
  - `standalone`
  - `compound`
  - `contextual`
  - `complex`

## Proposed Shared Types

An initial shared type shape can look like this:

```ts
type SelectorStepCombinator =
  | "descendant"
  | "child"
  | "adjacent-sibling"
  | "general-sibling"
  | null;

type ParsedSimpleSelectorSequence = {
  requiredClasses: string[];
  negativeClasses: string[];
  hasUnknownSemantics: boolean;
  hasSubjectModifiers: boolean;
  hasTypeOrIdConstraint: boolean;
};

type ParsedSelectorStep = {
  combinatorFromPrevious: SelectorStepCombinator;
  selector: ParsedSimpleSelectorSequence;
};

type ParsedSelectorBranchMatchKind =
  | "standalone"
  | "compound"
  | "contextual"
  | "complex";

type ParsedSelectorBranch = {
  raw: string;
  steps: ParsedSelectorStep[];
  subjectStepIndex: number;
  subjectClassNames: string[];
  requiredClassNames: string[];
  contextClassNames: string[];
  negativeClassNames: string[];
  hasCombinators: boolean;
  hasSubjectModifiers: boolean;
  hasUnknownSemantics: boolean;
  matchKind: ParsedSelectorBranchMatchKind;
};
```

This shape is intentionally richer than the current selector-analysis constraint view and more structural than the current CSS fact view.

## Projection Model

The shared parser should not directly return consumer-specific shapes.

Instead, the system should use projection helpers.

### CSS analysis projection

Project a `ParsedSelectorBranch` into CSS-oriented facts such as:

- `CssSelectorBranchFact`
- class definition inputs
- branch classification metadata for rules

### Selector-analysis projection

Project a `ParsedSelectorBranch` into selector-analysis-oriented shapes such as:

- `NormalizedSelector`
- `SelectorConstraint`
- parse notes
- unsupported outcomes when the parsed branch is outside the bounded selector-analysis slice

This means the shared parser can be richer than either consumer without forcing them to accept each other's view of the world.

## Support Expectations

The shared parser must be at least as robust as the current combined behavior of:

- the CSS selector branch parser
- the selector-analysis parser

That means it must preserve support for:

- top-level comma splitting
- simple descendant selectors
- child selectors
- adjacent sibling selectors
- general sibling selectors
- same-node compound class selectors
- negated classes via `:not(.class)`
- subject modifier detection
- unknown/unsupported semantics detection
- escaped CSS identifiers

It must also remain compatible with CSS parsing that carries nested at-rule context such as:

- `@media`

## `@media` Handling

The selector branch parser itself does not own at-rule traversal.

However, the overall parsing pipeline must preserve at-rule context consistently when selector branches are emitted from CSS.

This matters because CSS-oriented rules need to distinguish:

- the same class defined multiple times in the same at-rule context
- the same class defined at different breakpoints

The refactor must preserve the current behavior where `@media` context survives into CSS analysis and duplicate grouping.

The intended model is:

- CSS rule parsing discovers style rules and inherited at-rule context
- selector list parsing emits parsed selector branches
- CSS analysis combines parsed branches with the inherited at-rule context

That is enough to avoid incorrectly treating breakpoint-specific duplicates as equivalent.

## Recommended Module Structure

To keep responsibilities narrow and discoverable, the shared parser should live in a dedicated directory with small files.

Recommended shape:

```text
src/static-analysis-engine/pipeline/selector-parsing/
  index.ts
  types.ts
  splitTopLevelSelectorList.ts
  readCssIdentifier.ts
  parseSimpleSelectorSequence.ts
  parseSelectorBranch.ts
  parseSelectorBranches.ts
  projectToCssSelectorBranchFact.ts
  projectToSelectorAnalysis.ts
```

### Responsibility split

- `splitTopLevelSelectorList.ts`
  split comma-separated selectors safely at top level
- `readCssIdentifier.ts`
  identifier and escape handling only
- `parseSimpleSelectorSequence.ts`
  parse one simple-selector sequence such as `.a.b:not(.c)`
- `parseSelectorBranch.ts`
  parse one branch into steps and combinators
- `parseSelectorBranches.ts`
  parse a selector prelude into multiple parsed branches
- `projectToCssSelectorBranchFact.ts`
  CSS analysis projection only
- `projectToSelectorAnalysis.ts`
  selector-analysis projection only

This structure makes the high-level process easy to discover without concentrating everything into one or two giant files.

## Migration Plan

The migration should happen in bounded steps.

### Step 1

Introduce the shared selector parser and its tests without changing the consumer-facing shapes.

### Step 2

Switch CSS analysis to derive `CssSelectorBranchFact` from the shared parsed branch IR.

This is the lower-risk first consumer because it is already CSS-centric and preserves more branch metadata.

### Step 3

Switch selector-analysis parsing to project from the shared parsed branch IR into:

- normalized selector shapes
- selector constraints
- parse notes

### Step 4

Delete or reduce the old consumer-specific branch-parsing code once parity is confirmed.

## Testing Strategy

Three test layers should protect this refactor.

### Shared parser unit tests

Test the new selector parser directly for:

- combinators
- same-node compounds
- `:not(.x)`
- subject modifiers
- unknown semantics
- escaped identifiers
- comma splitting

### Projection tests

Verify that the same shared parsed branch can project correctly to:

- CSS selector facts
- selector-analysis constraints

### Consumer parity tests

Keep the existing CSS-analysis and selector-analysis tests stable so the refactor does not silently change behavior.

Add an explicit regression test that breakpoint-specific duplicate class definitions are not grouped together across different `@media` contexts.

## Recommendation

Adopt a shared selector-branch parser as the source of truth for selector structure inside the static-analysis-engine.

Keep the parser rich and consumer-agnostic.
Keep projections consumer-specific.
Keep the module layout narrow and discoverable.

That gives the subsystem:

- one parsing truth
- better extensibility
- preserved `@media` behavior
- cleaner architecture for both CSS analysis and selector satisfiability work
