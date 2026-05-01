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
  RenderedComponent,
  RenderedComponentBoundary,
  RenderedElement,
} from "../types.js";
import { normalizeAnchor, normalizeProjectPath, uniqueSorted } from "./common.js";
import { buildDiagnostic } from "./diagnostics.js";

export type ExpandContext = {
  componentNodeId: string;
  boundaryId: string;
  renderSite: RenderStructureInput["graph"]["nodes"]["renderSites"][number];
  childIndex: number;
  parentElementId?: string;
  basePathSegments: RenderPathSegment[];
  componentExpansionStack: string[];
  componentExpansionDepth: number;
  renderExpressionDepth: number;
  rootElementIds: string[];
  placementConditionIds: string[];
  certainty: "definite" | "possible" | "unknown";
};

export type ExpansionState = {
  input: RenderStructureInput;
  componentById: Map<string, RenderStructureInput["graph"]["nodes"]["components"][number]>;
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
      const conditionId = state.addPlacementCondition({
        key: `${context.boundaryId}:${context.renderSite.id}:${spec.branch}`,
        kind: "conditional-branch",
        sourceText: context.renderSite.renderSiteKind,
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
      expandRenderSite(state, {
        ...context,
        renderSite: childRenderSite,
        childIndex: spec.index,
        basePathSegments: pathSegments,
        placementConditionIds: uniqueSorted([...context.placementConditionIds, conditionId]),
        certainty: "possible",
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
        ...(template.placementComponentNodeId
          ? { placementComponentNodeId: template.placementComponentNodeId }
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

      for (const [childIndex, childRenderSiteId] of childRenderSiteIds.entries()) {
        const childRenderSite = state.input.graph.indexes.nodesById.get(childRenderSiteId);
        if (!childRenderSite || childRenderSite.kind !== "render-site") {
          continue;
        }
        expandRenderSite(state, {
          ...context,
          renderSite: childRenderSite,
          childIndex,
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

  for (const template of componentTemplates) {
    projectComponentTemplate(state, context, template);
  }

  for (const [childIndex, childRenderSiteId] of childRenderSiteIds.entries()) {
    const childRenderSite = state.input.graph.indexes.nodesById.get(childRenderSiteId);
    if (!childRenderSite || childRenderSite.kind !== "render-site") {
      continue;
    }
    expandRenderSite(state, {
      ...context,
      renderSite: childRenderSite,
      childIndex,
      renderExpressionDepth: context.renderExpressionDepth + 1,
      placementConditionIds: effectivePlacementConditionIds,
      certainty: effectiveCertainty,
    });
  }
}

function projectComponentTemplate(
  state: ExpansionState,
  context: ExpandContext,
  template: RenderStructureInput["graph"]["nodes"]["elementTemplates"][number],
): void {
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
  const target = (state.renderEdgesByFromComponentNodeId.get(fromComponentNodeId) ?? [])
    .map((edge) => state.componentById.get(edge.to))
    .find((candidate) => candidate?.componentName === targetName);

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
    return;
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
    return;
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
    return;
  }

  const boundary = createBoundary(
    "expanded-component-reference",
    { status: "expanded", reason: "fact-graph render edge expansion" },
    "definite",
  );
  pushEdge("resolved", "definite", target.componentName, { toComponent: target });

  const rootSites = state.rootRenderSitesByComponentNodeId.get(target.id) ?? [];
  const rootElementIds: string[] = [];
  for (const [rootIndex, rootSiteId] of rootSites.entries()) {
    const rootSite = state.renderSitesById.get(rootSiteId);
    if (!rootSite) {
      continue;
    }
    expandRenderSite(state, {
      componentNodeId: target.id,
      boundaryId: boundary.id,
      renderSite: rootSite,
      childIndex: rootIndex,
      parentElementId: context.parentElementId,
      basePathSegments: boundaryPathSegments,
      componentExpansionStack: [...context.componentExpansionStack, target.id],
      componentExpansionDepth: context.componentExpansionDepth + 1,
      renderExpressionDepth: context.renderExpressionDepth + 1,
      rootElementIds,
      placementConditionIds: context.placementConditionIds,
      certainty: context.certainty,
    });
  }
  boundary.rootElementIds = uniqueSorted(rootElementIds);
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
