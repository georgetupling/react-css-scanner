import {
  emissionSiteId,
  renderedComponentBoundaryId,
  renderedComponentId,
  renderedElementId,
  renderPathId,
  renderRegionId,
} from "../ids.js";
import type {
  RenderGraphProjection,
  EmissionSite,
  EmissionTokenProvenance,
  RenderPath,
  RenderPathSegment,
  RenderRegion,
  RenderStructureDiagnostic,
  RenderStructureInput,
  RenderedComponent,
  RenderedComponentBoundary,
  RenderedElement,
} from "../types.js";

type NativeRenderStructureProjection = {
  components: RenderedComponent[];
  componentBoundaries: RenderedComponentBoundary[];
  elements: RenderedElement[];
  emissionSites: EmissionSite[];
  renderPaths: RenderPath[];
  placementConditions: [];
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
  const emissionSites: EmissionSite[] = [];
  const renderPaths: RenderPath[] = [];
  const renderRegions: RenderRegion[] = [];
  const diagnostics: RenderStructureDiagnostic[] = [];

  const renderSitesById = new Map(
    input.graph.nodes.renderSites.map((site) => [site.id, site] as const),
  );
  const templatesByRenderSiteId = buildTemplatesByRenderSiteId(input);
  const childRenderSitesByParentRenderSiteId = buildChildRenderSitesByParentRenderSiteId(input);
  const rootRenderSitesByComponentNodeId = buildRootRenderSitesByComponentNodeId(input);
  const elementIdCounts = new Map<string, number>();
  const emissionIdCounts = new Map<string, number>();
  const elementsById = new Map<string, RenderedElement>();
  const rootBoundaryIdByComponentNodeId = new Map<string, string>();

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
    const boundaryRenderPath: RenderPath = {
      id: boundaryRenderPathId,
      rootComponentNodeId: componentNode.id,
      terminalKind: "component-boundary",
      terminalId: boundaryId,
      segments: boundaryPathSegments,
      placementConditionIds: [],
      certainty: "definite",
      traces: [],
    };
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

    componentBoundaries.push({
      id: boundaryId,
      boundaryKind: "component-root",
      componentNodeId: componentNode.id,
      componentKey: componentNode.componentKey,
      componentName: componentNode.componentName,
      filePath,
      declarationLocation,
      childBoundaryIds: [],
      rootElementIds,
      renderPathId: boundaryRenderPath.id,
      placementConditionIds: [],
      expansion: { status: "root" },
      traces: [],
    });
    rootBoundaryIdByComponentNodeId.set(componentNode.id, boundaryId);

    renderPaths.push(boundaryRenderPath);

    const rootRenderSites = rootRenderSitesByComponentNodeId.get(componentNode.id) ?? [];
    for (const [rootIndex, rootRenderSiteId] of rootRenderSites.entries()) {
      const rootRenderSite = renderSitesById.get(rootRenderSiteId);
      if (!rootRenderSite) {
        continue;
      }
      expandIntrinsicElementsForRenderSite({
        input,
        componentNodeId: componentNode.id,
        boundaryId,
        renderSite: rootRenderSite,
        childIndex: rootIndex,
        parentElementId: undefined,
        basePathSegments: boundaryPathSegments,
        templatesByRenderSiteId,
        childRenderSitesByParentRenderSiteId,
        elements,
        elementsById,
        elementIdCounts,
        renderPaths,
        rootElementIds,
      });
    }

    renderRegions.push({
      id: renderRegionId({
        regionKind: "component-root",
        key: componentNode.componentKey,
      }),
      regionKind: "component-root",
      boundaryId,
      componentNodeId: componentNode.id,
      renderPathId: boundaryRenderPath.id,
      sourceLocation: declarationLocation,
      placementConditionIds: [],
      childElementIds: uniqueSorted(rootElementIds),
      childBoundaryIds: [],
    });
  }

  const expressionIdBySiteNodeId =
    input.symbolicEvaluation.evaluatedExpressions.indexes.classExpressionIdBySiteNodeId;
  const expressionById = input.symbolicEvaluation.evaluatedExpressions.indexes.classExpressionById;
  const elementIdsByTemplateNodeId = buildElementIdsByTemplateNodeId(elements);
  const elementIdsByRenderSiteNodeId = buildElementIdsByRenderSiteNodeId(elements);
  const renderPathById = new Map(renderPaths.map((path) => [path.id, path] as const));
  const classSites = [...input.graph.nodes.classExpressionSites].sort(
    (left, right) =>
      compareAnchors(left.location, right.location) || left.id.localeCompare(right.id),
  );

  for (const classSite of classSites) {
    const expressionId = expressionIdBySiteNodeId.get(classSite.id);
    if (!expressionId) {
      diagnostics.push(
        buildDiagnostic({
          code: "missing-symbolic-class-expression",
          message: "class expression site has no symbolic evaluation expression",
          classSite,
        }),
      );
      continue;
    }

    const expression = expressionById.get(expressionId);
    if (!expression) {
      diagnostics.push(
        buildDiagnostic({
          code: "missing-symbolic-class-expression",
          message: "symbolic evaluation expression could not be resolved by id",
          classSite,
          evaluatedExpressionId: expressionId,
        }),
      );
      continue;
    }

    const element = resolveEmittedElement({
      expression,
      classSite,
      elementIdsByTemplateNodeId,
      elementIdsByRenderSiteNodeId,
      elementsById,
    });
    const boundaryId =
      element?.parentBoundaryId ??
      resolveBoundaryIdForClassSite(classSite, rootBoundaryIdByComponentNodeId);

    if (!boundaryId) {
      diagnostics.push(
        buildDiagnostic({
          code: "unmodeled-class-expression-site",
          message:
            "class expression site could not be mapped to an emitted element or component boundary",
          classSite,
          evaluatedExpressionId: expression.id,
        }),
      );
      continue;
    }

    const basePath = element
      ? renderPathById.get(element.renderPathId)
      : findBoundaryRenderPath(boundaryId, renderPaths);
    if (!basePath) {
      diagnostics.push(
        buildDiagnostic({
          code: "dangling-render-model-reference",
          message: "class expression site resolved to a missing render path",
          classSite,
          evaluatedExpressionId: expression.id,
          boundaryId,
          ...(element ? { elementId: element.id } : {}),
        }),
      );
      continue;
    }

    const siteKey = `${classSite.id}:${element?.id ?? boundaryId}`;
    const emissionId = createEmissionSiteId({
      classExpressionId: expression.id,
      key: siteKey,
      counts: emissionIdCounts,
    });
    const emissionPathId = renderPathId({ terminalKind: "emission-site", terminalId: emissionId });
    const emittedByComponentNodeId =
      expression.emittingComponentNodeId ?? classSite.emittingComponentNodeId;
    const placementComponentNodeId =
      expression.placementComponentNodeId ?? classSite.placementComponentNodeId;
    const tokenProvenance = buildTokenProvenanceFromExpressionTokens({
      expression,
      emittedByComponentNodeId,
    });
    const unsupported = [...expression.unsupported].sort((left, right) =>
      left.id.localeCompare(right.id),
    );
    const confidence =
      unsupported.length > 0 || expression.certainty.kind !== "exact" ? "medium" : "high";

    const emissionSite: EmissionSite = {
      id: emissionId,
      emissionKind: "rendered-element-class",
      ...(element ? { elementId: element.id } : {}),
      boundaryId,
      classExpressionId: expression.id,
      classExpressionSiteNodeId: expression.classExpressionSiteNodeId,
      sourceExpressionIds: [expression.id],
      sourceLocation: normalizeAnchor(expression.location),
      ...(element ? { emittedElementLocation: normalizeAnchor(element.sourceLocation) } : {}),
      ...(emittedByComponentNodeId ? { emittingComponentNodeId: emittedByComponentNodeId } : {}),
      ...(placementComponentNodeId ? { placementComponentNodeId } : {}),
      tokenProvenance,
      tokens: [...expression.tokens].sort(compareTokens),
      emissionVariants: [...expression.emissionVariants].sort((left, right) =>
        left.id.localeCompare(right.id),
      ),
      externalContributions: [...expression.externalContributions].sort((left, right) =>
        left.id.localeCompare(right.id),
      ),
      cssModuleContributions: [...expression.cssModuleContributions].sort((left, right) =>
        left.id.localeCompare(right.id),
      ),
      unsupported,
      confidence,
      renderPathId: emissionPathId,
      placementConditionIds: [],
      traces: [...expression.traces],
    };

    emissionSites.push(emissionSite);
    if (element) {
      element.emissionSiteIds = uniqueSorted([...element.emissionSiteIds, emissionSite.id]);
    }
    renderPaths.push({
      id: emissionPathId,
      rootComponentNodeId: basePath.rootComponentNodeId,
      terminalKind: "emission-site",
      terminalId: emissionSite.id,
      segments: [...basePath.segments],
      placementConditionIds: [],
      certainty: basePath.certainty,
      traces: [...expression.traces],
    });
  }

  return {
    components,
    componentBoundaries,
    elements: elements.sort((left, right) => left.id.localeCompare(right.id)),
    emissionSites: emissionSites.sort((left, right) => left.id.localeCompare(right.id)),
    renderPaths: renderPaths.sort((left, right) => left.id.localeCompare(right.id)),
    placementConditions: [],
    renderRegions,
    renderGraph: {
      nodes: components
        .map((component) => ({
          componentNodeId: component.componentNodeId,
          componentKey: component.componentKey,
          componentName: component.componentName,
          filePath: component.filePath,
          exported: component.exported,
          sourceLocation: component.declarationLocation,
        }))
        .sort(
          (left, right) =>
            [
              left.filePath.localeCompare(right.filePath),
              left.componentKey.localeCompare(right.componentKey),
              left.componentName.localeCompare(right.componentName),
              compareAnchors(left.sourceLocation, right.sourceLocation),
            ].find((value) => value !== 0) ?? 0,
        ),
      edges: [],
    },
    diagnostics: diagnostics.sort(
      (left, right) =>
        left.code.localeCompare(right.code) ||
        (left.filePath ?? "").localeCompare(right.filePath ?? "") ||
        left.message.localeCompare(right.message),
    ),
  };
}

function expandIntrinsicElementsForRenderSite(input: {
  input: RenderStructureInput;
  componentNodeId: string;
  boundaryId: string;
  renderSite: RenderStructureInput["graph"]["nodes"]["renderSites"][number];
  childIndex: number;
  parentElementId: string | undefined;
  basePathSegments: RenderPathSegment[];
  templatesByRenderSiteId: Map<string, RenderStructureInput["graph"]["nodes"]["elementTemplates"]>;
  childRenderSitesByParentRenderSiteId: Map<string, string[]>;
  elements: RenderedElement[];
  elementsById: Map<string, RenderedElement>;
  elementIdCounts: Map<string, number>;
  renderPaths: RenderPath[];
  rootElementIds: string[];
}): void {
  const templates = input.templatesByRenderSiteId.get(input.renderSite.id) ?? [];
  const childRenderSiteIds =
    input.childRenderSitesByParentRenderSiteId.get(input.renderSite.id) ?? [];

  const intrinsicTemplates = templates.filter((template) => template.templateKind === "intrinsic");
  if (intrinsicTemplates.length > 0) {
    for (const [templateIndex, template] of intrinsicTemplates.entries()) {
      const location = normalizeAnchor(template.location);
      const id = createRenderedElementId({
        boundaryId: input.boundaryId,
        templateNodeId: template.id,
        tagName: template.name,
        counts: input.elementIdCounts,
      });
      const pathSegments: RenderPathSegment[] = [
        ...input.basePathSegments,
        { kind: "child-index", index: input.childIndex },
        { kind: "element", elementId: id, tagName: template.name, location },
      ];
      const pathId = renderPathId({
        terminalKind: "element",
        terminalId: id,
      });
      const element: RenderedElement = {
        id,
        tagName: template.name,
        elementTemplateNodeId: template.id,
        renderSiteNodeId: input.renderSite.id,
        sourceLocation: location,
        ...(input.parentElementId ? { parentElementId: input.parentElementId } : {}),
        parentBoundaryId: input.boundaryId,
        childElementIds: [],
        childBoundaryIds: [],
        emissionSiteIds: [],
        ...(template.emittingComponentNodeId
          ? { emittingComponentNodeId: template.emittingComponentNodeId }
          : input.renderSite.emittingComponentNodeId
            ? { emittingComponentNodeId: input.renderSite.emittingComponentNodeId }
            : {}),
        ...(template.placementComponentNodeId
          ? { placementComponentNodeId: template.placementComponentNodeId }
          : input.renderSite.placementComponentNodeId
            ? { placementComponentNodeId: input.renderSite.placementComponentNodeId }
            : {}),
        renderPathId: pathId,
        placementConditionIds: [],
        certainty: "definite",
        traces: [],
      };
      input.elements.push(element);
      input.elementsById.set(element.id, element);
      input.renderPaths.push({
        id: pathId,
        rootComponentNodeId: input.componentNodeId,
        terminalKind: "element",
        terminalId: id,
        segments: pathSegments,
        placementConditionIds: [],
        certainty: "definite",
        traces: [],
      });

      if (input.parentElementId) {
        const parentElement = input.elementsById.get(input.parentElementId);
        if (parentElement) {
          parentElement.childElementIds = uniqueSorted([
            ...parentElement.childElementIds,
            element.id,
          ]);
        }
      } else {
        input.rootElementIds.push(element.id);
      }

      for (const [childIndex, childRenderSiteId] of childRenderSiteIds.entries()) {
        const childRenderSite = input.input.graph.indexes.nodesById.get(childRenderSiteId);
        if (!childRenderSite || childRenderSite.kind !== "render-site") {
          continue;
        }
        expandIntrinsicElementsForRenderSite({
          ...input,
          renderSite: childRenderSite,
          childIndex,
          parentElementId: element.id,
          basePathSegments: pathSegments,
        });
      }

      // Multiple intrinsic templates for one render site are uncommon; preserve deterministic traversal.
      if (templateIndex < intrinsicTemplates.length - 1) {
        continue;
      }
    }
    return;
  }

  // Fragments and non-element render sites pass through and continue expansion for child sites.
  for (const [childIndex, childRenderSiteId] of childRenderSiteIds.entries()) {
    const childRenderSite = input.input.graph.indexes.nodesById.get(childRenderSiteId);
    if (!childRenderSite || childRenderSite.kind !== "render-site") {
      continue;
    }
    expandIntrinsicElementsForRenderSite({
      ...input,
      renderSite: childRenderSite,
      childIndex,
    });
  }
}

function buildTemplatesByRenderSiteId(
  input: RenderStructureInput,
): Map<string, RenderStructureInput["graph"]["nodes"]["elementTemplates"]> {
  const templatesByRenderSiteId = new Map<
    string,
    RenderStructureInput["graph"]["nodes"]["elementTemplates"]
  >();
  for (const template of input.graph.nodes.elementTemplates) {
    const existing = templatesByRenderSiteId.get(template.renderSiteNodeId) ?? [];
    existing.push(template);
    templatesByRenderSiteId.set(template.renderSiteNodeId, existing);
  }
  for (const [renderSiteId, templates] of templatesByRenderSiteId.entries()) {
    templatesByRenderSiteId.set(
      renderSiteId,
      [...templates].sort(
        (left, right) =>
          compareAnchors(left.location, right.location) ||
          left.templateKind.localeCompare(right.templateKind) ||
          left.id.localeCompare(right.id),
      ),
    );
  }
  return templatesByRenderSiteId;
}

function buildChildRenderSitesByParentRenderSiteId(
  input: RenderStructureInput,
): Map<string, string[]> {
  const result = new Map<string, string[]>();
  for (const site of input.graph.nodes.renderSites) {
    if (!site.parentRenderSiteNodeId) {
      continue;
    }
    const existing = result.get(site.parentRenderSiteNodeId) ?? [];
    existing.push(site.id);
    result.set(site.parentRenderSiteNodeId, existing);
  }
  for (const [parentId, childIds] of result.entries()) {
    result.set(
      parentId,
      [...childIds].sort((leftId, rightId) => {
        const left = input.graph.indexes.nodesById.get(leftId);
        const right = input.graph.indexes.nodesById.get(rightId);
        if (!left || left.kind !== "render-site" || !right || right.kind !== "render-site") {
          return leftId.localeCompare(rightId);
        }
        return (
          compareAnchors(left.location, right.location) ||
          left.renderSiteKind.localeCompare(right.renderSiteKind) ||
          left.id.localeCompare(right.id)
        );
      }),
    );
  }
  return result;
}

function buildRootRenderSitesByComponentNodeId(input: RenderStructureInput): Map<string, string[]> {
  const result = new Map<string, string[]>();
  for (const site of input.graph.nodes.renderSites) {
    if (
      site.renderSiteKind !== "component-root" ||
      !site.emittingComponentNodeId ||
      site.parentRenderSiteNodeId
    ) {
      continue;
    }
    const existing = result.get(site.emittingComponentNodeId) ?? [];
    existing.push(site.id);
    result.set(site.emittingComponentNodeId, existing);
  }
  for (const [componentNodeId, rootSiteIds] of result.entries()) {
    result.set(
      componentNodeId,
      [...rootSiteIds].sort((leftId, rightId) => {
        const left = input.graph.indexes.nodesById.get(leftId);
        const right = input.graph.indexes.nodesById.get(rightId);
        if (!left || left.kind !== "render-site" || !right || right.kind !== "render-site") {
          return leftId.localeCompare(rightId);
        }
        return compareAnchors(left.location, right.location) || left.id.localeCompare(right.id);
      }),
    );
  }
  return result;
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
    key: key,
    tagName: input.tagName,
    index,
  });
}

function createEmissionSiteId(input: {
  classExpressionId: string;
  key: string;
  counts: Map<string, number>;
}): string {
  const countKey = `${input.classExpressionId}:${input.key}`;
  const index = input.counts.get(countKey) ?? 0;
  input.counts.set(countKey, index + 1);
  return emissionSiteId({
    classExpressionId: input.classExpressionId,
    key: input.key,
    index,
  });
}

function buildElementIdsByTemplateNodeId(elements: RenderedElement[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const element of elements) {
    if (!element.elementTemplateNodeId) {
      continue;
    }
    const existing = map.get(element.elementTemplateNodeId) ?? [];
    existing.push(element.id);
    map.set(element.elementTemplateNodeId, existing);
  }
  return map;
}

function buildElementIdsByRenderSiteNodeId(elements: RenderedElement[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const element of elements) {
    if (!element.renderSiteNodeId) {
      continue;
    }
    const existing = map.get(element.renderSiteNodeId) ?? [];
    existing.push(element.id);
    map.set(element.renderSiteNodeId, existing);
  }
  return map;
}

function resolveEmittedElement(input: {
  expression: RenderStructureInput["symbolicEvaluation"]["evaluatedExpressions"]["classExpressions"][number];
  classSite: RenderStructureInput["graph"]["nodes"]["classExpressionSites"][number];
  elementIdsByTemplateNodeId: Map<string, string[]>;
  elementIdsByRenderSiteNodeId: Map<string, string[]>;
  elementsById: Map<string, RenderedElement>;
}): RenderedElement | undefined {
  const byTemplate =
    input.expression.elementTemplateNodeId ?? input.classSite.elementTemplateNodeId;
  if (byTemplate) {
    const id = input.elementIdsByTemplateNodeId.get(byTemplate)?.[0];
    if (id) {
      return input.elementsById.get(id);
    }
  }

  const byRenderSite = input.expression.renderSiteNodeId ?? input.classSite.renderSiteNodeId;
  if (byRenderSite) {
    const id = input.elementIdsByRenderSiteNodeId.get(byRenderSite)?.[0];
    if (id) {
      return input.elementsById.get(id);
    }
  }

  return undefined;
}

function resolveBoundaryIdForClassSite(
  classSite: RenderStructureInput["graph"]["nodes"]["classExpressionSites"][number],
  rootBoundaryIdByComponentNodeId: Map<string, string>,
): string | undefined {
  return classSite.emittingComponentNodeId
    ? rootBoundaryIdByComponentNodeId.get(classSite.emittingComponentNodeId)
    : undefined;
}

function findBoundaryRenderPath(
  boundaryId: string,
  renderPaths: RenderPath[],
): RenderPath | undefined {
  return renderPaths.find(
    (path) => path.terminalKind === "component-boundary" && path.terminalId === boundaryId,
  );
}

function buildTokenProvenanceFromExpressionTokens(input: {
  expression: RenderStructureInput["symbolicEvaluation"]["evaluatedExpressions"]["classExpressions"][number];
  emittedByComponentNodeId?: string;
}): EmissionTokenProvenance[] {
  return [...input.expression.tokens].sort(compareTokens).map((token) => ({
    token: token.token,
    tokenKind: token.tokenKind,
    presence: token.presence,
    sourceExpressionId: input.expression.id,
    sourceClassExpressionSiteNodeId: input.expression.classExpressionSiteNodeId,
    ...(token.sourceAnchor ? { sourceLocation: normalizeAnchor(token.sourceAnchor) } : {}),
    ...(input.emittedByComponentNodeId
      ? { emittedByComponentNodeId: input.emittedByComponentNodeId }
      : {}),
    conditionId: token.conditionId,
    confidence: token.confidence,
  }));
}

function compareTokens(
  left: RenderStructureInput["symbolicEvaluation"]["evaluatedExpressions"]["classExpressions"][number]["tokens"][number],
  right: RenderStructureInput["symbolicEvaluation"]["evaluatedExpressions"]["classExpressions"][number]["tokens"][number],
): number {
  return (
    left.token.localeCompare(right.token) ||
    left.tokenKind.localeCompare(right.tokenKind) ||
    left.presence.localeCompare(right.presence) ||
    left.id.localeCompare(right.id)
  );
}

function buildDiagnostic(input: {
  code: RenderStructureDiagnostic["code"];
  message: string;
  classSite: RenderStructureInput["graph"]["nodes"]["classExpressionSites"][number];
  evaluatedExpressionId?: string;
  boundaryId?: string;
  elementId?: string;
}): RenderStructureDiagnostic {
  const location = normalizeAnchor(input.classSite.location);
  return {
    stage: "render-structure",
    severity: "warning",
    code: input.code,
    message: input.message,
    filePath: normalizeProjectPath(input.classSite.filePath),
    location,
    classExpressionSiteNodeId: input.classSite.id,
    ...(input.evaluatedExpressionId ? { evaluatedExpressionId: input.evaluatedExpressionId } : {}),
    ...(input.boundaryId ? { boundaryId: input.boundaryId } : {}),
    ...(input.elementId ? { elementId: input.elementId } : {}),
    provenance: [
      {
        stage: "render-structure",
        filePath: normalizeProjectPath(input.classSite.filePath),
        anchor: location,
        upstreamId: input.classSite.id,
        summary: input.message,
      },
    ],
    traces: [],
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

function compareAnchors(
  left: RenderStructureInput["graph"]["nodes"]["components"][number]["location"],
  right: RenderStructureInput["graph"]["nodes"]["components"][number]["location"],
): number {
  return (
    normalizeProjectPath(left.filePath).localeCompare(normalizeProjectPath(right.filePath)) ||
    left.startLine - right.startLine ||
    left.startColumn - right.startColumn ||
    (left.endLine ?? 0) - (right.endLine ?? 0) ||
    (left.endColumn ?? 0) - (right.endColumn ?? 0)
  );
}

function normalizeAnchor(
  anchor: RenderStructureInput["graph"]["nodes"]["components"][number]["location"],
): RenderStructureInput["graph"]["nodes"]["components"][number]["location"] {
  return {
    ...anchor,
    filePath: normalizeProjectPath(anchor.filePath),
  };
}

function normalizeProjectPath(filePath: string): string {
  return filePath.replace(/\\/g, "/");
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}
