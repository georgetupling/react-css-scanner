import { duplicateRenderStructureIdDiagnostic } from "./diagnostics.js";
import type {
  EmissionSite,
  PlacementCondition,
  RenderModelIndexes,
  RenderPath,
  RenderRegion,
  RenderStructureDiagnostic,
  RenderedComponent,
  RenderedComponentBoundary,
  RenderedElement,
} from "./types.js";

export function buildRenderModelIndexes(input: {
  components: RenderedComponent[];
  componentBoundaries: RenderedComponentBoundary[];
  elements: RenderedElement[];
  emissionSites: EmissionSite[];
  renderPaths: RenderPath[];
  placementConditions: PlacementCondition[];
  renderRegions: RenderRegion[];
}): {
  indexes: RenderModelIndexes;
  diagnostics: RenderStructureDiagnostic[];
} {
  const diagnostics: RenderStructureDiagnostic[] = [];
  const componentsById = new Map<string, RenderedComponent>();
  const componentIdByComponentNodeId = new Map<string, string>();
  const componentBoundaryById = new Map<string, RenderedComponentBoundary>();
  const boundaryIdsByComponentNodeId = new Map<string, string[]>();
  const elementById = new Map<string, RenderedElement>();
  const elementIdsByTemplateNodeId = new Map<string, string[]>();
  const elementIdsByRenderSiteNodeId = new Map<string, string[]>();
  const emissionSiteById = new Map<string, EmissionSite>();
  const emissionSiteIdsByClassExpressionId = new Map<string, string[]>();
  const emissionSiteIdsByClassExpressionSiteNodeId = new Map<string, string[]>();
  const emissionSiteIdsByToken = new Map<string, string[]>();
  const emissionSiteIdsByElementId = new Map<string, string[]>();
  const emissionSiteIdsByEmittingComponentNodeId = new Map<string, string[]>();
  const emissionSiteIdsBySuppliedByComponentNodeId = new Map<string, string[]>();
  const childElementIdsByParentElementId = new Map<string, string[]>();
  const childBoundaryIdsByParentElementId = new Map<string, string[]>();
  const ancestorElementIdsByElementId = new Map<string, string[]>();
  const siblingElementIdsByElementId = new Map<string, string[]>();
  const renderPathById = new Map<string, RenderPath>();
  const renderRegionIdsByComponentNodeId = new Map<string, string[]>();
  const unknownBarrierRegionIdsByComponentNodeId = new Map<string, string[]>();

  for (const component of input.components) {
    setUnique(componentsById, component.id, component, "component", diagnostics);
    if (component.componentNodeId) {
      componentIdByComponentNodeId.set(component.componentNodeId, component.id);
    }
  }

  for (const boundary of input.componentBoundaries) {
    setUnique(componentBoundaryById, boundary.id, boundary, "component boundary", diagnostics);
    if (boundary.componentNodeId) {
      pushMapValue(boundaryIdsByComponentNodeId, boundary.componentNodeId, boundary.id);
    }
  }

  for (const element of input.elements) {
    setUnique(elementById, element.id, element, "element", diagnostics);

    if (element.elementTemplateNodeId) {
      pushMapValue(elementIdsByTemplateNodeId, element.elementTemplateNodeId, element.id);
    }

    if (element.renderSiteNodeId) {
      pushMapValue(elementIdsByRenderSiteNodeId, element.renderSiteNodeId, element.id);
    }

    if (element.parentElementId) {
      pushMapValue(childElementIdsByParentElementId, element.parentElementId, element.id);
    }
  }

  for (const boundary of input.componentBoundaries) {
    if (boundary.parentElementId) {
      pushMapValue(childBoundaryIdsByParentElementId, boundary.parentElementId, boundary.id);
    }
  }

  for (const element of input.elements) {
    ancestorElementIdsByElementId.set(element.id, collectAncestorElementIds(element, elementById));
    siblingElementIdsByElementId.set(element.id, collectSiblingElementIds(element, elementById));
  }

  for (const emissionSite of input.emissionSites) {
    setUnique(emissionSiteById, emissionSite.id, emissionSite, "emission site", diagnostics);
    pushMapValue(
      emissionSiteIdsByClassExpressionId,
      emissionSite.classExpressionId,
      emissionSite.id,
    );
    pushMapValue(
      emissionSiteIdsByClassExpressionSiteNodeId,
      emissionSite.classExpressionSiteNodeId,
      emissionSite.id,
    );

    if (emissionSite.elementId) {
      pushMapValue(emissionSiteIdsByElementId, emissionSite.elementId, emissionSite.id);
    }

    if (emissionSite.emittingComponentNodeId) {
      pushMapValue(
        emissionSiteIdsByEmittingComponentNodeId,
        emissionSite.emittingComponentNodeId,
        emissionSite.id,
      );
    }

    if (emissionSite.suppliedByComponentNodeId) {
      pushMapValue(
        emissionSiteIdsBySuppliedByComponentNodeId,
        emissionSite.suppliedByComponentNodeId,
        emissionSite.id,
      );
    }

    for (const token of emissionSite.tokens) {
      pushMapValue(emissionSiteIdsByToken, token.token, emissionSite.id);
    }
  }

  for (const renderPath of input.renderPaths) {
    setUnique(renderPathById, renderPath.id, renderPath, "render path", diagnostics);
  }

  for (const renderRegion of input.renderRegions) {
    if (renderRegion.componentNodeId) {
      pushMapValue(renderRegionIdsByComponentNodeId, renderRegion.componentNodeId, renderRegion.id);
      if (renderRegion.regionKind === "unknown-barrier") {
        pushMapValue(
          unknownBarrierRegionIdsByComponentNodeId,
          renderRegion.componentNodeId,
          renderRegion.id,
        );
      }
    }
  }

  return {
    indexes: {
      componentsById,
      componentIdByComponentNodeId,
      componentBoundaryById,
      boundaryIdsByComponentNodeId: sortMapValues(boundaryIdsByComponentNodeId),
      elementById,
      elementIdsByTemplateNodeId: sortMapValues(elementIdsByTemplateNodeId),
      elementIdsByRenderSiteNodeId: sortMapValues(elementIdsByRenderSiteNodeId),
      emissionSiteById,
      emissionSiteIdsByClassExpressionId: sortMapValues(emissionSiteIdsByClassExpressionId),
      emissionSiteIdsByClassExpressionSiteNodeId: sortMapValues(
        emissionSiteIdsByClassExpressionSiteNodeId,
      ),
      emissionSiteIdsByToken: sortMapValues(emissionSiteIdsByToken),
      emissionSiteIdsByElementId: sortMapValues(emissionSiteIdsByElementId),
      emissionSiteIdsByEmittingComponentNodeId: sortMapValues(
        emissionSiteIdsByEmittingComponentNodeId,
      ),
      emissionSiteIdsBySuppliedByComponentNodeId: sortMapValues(
        emissionSiteIdsBySuppliedByComponentNodeId,
      ),
      childElementIdsByParentElementId: sortMapValues(childElementIdsByParentElementId),
      childBoundaryIdsByParentElementId: sortMapValues(childBoundaryIdsByParentElementId),
      ancestorElementIdsByElementId: sortMapValues(ancestorElementIdsByElementId),
      siblingElementIdsByElementId: sortMapValues(siblingElementIdsByElementId),
      renderPathById,
      renderRegionIdsByComponentNodeId: sortMapValues(renderRegionIdsByComponentNodeId),
      unknownBarrierRegionIdsByComponentNodeId: sortMapValues(
        unknownBarrierRegionIdsByComponentNodeId,
      ),
    },
    diagnostics,
  };
}

function setUnique<T>(
  map: Map<string, T>,
  key: string,
  value: T,
  recordKind: string,
  diagnostics: RenderStructureDiagnostic[],
): void {
  if (map.has(key)) {
    diagnostics.push(duplicateRenderStructureIdDiagnostic({ id: key, recordKind }));
  }

  map.set(key, value);
}

function pushMapValue(map: Map<string, string[]>, key: string, value: string): void {
  const values = map.get(key) ?? [];
  values.push(value);
  map.set(key, values);
}

function sortMapValues<Key extends string>(map: Map<Key, string[]>): Map<Key, string[]> {
  return new Map(
    [...map.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, values]) => [
        key,
        [...new Set(values)].sort((left, right) => left.localeCompare(right)),
      ]),
  );
}

function collectAncestorElementIds(
  element: RenderedElement,
  elementsById: Map<string, RenderedElement>,
): string[] {
  const ancestorIds: string[] = [];
  let parentId = element.parentElementId;

  while (parentId) {
    ancestorIds.push(parentId);
    parentId = elementsById.get(parentId)?.parentElementId;
  }

  return ancestorIds;
}

function collectSiblingElementIds(
  element: RenderedElement,
  elementsById: Map<string, RenderedElement>,
): string[] {
  if (element.parentElementId) {
    return (
      elementsById
        .get(element.parentElementId)
        ?.childElementIds.filter((elementId) => elementId !== element.id)
        .sort((left, right) => left.localeCompare(right)) ?? []
    );
  }

  return [...elementsById.values()]
    .filter(
      (candidate) =>
        candidate.id !== element.id &&
        !candidate.parentElementId &&
        candidate.parentBoundaryId === element.parentBoundaryId,
    )
    .map((candidate) => candidate.id)
    .sort((left, right) => left.localeCompare(right));
}
