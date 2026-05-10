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
- exact property semantics, unless a later property-semantics layer proves shorthand/longhand behavior
- no unsupported selector, declaration, source-order, or condition feature involved in the winning comparison

Anything weaker should begin as either:

- `debug`, when useful mainly to analysis authors or advanced troubleshooting
- opt-in non-default rule severity
- internal cascade evidence consumed by later rules

## Stage Policy

Initial implementation should run `cascade-analysis` only when at least one cascade-aware rule is enabled.

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
- The first pass is intentionally narrow: author declarations only, exact CSS properties only, selector-branch render matches only, and no user-facing findings.
- Before adding default-on cascade rules, add rule-aware gating so projects only pay for deeper cascade work when cascade-aware rules are enabled.

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
  sourceAnchor?: SourceAnchor;
};
```

This is still a frontend fact, not the final cascade contract. Cascade analysis should consume normalized declaration evidence from `project-evidence`, not raw parser output.

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

Initial support should use author styles only. Inline React styles, user origin, and user-agent origin should remain representable so the model does not need to be reshaped later.

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

export type ConditionCompatibility =
  | "definitely-compatible"
  | "definitely-incompatible"
  | "possibly-compatible"
  | "unknown";
```

The first implementation may treat most condition details as opaque, but it must distinguish known incompatibility from unknown compatibility.

### Declaration Candidates

A declaration candidate represents a declaration matched to a modeled element under a condition set.

```ts
export type CascadeDeclarationCandidate = {
  id: string;
  declarationId: ProjectEvidenceId;
  elementId: string;
  selectorBranchId?: ProjectEvidenceId;
  property: string;
  cascadeKey: CascadeKey;
  conditionSetId?: string;
  matchCertainty: "definite" | "possible" | "unknown";
  reasons: string[];
  traces: AnalysisTrace[];
};
```

Candidate indexes should include:

- candidates by declaration id
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
- `projectEvidence.indexes` exposes declaration indexes by id, stylesheet, rule definition node, selector branch, and property.
- `projectEvidence.meta.cssDeclarationCount` records the declaration count.
- The first version uses `ruleDefinitionNodeId` rather than a project-evidence `styleRuleId`, because rules are not yet first-class project-evidence entities.
- Runtime stylesheet order is normalized for definite initial static CSS imports, including CSS files reached through statically imported source modules and nested stylesheet imports.
- `stylesheetSourceOrder` and `projectSourceOrder` fields remain deferred on the declaration evidence itself; cascade currently stores normalized order in candidate cascade keys.

Once declarations are first-class, `cascade-analysis` can be added as a narrow proof stage over exact-property author declarations.

## Phase 2 Boundary

Phase 2 adds the first cascade stage scaffold:

- `CascadeKey` for author declarations with `important`, selector specificity, and local source order.
- branch-specific selector specificity, including basic `:is()`, `:not()`, `:has()`, and zero-specificity `:where()`.
- declaration candidates from selector-branch render matches.
- condition sets for at-rule and render placement conditions, initially conservative.
- outcomes grouped by rendered element and exact property.
- resolved cross-stylesheet outcomes when all candidates come from a definite initial runtime CSS chunk with stable static import order.
- unresolved outcomes when candidates come from multiple stylesheets and runtime order cannot be proven.

Known limitations:

- only definite initial static runtime stylesheet order is normalized
- no dynamic/lazy CSS order normalization yet
- no multi-entry runtime context modeling beyond requiring a stable observed order
- no cascade layers
- no `@scope`
- no inline styles
- no shorthand/longhand property semantics
- no pseudo-state compatibility model
- no rule consumes outcomes yet
