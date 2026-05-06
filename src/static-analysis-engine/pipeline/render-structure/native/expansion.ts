import {
  renderedComponentBoundaryId,
  renderedElementId,
  renderPathId,
  renderRegionId,
} from "../ids.js";
import type {
  PlacementCondition,
  RenderGraphProjectionEdge,
  RenderPath,
  RenderPathSegment,
  RenderRegion,
  RenderStructureDiagnostic,
  RenderStructureInput,
  RenderedComponentBoundary,
  RenderedElement,
} from "../types.js";
import { evaluateStaticTruthiness } from "../../static-truthiness.js";
import { normalizeAnchor, normalizeProjectPath, uniqueSorted } from "./common.js";
import { buildDiagnostic } from "./diagnostics.js";

export type ExpandContext = {
  componentNodeId: string;
  placementComponentNodeId?: string;
  forcePlacementComponentNodeId?: string;
  boundaryId: string;
  renderSite: RenderStructureInput["graph"]["nodes"]["renderSites"][number];
  childIndex: number;
  parentElementId?: string;
  basePathSegments: RenderPathSegment[];
  componentExpansionStack: string[];
  componentExpansionDepth: number;
  renderExpressionDepth: number;
  rootElementIds: string[];
  suppliedRenderSiteIdsByPropName?: ReadonlyMap<string, string[]>;
  placementConditionIds: string[];
  certainty: "definite" | "possible" | "unknown";
};

type ChildExpansionSpec = {
  renderSite: RenderStructureInput["graph"]["nodes"]["renderSites"][number];
  childIndex: number;
};

export type ExpansionState = {
  input: RenderStructureInput;
  componentById: Map<string, RenderStructureInput["graph"]["nodes"]["components"][number]>;
  componentNodesByName: Map<
    string,
    Array<RenderStructureInput["graph"]["nodes"]["components"][number]>
  >;
  boundaryById: Map<string, RenderedComponentBoundary>;
  renderSitesById: Map<string, RenderStructureInput["graph"]["nodes"]["renderSites"][number]>;
  templatesByRenderSiteId: Map<string, RenderStructureInput["graph"]["nodes"]["elementTemplates"]>;
  childRenderSitesByParentRenderSiteId: Map<string, string[]>;
  rootRenderSitesByComponentNodeId: Map<string, string[]>;
  renderEdgesByFromComponentNodeId: Map<string, RenderStructureInput["graph"]["edges"]["renders"]>;
  elementIdCounts: Map<string, number>;
  elements: RenderedElement[];
  elementsById: Map<string, RenderedElement>;
  renderPaths: RenderPath[];
  renderGraphEdges: RenderGraphProjectionEdge[];
  placementConditions: PlacementCondition[];
  renderRegions: RenderRegion[];
  diagnostics: RenderStructureDiagnostic[];
  componentBoundaries: RenderedComponentBoundary[];
  linkBoundaryToParent: (boundary: RenderedComponentBoundary) => void;
  addUnknownBarrier: (input: {
    boundary: RenderedComponentBoundary;
    sourceLocation: RenderStructureInput["graph"]["nodes"]["components"][number]["location"];
    reason: string;
  }) => void;
  addPlacementCondition: (input: Omit<PlacementCondition, "id"> & { key: string }) => string;
};

export function expandRenderSite(state: ExpansionState, context: ExpandContext): void {
  const maxRenderExpressionDepth = state.input.options?.maxRenderExpressionDepth;
  if (
    typeof maxRenderExpressionDepth === "number" &&
    context.renderExpressionDepth > maxRenderExpressionDepth
  ) {
    state.diagnostics.push(
      buildDiagnostic({
        code: "render-expansion-budget-exceeded",
        message: "native render-site traversal exceeded max render expression depth",
        filePath: context.renderSite.filePath,
        location: context.renderSite.location,
        renderSiteNodeId: context.renderSite.id,
        boundaryId: context.boundaryId,
      }),
    );
    const boundary = state.boundaryById.get(context.boundaryId);
    if (boundary) {
      state.addUnknownBarrier({
        boundary,
        sourceLocation: context.renderSite.location,
        reason: "max render expression depth exceeded",
      });
    }
    return;
  }

  const templates = state.templatesByRenderSiteId.get(context.renderSite.id) ?? [];
  const childRenderSiteIdsRaw =
    state.childRenderSitesByParentRenderSiteId.get(context.renderSite.id) ?? [];
  let childRenderSiteIds = childRenderSiteIdsRaw;
  const maxRepeatedRegionExpansions = state.input.options?.maxRepeatedRegionExpansions;
  if (
    Boolean(context.renderSite.repeatedRegion) &&
    typeof maxRepeatedRegionExpansions === "number" &&
    childRenderSiteIdsRaw.length > maxRepeatedRegionExpansions
  ) {
    childRenderSiteIds = childRenderSiteIdsRaw.slice(0, maxRepeatedRegionExpansions);
    const boundary = state.boundaryById.get(context.boundaryId);
    if (boundary) {
      state.addUnknownBarrier({
        boundary,
        sourceLocation: context.renderSite.location,
        reason: "max repeated region expansions exceeded",
      });
    }
    state.diagnostics.push(
      buildDiagnostic({
        code: "render-expansion-budget-exceeded",
        message: "repeated-region expansion exceeded max repeated region expansions",
        filePath: context.renderSite.filePath,
        location: context.renderSite.location,
        renderSiteNodeId: context.renderSite.id,
        boundaryId: context.boundaryId,
      }),
    );
  }

  if (context.renderSite.renderSiteKind === "conditional") {
    const resolvedCondition = resolveStaticConditionalBranch({
      state,
      context,
    });
    const branchSpecs: Array<{ index: number; branch: "when-true" | "when-false" }> = [
      { index: 0, branch: "when-true" },
      { index: 1, branch: "when-false" },
    ];
    for (const spec of branchSpecs) {
      const childRenderSiteId = childRenderSiteIds[spec.index];
      if (!childRenderSiteId) {
        state.addPlacementCondition({
          key: `${context.boundaryId}:${context.renderSite.id}:${spec.branch}:missing`,
          kind: "statically-skipped-branch",
          sourceText: "missing conditional branch in native expansion",
          sourceLocation: normalizeAnchor(context.renderSite.location),
          branch: spec.branch,
          certainty: "possible",
          confidence: "medium",
          traces: [],
        });
        continue;
      }
      const childRenderSite = state.input.graph.indexes.nodesById.get(childRenderSiteId);
      if (!childRenderSite || childRenderSite.kind !== "render-site") {
        continue;
      }
      const branchSkippedReason =
        resolvedCondition?.kind === "resolved"
          ? resolvedCondition.reachableBranch === spec.branch
            ? undefined
            : resolvedCondition.reason
          : undefined;
      const conditionId = branchSkippedReason
        ? state.addPlacementCondition({
            key: `${context.boundaryId}:${context.renderSite.id}:${spec.branch}:skipped`,
            kind: "statically-skipped-branch",
            sourceText: context.renderSite.conditionSourceText ?? context.renderSite.renderSiteKind,
            sourceLocation: normalizeAnchor(childRenderSite.location),
            branch: spec.branch,
            reason: branchSkippedReason,
            certainty: "definite",
            confidence: "high",
            traces: [],
          })
        : state.addPlacementCondition({
            key: `${context.boundaryId}:${context.renderSite.id}:${spec.branch}`,
            kind: "conditional-branch",
            sourceText: context.renderSite.conditionSourceText ?? context.renderSite.renderSiteKind,
            sourceLocation: normalizeAnchor(context.renderSite.location),
            branch: spec.branch,
            certainty: "possible",
            confidence: "medium",
            traces: [],
          });
      const pathSegments = [
        ...context.basePathSegments,
        { kind: "conditional-branch", branch: spec.branch, conditionId } as const,
      ];
      const regionPathId = renderPathId({
        terminalKind: "unknown-region",
        terminalId: `${context.boundaryId}:${context.renderSite.id}:${spec.branch}`,
      });
      state.renderPaths.push({
        id: regionPathId,
        rootComponentNodeId: context.componentNodeId,
        terminalKind: "unknown-region",
        terminalId: `${context.boundaryId}:${context.renderSite.id}:${spec.branch}`,
        segments: pathSegments,
        placementConditionIds: uniqueSorted([...context.placementConditionIds, conditionId]),
        certainty: "possible",
        traces: [],
      });
      state.renderRegions.push({
        id: renderRegionId({
          regionKind: "conditional-branch",
          key: `${context.boundaryId}:${context.renderSite.id}:${spec.branch}`,
        }),
        regionKind: "conditional-branch",
        boundaryId: context.boundaryId,
        componentNodeId: context.componentNodeId,
        renderPathId: regionPathId,
        sourceLocation: normalizeAnchor(context.renderSite.location),
        placementConditionIds: uniqueSorted([...context.placementConditionIds, conditionId]),
        childElementIds: [],
        childBoundaryIds: [],
      });
      if (branchSkippedReason) {
        continue;
      }
      expandRenderSite(state, {
        ...context,
        renderSite: childRenderSite,
        childIndex: spec.index,
        basePathSegments: pathSegments,
        placementConditionIds: uniqueSorted([...context.placementConditionIds, conditionId]),
        certainty: branchSkippedReason ? "unknown" : "possible",
        renderExpressionDepth: context.renderExpressionDepth + 1,
      });
    }
    return;
  }

  let repeatedConditionId: string | undefined;
  const repeatedRegion = context.renderSite.repeatedRegion;
  if (repeatedRegion) {
    repeatedConditionId = state.addPlacementCondition({
      key: `${context.boundaryId}:${context.renderSite.id}:${repeatedRegion.repeatKind}`,
      kind: "repeated-region",
      reason: `${repeatedRegion.repeatKind} render repetition`,
      sourceText: repeatedRegion.sourceText,
      sourceLocation: normalizeAnchor(repeatedRegion.sourceLocation),
      ...(repeatedRegion.mayHaveMultipleIterations !== undefined
        ? { mayHaveMultipleIterations: repeatedRegion.mayHaveMultipleIterations }
        : {}),
      certainty: repeatedRegion.certainty,
      confidence: "medium",
      traces: [],
    });
    const repeatedPathId = renderPathId({
      terminalKind: "unknown-region",
      terminalId: `${context.boundaryId}:${context.renderSite.id}:repeated`,
    });
    state.renderPaths.push({
      id: repeatedPathId,
      rootComponentNodeId: context.componentNodeId,
      terminalKind: "unknown-region",
      terminalId: `${context.boundaryId}:${context.renderSite.id}:repeated`,
      segments: [
        ...context.basePathSegments,
        { kind: "repeated-template", conditionId: repeatedConditionId },
      ],
      placementConditionIds: uniqueSorted([...context.placementConditionIds, repeatedConditionId]),
      certainty: repeatedRegion.certainty,
      traces: [],
    });
    state.renderRegions.push({
      id: renderRegionId({
        regionKind: "repeated-template",
        key: `${context.boundaryId}:${context.renderSite.id}`,
      }),
      regionKind: "repeated-template",
      boundaryId: context.boundaryId,
      componentNodeId: context.componentNodeId,
      renderPathId: repeatedPathId,
      sourceLocation: normalizeAnchor(repeatedRegion.sourceLocation),
      placementConditionIds: uniqueSorted([...context.placementConditionIds, repeatedConditionId]),
      childElementIds: [],
      childBoundaryIds: [],
    });
  }

  const effectivePlacementConditionIds = repeatedConditionId
    ? uniqueSorted([...context.placementConditionIds, repeatedConditionId])
    : context.placementConditionIds;
  const effectiveCertainty = repeatedConditionId
    ? (repeatedRegion?.certainty ?? "possible")
    : context.certainty;

  const intrinsicTemplates = templates.filter((template) => template.templateKind === "intrinsic");
  const componentTemplates = templates.filter(
    (template) => template.templateKind === "component-candidate",
  );

  if (intrinsicTemplates.length > 0) {
    for (const template of intrinsicTemplates) {
      const location = normalizeAnchor(template.location);
      const id = createRenderedElementId({
        boundaryId: context.boundaryId,
        templateNodeId: template.id,
        tagName: template.name,
        counts: state.elementIdCounts,
      });
      const pathSegments: RenderPathSegment[] = [
        ...context.basePathSegments,
        { kind: "child-index", index: context.childIndex },
        { kind: "element", elementId: id, tagName: template.name, location },
      ];
      const pathId = renderPathId({ terminalKind: "element", terminalId: id });
      const element: RenderedElement = {
        id,
        tagName: template.name,
        elementTemplateNodeId: template.id,
        renderSiteNodeId: context.renderSite.id,
        sourceLocation: location,
        ...(context.parentElementId ? { parentElementId: context.parentElementId } : {}),
        parentBoundaryId: context.boundaryId,
        childElementIds: [],
        childBoundaryIds: [],
        emissionSiteIds: [],
        ...(template.emittingComponentNodeId
          ? { emittingComponentNodeId: template.emittingComponentNodeId }
          : context.renderSite.emittingComponentNodeId
            ? { emittingComponentNodeId: context.renderSite.emittingComponentNodeId }
            : {}),
        ...(context.forcePlacementComponentNodeId
          ? { placementComponentNodeId: context.forcePlacementComponentNodeId }
          : template.placementComponentNodeId
            ? { placementComponentNodeId: template.placementComponentNodeId }
            : context.placementComponentNodeId
              ? { placementComponentNodeId: context.placementComponentNodeId }
              : context.renderSite.placementComponentNodeId
                ? { placementComponentNodeId: context.renderSite.placementComponentNodeId }
                : {}),
        renderPathId: pathId,
        placementConditionIds: effectivePlacementConditionIds,
        certainty: effectiveCertainty,
        traces: [],
      };
      state.elements.push(element);
      state.elementsById.set(element.id, element);
      state.renderPaths.push({
        id: pathId,
        rootComponentNodeId: context.componentNodeId,
        terminalKind: "element",
        terminalId: id,
        segments: pathSegments,
        placementConditionIds: effectivePlacementConditionIds,
        certainty: effectiveCertainty,
        traces: [],
      });

      if (context.parentElementId) {
        const parentElement = state.elementsById.get(context.parentElementId);
        if (parentElement) {
          parentElement.childElementIds = uniqueSorted([
            ...parentElement.childElementIds,
            element.id,
          ]);
        }
      } else {
        context.rootElementIds.push(element.id);
      }

      for (const childSpec of buildChildExpansionSpecs({
        state,
        context,
        childRenderSiteIds,
      })) {
        expandRenderSite(state, {
          ...context,
          renderSite: childSpec.renderSite,
          childIndex: childSpec.childIndex,
          parentElementId: element.id,
          basePathSegments: pathSegments,
          renderExpressionDepth: context.renderExpressionDepth + 1,
          placementConditionIds: effectivePlacementConditionIds,
          certainty: effectiveCertainty,
        });
      }
    }
    return;
  }

  let shouldExpandComponentChildren = componentTemplates.length === 0;
  const suppliedRenderSiteIdsByPropName = buildSuppliedRenderSiteIdsByPropName({
    state,
    childRenderSiteIds,
  });
  const renderedPropNames = new Set<string>();
  for (const template of componentTemplates) {
    const result = projectComponentTemplate(
      state,
      {
        ...context,
        placementConditionIds: effectivePlacementConditionIds,
        certainty: effectiveCertainty,
      },
      template,
      suppliedRenderSiteIdsByPropName,
    );
    shouldExpandComponentChildren ||= result.rendersSuppliedChildren;
    for (const propName of result.renderedPropNames) {
      renderedPropNames.add(propName);
    }
  }

  for (const childSpec of buildChildExpansionSpecs({
    state,
    context,
    childRenderSiteIds,
  })) {
    const childRenderSite = childSpec.renderSite;
    if (
      componentTemplates.length > 0 &&
      isSuppliedComponentInputRenderSite(childRenderSite) &&
      !shouldExpandSuppliedComponentInputRenderSite({
        renderSite: childRenderSite,
        rendersSuppliedChildren: shouldExpandComponentChildren,
        renderedPropNames,
      })
    ) {
      continue;
    }
    expandRenderSite(state, {
      ...context,
      renderSite: childRenderSite,
      childIndex: childSpec.childIndex,
      renderExpressionDepth: context.renderExpressionDepth + 1,
      placementConditionIds: effectivePlacementConditionIds,
      certainty: effectiveCertainty,
    });
  }
}

function isSuppliedComponentInputRenderSite(
  renderSite: RenderStructureInput["graph"]["nodes"]["renderSites"][number],
): boolean {
  return (
    !renderSite.parentRenderRelation ||
    renderSite.parentRenderRelation === "jsx-child" ||
    renderSite.parentRenderRelation === "jsx-attribute-expression"
  );
}

function buildSuppliedRenderSiteIdsByPropName(input: {
  state: ExpansionState;
  childRenderSiteIds: readonly string[];
}): ReadonlyMap<string, string[]> {
  const result = new Map<string, string[]>();
  for (const childRenderSiteId of input.childRenderSiteIds) {
    const childRenderSite = input.state.input.graph.indexes.nodesById.get(childRenderSiteId);
    if (!childRenderSite || childRenderSite.kind !== "render-site") {
      continue;
    }
    const propName = getSuppliedComponentInputPropName(childRenderSite);
    if (!propName) {
      continue;
    }
    result.set(propName, [...(result.get(propName) ?? []), childRenderSite.id]);
  }
  return result;
}

function buildChildExpansionSpecs(input: {
  state: ExpansionState;
  context: ExpandContext;
  childRenderSiteIds: readonly string[];
}): ChildExpansionSpec[] {
  const childRenderSites = input.childRenderSiteIds
    .map((childRenderSiteId) => input.state.input.graph.indexes.nodesById.get(childRenderSiteId))
    .filter(
      (
        childRenderSite,
      ): childRenderSite is RenderStructureInput["graph"]["nodes"]["renderSites"][number] =>
        childRenderSite?.kind === "render-site",
    );
  const specs: Array<{
    renderSite: RenderStructureInput["graph"]["nodes"]["renderSites"][number];
    location: RenderStructureInput["graph"]["nodes"]["renderSites"][number]["location"];
  }> = childRenderSites.map((renderSite) => ({
    renderSite,
    location: renderSite.location,
  }));

  const suppliedRenderSiteIdsByPropName = input.context.suppliedRenderSiteIdsByPropName;
  if (suppliedRenderSiteIdsByPropName) {
    const component = input.state.componentById.get(input.context.componentNodeId);
    for (const slot of component?.renderedPropSlots ?? []) {
      const suppliedRenderSiteIds = suppliedRenderSiteIdsByPropName.get(slot.propName) ?? [];
      if (
        suppliedRenderSiteIds.length === 0 ||
        !containsAnchor(input.context.renderSite.location, slot.location) ||
        childRenderSites.some((renderSite) => containsAnchor(renderSite.location, slot.location))
      ) {
        continue;
      }
      for (const suppliedRenderSiteId of suppliedRenderSiteIds) {
        const suppliedRenderSite =
          input.state.input.graph.indexes.nodesById.get(suppliedRenderSiteId);
        if (!suppliedRenderSite || suppliedRenderSite.kind !== "render-site") {
          continue;
        }
        specs.push({
          renderSite: suppliedRenderSite,
          location: slot.location,
        });
      }
    }
  }

  return specs
    .sort(
      (left, right) =>
        compareAnchors(left.location, right.location) ||
        left.renderSite.id.localeCompare(right.renderSite.id),
    )
    .map((spec, childIndex) => ({
      renderSite: spec.renderSite,
      childIndex,
    }));
}

function containsAnchor(
  outer: RenderStructureInput["graph"]["nodes"]["renderSites"][number]["location"],
  inner: RenderStructureInput["graph"]["nodes"]["renderSites"][number]["location"],
): boolean {
  if (outer.filePath !== inner.filePath) {
    return false;
  }
  return (
    compareAnchorPositions(
      outer.startLine,
      outer.startColumn,
      inner.startLine,
      inner.startColumn,
    ) <= 0 &&
    compareAnchorPositions(outer.endLine, outer.endColumn, inner.endLine, inner.endColumn) >= 0
  );
}

function compareAnchors(
  left: RenderStructureInput["graph"]["nodes"]["renderSites"][number]["location"],
  right: RenderStructureInput["graph"]["nodes"]["renderSites"][number]["location"],
): number {
  return (
    left.filePath.localeCompare(right.filePath) ||
    compareAnchorPositions(left.startLine, left.startColumn, right.startLine, right.startColumn) ||
    compareAnchorPositions(left.endLine, left.endColumn, right.endLine, right.endColumn)
  );
}

function compareAnchorPositions(
  leftLine: number,
  leftColumn: number,
  rightLine: number,
  rightColumn: number,
): number {
  return leftLine - rightLine || leftColumn - rightColumn;
}

function shouldExpandSuppliedComponentInputRenderSite(input: {
  renderSite: RenderStructureInput["graph"]["nodes"]["renderSites"][number];
  rendersSuppliedChildren: boolean;
  renderedPropNames: ReadonlySet<string>;
}): boolean {
  if (
    !input.renderSite.parentRenderRelation ||
    input.renderSite.parentRenderRelation === "jsx-child"
  ) {
    return input.rendersSuppliedChildren;
  }

  if (input.renderSite.parentRenderRelation === "jsx-attribute-expression") {
    return Boolean(
      input.renderSite.parentRenderAttributeName &&
      input.renderedPropNames.has(input.renderSite.parentRenderAttributeName),
    );
  }

  return true;
}

function getSuppliedComponentInputPropName(
  renderSite: RenderStructureInput["graph"]["nodes"]["renderSites"][number],
): string | undefined {
  if (!renderSite.parentRenderRelation || renderSite.parentRenderRelation === "jsx-child") {
    return "children";
  }
  if (renderSite.parentRenderRelation === "jsx-attribute-expression") {
    return renderSite.parentRenderAttributeName;
  }
  return undefined;
}

function projectComponentTemplate(
  state: ExpansionState,
  context: ExpandContext,
  template: RenderStructureInput["graph"]["nodes"]["elementTemplates"][number],
  suppliedRenderSiteIdsByPropName: ReadonlyMap<string, string[]>,
): {
  rendersSuppliedChildren: boolean;
  renderedPropNames: string[];
} {
  const boundaryPathSegments: RenderPathSegment[] = [
    ...context.basePathSegments,
    { kind: "child-index", index: context.childIndex },
    {
      kind: "component-reference",
      renderSiteNodeId: context.renderSite.id,
      location: normalizeAnchor(template.location),
    },
  ];
  const fromComponentNodeId = context.renderSite.emittingComponentNodeId ?? context.componentNodeId;
  const targetName = template.name.split(".").at(-1) ?? template.name;
  let target =
    (template.resolvedComponentNodeId
      ? state.componentById.get(template.resolvedComponentNodeId)
      : undefined) ??
    (state.renderEdgesByFromComponentNodeId.get(fromComponentNodeId) ?? [])
      .map((edge) => state.componentById.get(edge.to))
      .find((candidate) => candidate?.componentName === targetName);
  let resolvedHeuristically = false;

  const createBoundary = (
    kind: "expanded-component-reference" | "unresolved-component-reference",
    expansion:
      | { status: "expanded"; reason: string }
      | { status: "unresolved" | "cycle" | "budget-exceeded"; reason: string },
    certainty: "definite" | "unknown",
  ): RenderedComponentBoundary => {
    const id = renderedComponentBoundaryId({
      boundaryKind: kind,
      key: `${context.boundaryId}:${template.id}`,
    });
    const renderPathIdValue = renderPathId({
      terminalKind: "component-boundary",
      terminalId: id,
    });
    state.renderPaths.push({
      id: renderPathIdValue,
      rootComponentNodeId: context.componentNodeId,
      terminalKind: "component-boundary",
      terminalId: id,
      segments: boundaryPathSegments,
      placementConditionIds: context.placementConditionIds,
      certainty,
      traces: [],
    });
    const boundary: RenderedComponentBoundary = {
      id,
      boundaryKind: kind,
      ...(target ? { componentNodeId: target.id } : {}),
      ...(target ? { componentKey: target.componentKey } : {}),
      componentName: target?.componentName ?? targetName,
      ...(target ? { filePath: normalizeProjectPath(target.filePath) } : {}),
      ...(target ? { declarationLocation: normalizeAnchor(target.location) } : {}),
      referenceRenderSiteNodeId: context.renderSite.id,
      referenceLocation: normalizeAnchor(template.location),
      ...(target?.renderedPropSlots?.length ? { renderedPropSlots: target.renderedPropSlots } : {}),
      parentBoundaryId: context.boundaryId,
      ...(context.parentElementId ? { parentElementId: context.parentElementId } : {}),
      childBoundaryIds: [],
      rootElementIds: [],
      renderPathId: renderPathIdValue,
      placementConditionIds: context.placementConditionIds,
      expansion,
      traces: [],
    };
    state.componentBoundaries.push(boundary);
    state.boundaryById.set(boundary.id, boundary);
    state.linkBoundaryToParent(boundary);
    return boundary;
  };

  const parentComponent = state.componentById.get(fromComponentNodeId);
  const pushEdge = (
    resolution: "resolved" | "unresolved",
    renderPath: "definite" | "unknown",
    toComponentName: string,
    options?: { toComponent?: RenderStructureInput["graph"]["nodes"]["components"][number] },
  ): void => {
    if (!parentComponent) {
      return;
    }
    state.renderGraphEdges.push({
      fromComponentNodeId: parentComponent.id,
      fromComponentKey: parentComponent.componentKey,
      fromComponentName: parentComponent.componentName,
      fromFilePath: normalizeProjectPath(parentComponent.filePath),
      ...(options?.toComponent ? { toComponentNodeId: options.toComponent.id } : {}),
      ...(options?.toComponent ? { toComponentKey: options.toComponent.componentKey } : {}),
      toComponentName,
      ...(options?.toComponent
        ? { toFilePath: normalizeProjectPath(options.toComponent.filePath) }
        : {}),
      ...(options?.toComponent
        ? { targetLocation: normalizeAnchor(options.toComponent.location) }
        : {}),
      sourceLocation: normalizeAnchor(template.location),
      resolution,
      traversal: "render-structure",
      renderPath,
      traces: [],
    });
  };

  if (!target) {
    const heuristicTarget = resolveHeuristicComponentTarget({
      state,
      targetName,
      sourceFilePath: template.filePath,
    });
    if (heuristicTarget) {
      target = heuristicTarget;
      resolvedHeuristically = true;
      state.diagnostics.push(
        buildDiagnostic({
          code: "heuristic-component-reference-match",
          message: `heuristically matched unresolved component reference "${targetName}" to "${heuristicTarget.componentName}" by unique name`,
          filePath: template.filePath,
          location: template.location,
          renderSiteNodeId: context.renderSite.id,
        }),
      );
    }
  }

  if (!target) {
    const boundary = createBoundary(
      "unresolved-component-reference",
      { status: "unresolved", reason: `unresolved component reference: ${targetName}` },
      "unknown",
    );
    state.addUnknownBarrier({
      boundary,
      sourceLocation: template.location,
      reason: `unresolved component reference: ${targetName}`,
    });
    state.diagnostics.push(
      buildDiagnostic({
        code: "unresolved-component-reference",
        message: `could not resolve component reference "${targetName}"`,
        filePath: template.filePath,
        location: template.location,
        renderSiteNodeId: context.renderSite.id,
        boundaryId: boundary.id,
      }),
    );
    pushEdge("unresolved", "unknown", targetName);
    return { rendersSuppliedChildren: true, renderedPropNames: [] };
  }

  const maxComponentExpansionDepth = state.input.options?.maxComponentExpansionDepth;
  if (
    typeof maxComponentExpansionDepth === "number" &&
    context.componentExpansionDepth >= maxComponentExpansionDepth
  ) {
    const boundary = createBoundary(
      "unresolved-component-reference",
      {
        status: "budget-exceeded",
        reason: `max component expansion depth exceeded before "${target.componentName}"`,
      },
      "unknown",
    );
    state.addUnknownBarrier({
      boundary,
      sourceLocation: template.location,
      reason: "max component expansion depth exceeded",
    });
    state.diagnostics.push(
      buildDiagnostic({
        code: "component-expansion-budget-exceeded",
        message: `component expansion depth exceeded before expanding "${target.componentName}"`,
        filePath: template.filePath,
        location: template.location,
        renderSiteNodeId: context.renderSite.id,
        boundaryId: boundary.id,
      }),
    );
    pushEdge("unresolved", "unknown", target.componentName);
    return { rendersSuppliedChildren: false, renderedPropNames: [] };
  }

  if (context.componentExpansionStack.includes(target.id)) {
    const boundary = createBoundary(
      "unresolved-component-reference",
      { status: "cycle", reason: `component expansion cycle at "${target.componentName}"` },
      "unknown",
    );
    state.addUnknownBarrier({
      boundary,
      sourceLocation: template.location,
      reason: `component expansion cycle at "${target.componentName}"`,
    });
    state.diagnostics.push(
      buildDiagnostic({
        code: "component-expansion-cycle",
        message: `detected component expansion cycle at "${target.componentName}"`,
        filePath: template.filePath,
        location: template.location,
        renderSiteNodeId: context.renderSite.id,
        boundaryId: boundary.id,
      }),
    );
    pushEdge("unresolved", "unknown", target.componentName, { toComponent: target });
    return { rendersSuppliedChildren: false, renderedPropNames: [] };
  }

  const boundaryCertainty = resolvedHeuristically ? "unknown" : "definite";
  const boundary = createBoundary(
    "expanded-component-reference",
    {
      status: "expanded",
      reason: resolvedHeuristically
        ? "heuristic unique-name expansion"
        : "fact-graph render edge expansion",
    },
    boundaryCertainty,
  );
  pushEdge("resolved", boundaryCertainty, target.componentName, { toComponent: target });

  const rootSites = state.rootRenderSitesByComponentNodeId.get(target.id) ?? [];
  const rootElementIds: string[] = [];
  for (const [rootIndex, rootSiteId] of rootSites.entries()) {
    const rootSite = state.renderSitesById.get(rootSiteId);
    if (!rootSite) {
      continue;
    }
    expandRenderSite(state, {
      componentNodeId: target.id,
      placementComponentNodeId: context.componentNodeId,
      forcePlacementComponentNodeId: context.componentNodeId,
      boundaryId: boundary.id,
      renderSite: rootSite,
      childIndex: rootIndex,
      parentElementId: context.parentElementId,
      basePathSegments: boundaryPathSegments,
      componentExpansionStack: [...context.componentExpansionStack, target.id],
      componentExpansionDepth: context.componentExpansionDepth + 1,
      renderExpressionDepth: context.renderExpressionDepth + 1,
      rootElementIds,
      suppliedRenderSiteIdsByPropName,
      placementConditionIds: context.placementConditionIds,
      certainty: boundaryCertainty === "unknown" ? "unknown" : context.certainty,
    });
  }
  boundary.rootElementIds = uniqueSorted(rootElementIds);
  return {
    rendersSuppliedChildren: target.rendersChildrenProp === true,
    renderedPropNames: [...(target.renderedPropNames ?? [])].sort(),
  };
}

function resolveHeuristicComponentTarget(input: {
  state: ExpansionState;
  targetName: string;
  sourceFilePath: string;
}): RenderStructureInput["graph"]["nodes"]["components"][number] | undefined {
  const candidates = input.state.componentNodesByName.get(input.targetName) ?? [];
  if (candidates.length === 0) {
    return undefined;
  }
  if (candidates.length === 1) {
    return candidates[0];
  }

  const sourceSegments = normalizeProjectPath(input.sourceFilePath).split("/");
  const scoredCandidates = candidates.map((candidate) => ({
    candidate,
    score: countCommonPathPrefixSegments(sourceSegments, candidate.filePath.split("/")),
  }));
  const maxScore = Math.max(...scoredCandidates.map((entry) => entry.score));
  const topCandidates = scoredCandidates
    .filter((entry) => entry.score === maxScore)
    .map((entry) => entry.candidate)
    .sort((left, right) => left.id.localeCompare(right.id));

  return topCandidates.length === 1 ? topCandidates[0] : undefined;
}

function countCommonPathPrefixSegments(left: string[], right: string[]): number {
  const maxLength = Math.min(left.length, right.length);
  let count = 0;
  for (let index = 0; index < maxLength; index += 1) {
    if (left[index] !== right[index]) {
      break;
    }
    count += 1;
  }
  return count;
}

function createRenderedElementId(input: {
  boundaryId: string;
  templateNodeId: string;
  tagName: string;
  counts: Map<string, number>;
}): string {
  const key = `${input.boundaryId}:${input.templateNodeId}`;
  const index = input.counts.get(key) ?? 0;
  input.counts.set(key, index + 1);
  return renderedElementId({
    key,
    tagName: input.tagName,
    index,
  });
}

function resolveStaticConditionalBranch(input: { state: ExpansionState; context: ExpandContext }):
  | {
      kind: "resolved";
      reachableBranch: "when-true" | "when-false";
      reason:
        | "condition-resolved-true"
        | "condition-resolved-false"
        | "expression-resolved-nullish";
    }
  | undefined {
  const expressionId = input.context.renderSite.conditionExpressionId;
  const expression = expressionId
    ? getExpressionSyntaxNodeById(input.state, expressionId)
    : undefined;
  const resolved = expression
    ? evaluateStaticConditionValue({
        state: input.state,
        context: input.context,
        expression,
        depth: 0,
        visitedExpressionIds: new Set(),
      })
    : evaluateConditionFromSourceText({
        state: input.state,
        context: input.context,
        sourceText: input.context.renderSite.conditionSourceText,
      });
  if (resolved === undefined) {
    return undefined;
  }
  if (resolved === "nullish") {
    return {
      kind: "resolved",
      reachableBranch: "when-false",
      reason: "expression-resolved-nullish",
    };
  }
  return {
    kind: "resolved",
    reachableBranch: resolved ? "when-true" : "when-false",
    reason: resolved ? "condition-resolved-true" : "condition-resolved-false",
  };
}

function evaluateConditionFromSourceText(input: {
  state: ExpansionState;
  context: ExpandContext;
  sourceText?: string;
}): boolean | "nullish" | undefined {
  const text = input.sourceText?.trim();
  if (!text) {
    return undefined;
  }

  if (text === "true") {
    return true;
  }
  if (text === "false") {
    return false;
  }
  if (text === "null" || text === "undefined") {
    return "nullish";
  }

  if (/^-?\d+(\.\d+)?$/.test(text)) {
    return Number(text) !== 0;
  }

  const identifierMatch = text.match(/^[A-Za-z_$][\w$]*$/);
  if (identifierMatch) {
    const expression = resolveLocalBindingExpressionForIdentifier({
      state: input.state,
      context: input.context,
      identifierName: text,
      targetLocation: input.context.renderSite.location,
    });
    if (!expression) {
      return undefined;
    }
    const direct = evaluateStaticConditionValue({
      state: input.state,
      context: input.context,
      expression,
      depth: 0,
      visitedExpressionIds: new Set(),
    });
    if (direct !== undefined) {
      return direct;
    }
    if (expression.expressionKind === "unsupported") {
      return evaluateUnsupportedComparisonExpression({
        state: input.state,
        context: input.context,
        rawText: expression.rawText,
      });
    }
  }

  return evaluateUnsupportedComparisonExpression({
    state: input.state,
    context: input.context,
    rawText: text,
  });
}

function evaluateStaticConditionValue(input: {
  state: ExpansionState;
  context: ExpandContext;
  expression: RenderStructureInput["graph"]["nodes"]["expressionSyntax"][number];
  depth: number;
  visitedExpressionIds: Set<string>;
}): boolean | "nullish" | undefined {
  const direct = evaluateStaticTruthiness({
    expression: input.expression,
    depth: input.depth,
    seenExpressionIds: input.visitedExpressionIds,
    resolveExpressionById: (expressionId) => getExpressionSyntaxNodeById(input.state, expressionId),
    resolveIdentifier: (expression) =>
      resolveLocalBindingExpressionForIdentifier({
        state: input.state,
        context: input.context,
        identifierName: expression.name,
        targetLocation: expression.location,
      }),
  });
  if (direct !== undefined) {
    return direct;
  }

  if (input.expression.expressionKind === "unsupported") {
    return evaluateUnsupportedComparisonExpression({
      state: input.state,
      context: input.context,
      rawText: input.expression.rawText,
    });
  }

  if (input.expression.expressionKind === "identifier") {
    const resolvedExpression = resolveLocalBindingExpressionForIdentifier({
      state: input.state,
      context: input.context,
      identifierName: input.expression.name,
      targetLocation: input.expression.location,
    });
    if (resolvedExpression?.expressionKind === "unsupported") {
      return evaluateUnsupportedComparisonExpression({
        state: input.state,
        context: input.context,
        rawText: resolvedExpression.rawText,
      });
    }
  }

  return undefined;
}

function resolveLocalBindingExpressionForIdentifier(input: {
  state: ExpansionState;
  context: ExpandContext;
  identifierName: string;
  targetLocation: RenderStructureInput["graph"]["nodes"]["expressionSyntax"][number]["location"];
}): RenderStructureInput["graph"]["nodes"]["expressionSyntax"][number] | undefined {
  const ownerNodeIds = uniqueSorted([
    input.context.componentNodeId,
    input.state.input.graph.indexes.moduleNodeIdByFilePath.get(input.targetLocation.filePath) ?? "",
  ]).filter(Boolean);
  const bindingNodeIds = ownerNodeIds.flatMap(
    (ownerNodeId) =>
      input.state.input.graph.indexes.localValueBindingNodeIdsByOwnerNodeId.get(ownerNodeId) ?? [],
  );
  const bindings = bindingNodeIds
    .map((bindingNodeId) => input.state.input.graph.indexes.nodesById.get(bindingNodeId))
    .filter((node): node is RenderStructureInput["graph"]["nodes"]["localValueBindings"][number] =>
      Boolean(node && node.kind === "local-value-binding"),
    )
    .filter((binding) => binding.localName === input.identifierName)
    .filter(
      (binding) =>
        binding.location.filePath === input.targetLocation.filePath &&
        (binding.location.startLine < input.targetLocation.startLine ||
          (binding.location.startLine === input.targetLocation.startLine &&
            binding.location.startColumn <= input.targetLocation.startColumn)),
    )
    .sort((left, right) =>
      right.location.startLine !== left.location.startLine
        ? right.location.startLine - left.location.startLine
        : right.location.startColumn - left.location.startColumn,
    );

  for (const binding of bindings) {
    const expressionId = resolveLocalBindingExpressionId({
      state: input.state,
      binding,
    });
    if (!expressionId) {
      continue;
    }
    const expression = getExpressionSyntaxNodeById(input.state, expressionId);
    if (expression) {
      return expression;
    }
  }
  return undefined;
}

function resolveLocalBindingExpressionId(input: {
  state: ExpansionState;
  binding: RenderStructureInput["graph"]["nodes"]["localValueBindings"][number];
}): string | undefined {
  if (input.binding.bindingKind !== "destructured-property") {
    return input.binding.expressionId;
  }

  if (!input.binding.objectExpressionId) {
    return input.binding.initializerExpressionId;
  }

  const objectExpression = getExpressionSyntaxNodeById(
    input.state,
    input.binding.objectExpressionId,
  );
  if (
    !objectExpression ||
    objectExpression.expressionKind !== "object-literal" ||
    !input.binding.propertyName
  ) {
    return undefined;
  }

  const property = objectExpression.properties.find(
    (candidate) =>
      candidate.propertyKind === "property" &&
      candidate.keyKind !== "computed" &&
      candidate.keyText === input.binding.propertyName,
  );
  if (property?.valueExpressionId) {
    return property.valueExpressionId;
  }

  if (objectExpression.hasSpreadProperty || objectExpression.hasUnsupportedProperty) {
    return undefined;
  }

  return input.binding.initializerExpressionId;
}

function evaluateUnsupportedComparisonExpression(input: {
  state: ExpansionState;
  context: ExpandContext;
  rawText: string;
}): boolean | undefined {
  const match = input.rawText.match(
    /^\s*([A-Za-z_$][\w$]*|-?\d+(?:\.\d+)?)\s*(>=|<=|>|<|===|!==)\s*([A-Za-z_$][\w$]*|-?\d+(?:\.\d+)?)\s*$/,
  );
  if (!match) {
    return undefined;
  }

  const left = resolveComparisonOperand({
    state: input.state,
    context: input.context,
    text: match[1],
  });
  const right = resolveComparisonOperand({
    state: input.state,
    context: input.context,
    text: match[3],
  });
  if (left === undefined || right === undefined) {
    return undefined;
  }

  switch (match[2]) {
    case ">":
      return left > right;
    case ">=":
      return left >= right;
    case "<":
      return left < right;
    case "<=":
      return left <= right;
    case "===":
      return left === right;
    case "!==":
      return left !== right;
    default:
      return undefined;
  }
}

function resolveComparisonOperand(input: {
  state: ExpansionState;
  context: ExpandContext;
  text: string;
}): number | undefined {
  const numeric = Number(input.text);
  if (!Number.isNaN(numeric)) {
    return numeric;
  }

  const expression = resolveLocalBindingExpressionForIdentifier({
    state: input.state,
    context: input.context,
    identifierName: input.text,
    targetLocation: input.context.renderSite.location,
  });
  if (!expression) {
    return undefined;
  }
  if (expression.expressionKind === "numeric-literal") {
    const value = Number(expression.value);
    return Number.isNaN(value) ? undefined : value;
  }

  return undefined;
}

function getExpressionSyntaxNodeById(
  state: ExpansionState,
  expressionId: string,
): RenderStructureInput["graph"]["nodes"]["expressionSyntax"][number] | undefined {
  const nodeId = state.input.graph.indexes.expressionSyntaxNodeIdByExpressionId.get(expressionId);
  const node = nodeId ? state.input.graph.indexes.nodesById.get(nodeId) : undefined;
  if (node && node.kind === "expression-syntax") {
    return node;
  }
  return state.input.graph.nodes.expressionSyntax.find(
    (expression) => expression.expressionId === expressionId,
  );
}
