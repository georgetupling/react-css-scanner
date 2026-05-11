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

Inline style support is intentionally static and bounded. The scanner can follow object literals, local and imported exported `const` style object bindings, no-argument local helpers that return style objects, conditional style object branches, static object spreads, and JSX prop spreads that expose a `style` prop or forward `props`/rest props into an intrinsic element. JSX prop spread extraction for both `style` and class-like props uses a shared static object value evaluator with exact/partial/unknown confidence, so computed literal keys, member expressions, no-argument helper calls, nested object spreads, and known properties after unknown spreads can be reused consistently across inline style and className analysis. Conflicting conditional inline style values are rejected as unsupported rather than guessed. React inline style declaration semantics are computed before candidate creation: camelCase property names are normalized, numeric values are converted using React's `px`/unitless behavior, custom properties are preserved, and then `propertyEffects` are attached through the shared CSS declaration semantics helper.

### Shared Static Value Flow

The existing className symbolic evaluator already proves many string and token flows: literals, templates, arrays, helpers, member access, imported constants, finite alternatives, and partial/unknown dynamic input. Inline style analysis needs the same reach, but it cannot consume the className projection directly because style semantics are object-shaped rather than token-shaped. Style flow must preserve property order, spread barriers, last-write-wins behavior, computed property names, branch-specific property values, and per-property source locations.

The stage-owned design is:

```text
language-frontends
  -> JSX class/style/spread sites
  -> normalized expression-syntax facts
  -> no static object evaluation

symbolic-evaluation
  -> reusable JavaScript value evaluation over expression-syntax facts
  -> className projection facts
  -> static object value facts/indexes for later consumers

cascade-analysis
  -> consumes precomputed inline-style declaration semantics
  -> does cascade comparison, not JavaScript AST/value flow
```

Implementation status:

- React language frontends now preserve JSX spread expressions as class/style sites with `object-property` projection metadata instead of evaluating the spread object from the TypeScript AST.
- `symbolic-evaluation` resolves `className` projections from expression-syntax facts, including local/imported object literals, member access, element access with static keys, computed static object keys, and uncertainty from unresolved object entries.
- Inline style projections are represented in frontend facts too. `symbolic-evaluation` now emits reusable static inline-style object facts/indexes keyed by inline style site. Those facts flatten supported object spreads, resolve `style` projections from JSX prop spreads, preserve conditional alternatives, and retain value expression syntax for React property semantics. Cascade consumes those facts by site key and no longer projects the `style` property or resolves JavaScript object roots itself.

This keeps the architecture honest:

- language frontends identify syntax sites and collect expression facts
- symbolic evaluation owns reusable JavaScript value shapes
- className and inline style analysis project those shapes into domain-specific evidence
- cascade consumes already-normalized inline style declarations rather than doing JavaScript dataflow

Near-term improvements should land in symbolic evaluation when they are object-shape concepts, and in the className or inline-style projection only when the behavior is domain-specific.

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
- candidates with unconditional plus conditional signatures produce a `condition-branch` outcome: the unconditional declarations form the default winner, and each modeled conditional signature gets its own possible branch winner
- candidates with only different conditional signatures produce an unresolved `condition-uncertain` outcome, because different runtime contexts may produce different winners

Environment-dependent conditions now flow through a small browser environment profile layer. The first built-in profiles describe modern browser support plus representative mobile/desktop and light/dark environments; branch comparison still keeps exact range and contradiction checks as the conservative source of truth so a missing starter profile does not make a real browser state impossible.

Implementation status:

- at-rule and render placement conditions are modeled as compatibility signatures. Cascade normalizes browser-stable at-rule truths: `@media all` is definite, and `@media not all` declarations are ignored as impossible. Basic `@supports` boolean expressions are reduced with `not`/`and`/`or`; invalid declaration conditions are impossible, negated invalid declarations are definite, and syntactically valid declaration conditions remain conditional unless a modeled branch can tie them to a built-in environment profile. Environment-dependent media queries, valid `@supports`, container queries, and unknown at-rules remain conditional.
- supported selector pseudo-classes are modeled as `selector-state` conditions.
- pseudo-state selectors can still produce selector reachability matches when their structural class requirements are otherwise supported.
- candidates with the same pseudo-state set can be compared as a possible conditional outcome.
- stateful selectors compared with unconditional selectors produce branch outcomes: the unconditional winner applies by default, and each pseudo-state context has a separate possible winner.

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
  | "condition-branch"
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
  conditionalBranches?: CascadeConditionalOutcomeBranch[];
  certainty: "definite" | "possible" | "unknown";
  reason: CascadeComparisonReason;
  comparisonTrace: CascadeComparisonStep[];
  traces: AnalysisTrace[];
};

export type CascadeConditionalOutcomeBranch = {
  conditionSetId: string;
  winningCandidateId?: string;
  losingCandidateIds: string[];
  unresolvedCandidateIds: string[];
  certainty: "possible" | "unknown";
  reason: CascadeComparisonReason;
};
```

Rules should consume outcomes rather than recomputing cascade comparisons.

### Computed Style Resolution Follow-On

Cascade outcomes answer which declaration wins locally for one rendered element and one effective property. That is necessary but not sufficient for browser-like inheritance semantics, because many CSS properties are inherited from the parent computed value when the element has no local winning declaration, or when the winning declaration uses a CSS-wide keyword such as `inherit` or inherited `unset`.

The follow-on work is a computed-style resolution layer inside `cascade-analysis`:

```ts
export type CascadeComputedProperty = {
  id: string;
  elementId: string;
  property: string;
  value?: string;
  source:
    | "local-cascade"
    | "inherited-parent"
    | "initial-value"
    | "unresolved-parent"
    | "unsupported-css-wide-keyword";
  outcomeId?: string;
  winningCandidateId?: string;
  parentComputedPropertyId?: string;
  certainty: "definite" | "possible" | "unknown";
  reasons: string[];
  traces: AnalysisTrace[];
};
```

This should be computed after final cascade outcomes, using:

- `CascadeOutcome` and `CascadeDeclarationCandidate` to find the local winning value for an element/property.
- `propertyMetadata.ts` for each known longhand's `inherited` flag and initial value.
- `renderModel.indexes.elementById` / `RenderedElement.parentElementId` to follow the modeled parent element chain.
- condition branch metadata from outcomes when a local winner or parent value is possible rather than definite.

Resolution rules:

- A definite local winner with an ordinary concrete value produces `source: "local-cascade"`.
- `initial` resolves to the longhand metadata initial value.
- `inherit` resolves to the parent element's computed value for the same property.
- `unset` resolves as `inherit` for inherited properties and as `initial` for non-inherited properties.
- No local outcome resolves as parent inheritance for inherited properties, and as initial value for non-inherited properties.
- Root elements with no modeled parent resolve inherited properties to their initial values.
- `revert` and `revert-layer` remain `unsupported-css-wide-keyword` until user/user-agent origins and layer rollback semantics are modeled.
- Unknown, conditional, or branch-varying local outcomes should propagate `possible` / `unknown` rather than inventing one computed value.
- Missing or uncertain parent chains produce `source: "unresolved-parent"` for inherited values rather than falling back silently.

The pass should be recursive and deterministic. It needs a visited-set guard even though render parent chains should be acyclic, because computed-style resolution should never be able to hang on malformed analysis input. It should emit indexed records, not mutate cascade outcomes, so consumers can choose whether they need local cascade evidence or computed-value evidence.

Recommended result/index additions:

```ts
export type CascadeAnalysisResult = {
  declarations: CssDeclarationCascadeRecord[];
  conditionSets: CascadeConditionSet[];
  candidates: CascadeDeclarationCandidate[];
  outcomes: CascadeOutcome[];
  computedProperties: CascadeComputedProperty[];
  diagnostics: CascadeAnalysisDiagnostic[];
  indexes: CascadeAnalysisIndexes;
};

export type CascadeAnalysisIndexes = {
  // existing indexes...
  computedPropertyById: Map<string, CascadeComputedProperty>;
  computedPropertyIdsByElementId: Map<string, string[]>;
  computedPropertyIdByElementAndProperty: Map<string, string>;
  computedPropertyIdsByOutcomeId: Map<string, string[]>;
};
```

The first implementation should only compute known longhands from `propertyMetadata.ts`. That keeps the behavior explainable and avoids implying the scanner has a full browser computed-style database. As the metadata table expands, computed-style coverage expands with it.

Benefits:

- Inherited properties such as `color` and `list-style-*` become element-aware instead of declaration-local.
- Declarations using `inherit`, inherited `unset`, or inherited defaults can be compared against the actual modeled parent value.
- Redundant declarations can be proven when a child explicitly declares the same value it would inherit.
- Shadowing and conflict rules can distinguish "locally loses" from "computed value still comes from an ancestor".
- Future accessibility and design-system rules can reason about effective values on the rendered element rather than only syntactic declarations.

Rule consumers:

- `declaration-always-shadowed` should mostly stay on local `CascadeOutcome`; it is about declarations losing in cascade comparison. It can use computed properties later to improve explanations for inherited values, but it should not require parent computed style to report definite local shadowing.
- `same-property-conflict` should use computed properties once implemented, because two declarations that look conflicting syntactically may compute to the same effective value through inheritance, `unset`, or custom-property substitution.
- `selector-declaration-never-wins` should use local outcomes for "never wins", then optionally computed properties to explain whether an ancestor still supplies the effective value.
- `implicit-cascade-dependency` becomes much stronger with computed properties: it can report when a component depends on inherited `color`, `font`, `list-style`, or other inherited values from an ancestor outside its local ownership boundary.
- `component-style-overridden-externally` can use computed properties to prove the final effective value on a component's rendered element is supplied by an external or parent-owned stylesheet.
- Future `redundant-inherited-declaration` / `same-computed-value` rules should consume computed properties directly and only report when both the local declaration and inherited parent value are definite.

Suggested implementation order:

1. Add `CascadeComputedProperty` types, ids, and indexes.
2. Build an internal resolver over known longhands, local outcomes, candidates, metadata, and render parent links.
3. Handle ordinary concrete values, `initial`, `inherit`, and `unset`.
4. Preserve `revert` / `revert-layer`, conditional outcomes, and uncertain parent chains as unknown evidence.
5. Add focused tests for inherited `color`, child `inherit`, child `unset`, root fallback, non-inherited initial fallback, and uncertain parent propagation.
6. Update rule docs and only then wire specific rules to computed-style evidence.

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
- Runtime CSS loading emits named environment contexts (`initial`, `route:<source>`, and `lazy-boundary:<source>`). Runtime stylesheet order is normalized from those contexts for definite initial static CSS imports and definite lazy runtime CSS chunks, including CSS files reached through statically imported source modules and nested stylesheet imports.
- `stylesheetSourceOrder` and `projectSourceOrder` fields remain deferred on the declaration evidence itself; cascade currently stores normalized order in candidate cascade keys.

Once declarations are first-class, `cascade-analysis` can be added as a narrow proof stage over exact-property author declarations.

## Phase 2 Boundary

Phase 2 adds the first cascade stage scaffold:

- `CascadeKey` for author declarations with `important`, cascade layer, selector specificity, and local source order.
- branch-specific selector specificity, including basic `:is()`, `:not()`, `:has()`, and zero-specificity `:where()`.
- named cascade layer order from `@layer a, b;` statements and named `@layer name { ... }` blocks, including layer-order statements from earlier stylesheets and nested named layer composition such as `@layer framework { @layer components { ... } }`.
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
- conservative at-rule truth normalization for browser-stable media query cases: always-active `@media all` does not make a candidate conditional, and impossible `@media not all` candidates are skipped.
- conservative `@supports` truth normalization for basic declaration conditions and boolean combinations: syntactically invalid declaration checks are impossible, `not`/`and`/`or` are reduced, and syntactically valid declaration checks remain conditional unless boolean reduction proves the whole condition definite or impossible.
- outcomes grouped by rendered element and effective property.
- resolved cross-stylesheet outcomes when all candidates come from a definite runtime CSS context with stable static import order.
- runtime-specific stylesheet order contexts for named runtime CSS environments: initial chunk styles are ordered in the initial context, and initial chunk styles are ordered before lazy chunk styles for each `lazy-boundary:<source>` context, while lazy styles are not treated as globally loaded for initial source contexts.
- unresolved outcomes when candidates come from multiple stylesheets and runtime order cannot be proven.
- conditional outcomes when all candidates share the same non-empty condition signature.
- `condition-branch` outcomes when unconditional/default declarations compete with conditional declarations, with separate branch winners for each modeled condition signature.
- modeled condition branch enumeration for satisfiable combinations of supported at-rule and selector-state contexts, including viewport plus pseudo-state branches. Conditional branches can carry matching built-in environment profile ids, so consumers can see which named browser environments make a conditional winner possible.
- explicit `condition-branch-limit-exceeded` diagnostics when simultaneous conditional contexts would exceed the modeled branch cap, instead of silently falling back to less precise conditional handling.
- media condition normalization for impossible `min-width`/`max-width` and modern `width` comparison ranges, plus environment-profile branch overlap checks. Disjoint bounded width contexts stay in separate branches; overlapping contexts get an additional combined branch.
- mutually exclusive media feature values are modeled for `prefers-color-scheme: light/dark` and `orientation: portrait/landscape`.
- simple `@supports` declaration requirements are modeled for branch satisfiability and against the built-in modern-browser capability profile: compatible declaration checks can combine, while `@supports (x: y)` and `@supports not (x: y)` stay mutually exclusive.
- simple `@container` width constraints are modeled for branch satisfiability. Named container queries with overlapping width ranges can combine, disjoint ranges for the same container name stay separate, and different container names remain independently satisfiable.
- unresolved `condition-uncertain` outcomes when candidates only have unsupported or unmodeled conditional signatures.
- selector pseudo-state conditions for supported state and structural pseudo-classes, including branch outcomes when a pseudo-state selector is compared with an unconditional selector.
- pseudo-state branch reduction for modeled selector-state implication, so branches such as `:hover:focus` include declarations that only require `:hover`, and `:focus-visible` branches include declarations that require `:focus`.
- bounded `@scope` proximity through selector-reachability-backed root and limit matching for supported selector shapes; scoped declarations outside the modeled root are skipped, scope limits block descendants past the limit, and proximity is compared between specificity and source order.
- value-aware property effects computed by the CSS frontend. Exact non-custom declarations are validated through `css-tree`'s MDN-backed property grammar database once their value is concrete; declarations containing unresolved `var()` dependencies are validated after definite custom-property substitution. Supported shorthands include box-model shorthands: `margin`, `padding`, logical `margin-*`/`padding-*`, physical/logical `inset`, `border-width`, `border-style`, `border-color`, physical side `border-*`, logical `border-block*`/`border-inline*`, whole `border` when the width/style/color value can be safely parsed, and `css-tree`-validated `background` effects for color, image, repeat, attachment, position, size, origin, and clip.
- a metadata-backed property model for known longhands and shorthands. Longhand records include inheritance, initial values, and bounded logical-to-physical relationships; shorthand records define reset groups. CSS-wide keywords are resolved through metadata: `initial` uses the longhand initial value, `unset` becomes `inherit` for inherited properties and the initial value otherwise, and `revert` / `revert-layer` remain explicit because they depend on origin/layer context. The bounded `all` shorthand expands across the known metadata longhand universe.
- logical property normalization before final outcome comparison. When an element has a definite modeled `writing-mode` and `direction`, or no modeled flow declarations so browser initial `horizontal-tb`/`ltr` applies, logical box/inset/border candidates are remapped to physical properties so they compete with physical declarations. Conditional or unsupported flow declarations leave logical candidates unresolved rather than guessing.
- `unsupported-property-semantics` diagnostics for known unsupported shorthands such as `font`, `flex`, `grid`, transitions, animations, and ambiguous supported-family values such as whole-border CSS variables or ambiguous `background` values.

Known limitations:

- only definite named runtime stylesheet contexts are normalized; possible dynamic CSS imports, unresolved dynamic imports, and unknown bundler chunk semantics remain uncertain
- lazy CSS order is normalized per named `lazy-boundary:<source>` runtime environment, not as one global project order
- multi-entry runtime context modeling is conservative; entries and route contexts remain separate unless a stable per-context order can be proven
- viewport reasoning has a starter environment profile model for representative mobile/desktop, light/dark, and modern-browser capability contexts, plus browser-stable `@media all` / `@media not all`, static width range satisfiability for `min-width`, `max-width`, and simple `width` range syntax, and mutually exclusive `prefers-color-scheme` and `orientation` values; other media features remain conditional without concrete profile fields
- capability and container environment evaluation remain conservative beyond the built-in modern-browser support profile, `@supports` syntax/boolean normalization, simple declaration-check contradiction, and simple container width-range overlap. Container style queries, complex container query syntax, and exact DOM container identity are not modeled
- simultaneous condition branch enumeration is capped at 8 modeled condition sets or 128 branch combinations; outcomes beyond that cap remain condition-uncertain with a diagnostic rather than enumerating every possible environment
- condition branches enumerate modeled simultaneous at-rule and selector-state contexts, but they do not combine render placement conditions, class-emission conditions, or runtime route/loading contexts yet
- pseudo-state implication is deliberately small and one-way: `:focus-visible` implies `:focus`, `:user-invalid` implies `:invalid`, and `:user-valid` implies `:valid`; broader pseudo-state overlap, exclusion, or temporal state semantics are not modeled
- anonymous and otherwise unsupported cascade layer order remains unresolved
- cross-stylesheet layer ordering follows definite runtime stylesheet order; uncertain runtime stylesheet order still blocks definite cross-stylesheet layer precedence
- `@scope` root/limit support reuses selector reachability for supported class, compound, and simple structural selector shapes; unsupported selector-reachability shapes are still skipped conservatively, and `:scope` root matching inside scoped rule selectors is not modeled yet
- computed JSX prop names are supported when the key resolves to a literal static object key; computed inline style declaration names inside the style object remain limited to expression-syntax support
- JSX prop spread extraction has shared static object confidence for known/unknown entries, computed literal keys, member expressions, nested spreads, and no-argument helper calls; dynamic unknown spreads, parameterized helpers, mutation-built objects, arbitrary call results, re-export barrels, namespace imports, and package imports remain conservative
- conditional inline style branches with conflicting values for the same effective property are intentionally unsupported
- only a bounded safe shorthand/longhand property semantics set
- reset and inheritance handling is metadata-backed for known longhands/shorthands and the bounded `all` reset group. Logical-to-physical mapping is modeled for supported `horizontal-tb`, `vertical-rl`, and `vertical-lr` writing modes with `ltr`/`rtl` direction when the flow is definite; full parent computed-value inheritance, sideways writing modes, and broader reset semantics are not modeled
- custom property cascade and definite `var()` substitution are modeled, but conditional, cyclic, and missing substitutions remain unsupported-property-semantics uncertainty
- exact property values use `css-tree` typed property grammar validation, but shorthand expansion remains intentionally bounded; border shorthand parsing recognizes clear width/style/color tokens and intentionally rejects ambiguous whole-value variables
- `background` shorthand parsing is `css-tree` validated but still partial: it models reset/winning behavior for the main background longhands, but it does not yet model every computed-value nuance or `var()` substitution
- only `declaration-always-shadowed` consumes outcomes today, and it remains opt-in
