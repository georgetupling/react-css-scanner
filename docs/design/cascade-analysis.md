# Cascade Analysis

## Purpose

Cascade analysis is the planned browser-like CSS semantics layer for `scan-react-css`.

Its job is to turn existing stylesheet, selector, render, runtime-loading, and ownership evidence into declaration-level cascade evidence:

- which CSS declarations can apply to which modeled rendered elements
- which declarations win or lose for a property
- whether the scanner can prove the result or must preserve uncertainty
- why a cascade result happened, in terms users can inspect

Cascade findings should be proof-oriented. The scanner should not report approximate cascade warnings by default. When cascade behavior is uncertain, the stage should emit diagnostics/evidence for debug or opt-in rules rather than normal findings.

## Product Policy

Default user-facing cascade rules must prioritize precision over recall.

A default-on cascade finding requires:

- definite element match
- known stylesheet/runtime order
- known selector specificity
- compatible conditions
- exact property semantics or supported property-effect expansion
- no unsupported selector, declaration, source-order, or condition feature involved in the winning comparison

Anything weaker should begin as either:

- `debug`, when useful mainly to analysis authors or advanced troubleshooting
- opt-in non-default rule severity
- internal cascade evidence consumed by later rules

## Stage Policy

Normal `scanProject()` execution should run `cascade-analysis` only when at least one cascade-aware rule is enabled.

Reasons:

- cascade analysis will be heavier than current rule-facing evidence assembly
- early cascade rules will likely be opt-in/debug
- running only when needed avoids making every scan pay for an experimental capability

The stage can later run unconditionally if cascade evidence becomes broadly useful to ownership, reachability, or summary reporting.

Recommended eventual pipeline position:

```text
workspace-discovery
-> language-frontends
-> fact-graph
-> symbolic-evaluation
-> render-structure
-> selector-reachability
-> runtime-css-loading
-> project-evidence
-> ownership-inference
-> cascade-analysis
-> run-rules
```

Current implementation status:

- `cascade-analysis` is scaffolded under `src/static-analysis-engine/pipeline/cascade-analysis`.
- The stage currently runs after `ownership-inference` and before `run-rules`.
- It emits declaration records, condition sets, declaration candidates, outcomes, diagnostics, and indexes.
- The first pass is intentionally narrow: author stylesheet declarations plus bounded JSX inline style flow, limited CSS property effects, selector-branch render matches only, and one opt-in cascade-consuming rule.
- `scanProject()` uses rule-aware gating so projects only pay for cascade work when a cascade-aware rule is enabled.
- Direct `runAnalysisPipeline()` calls still build cascade analysis by default for engine tests, tooling, and analysis inspection. Callers can request `cascadeAnalysis: "auto"` to use rule-aware gating.

The stage can technically run before `ownership-inference` for pure declaration winning/losing. Placing it after ownership keeps room for ownership-aware cascade rules such as `component-style-overridden-externally`.

`src/static-analysis-engine/entry/scan.ts` must remain orchestration-only. Cascade-specific derivation belongs under `src/static-analysis-engine/pipeline/cascade-analysis`.

## Parser Decision

Use `css-tree` as the analysis-facing CSS parser.

`parseCssStyleRules.ts` remains the stable wrapper for stylesheet rule extraction. Internally it should use the `css-tree` implementation.

`CssDeclarationFact` now carries declaration-level metadata:

```ts
export type CssDeclarationFact = {
  property: string;
  value: string;
  important?: boolean;
  propertyEffects?: CssDeclarationPropertyEffect[];
  sourceAnchor?: SourceAnchor;
};
```

`propertyEffects` is computed by the CSS parsing/frontend layer, including any `css-tree` value parsing needed for shorthand semantics. This keeps later stages from re-walking CSS value ASTs. Cascade analysis should consume normalized declaration evidence from `project-evidence`, not raw parser output.

## Evidence Contracts

These contracts describe the target shape. Names may be adjusted during implementation, but the semantic boundaries should hold.

### Declaration Evidence

Add first-class declaration entities to `project-evidence`.

```ts
export type CssDeclarationAnalysis = {
  id: ProjectEvidenceId;
  stylesheetId: ProjectEvidenceId;
  styleRuleId?: ProjectEvidenceId;
  selectorQueryId?: ProjectEvidenceId;
  selectorBranchIds: ProjectEvidenceId[];
  selectorText: string;
  property: string;
  value: string;
  propertyEffects?: CssDeclarationPropertyEffect[];
  important: boolean;
  declarationIndex: number;
  ruleSourceOrder: number;
  stylesheetSourceOrder?: number;
  projectSourceOrder?: number;
  location?: SourceAnchor;
  atRuleContext: CssAtRuleContextFact[];
  sourceDeclaration: CssDeclarationFact;
};
```

Notes:

- `declarationIndex` is order within the declaration block.
- `ruleSourceOrder` is order within a stylesheet.
- `stylesheetSourceOrder` is order among stylesheets when known.
- `projectSourceOrder` is a later normalized order suitable for cascade comparison in a runtime context.
- `selectorBranchIds` connects one declaration block to each selector-list branch that can carry the declaration.

Relevant implementation locations:

- `src/static-analysis-engine/types/css.ts`
- `src/static-analysis-engine/pipeline/fact-graph/types.ts`
- `src/static-analysis-engine/pipeline/fact-graph/builders/buildCssNodes.ts`
- `src/static-analysis-engine/pipeline/project-evidence/analysisTypes.ts`
- `src/static-analysis-engine/pipeline/project-evidence/entities/core.ts`
- `src/static-analysis-engine/pipeline/project-evidence/indexes.ts`

### Cascade Key

Every declaration candidate needs a sortable cascade key.

```ts
export type CssSpecificity = {
  a: number;
  b: number;
  c: number;
};

export type CascadeKey = {
  origin: "author" | "inline" | "user" | "user-agent" | "unknown";
  important: boolean;
  layer?: {
    name?: string;
    order?: number;
    known: boolean;
    unlayered: boolean;
  };
  specificity: CssSpecificity;
  scopeProximity?: {
    distance?: number;
    known: boolean;
  };
  sourceOrder?: number;
  orderKnown: boolean;
};
```

Initial support includes author stylesheet declarations, direct JSX inline styles on intrinsic elements, and statically analyzable component-forwarded `style` props. User origin and user-agent origin remain representable so the model does not need to be reshaped later.

Inline style support is intentionally static and bounded. The scanner can follow object literals, local and imported exported `const` style object bindings, no-argument local helpers that return style objects, conditional style object branches, static object spreads, and JSX prop spreads that expose a `style` prop or forward `props`/rest props into an intrinsic element. Conflicting conditional values are rejected as unsupported rather than guessed. React inline style declaration semantics are computed before candidate creation: camelCase property names are normalized, numeric values are converted using React's `px`/unitless behavior, custom properties are preserved, and then `propertyEffects` are attached through the shared CSS declaration semantics helper.

### Condition Evidence

Cascade comparisons must not treat incompatible conditions as definite conflicts.

```ts
export type CascadeConditionSource =
  | "at-rule"
  | "selector-state"
  | "render-condition"
  | "class-emission-condition"
  | "runtime-css-loading";

export type CascadeConditionSet = {
  id: string;
  sources: CascadeConditionSource[];
  atRuleContext: CssAtRuleContextFact[];
  renderConditionIds: string[];
  classEmissionConditionIds: string[];
  pseudoStates: string[];
  runtimeContextIds: string[];
  compatibility: "definite" | "conditional" | "unknown";
  reasons: string[];
  traces: AnalysisTrace[];
};

```

The first implementation treats condition details as opaque signatures:

- candidates with no conditions are definite
- candidates with the same non-empty at-rule/render condition signature can be compared, but the outcome is conditional/possible
- candidates with different condition signatures produce an unresolved `condition-uncertain` outcome, because different runtime contexts may produce different winners

This deliberately avoids evaluating media/supports truth. It only proves whether the compared declarations are guarded by the same modeled context.

Implementation status:

- at-rule and render placement conditions are modeled as opaque compatibility signatures.
- supported selector pseudo-classes are modeled as `selector-state` conditions.
- pseudo-state selectors can still produce selector reachability matches when their structural class requirements are otherwise supported.
- candidates with the same pseudo-state set can be compared as a possible conditional outcome.
- candidates with different pseudo-state sets, including stateful selectors compared with unconditional selectors, remain unresolved instead of producing a false definite winner.

### Declaration Candidates

A declaration candidate represents a declaration matched to a modeled element under a condition set.

```ts
export type CascadeDeclarationCandidate = {
  id: string;
  declarationId?: ProjectEvidenceId;
  inlineStyleId?: string;
  elementId: string;
  selectorBranchId?: ProjectEvidenceId;
  property: string;
  value: string;
  declaredProperty: string;
  declaredValue: string;
  propertyEffectSource: "exact" | "shorthand";
  cascadeKey: CascadeKey;
  conditionSetId?: string;
  matchCertainty: "definite" | "possible" | "unknown";
  reasons: string[];
  traces: AnalysisTrace[];
};
```

Candidate indexes should include:

- candidates by declaration id
- candidates by inline style id
- candidates by selector branch id
- candidates by element id
- candidates by element id and property
- candidates by condition set id

### Cascade Outcomes

A cascade outcome describes a property comparison for one modeled element.

```ts
export type CascadeComparisonReason =
  | "higher-origin"
  | "important"
  | "layer-order"
  | "specificity"
  | "scope-proximity"
  | "source-order"
  | "condition-uncertain"
  | "order-uncertain"
  | "unsupported-selector"
  | "unsupported-property-semantics";

export type CascadeComparisonStep = {
  reason: CascadeComparisonReason;
  winningCandidateId?: string;
  losingCandidateId?: string;
  certainty: "definite" | "possible" | "unknown";
  detail: string;
};

export type CascadeOutcome = {
  id: string;
  elementId: string;
  property: string;
  winningCandidateId?: string;
  losingCandidateIds: string[];
  unresolvedCandidateIds: string[];
  certainty: "definite" | "possible" | "unknown";
  reason: CascadeComparisonReason;
  comparisonTrace: CascadeComparisonStep[];
  traces: AnalysisTrace[];
};
```

Rules should consume outcomes rather than recomputing cascade comparisons.

### Diagnostics

Cascade diagnostics should preserve why a declaration or comparison could not be analyzed.

```ts
export type CascadeAnalysisDiagnosticCode =
  | "unsupported-selector-specificity"
  | "unsupported-selector-match"
  | "unknown-stylesheet-order"
  | "unknown-condition-compatibility"
  | "unsupported-property-semantics"
  | "unsupported-inline-style"
  | "missing-declaration-location"
  | "missing-selector-branch-match";

export type CascadeAnalysisDiagnostic = {
  id: string;
  code: CascadeAnalysisDiagnosticCode;
  severity: AnalysisSeverity;
  confidence: AnalysisConfidence;
  message: string;
  location?: SourceAnchor;
  declarationId?: ProjectEvidenceId;
  selectorBranchId?: ProjectEvidenceId;
  elementId?: string;
  traces: AnalysisTrace[];
};
```

## Stage Result

```ts
export type CascadeAnalysisResult = {
  declarations: CssDeclarationCascadeRecord[];
  conditionSets: CascadeConditionSet[];
  candidates: CascadeDeclarationCandidate[];
  outcomes: CascadeOutcome[];
  diagnostics: CascadeAnalysisDiagnostic[];
  indexes: CascadeAnalysisIndexes;
  meta: {
    generatedAtStage: "cascade-analysis";
  };
};
```

`CssDeclarationCascadeRecord` can be a stage-local projection of `CssDeclarationAnalysis` plus cascade key inputs that do not belong in `project-evidence`.

## Initial Rule Targets

Start with one opt-in/debug rule after the stage exists:

- `declaration-always-shadowed`

Implementation status:

- `declaration-always-shadowed` is implemented as an opt-in rule with default severity `off`.
- It consumes cascade outcomes and declaration candidates rather than recomputing cascade logic.
- It reports only when every candidate for a declaration definitely loses and the declaration has no cascade diagnostics.

Only report when:

- at least one candidate for the declaration exists
- every candidate loses
- every loss is definite
- the winning declaration is known
- no unresolved candidate could let the declaration win

Future rules:

- `selector-declaration-never-wins`
- `same-property-conflict`
- `component-style-overridden-externally`
- `implicit-cascade-dependency`
- `selector-specificity-too-high`
- `selector-specificity-conflict`
- `layer-boundary-violation`

## Phase 1 Boundary

Phase 1 is the declaration-evidence substrate. It should not build the full cascade stage yet.

Phase 1 adds first-class declaration evidence to `project-evidence`:

- declaration ids
- declaration order
- stylesheet/rule/selector links
- property/value/important/location
- indexes by stylesheet, rule, selector branch, and property
- tests proving deterministic declaration extraction and indexing

Implementation status:

- `CssDeclarationAnalysis` is exported from `project-evidence`.
- `projectEvidence.entities.cssDeclarations` carries normalized declaration records.
- CSS frontend declaration facts carry `propertyEffects`, so cascade analysis can consume parsed declaration semantics without reparsing stylesheet values.
- `projectEvidence.indexes` exposes declaration indexes by id, stylesheet, rule definition node, selector branch, and property.
- `projectEvidence.meta.cssDeclarationCount` records the declaration count.
- The first version uses `ruleDefinitionNodeId` rather than a project-evidence `styleRuleId`, because rules are not yet first-class project-evidence entities.
- Runtime stylesheet order is normalized for definite initial static CSS imports, including CSS files reached through statically imported source modules and nested stylesheet imports.
- `stylesheetSourceOrder` and `projectSourceOrder` fields remain deferred on the declaration evidence itself; cascade currently stores normalized order in candidate cascade keys.

Once declarations are first-class, `cascade-analysis` can be added as a narrow proof stage over exact-property author declarations.

## Phase 2 Boundary

Phase 2 adds the first cascade stage scaffold:

- `CascadeKey` for author declarations with `important`, cascade layer, selector specificity, and local source order.
- branch-specific selector specificity, including basic `:is()`, `:not()`, `:has()`, and zero-specificity `:where()`.
- named cascade layer order from `@layer a, b;` statements and named `@layer name { ... }` blocks.
- layer precedence before specificity, including unlayered normal declarations and reversed `!important` layer order.
- declaration candidates from selector-branch render matches.
- declaration candidates from direct `style={{ ... }}` JSX inline styles on intrinsic elements, with inline origin precedence.
- declaration candidates from component-forwarded `style` props when a component supplies a static style object and an expanded intrinsic element consumes that prop.
- declaration candidates from JSX prop spreads when the spread can be statically resolved to a `style` prop, or when component props/rest props are forwarded to an intrinsic element.
- declaration candidates from local and imported exported `const` style object bindings.
- declaration candidates from no-argument local helpers that return statically analyzable style objects.
- conditional inline style object support when every branch can be statically analyzed; properties present in only some branches become possible candidates, while conflicting branch values produce an `unsupported-inline-style` diagnostic.
- React-style numeric value normalization for inline styles: non-zero numeric values gain `px` except for custom properties and known unitless CSS properties.
- static inline style object spread flattening for local `const` object literals, preserving object literal order and React's later-property-wins behavior.
- precomputed inline style property effects after React property/value normalization, so cascade candidate creation does not parse inline declaration semantics.
- custom property declarations are modeled as exact cascade candidates, and declaration values containing `var(...)` record custom-property dependencies. Shorthand expansion blocked by `var(...)` emits explicit unresolved-custom-property diagnostics instead of generic parser uncertainty.
- definite custom property winners are substituted into dependent declaration values before final property-effect expansion. This lets declarations such as `background: var(--button-bg)` become normal longhand candidates when `--button-bg` has a definite winner for the rendered element.
- `var(...)` fallback values are used when a referenced custom property is missing and the fallback can be resolved.
- custom property substitution preserves uncertainty when the referenced custom property winner is conditional, unresolved, cyclic, invalid after substitution, or missing without a usable fallback.
- condition sets for at-rule and render placement conditions.
- outcomes grouped by rendered element and effective property.
- resolved cross-stylesheet outcomes when all candidates come from a definite initial runtime CSS chunk with stable static import order.
- unresolved outcomes when candidates come from multiple stylesheets and runtime order cannot be proven.
- conditional outcomes when all candidates share the same non-empty condition signature.
- unresolved `condition-uncertain` outcomes when candidates have different at-rule/render condition signatures.
- selector pseudo-state conditions for supported state and structural pseudo-classes, including conservative unresolved outcomes when a pseudo-state selector is compared with an unconditional selector.
- value-aware property effects computed by the CSS frontend for exact properties plus supported box-model shorthands: `margin`, `padding`, logical `margin-*`/`padding-*`, physical/logical `inset`, `border-width`, `border-style`, `border-color`, physical side `border-*`, logical `border-block*`/`border-inline*`, whole `border` when the width/style/color value can be safely parsed, and `css-tree`-validated `background` effects for color, image, repeat, attachment, position, size, origin, and clip.
- `unsupported-property-semantics` diagnostics for known unsupported shorthands such as `font`, `flex`, `grid`, transitions, animations, and ambiguous supported-family values such as whole-border CSS variables or ambiguous `background` values.

Known limitations:

- only definite initial static runtime stylesheet order is normalized
- no dynamic/lazy CSS order normalization yet
- no multi-entry runtime context modeling beyond requiring a stable observed order
- no evaluation of `@media`, `@supports`, or container-query truth
- no proof that different conditional contexts are mutually exclusive or overlapping
- anonymous and otherwise unsupported cascade layer order remains unresolved
- no nested layer name composition beyond explicit dotted layer names
- no `@scope`
- no computed style property names or computed JSX prop names
- no dynamic, unknown spread, parameterized helper, mutation-based, call-result, member-expression, re-export barrel, namespace import, or package-import inline style evaluation
- conditional inline style branches with conflicting values for the same effective property are intentionally unsupported
- only a bounded safe shorthand/longhand property semantics set
- no logical property, reset, or inheritance resolution
- custom property cascade and definite `var()` substitution are modeled, but conditional, cyclic, missing, and invalid substitutions remain unsupported-property-semantics uncertainty
- no full typed value grammar; border shorthand parsing recognizes clear width/style/color tokens and intentionally rejects ambiguous whole-value variables
- `background` shorthand parsing is `css-tree` validated but still partial: it models reset/winning behavior for the main background longhands, but it does not yet model every computed-value nuance or `var()` substitution
- no pseudo-state implication model: for example, `:focus-visible` is not inferred to imply `:focus`, and `:hover:focus` is not reduced against `:hover`
- only `declaration-always-shadowed` consumes outcomes today, and it remains opt-in
