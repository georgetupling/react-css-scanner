# Maximal Class Source Analysis Note

## Purpose

This note captures a future-looking design direction for `scan-react-css`: adding a much more powerful JavaScript and TypeScript static evaluation layer that exhaustively traces where CSS class names come from and recovers any class tokens that can be known at compile time.

This is intentionally recorded as future work rather than near-term implementation guidance. It represents a materially larger project than the bounded class-expression evaluator described in [../observations/class-expression-evaluator-design-note.md](../observations/class-expression-evaluator-design-note.md).

## Summary

A maximal approach is feasible, but it would move the project into a different product tier.

Instead of a scanner that extracts CSS usage from local syntax patterns plus bounded AST evaluation, the tool would become a partial program evaluator for React class construction. That could recover many more compile-time-known classes, but it would also introduce substantial complexity, cost, and maintenance burden.

## What this approach means

Under a maximal approach, the scanner would no longer stop at local `className` expressions or shallow same-file helper analysis.

Instead, it would:

1. Build and traverse a module graph for the scanned project.
2. Resolve imports and exports across files.
3. Track values flowing into `className` and class-composition helpers.
4. Evaluate a much larger subset of JS and TS at compile time.
5. Derive a graph of possible string outcomes.
6. Extract class tokens from that graph when they are statically knowable.

This is best described as a bounded abstract interpreter or partial evaluator, not just a richer parser.

## What it could improve

This approach could potentially recover class usages from patterns such as:

- constants imported from nearby modules
- helper wrappers defined in other files
- reusable variant maps
- object-driven class composition
- simple factory functions returning class strings
- layered helper stacks such as:
  - `buttonClasses(props)`
  - `composeVariant(base, variant)`
  - `cx(...)`

This would likely reduce false positives in:

- `unused-css-class`
- `missing-css-class`
- `unreachable-css`
- dynamic-analysis rules that currently fire because the scanner cannot prove usage

## What it still would not solve completely

Even a maximal static interpreter would still have hard limits.

It would still struggle or deliberately stop on:

- user input and runtime API data
- environment-dependent logic
- mutation-heavy control flow
- loops and callbacks with nontrivial semantics
- dynamic property access
- reflection-like patterns
- arbitrary third-party library behavior
- build-tool or framework transforms that are not modeled
- unconstrained string computation

So this direction would never become complete runtime truth. It would remain a stronger static approximation.

## Major system components

To make this work, the project would likely need several new subsystems.

### 1. Semantic JS/TS layer

The scanner would need a stronger semantic model, likely backed by the TypeScript compiler API, to resolve symbols, types, imports, and exports.

### 2. Cross-file symbol resolution

The engine would need to trace values through:

- imported constants
- imported functions
- re-exports
- module cycles

### 3. Abstract value model

Instead of evaluating raw JS values, the system would need a compile-time value lattice.

Possible value forms:

- exact string
- finite set of strings
- concatenation of partial values
- object shapes with known property values
- array shapes
- unknown or dynamic values

### 4. Expression and statement evaluator

The engine would need to interpret a sizable subset of JS and TS:

- literals
- template literals
- conditionals
- logical expressions
- concatenation
- arrays and objects
- property reads
- simple function calls
- returns and limited control flow

### 5. Function summarization

Rather than re-evaluating every function body repeatedly, the engine would likely need summaries such as:

- what this function returns for known argument shapes
- whether the function is pure enough for static evaluation
- whether the result is exact, finite, or dynamic

### 6. Memoization and cycle handling

The engine would need strong caching and recursion guards to avoid repeated work and infinite analysis in cyclic dependency graphs.

### 7. Budgeting and truncation

To stay practical, the engine would need limits around:

- recursion depth
- number of value variants
- number of cross-file hops
- evaluation time per symbol or module

## Likely architecture impact

If this direction were pursued, it should not be bolted onto the current extraction logic as a chain of special cases.

A cleaner architecture would likely separate:

1. module and symbol resolution
2. abstract value evaluation
3. class-source tracing
4. source-fact extraction
5. rule execution

That separation matters because once the evaluator becomes powerful, it becomes a reusable subsystem rather than a small parser helper.

## Example abstract value model

One useful mental model is to represent values with compile-time abstractions such as:

```ts
type AbstractValue =
  | { kind: "exact-string"; value: string }
  | { kind: "string-set"; values: string[] }
  | { kind: "concat"; parts: AbstractValue[] }
  | { kind: "object-shape"; properties: Record<string, AbstractValue> }
  | { kind: "array-shape"; items: AbstractValue[] }
  | { kind: "unknown"; reason: string };
```

Then class-token extraction would operate over these abstract values rather than directly over raw AST nodes.

## Benefits

The maximal approach has meaningful upside.

### Better recovery of real class usage

Many false positives caused by helper layering and abstraction could disappear.

### Cleaner dynamic reporting

If more cases can be proven statically, the dynamic-analysis rules can be reserved for truly uncertain cases.

### Stronger foundation for future rules

Once the scanner has a richer program-understanding layer, it may support future rules that depend on compile-time value reasoning.

## Risks and costs

### 1. Complexity explosion

This is not an incremental tweak. It is a major subsystem with its own design, correctness boundaries, and maintenance demands.

### 2. Performance cost

Cross-file evaluation can become expensive quickly on large repositories, especially when variant sets branch combinatorially.

### 3. Debuggability cost

A richer evaluator can make incorrect or surprising outcomes much harder to explain to users and maintainers.

### 4. Soundness versus usefulness tension

If the interpreter is too conservative, it recovers little value.

If it is too aggressive, it can create false confidence by claiming a class is known when it is not safely provable.

### 5. Ecosystem burden

Real projects use many local abstractions and third-party helpers. Supporting enough of them well enough becomes an ongoing responsibility.

### 6. Product drift

The project may stop feeling like a focused CSS scanner and start feeling like a JS static-analysis engine that happens to power CSS rules.

## Feasibility

This direction is technically feasible.

However, it is probably better understood as a second-system effort than as the next natural iteration after the current observation set. The main observed pain points appear solvable with a far smaller evaluator focused on class expressions and shallow local dataflow.

## Comparison with the bounded evaluator approach

The bounded evaluator described in `docs/observations/class-expression-evaluator-design-note.md` aims to:

- inspect `className` expressions
- inline shallow same-file constants and transparent helper functions
- recover finite, statically provable class tokens
- stop early when things become too dynamic

The maximal approach would go much further by:

- following imports across files
- evaluating many more expression and function shapes
- carrying abstract values through a module graph
- maintaining evaluator budgets and symbol summaries

The bounded approach is high-ROI and targeted.

The maximal approach is powerful, but much more expensive.

## Recommended staged exploration

If the project ever wants to explore this direction, it would be safer to move through intermediate tiers rather than jumping straight to a full abstract interpreter.

Suggested progression:

1. Same-file class-expression evaluator.
2. Same-file helper and constant summarization.
3. Imported constant and map resolution across files.
4. Cross-file pure-helper summarization.
5. Bounded interprocedural class-source tracing.
6. Only then consider a more general abstract interpretation layer.

This staged path would allow the project to measure accuracy gains and performance costs before committing to the full complexity of a maximal design.

## Recommendation

Treat this as a future research direction, not a current implementation plan.

The most likely high-value path remains:

- narrow class-expression evaluation
- shallow local dataflow
- same-file helper support
- maybe limited cross-file constant or helper summarization later

That path addresses a large share of the current friction without requiring the project to become a full JS and TS static evaluation engine.
