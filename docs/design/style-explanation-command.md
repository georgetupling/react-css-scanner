# Style Explanation Command

## Goal

Add an ergonomic command for answering: "what CSS does the scanner expect this JSX element or component to have at runtime?"

The command should be truthful about React and CSS context. A JSX component rarely has one universal computed style. It may render through multiple parents, route/lazy CSS contexts, viewport branches, pseudo-states, prop-supplied classes, or conditional inline styles. The first version should therefore present style evidence grouped by modeled context instead of pretending there is always one final browser value.

## Proposed UX

Primary command:

```bash
scan-react-css explain-styles src/Button.tsx:12
```

Optional narrowing flags:

```bash
scan-react-css explain-styles src/Button.tsx:12 --context route:settings
scan-react-css explain-styles src/Button.tsx:12 --state hover --viewport 1024
scan-react-css explain-styles src/Button.tsx:12 --json
```

The positional target is a source location. The command resolves that location to the nearest modeled JSX element, component render site, or component declaration. If the location maps to a component declaration with multiple rendered element contexts, the report lists those contexts separately.

Initial text output should favor a compact explanation:

```text
Styles for <Button> at src/Button.tsx:12

Modeled render contexts:
- App > Toolbar > Button
- SettingsPage > Button

Element: button
Classes:
- button
- button--primary

Definite computed values:
color: white
background-color: blue
padding-top: 8px

Conditional values:
:hover
  background-color: navy

@media (min-width: 768px)
  padding-left: 16px
  padding-right: 16px

Uncertain:
border-color
  runtime stylesheet order differs across lazy route contexts
```

## Product Surface

CLI entry:

- `src/cli/args.ts`
- `src/cli/index.ts`

Project/API entry:

- `src/project/explainStyles.ts` or `src/style-explanations/explainStyles.ts`
- exported from `src/project/index.ts` and `src/index.ts` once stable

The CLI should call a project-level API, not directly call internal pipeline modules. This keeps the same public layering as `scanProject()`.

## Analysis Boundary

This feature should not add new derivation logic to `src/static-analysis-engine/entry/scan.ts`.

`scan.ts` remains orchestration-only. The explanation layer consumes the completed analysis result:

- workspace snapshot for source file text and root-relative path normalization
- fact graph for source node identity and location indexes
- symbolic evaluation for class expression alternatives and conditions
- render structure for component boundaries, rendered elements, render paths, parent/child context, and placement conditions
- selector reachability for selector branches that match each rendered element
- runtime CSS loading for initial/route/lazy stylesheet availability and order contexts
- project evidence for declarations, selectors, stylesheets, class definitions, and source anchors
- cascade analysis for candidates, outcomes, condition sets, and computed properties

The command is a read-only query/reporting layer over those models.

## Internal Shape

Add a new explanation model, separate from findings:

```ts
export type StyleExplanationTarget = {
  filePath: string;
  line: number;
  column?: number;
};

export type StyleExplanationResult = {
  target: StyleExplanationTarget;
  matchedTargets: StyleExplanationMatchedTarget[];
  contexts: StyleExplanationContext[];
  diagnostics: StyleExplanationDiagnostic[];
};
```

Matched targets:

```ts
export type StyleExplanationMatchedTarget = {
  kind: "jsx-element" | "component-reference" | "component-declaration";
  label: string;
  sourceLocation: SourceAnchor;
  renderedElementIds: string[];
  boundaryIds: string[];
};
```

Context records:

```ts
export type StyleExplanationContext = {
  id: string;
  label: string;
  renderPathId: string;
  elementId: string;
  tagName: string;
  classTokens: StyleExplanationClassToken[];
  definiteProperties: StyleExplanationProperty[];
  conditionalProperties: StyleExplanationConditionalGroup[];
  uncertainProperties: StyleExplanationProperty[];
};
```

Property records:

```ts
export type StyleExplanationProperty = {
  property: string;
  value?: string;
  certainty: "definite" | "possible" | "unknown";
  source: "computed" | "local-cascade" | "inherited-parent" | "initial" | "unresolved";
  outcomeId?: string;
  winningCandidateId?: string;
  declarationId?: string;
  inlineStyleId?: string;
  selector?: string;
  stylesheetPath?: string;
  location?: SourceAnchor;
  reasons: string[];
};
```

JSON output should preserve ids and anchors. Text output should collapse ids and show only useful source references.

## Resolution Algorithm

1. Normalize the requested target path against the project root.
2. Run the normal analysis pipeline with cascade analysis enabled.
3. Locate source facts whose `SourceAnchor` contains or is nearest to the requested line/column.
4. Prefer targets in this order:
   - intrinsic JSX element template at the location
   - component reference render site at the location
   - component declaration containing the location
5. Resolve matched targets to rendered elements:
   - intrinsic JSX element -> `renderModel.indexes.elementIdsByTemplateNodeId`
   - component reference -> child boundary/root elements reached from the render site
   - component declaration -> all root boundaries/elements for that component
6. For each rendered element, collect:
   - class emission sites and class tokens
   - cascade candidates by element id
   - cascade outcomes by element id
   - computed properties by element id
   - condition sets attached to candidates/outcomes
7. Group results into:
   - definite computed properties
   - conditional branch properties
   - uncertain/unresolved properties
8. Attach declaration/source explanations through project evidence indexes.

The grouping should be deterministic. Sort contexts by render path, properties by property name, and evidence references by source path/location.

## Context Narrowing

The first implementation can support no narrowing and still be useful. Later flags can filter or project the explanation:

- `--context <id>`: runtime/render context id, such as `initial`, `route:<id>`, or a render path/component label.
- `--state <pseudo>`: request a pseudo-state branch such as `hover`, `focus`, or `disabled`.
- `--viewport <px>`: evaluate modeled width media branches against one viewport width.
- `--color-scheme light|dark`
- `--json`

These flags should filter the explanation model, not re-run bespoke cascade logic. They consume condition sets, environment profiles, and computed properties already emitted by analysis.

## Output Semantics

`Definite computed values` means:

- the rendered element is modeled
- the property has a `CascadeComputedProperty` with definite certainty
- its value is not branch-dependent in the selected context

`Conditional values` means:

- the property can have different winners under modeled condition sets, pseudo-states, media/supports/container branches, or runtime stylesheet contexts

`Uncertain` means:

- the scanner cannot prove one effective value because of unsupported selector/property semantics, unresolved runtime CSS order, unknown spread/object flow, branch-cap limits, unresolved parent inheritance, unsupported CSS-wide keywords, or other diagnostics

## Why Not Hover First?

Editor hover is attractive, but it is the wrong first public surface. Hover needs fast incremental analysis, source-location mapping, UX truncation, and a compact answer. The CLI command can establish the data contract and explanation semantics first.

Once the command is stable, the same project API can power:

- VS Code code lens: "Explain styles"
- hover summary with a link to full explanation
- JSON output for editor extensions
- CI artifacts for style ownership/debugging

## Implementation Plan

### Phase 1: Text and JSON Query

- Add `explainStyles()` project API.
- Add a target parser for `path:line[:column]`.
- Reuse `runAnalysisPipeline()` with cascade analysis enabled.
- Resolve JSX/component targets to rendered elements.
- Produce deterministic JSON.
- Add text formatter.
- Add CLI subcommand or command-mode parser.

### Phase 2: Better Context Labels

- Build readable render path labels from `RenderPath.segments`.
- Include component boundary labels and route/runtime CSS context ids.
- Show class token provenance and owning component where known.

### Phase 3: Condition Projection

- Add optional filters for pseudo-state and viewport width.
- Project modeled branch outcomes into the selected context.
- Keep unresolved conditions in an explicit "still uncertain" group.

### Phase 4: Editor-Ready API

- Keep the API independent of terminal formatting.
- Add compact summary fields for hover.
- Preserve source ids and anchors for editor navigation.

## Rules and Existing Outputs

This command does not create findings and should not affect rule behavior.

It should use the same evidence that rules use, especially:

- `declaration-always-shadowed` evidence from local cascade outcomes
- future conflict/redundancy rules from computed properties
- ownership evidence for explaining whether a final value comes from local, shared, external, or parent-owned CSS

The feature is best thought of as an interactive debugger for the scanner's CSS model.
