# Phase 5: Bounded Local Component Expansion

## Status

Complete.

This note now serves as the Phase 5 design-and-outcome record.

The implementation now covers the bounded same-file local expansion surface described here, including:

- same-file local component expansion
- simple prop passing
- `children` insertion
- generic named JSX subtree props
- bounded helper expansion inside component bodies
- bounded statement-level control flow
- exact and bounded-unknown collection rendering, including `repeated-region`

The next milestone is Phase 6:

- early cross-file reasoning

## Purpose

This note defines the Phase 5 milestone that followed the Phase 4 selector-satisfiability prototype:

- bounded local component expansion

The goal is to extend the render IR from:

- same-file intrinsic JSX only

to:

- same-file local component composition with strict limits

This is the clearest next roadmap step because it is the biggest remaining gap between the current prototype and the original milestone order.

## Why This Phase Matters

Right now the engine can reason about:

- intrinsic JSX structure
- same-file class-bearing elements
- conditionals
- selector satisfiability over that bounded structure

But it still stops at local component boundaries.

That means the current engine cannot yet answer many important wrapper-style questions even when the components live in the same file.

Example:

```tsx
function PanelShell({ children }: { children: React.ReactNode }) {
  return <section className="panel-shell">{children}</section>;
}

export function PanelPage() {
  return (
    <PanelShell>
      <h1 className="panel-shell__title" />
    </PanelShell>
  );
}
```

Before Phase 5, the same-file render IR would preserve `<PanelShell />` as an unresolved component reference.

Phase 5 exists to let the engine expand bounded cases like this into approximate rendered structure.

## Main Goal

The Phase 5 goal is:

- inline simple same-file local components into the render subtree IR

while keeping the analysis:

- bounded
- deterministic
- explainable

## Non-Goals

This phase should not try to solve all component reasoning.

Not in scope:

- cross-file component expansion
- render props
- higher-order components
- hooks-based control flow reasoning
- arbitrary prop expression evaluation
- broad framework-specific conventions
- exact React semantics

This phase is intentionally narrow.

## Questions This Phase Should Unlock

Once implemented, the engine should start being able to answer questions like:

- does a same-file wrapper contribute an ancestor class around consumer-provided children?
- does a same-file local component emit a descendant that satisfies a selector?
- does a local wrapper preserve direct parent-child structure?
- does `children` insertion create a satisfiable selector path?
- does a simple JSX-valued prop flow into a local component subtree?

## First Supported Slice

The first supported slice should be deliberately small.

### Must support

- same-file function declarations used as components
- same-file arrow/function expressions assigned to top-level identifiers
- simple JSX prop passing
- `children` propagation
- bounded local expansion depth
- explicit unresolved states when expansion is not supported

### Nice to support if the implementation stays clean

- JSX-valued named subtree props like `header={<... />}`
- string-literal and simple exact prop passing into child `className`
- bounded conditional component returns if already handled by the existing render IR

### Must not support yet

- cross-file local imports
- callbacks that return JSX
- dynamic component identities
- `as={Component}` polymorphism
- render props
- deep value-flow through arbitrary helpers

## Product Semantics

The engine should treat local expansion as:

- a bounded approximation of component output

not:

- a claim to know the exact runtime tree

That means unsupported cases must still remain explicit.

For example, the engine should prefer:

- unresolved local component boundary

over:

- flattening in a guessed subtree

## Proposed Analysis Model

The cleanest model is:

1. detect component-reference nodes in same-file render trees
2. resolve those references to same-file component definitions where possible
3. build a bounded expansion context
4. inline the callee subtree into the caller subtree
5. preserve expansion traces and unresolved boundaries when limits are hit

In plain language:

- turn local component calls from opaque nodes into expanded render subtrees when we can do so safely

## Recommended Constraints

The first implementation should use explicit limits.

Suggested limits:

- maximum local expansion depth: `2` or `3`
- maximum total expanded local components per root subtree
- no recursive component expansion cycles
- no expansion if the component target cannot be resolved to a same-file declaration
- no expansion if props require unsupported evaluation

These should initially be hard-coded internal limits rather than product config.

## Required Data/IR Additions

The current render IR is already close to what this phase needs.

Likely additions:

- richer component-reference metadata
- prop payload summaries on component-reference nodes
- maybe explicit slot/subtree-prop nodes in render IR
- expansion trace metadata

The key idea is:

- Phase 5 should reuse the existing render IR where possible
- not invent a second competing render-tree representation

## Expected Pipeline Changes

This phase should mainly affect:

- `pipeline/render-ir/`
- some reuse of:
  - `pipeline/abstract-values/`
  - `pipeline/symbol-resolution/`

The selector-analysis stage should ideally not need architectural changes.

That is a good sign if achieved.

## Recommended Implementation Shape

The cleanest approach is to split render IR work into three conceptual layers:

1. component discovery
2. JSX-to-render-node construction
3. local component expansion

The current file `buildSameFileRenderSubtrees.ts` is doing all of that implicitly for the intrinsic-only case.

Phase 5 is the point where that should start being separated more intentionally.

## Target File And Directory Structure

This is the recommended target structure for the next render-IR slice.

It does not all need to land in one commit, but this should be the intended direction.

```text
src/static-analysis-engine/
  pipeline/
    render-ir/
      index.ts
      types.ts
      buildSameFileRenderSubtrees.ts
      componentDiscovery/
        index.ts
        collectSameFileComponents.ts
        types.ts
      jsxToRenderIr/
        index.ts
        buildRenderNodeFromJsx.ts
        buildElementNode.ts
        buildChildren.ts
        classAttributeSummary.ts
      localExpansion/
        index.ts
        expandSameFileLocalComponents.ts
        expansionContext.ts
        expansionBudget.ts
        slotInsertion.ts
        propBinding.ts
        cycleDetection.ts
      shared/
        anchors.ts
        expressionUnwrap.ts
        returnDetection.ts
```

## Why this structure is recommended

### `componentDiscovery/`

Responsibility:

- find same-file component definitions that are eligible for bounded expansion

This should answer:

- what components exist in this file?
- what is their declaration shape?
- where is their root JSX body?

### `jsxToRenderIr/`

Responsibility:

- convert JSX expressions into render nodes

This should answer:

- how do we normalize intrinsic elements, fragments, expressions, and unresolved component calls?

This is the structural render-node builder.

### `localExpansion/`

Responsibility:

- resolve same-file component references and inline them where supported

This should answer:

- can this local component be expanded?
- with what props?
- under what budget?
- how are `children` inserted?

### `shared/`

Responsibility:

- small render-IR-local helpers that are used by multiple render-IR subareas

Examples:

- source anchors
- expression unwrapping
- detecting returned JSX expressions

This helps avoid both:

- a giant `buildSameFileRenderSubtrees.ts`
- and premature promotion into some global utility layer

## Minimal Acceptable Landing Version

The full target structure above is the intended direction.

The minimal acceptable first landing could be:

```text
src/static-analysis-engine/pipeline/render-ir/
  index.ts
  types.ts
  buildSameFileRenderSubtrees.ts
  collectSameFileComponents.ts
  buildRenderNodeFromJsx.ts
  expandSameFileLocalComponents.ts
  shared.ts
```

If implementation pressure stays low, that is acceptable.

The important thing is the responsibility split, not the exact folder count.

## Core Responsibilities By File

If the smaller landing version is used, responsibilities should still stay clear.

### `collectSameFileComponents.ts`

Owns:

- discovery of same-file component definitions
- recording their declaration anchors and root JSX expressions

Should not own:

- JSX-to-render-node conversion
- component expansion

### `buildRenderNodeFromJsx.ts`

Owns:

- turning JSX and renderable expressions into render IR nodes

Should not own:

- scanning the whole file for components
- expansion policy

### `expandSameFileLocalComponents.ts`

Owns:

- bounded inlining of same-file local component references

Should not own:

- raw AST scanning of the whole file
- generic source-anchor helpers

## Proposed Data Shapes

The exact types can evolve, but something like this is likely enough for the first pass.

```ts
type SameFileComponentDefinition = {
  componentName: string;
  declarationAnchor: SourceAnchor;
  exported: boolean;
  rootExpression: ts.Expression;
  params: ComponentParamSummary[];
};

type ComponentParamSummary = {
  kind: "props-object" | "destructured-props" | "children-only" | "unsupported";
  propNames: string[];
};
```

And for expansion:

```ts
type LocalExpansionContext = {
  filePath: string;
  componentsByName: Map<string, SameFileComponentDefinition>;
  currentDepth: number;
  maxDepth: number;
  expansionStack: string[];
};
```

The important thing is not the final field names.

The important thing is to make expansion state explicit.

## Expansion Rules For The First Slice

The first slice should use simple rules.

### Expand only when all of these are true

- target is a same-file component
- target name resolves directly to one discovered component definition
- current depth is below budget
- no cycle would be introduced
- props are simple enough to bind

### Do not expand when any of these are true

- target is unresolved
- target is recursive through the current expansion stack
- target uses unsupported parameter patterns
- prop bindings are unsupported
- expansion budget is exhausted

### What to emit when expansion fails

Keep an explicit component-reference-like node, but with a clearer reason such as:

- `same-file-component-expansion-unsupported`
- `same-file-component-expansion-cycle`
- `same-file-component-expansion-budget-exceeded`

That keeps the uncertainty honest.

## `children` Strategy

The first implementation should treat `children` as the main subtree insertion mechanism.

Recommended model:

- when a component invocation has JSX children, summarize them as a subtree payload
- when the callee renders `props.children` or destructured `children`, insert that subtree there

This can stay bounded and still unlock a lot of wrapper-style cases.

Named subtree props can come right after this if the insertion model stays clean.

## Explanation Requirements

Phase 5 should preserve technical explanation data such as:

- component `PanelShell` resolved locally in same file
- expanded at depth `1`
- inserted caller `children` into callee `children` slot
- expansion stopped at nested component `Foo` because unsupported parameter shape

This does not need polished user prose yet.

It does need to be machine- and maintainer-readable.

## Success Criteria

Phase 5 should be considered successful when all of the following are true.

- same-file local wrapper components can be expanded in bounded cases
- `children` can influence the resulting render subtree
- selector satisfiability can benefit from local component expansion
- unsupported and over-budget cases remain explicit
- the render-IR code is cleaner after the change, not just more capable

## Risks

### 1. Hidden scope creep

The biggest risk is accidentally turning “same-file local component expansion” into “mini React interpreter.”

Guardrail:

- keep the support matrix tight

### 2. Render-IR file sprawl without responsibility clarity

Guardrail:

- split by responsibility, not by arbitrary file count

### 3. Prop-flow complexity arriving too early

Guardrail:

- start with `children` and simple exact prop passing only

### 4. Silent incorrect expansion

Guardrail:

- prefer unresolved nodes over guessed expansion

## Recommendation

The next implementation milestone should be:

- extract render-IR component discovery and JSX conversion into their own files
- then add bounded same-file local component expansion

The target directory structure in this note should be treated as the intended landing zone, even if the first implementation arrives in a slightly smaller version of it.
