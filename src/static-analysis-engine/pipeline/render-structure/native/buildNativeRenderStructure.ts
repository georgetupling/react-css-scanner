import {
  placementConditionId,
  renderedComponentBoundaryId,
  renderedComponentId,
  renderPathId,
  renderRegionId,
} from "../ids.js";
import type {
  EmissionSite,
  PlacementCondition,
  RenderGraphProjection,
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
import { buildNativeEmissionSites } from "./emissions.js";
import { createUnknownBarrierCondition } from "./diagnostics.js";
import { expandRenderSite, type ExpansionState } from "./expansion.js";
import {
  buildChildRenderSitesByParentRenderSiteId,
  buildRootRenderSitesByComponentNodeId,
  buildTemplatesByRenderSiteId,
} from "./lookups.js";
import {
  buildRenderEdgesByFromComponentNodeId,
  buildRenderGraphNodes,
  sortRenderGraphEdges,
} from "./renderGraph.js";
import { compareAnchors, normalizeAnchor, normalizeProjectPath, uniqueSorted } from "./common.js";

type NativeRenderStructureProjection = {
  components: RenderedComponent[];
  componentBoundaries: RenderedComponentBoundary[];
  elements: RenderedElement[];
  emissionSites: EmissionSite[];
  renderPaths: RenderPath[];
  placementConditions: PlacementCondition[];
  renderRegions: RenderRegion[];
  renderGraph: RenderGraphProjection;
  diagnostics: RenderStructureDiagnostic[];
};

export function buildNativeRenderStructure(
  input: RenderStructureInput,
): NativeRenderStructureProjection {
  const components: RenderedComponent[] = [];
  const componentBoundaries: RenderedComponentBoundary[] = [];
  const elements: RenderedElement[] = [];
  const renderPaths: RenderPath[] = [];
  const placementConditions: PlacementCondition[] = [];
  const renderRegions: RenderRegion[] = [];
  const diagnostics: RenderStructureDiagnostic[] = [];
  const renderGraphEdges: RenderGraphProjectionEdge[] = [];

  const componentById = new Map(
    input.graph.nodes.components.map((node) => [node.id, node] as const),
  );
  const componentNodesByName = new Map<
    string,
    Array<RenderStructureInput["graph"]["nodes"]["components"][number]>
  >();
  for (const componentNode of input.graph.nodes.components) {
    const existing = componentNodesByName.get(componentNode.componentName) ?? [];
    existing.push(componentNode);
    componentNodesByName.set(componentNode.componentName, existing);
  }
  for (const [componentName, componentNodes] of componentNodesByName.entries()) {
    componentNodesByName.set(
      componentName,
      [...componentNodes].sort((left, right) => left.id.localeCompare(right.id)),
    );
  }
  const boundaryById = new Map<string, RenderedComponentBoundary>();
  const renderSitesById = new Map(
    input.graph.nodes.renderSites.map((site) => [site.id, site] as const),
  );
  const templatesByRenderSiteId = buildTemplatesByRenderSiteId(input);
  const childRenderSitesByParentRenderSiteId = buildChildRenderSitesByParentRenderSiteId(input);
  const rootRenderSitesByComponentNodeId = buildRootRenderSitesByComponentNodeId(input);
  const renderEdgesByFromComponentNodeId = buildRenderEdgesByFromComponentNodeId(input);
  const elementIdCounts = new Map<string, number>();
  const elementsById = new Map<string, RenderedElement>();
  const rootBoundaryIdByComponentNodeId = new Map<string, string>();

  const linkBoundaryToParent = (boundary: RenderedComponentBoundary): void => {
    if (boundary.parentBoundaryId) {
      const parent = boundaryById.get(boundary.parentBoundaryId);
      if (parent) {
        parent.childBoundaryIds = uniqueSorted([...parent.childBoundaryIds, boundary.id]);
      }
    }
    if (boundary.parentElementId) {
      const parentElement = elementsById.get(boundary.parentElementId);
      if (parentElement) {
        parentElement.childBoundaryIds = uniqueSorted([
          ...parentElement.childBoundaryIds,
          boundary.id,
        ]);
      }
    }
  };

  const addUnknownBarrier = (inputBarrier: {
    boundary: RenderedComponentBoundary;
    sourceLocation: RenderStructureInput["graph"]["nodes"]["components"][number]["location"];
    reason: string;
  }): void => {
    const condition = createUnknownBarrierCondition({
      boundaryId: inputBarrier.boundary.id,
      sourceLocation: inputBarrier.sourceLocation,
      reason: inputBarrier.reason,
    });
    placementConditions.push(condition);
    inputBarrier.boundary.placementConditionIds = uniqueSorted([
      ...inputBarrier.boundary.placementConditionIds,
      condition.id,
    ]);
    const regionId = renderRegionId({
      regionKind: "unknown-barrier",
      key: `${inputBarrier.boundary.id}:${inputBarrier.reason}`,
    });
    renderRegions.push({
      id: regionId,
      regionKind: "unknown-barrier",
      boundaryId: inputBarrier.boundary.id,
      ...(inputBarrier.boundary.componentNodeId
        ? { componentNodeId: inputBarrier.boundary.componentNodeId }
        : {}),
      renderPathId: inputBarrier.boundary.renderPathId,
      sourceLocation: normalizeAnchor(inputBarrier.sourceLocation),
      placementConditionIds: [condition.id],
      childElementIds: [],
      childBoundaryIds: [],
    });
  };

  const addPlacementCondition = (
    inputCondition: Omit<PlacementCondition, "id"> & { key: string },
  ): string => {
    const id = placementConditionId({
      conditionKind: inputCondition.kind,
      key: inputCondition.key,
    });
    placementConditions.push({
      ...inputCondition,
      id,
    });
    return id;
  };

  const expansionState: ExpansionState = {
    input,
    componentById,
    componentNodesByName,
    boundaryById,
    renderSitesById,
    templatesByRenderSiteId,
    childRenderSitesByParentRenderSiteId,
    rootRenderSitesByComponentNodeId,
    renderEdgesByFromComponentNodeId,
    elementIdCounts,
    elements,
    elementsById,
    renderPaths,
    renderGraphEdges,
    placementConditions,
    renderRegions,
    diagnostics,
    componentBoundaries,
    linkBoundaryToParent,
    addUnknownBarrier,
    addPlacementCondition,
  };

  for (const componentNode of [...input.graph.nodes.components].sort(compareComponentNodes)) {
    const boundaryId = renderedComponentBoundaryId({
      boundaryKind: "component-root",
      key: componentNode.componentKey,
    });
    const componentId = renderedComponentId(componentNode.componentKey);
    const declarationLocation = normalizeAnchor(componentNode.location);
    const filePath = normalizeProjectPath(componentNode.filePath);
    const boundaryPathSegments: RenderPathSegment[] = [
      {
        kind: "component-root",
        componentNodeId: componentNode.id,
        location: declarationLocation,
      },
    ];
    const boundaryRenderPathId = renderPathId({
      terminalKind: "component-boundary",
      terminalId: boundaryId,
    });
    renderPaths.push({
      id: boundaryRenderPathId,
      rootComponentNodeId: componentNode.id,
      terminalKind: "component-boundary",
      terminalId: boundaryId,
      segments: boundaryPathSegments,
      placementConditionIds: [],
      certainty: "definite",
      traces: [],
    });
    const rootElementIds: string[] = [];

    components.push({
      id: componentId,
      componentNodeId: componentNode.id,
      componentKey: componentNode.componentKey,
      componentName: componentNode.componentName,
      filePath,
      exported: componentNode.exported,
      declarationLocation,
      rootBoundaryIds: [boundaryId],
      provenance: [
        {
          stage: "render-structure",
          filePath,
          anchor: declarationLocation,
          upstreamId: componentNode.id,
          summary: "Derived rendered component from fact graph component node",
        },
      ],
      traces: [],
    });

    const boundary: RenderedComponentBoundary = {
      id: boundaryId,
      boundaryKind: "component-root",
      componentNodeId: componentNode.id,
      componentKey: componentNode.componentKey,
      componentName: componentNode.componentName,
      filePath,
      declarationLocation,
      ...(componentNode.renderedPropSlots?.length
        ? { renderedPropSlots: componentNode.renderedPropSlots }
        : {}),
      childBoundaryIds: [],
      rootElementIds,
      renderPathId: boundaryRenderPathId,
      placementConditionIds: [],
      expansion: { status: "root" },
      traces: [],
    };
    componentBoundaries.push(boundary);
    boundaryById.set(boundary.id, boundary);
    rootBoundaryIdByComponentNodeId.set(componentNode.id, boundary.id);

    for (const [rootIndex, rootRenderSiteId] of (
      rootRenderSitesByComponentNodeId.get(componentNode.id) ?? []
    ).entries()) {
      const rootRenderSite = renderSitesById.get(rootRenderSiteId);
      if (!rootRenderSite) {
        continue;
      }
      expandRenderSite(expansionState, {
        componentNodeId: componentNode.id,
        placementComponentNodeId: componentNode.id,
        boundaryId: boundary.id,
        renderSite: rootRenderSite,
        childIndex: rootIndex,
        basePathSegments: boundaryPathSegments,
        componentExpansionStack: [componentNode.id],
        componentExpansionDepth: 0,
        renderExpressionDepth: 0,
        rootElementIds,
        placementConditionIds: [],
        certainty: "definite",
      });
    }

    renderRegions.push({
      id: renderRegionId({
        regionKind: "component-root",
        key: componentNode.componentKey,
      }),
      regionKind: "component-root",
      boundaryId: boundary.id,
      componentNodeId: componentNode.id,
      renderPathId: boundary.renderPathId,
      sourceLocation: declarationLocation,
      placementConditionIds: [],
      childElementIds: uniqueSorted(rootElementIds),
      childBoundaryIds: uniqueSorted(boundary.childBoundaryIds),
    });
  }

  const emissionResult = buildNativeEmissionSites({
    renderInput: input,
    elements,
    componentBoundaries,
    renderPaths,
    rootBoundaryIdByComponentNodeId,
  });

  return {
    components,
    componentBoundaries: componentBoundaries.sort((left, right) => left.id.localeCompare(right.id)),
    elements: elements.sort((left, right) => left.id.localeCompare(right.id)),
    emissionSites: emissionResult.emissionSites.sort((left, right) =>
      left.id.localeCompare(right.id),
    ),
    renderPaths: renderPaths.sort((left, right) => left.id.localeCompare(right.id)),
    placementConditions: placementConditions.sort((left, right) => left.id.localeCompare(right.id)),
    renderRegions: renderRegions.sort((left, right) => left.id.localeCompare(right.id)),
    renderGraph: {
      nodes: buildRenderGraphNodes(components),
      edges: sortRenderGraphEdges(renderGraphEdges),
    },
    diagnostics: [...diagnostics, ...emissionResult.diagnostics].sort(
      (left, right) =>
        left.code.localeCompare(right.code) ||
        (left.filePath ?? "").localeCompare(right.filePath ?? "") ||
        left.message.localeCompare(right.message),
    ),
  };
}

function compareComponentNodes(
  left: RenderStructureInput["graph"]["nodes"]["components"][number],
  right: RenderStructureInput["graph"]["nodes"]["components"][number],
): number {
  return (
    left.filePath.localeCompare(right.filePath) ||
    left.componentKey.localeCompare(right.componentKey) ||
    left.componentName.localeCompare(right.componentName) ||
    compareAnchors(left.location, right.location)
  );
}
