# Current Engine Assessment

## Purpose

This document assesses the current state of `src/static-analysis-engine`.

It is intentionally focused on the engine itself:

- what it already does well
- where real functionality is missing
- where responsibility is leaking out of analysis and into rules
- which legacy-dependent engine-local code was removed
- where scope is still ambiguous

This document does not try to cover the package shell, CLI, config, or publishing story in depth. Those are covered separately.

## Current State Summary

The engine already has substantial core pieces in place.

Implemented areas include:

- source parsing
- module graph construction
- symbol collection and cross-file binding resolution
- bounded render IR construction
- render graph construction
- CSS rule and class-definition extraction
- selector normalization for a bounded subset of selectors
- selector branch projection for branch-level selector-list findings
- stylesheet reachability analysis
- a normalized `ProjectAnalysis` projection for rule-facing entities, relations, and indexes
- reference match relations with class-token, definite/possible, reachability, reasons, and trace evidence
- declared-provider satisfaction relations indexed by reference and class name
- serializable `ProjectAnalysis` debug snapshots
- a dedicated CSS Module analysis stage for import records, static member references, and computed-member diagnostics
- CSS Module member-to-export match relations projected and indexed through `ProjectAnalysis`
- render-model internals grouped under the render-model pipeline stage

The pipeline in `entry/scan.ts` is coherent enough to act as the nucleus of the reboot.

The biggest problem is not that the engine has no structure. The biggest remaining problem is that
the new project analysis contract is still a first slice and does not yet cover every product
behavior.

## Real Functionality Gaps

These are engine gaps, not packaging or docs gaps.

### 1. `ProjectAnalysis` is still incomplete

The current pipeline now returns a normalized `projectAnalysis` object from the engine entry points.
Intermediate stage outputs remain local to the pipeline.
The projection currently covers:

- source files
- stylesheets
- components
- render subtrees
- class references
- class definitions
- selector queries
- class ownership evidence
- reachability, match, import, and render relations
- deterministic indexes over common rule lookup paths

Remaining gaps include:

- deeper ownership and organization rules beyond the first component-colocation signal
- richer external CSS ingestion records
- stronger match semantics for dynamic and unsupported analysis beyond the current class-reference slice

### 2. CSS Modules are a first slice, not yet complete

The current engine now recognizes CSS Modules as first-class analysis records for the core static
member path. CSS Module extraction lives in `cssModuleAnalysisStage` and
`pipeline/css-modules`; `ProjectAnalysis` consumes those records to assign stable ids, connect them
to source and stylesheet entities, and build rule-facing relations and indexes.

Implemented:

- CSS Module import records
- `styles.foo` and `styles["foo"]` member reference records
- module member-to-class-definition match relations
- computed member access diagnostics

Still missing:

- `localsConvention` transformations
- `composes` target analysis
- destructured or re-exported CSS Module member patterns
- full integration between CSS Module member access and generic class-expression diagnostics

### 3. Dynamic class analysis is still narrow

`pipeline/render-model/abstract-values/classExpressions.ts` currently handles:

- exact string literals
- no-substitution template literals
- simple conditional expressions that collapse to string sets

It does not yet treat common real-world patterns as first-class:

- template expressions with interpolated branches
- array joins
- helper libraries such as `clsx` and `classnames`
- object syntax helpers
- string concatenation
- computed CSS Module property access

This is a real engine gap because class extraction is foundational.

### 4. Module resolution is intentionally bounded

The module graph is useful, but it is still limited in ways that matter for a production scanner:

- relative-path source resolution is the main supported path
- no first-class path alias model
- no package export map or tsconfig path awareness
- no explicit monorepo workspace resolution contract
- CSS import handling is still based on basic specifier classification

This is acceptable for a reboot, but it is a real functional limit.

### 5. Selector analysis only covers a bounded subset

The selector-analysis types are explicit about this, which is good.

Current bounded support is centered on:

- same-node class conjunction
- parent-child
- ancestor-descendant
- sibling relationships
- class-only selector steps

Still missing or only partially represented:

- pseudo classes and pseudo elements
- attribute selectors
- ids
- tag plus class combinations as first-class semantics
- negation beyond shallow extraction
- more complex at-rule semantics

The engine is honest about bounded analysis, but the product contract will need to state these limits clearly.

### 6. At-rule handling is narrow

The selector-analysis model currently only gives `media` a first-class type for at-rule context.

That leaves open behavior for:

- `supports`
- `layer`
- container queries
- nested combinations of multiple at-rules with semantics

The engine can preserve some context text, but it does not yet model the meaning of those contexts deeply.

### 7. External CSS support is partial

The engine can model external providers and project-wide remote stylesheet presence, but it does not actually provide a full external CSS ingestion contract on its own.

Open areas include:

- true remote fetching behavior
- caching semantics
- HTML discovery owned by the engine versus product shell
- direct external stylesheet definition ingestion as a first-class pipeline input

### 8. Missing analysis support for future rule families

Rule execution now lives outside the engine in `src/rules`, so missing rule families are no longer
engine-native rule gaps by themselves. The engine gap is whether `ProjectAnalysis` exposes enough
evidence for those rules to stay thin.

Current implemented rule families include:

- missing CSS class
- unused CSS class
- CSS class defined only in unreachable stylesheets
- dynamic class references
- unsupported syntax affecting analysis

Remaining analysis gaps for target rules include:

- ownership and organization records
- utility/migration-style declaration analysis
- richer selector satisfiability records
- richer external CSS ingestion and provider records

## Responsibility Leakage

The main architectural leak is that rules are still doing analysis work.

### 1. Rules should not rebuild project-wide indexes

The reboot moved rules above the engine and made them consume `ProjectAnalysis`.

Current rules are mostly reading:

- class references
- class definitions
- reference match relations
- declared-provider satisfaction relations
- indexes such as `matchesByReferenceId`

This is the intended direction. Any future rule that needs to rebuild project-wide maps is a signal
that `ProjectAnalysis` needs another relation or index.

### 2. Some definition-level analysis is still thin

Future duplication and migration rules will need non-trivial filtering and grouping logic over CSS
definitions.

That suggests the engine is missing reusable definition-level analysis records such as:

- definition scope kind
- root/simple selector classification
- declaration signature
- comparable-definition groups

### 3. Rule inputs still expose some low-level concepts

The rule layer no longer receives intermediate stage outputs, which is a major improvement.

Some low-level concepts still leak through `ProjectAnalysis`, especially:

- class expression certainty
- selector query constraints
- dynamic and unsupported analysis detail

That is acceptable for the first slice, but the contract should keep moving toward domain-specific
relations and summaries that rules can consume directly.

### 4. Legacy adapters were deleted

The current-scanner adapters were removed from `src/static-analysis-engine`.

Deleted files included:

- `runMigratedDefinitionAndUsageIntegrityRules.ts` is 379 lines
- `runMigratedOptimizationRules.ts` is 349 lines
- `buildEngineDefinitionReachability.ts` is 316 lines

Those files were not just bridging contracts. They reconstructed analysis concepts that the engine should expose natively if those rule families are meant to survive.

### 5. Comparison code was deleted

The `comparison/` area was removed because it existed to compare engine output to a deleted baseline scanner.

That comparison surface kept the engine public surface entangled with:

- baseline findings
- compatibility result types
- shadow-mode reporting

Those concerns are orthogonal to engine analysis.

## Deleted Legacy-Dependent Code

The following engine-local areas have been deleted because they only supported shadow-mode comparison against, or migration adapters for, the deleted scanner:

- `src/static-analysis-engine/comparison/`
- `src/static-analysis-engine/adapters/current-scanner/`
- `src/static-analysis-engine/runtime/compatTypes.ts`

Reason:

- they only exist to compare against or adapt to the removed scanner
- they blocked type-checking by importing deleted root modules
- they add conceptual noise to the engine public surface

The default engine export surface also no longer exports:

- all comparison exports in `src/static-analysis-engine/index.ts`

### Moved out of the engine

Rule execution now lives in `src/rules`.

Rules should consume `ProjectAnalysis` directly.

## Ambiguities In Scope Or Intended Design

These are the major questions the engine still leaves open.

### 1. Is the engine path-based or text-based?

Right now the main entry point is essentially text-based:

- source files are passed in as `{ filePath, sourceText }`
- CSS is passed in separately
- HTML is not a first-class engine input

That is a good core shape, but the project should make that explicit. Otherwise engine responsibilities will drift back toward filesystem work.

### 2. Should the engine emit findings directly, or only analysis?

Current decision:

- the engine returns analysis only
- rule execution lives above the engine in `src/rules`
- product reporting turns rule results into user-facing output

The remaining work is to keep that boundary clear as new rules are added.

### 3. How much unsupported analysis becomes a finding?

The code already distinguishes:

- resolved
- unsupported
- budget-exceeded
- unknown

That is a strength. The ambiguous part is product semantics:

- should unsupported selector analysis emit rule findings
- should it stay as diagnostics only
- when does bounded uncertainty become warning versus info

The engine should support both, but the intended product behavior should be defined.

### 4. How far should ownership go in the engine?

The deleted scanner had ownership-style concepts such as component, page, global, and utility.

The current engine now exposes evidence-based class ownership records in `ProjectAnalysis`.
Those records preserve owner candidates, consumer summaries, path-convention reasons, confidence,
and traces without reviving fixed ownership buckets as the primary model.

Remaining decisions:

- which ownership rules should become default product policy
- how much path-convention behavior should become configurable
- whether broader directory or feature ownership should be modeled beyond component-level evidence

The first implemented rule is `single-component-style-not-colocated`; broader boundary and shared
ownership rules should continue to consume `ProjectAnalysis` ownership records rather than rebuilding
import/reference maps.

### 5. How far should bounded render analysis go?

The render IR is already substantial, but it is still explicitly bounded.

Decision needed:

- what minimum JSX and helper coverage counts as product-ready
- whether helper expansion is a policy-driven plug-in point
- what unsupported render shapes should degrade to

### 6. What is the intended external CSS boundary?

Unclear points include:

- whether HTML extraction belongs in the engine
- whether remote fetching belongs in the engine
- whether declared global providers are engine policy or product policy

These should not be left implicit.

## Recommended Engine Direction

The engine should move toward one clean contract:

- build `ProjectAnalysis`
- build reusable indexes and match relations once
- keep rules thin
- stop exporting legacy comparison scaffolding as part of the main story

If we do that, the existing pipeline becomes an asset instead of a refactor trap.

## Recommended Next Engine Slices

1. Harden `ProjectAnalysis` for the existing rules:
   - stable ids
   - match semantics
   - diagnostics versus findings support
   - trace propagation
   - serializable debug output
2. Improve dynamic class extraction for common syntax and helper libraries.
3. Expand selector semantics once the selector result contract is stable.
4. Add ownership analysis only after correctness and reachability are dependable.
