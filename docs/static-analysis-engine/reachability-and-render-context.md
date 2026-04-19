# Static Analysis Engine Reachability And Render Context

## Purpose

This document defines the intended design direction for stylesheet reachability in the static-analysis-engine track.

It exists to clarify an important architectural gap in the current implementation:

- selector satisfiability is already evaluated against the render IR
- stylesheet reachability is still modeled mostly as direct import availability by source file

That split is useful for the current bounded slice, but it is not yet the stronger model implied by the requirements and architecture docs.

This note describes:

- what the current implementation does
- what is missing
- what the target state should be
- how to move there in bounded stages

## Why this matters

The old scanner had to lean heavily on file-level import structure because it did not model enough rendered structure to do much better.

The static-analysis-engine is different.

It already builds:

- module and binding information
- render graph summaries
- approximate rendered subtrees
- selector satisfiability checks against those subtrees

That means the new engine can eventually ask a stronger question than:

- is this stylesheet reachable from some source file?

It should be able to ask:

- is this stylesheet available in the render contexts where this rendered structure can actually occur?

That is a better fit for the new engine's architecture and for the product goal of reducing false positives around structure-sensitive CSS reasoning.

## Current Implementation

The current `pipeline/reachability` stage is a narrow, useful first slice.

Today it:

- normalizes known CSS file paths from the selector CSS sources
- walks the module graph
- looks for source modules that directly import each stylesheet
- emits one stylesheet reachability record per CSS source

In effect, the current question is:

- which analyzed source files directly import this stylesheet?

The current selector-analysis stage then uses those results to:

- mark selectors from unknown stylesheets as unsupported
- mark selectors from unavailable stylesheets as resolved no-match
- filter render subtrees down to those whose source file is one of the directly importing files

This is a valid bounded implementation.

It already improves on the legacy scanner because selector satisfiability is not decided by import structure alone.
The render IR still participates in the final question.

However, reachability itself is not yet render-aware.

## What is missing

The current reachability model does not yet represent:

- component-level availability
- propagation through component composition
- availability inherited through rendered wrapper/layout contexts
- possible versus definite availability at render-path granularity
- separation between "stylesheet imported somewhere in the project" and "stylesheet available where this subtree can render"

This matters because a file-level import approximation is still weaker than the new engine's actual reasoning capacity.

For example, the current model does not yet naturally capture questions like:

- a layout imports stylesheet `A`; is `A` available to a child component subtree rendered under that layout?
- a wrapper imports stylesheet `B`; is `B` available only when that wrapper actually participates in the render path?
- two components can each render the same child component under different stylesheet contexts; which selectors are available on which paths?

Those are exactly the kinds of questions the static-analysis-engine should eventually answer better than the legacy scanner.

## Render Graph And Render IR Roles

Reachability should not depend on the render IR alone.

The render graph and the render IR each contribute different information.

### Render graph

The render graph answers:

- which components render which other components?
- at which call sites?
- with which bounded prop relationships?

This is the right layer for reasoning about stylesheet availability propagation through component composition.

### Render IR

The render IR answers:

- what approximate rendered element structure can occur?
- where do classes appear?
- where do conditionals, slots, fragments, and expanded calls produce subtree alternatives?

This is the right layer for reasoning about whether selector structure can match.

### Combined role

The intended model is:

- use render graph style information to determine where a stylesheet is available
- use render IR structure to determine whether a selector can match in those available contexts

That keeps the architectural seam clear:

- availability is not the same question as structural satisfiability
- but the two should connect through shared render contexts

## Target State

The target state is a first-class new-engine reachability model that attaches stylesheet availability to render contexts rather than only to source files.

At a high level, the engine should be able to represent statements like:

- stylesheet `X` is definitely available when rendering component `Layout`
- stylesheet `X` is definitely available to subtrees rendered beneath `Layout -> Page`
- stylesheet `Y` is only possibly available on one conditional render path
- stylesheet `Z` is unavailable in the render contexts where selector `.foo .bar` could otherwise match

This target model should support both:

- direct CSS availability reasoning
- selector satisfiability reasoning that is scoped to those availability contexts

## Proposed Core Concepts

The reachability subsystem should grow toward a render-context-oriented summary shape.

An initial working shape could look like this:

```ts
type ReachabilityAvailability = "definite" | "possible" | "unknown" | "unavailable";

type StylesheetAvailabilityContext =
  | {
      kind: "source-entry";
      filePath: string;
    }
  | {
      kind: "component";
      componentId: string;
      filePath: string;
    }
  | {
      kind: "render-edge";
      fromComponentId: string;
      toComponentId: string;
      callSiteAnchor?: SourceAnchor;
    }
  | {
      kind: "render-subtree-root";
      subtreeId: string;
      filePath: string;
    };

type StylesheetAvailabilityRecord = {
  cssFilePath?: string;
  context: StylesheetAvailabilityContext;
  availability: ReachabilityAvailability;
  reasons: string[];
};

type ReachabilitySummary = {
  stylesheets: StylesheetAvailabilityRecord[];
};
```

This is not a final contract.

The main design point is that availability should be attached to explicit contexts in the new engine rather than flattened to:

- imported somewhere
- not imported anywhere

## Intended Analysis Flow

The longer-term reachability flow should be:

1. Discover direct stylesheet imports at the module level.
2. Attach those imports to source-entry or component-entry contexts.
3. Propagate stylesheet availability along render graph edges in a bounded way.
4. Preserve definite versus possible availability as propagation crosses:
   - conditionals
   - unresolved component calls
   - budget boundaries
5. Expose availability records that selector-analysis can use to limit structural matching to relevant render contexts.
6. Keep structural selector matching in selector-analysis rather than moving it into reachability.

This produces a cleaner division of responsibility:

- reachability decides where a stylesheet can be available
- selector-analysis decides whether a selector can match within those available contexts

## Important Non-Goals

The reachability subsystem should not try to:

- fully simulate runtime CSS cascade
- reason about precise browser inheritance behavior
- fold selector matching directly into availability propagation
- assume every ancestor import implies universal project-wide availability
- silently overclaim that availability is definite when it is only possible

The goal is bounded availability reasoning, not a full browser model.

## Relationship To The Legacy Scanner

The legacy scanner's import-driven reachability model was appropriate for a file-centric architecture.

The static-analysis-engine should retain the useful parts of that model:

- CSS import discovery
- deterministic import resolution
- explicit unavailability when nothing imports a stylesheet

But it should not stop there.

The new engine's advantage is that it can combine:

- module structure
- component composition
- render context
- rendered subtree structure

That means the legacy import graph should become an input to reachability, not the full reachability model.

## Staged Implementation Plan

The target state does not need to arrive in one jump.

A sensible staged sequence is:

### Stage 1: Keep the current direct-import summary, but model contexts explicitly

Add explicit context-bearing reachability records even if the first contexts are only:

- source-entry file
- component/file root

This keeps the public shape moving in the right direction before deeper propagation exists.

### Stage 2: Propagate availability through the render graph

Add bounded propagation from stylesheet-owning source/component contexts to directly rendered child component contexts.

This is the first step that makes reachability genuinely new-engine-native instead of only import-native.

### Stage 3: Connect availability to render subtree roots

Associate availability records with concrete render subtree roots or equivalent render contexts so selector-analysis can filter by availability context more precisely than source file path.

### Stage 4: Preserve possible availability across branches and uncertain expansion

When propagation crosses uncertain render paths, unresolved calls, or bounded expansion points, record:

- `possible`
- `unknown`

instead of collapsing everything to either definite or unavailable.

### Stage 5: Let rules distinguish structural impossibility from availability impossibility

At that point, downstream rules should be able to tell the difference between:

- selector cannot match the render structure
- selector could match structurally, but its stylesheet is unavailable in those contexts
- selector result is only possible because availability is only possible

That separation is valuable for explanation and for confidence modeling.

## Selector-Analysis Integration

Selector-analysis should remain the consumer of reachability, not the owner of it.

The intended integration is:

- selector-analysis receives parsed selector constraints
- selector-analysis receives render subtrees
- selector-analysis receives reachability contexts
- selector-analysis evaluates only within the contexts where the stylesheet is available

This means selector-analysis should not keep embedding more ad hoc stylesheet-availability logic over time.

As the reachability subsystem becomes richer, selector-analysis should become simpler in one respect:

- it should consume better availability inputs rather than improvising availability filtering from file paths

## Explanation Expectations

Reachability should eventually emit technical explanation payloads that can answer questions like:

- why is this stylesheet considered definitely available here?
- which render path made this availability only possible?
- why was this stylesheet considered unavailable for this selector result?

Initially, reason strings are sufficient.

Longer term, this should grow toward structured traces shared with the rest of the engine.

## Suggested Exit Criteria For The First Serious Reachability Upgrade

The first serious reachability upgrade should be considered done when:

- reachability records are attached to explicit engine contexts rather than only CSS files
- propagation uses at least a lightweight render-graph seam
- selector-analysis no longer filters only by directly importing source file path
- availability can be reported as at least `definite`, `possible`, `unknown`, or `unavailable`
- selector results can explain structural outcome and availability outcome separately

## Recommendation

Treat the current direct-import reachability implementation as a bounded bootstrap stage, not as the desired steady state.

The next reachability design goal should be:

- keep import-based CSS discovery
- add explicit render-context-aware availability
- connect that availability to selector-analysis through render graph and render subtree boundaries

That path preserves the strengths of the legacy model while finally using the new engine's richer architecture for the part that legacy reachability could never model well.
