import type { EmissionSite, RenderModel, RenderedElement } from "../render-structure/index.js";

export type SelectorRenderMatchIndexes = {
  renderModel: RenderModel;
  elementsById: Map<string, RenderedElement>;
  emissionSitesById: Map<string, EmissionSite>;
  emissionSiteIdsByElementId: Map<string, string[]>;
  elementIdsByClassName: Map<string, string[]>;
  unknownClassElementIds: string[];
};

export function buildSelectorRenderMatchIndexes(
  renderModel: RenderModel,
): SelectorRenderMatchIndexes {
  const elementIdsByClassName = new Map<string, string[]>();
  const unknownClassElementIds = new Set<string>();

  for (const emissionSite of renderModel.emissionSites) {
    if (!emissionSite.elementId) {
      if (emissionSite.confidence === "low" || emissionSite.unsupported.length > 0) {
        for (const elementId of getBoundaryUnknownClassElementIds(renderModel, emissionSite)) {
          unknownClassElementIds.add(elementId);
        }
      }
      continue;
    }

    if (emissionSite.confidence === "low" || emissionSite.unsupported.length > 0) {
      unknownClassElementIds.add(emissionSite.elementId);
    }

    for (const token of emissionSite.tokens) {
      if (token.tokenKind === "css-module-export") {
        continue;
      }

      pushMapValue(elementIdsByClassName, token.token, emissionSite.elementId);
    }
  }

  sortMapValues(elementIdsByClassName);

  return {
    renderModel,
    elementsById: renderModel.indexes.elementById,
    emissionSitesById: renderModel.indexes.emissionSiteById,
    emissionSiteIdsByElementId: renderModel.indexes.emissionSiteIdsByElementId,
    elementIdsByClassName,
    unknownClassElementIds: [...unknownClassElementIds].sort((left, right) =>
      left.localeCompare(right),
    ),
  };
}

function getBoundaryUnknownClassElementIds(
  renderModel: RenderModel,
  emissionSite: EmissionSite,
): string[] {
  const elementIds = new Set<string>();
  const boundary = renderModel.indexes.componentBoundaryById.get(emissionSite.boundaryId);
  for (const elementId of boundary?.rootElementIds ?? []) {
    elementIds.add(elementId);
  }

  if (!boundary?.componentNodeId) {
    return [...elementIds].sort((left, right) => left.localeCompare(right));
  }

  for (const expandedBoundary of renderModel.componentBoundaries) {
    if (
      expandedBoundary.id === boundary.id ||
      expandedBoundary.componentNodeId !== boundary.componentNodeId ||
      !expandedBoundary.parentBoundaryId
    ) {
      continue;
    }

    const parentBoundary = renderModel.indexes.componentBoundaryById.get(
      expandedBoundary.parentBoundaryId,
    );
    for (const elementId of parentBoundary?.rootElementIds ?? []) {
      elementIds.add(elementId);
    }
  }

  return [...elementIds].sort((left, right) => left.localeCompare(right));
}

function pushMapValue<Key, Value>(map: Map<Key, Value[]>, key: Key, value: Value): void {
  const values = map.get(key) ?? [];
  values.push(value);
  map.set(key, values);
}

function sortMapValues(map: Map<string, string[]>): void {
  for (const [key, values] of map.entries()) {
    map.set(
      key,
      [...new Set(values)].sort((left, right) => left.localeCompare(right)),
    );
  }
}
