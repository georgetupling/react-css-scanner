import { graphToReactRenderSyntaxInputs } from "../../fact-graph/index.js";
import { buildLegacyRenderArtifacts } from "../../render-model/buildLegacyRenderArtifacts.js";
import { conditionId, tokenAlternativeId } from "../../symbolic-evaluation/ids.js";
import { tokenizeClassNames } from "../../symbolic-evaluation/class-values/classValueOperations.js";
import {
  emissionSiteId,
  placementConditionId,
  renderedComponentBoundaryId,
  renderedComponentId,
  renderedElementId,
  renderPathId,
  renderRegionId,
} from "../ids.js";
import type {
  RenderComponentReferenceNode,
  RenderElementNode,
  RenderNode,
  RenderSubtree,
} from "../../render-model/render-ir/index.js";
import type { RenderModelClassExpressionSummaryRecord } from "../../render-model/render-ir/class-expressions/classExpressionSummaries.js";
import type {
  RenderCertainty,
  EmissionSite,
  EmissionTokenProvenance,
  PlacementCondition,
  RenderGraphProjection,
  RenderGraphProjectionEdge,
  RenderGraphProjectionNode,
  RenderPath,
  RenderPathSegment,
  RenderRegion,
  RenderStructureDiagnostic,
  RenderStructureInput,
  RenderedComponent,
  RenderedComponentBoundary,
  RenderedElement,
} from "../types.js";
import type { ClassExpressionSummary } from "../../symbolic-evaluation/class-values/types.js";
import type {
  CanonicalClassExpression,
  TokenAlternative,
} from "../../symbolic-evaluation/types.js";
import type { SourceAnchor } from "../../../types/core.js";

type ProjectionAccumulator = {
  componentBoundaries: RenderedComponentBoundary[];
  elements: RenderedElement[];
  emissionSites: EmissionSite[];
  renderPaths: RenderPath[];
  placementConditions: PlacementCondition[];
  renderRegions: RenderRegion[];
  boundaryById: Map<string, RenderedComponentBoundary>;
  elementById: Map<string, RenderedElement>;
  placementConditionById: Map<string, PlacementCondition>;
  renderRegionById: Map<string, RenderRegion>;
  rootBoundaryIdByComponentKey: Map<string, string>;
  rootBoundaryIdBySubtreeKey: Map<string, string>;
  componentNodeIdByComponentKey: Map<string, string>;
  legacyClassSummaryRecordBySummary: Map<
    ClassExpressionSummary,
    RenderModelClassExpressionSummaryRecord
  >;
  symbolicExpressions: SymbolicExpressionLookup;
};

type TraversalContext = {
  rootComponentNodeId?: string;
  emittingComponentNodeId?: string;
  externalSupplierComponentNodeId?: string;
  placementComponentNodeId?: string;
  boundaryId: string;
  parentElementId?: string;
  pathSegments: RenderPathSegment[];
  placementConditionIds: string[];
  certainty: RenderCertainty;
};

type SymbolicExpressionLookup = {
  all: CanonicalClassExpression[];
  byId: Map<string, CanonicalClassExpression>;
  bySiteNodeId: Map<string, CanonicalClassExpression>;
  byExpressionNodeId: Map<string, CanonicalClassExpression[]>;
  byAnchor: Map<string, CanonicalClassExpression[]>;
  siteNodeIdByAnchor: Map<string, string>;
  expressionNodeIdBySiteNodeId: Map<string, string>;
};

export function projectLegacyRenderModel(input: RenderStructureInput): {
  components: RenderedComponent[];
  componentBoundaries: RenderedComponentBoundary[];
  elements: RenderedElement[];
  emissionSites: EmissionSite[];
  renderPaths: RenderPath[];
  placementConditions: PlacementCondition[];
  renderRegions: RenderRegion[];
  renderGraph: RenderGraphProjection;
  diagnostics: RenderStructureDiagnostic[];
} {
  if (!input.legacy) {
    return emptyProjection();
  }

  const legacyModel = buildLegacyRenderArtifacts({
    parsedFiles: input.legacy.parsedFiles,
    reactRenderSyntax: graphToReactRenderSyntaxInputs(input.graph),
    symbolResolution: input.legacy.symbolResolution,
    moduleFacts: input.legacy.moduleFacts,
    includeTraces: input.options?.includeTraces,
  });
  const accumulator: ProjectionAccumulator = {
    componentBoundaries: [],
    elements: [],
    emissionSites: [],
    renderPaths: [],
    placementConditions: [],
    renderRegions: [],
    boundaryById: new Map(),
    elementById: new Map(),
    placementConditionById: new Map(),
    renderRegionById: new Map(),
    rootBoundaryIdByComponentKey: new Map(),
    rootBoundaryIdBySubtreeKey: new Map(),
    componentNodeIdByComponentKey: input.graph.indexes.componentNodeIdByComponentKey,
    legacyClassSummaryRecordBySummary: new Map(
      legacyModel.classExpressionSummaries.map((record) => [record.summary, record]),
    ),
    symbolicExpressions: buildSymbolicExpressionLookup(input),
  };

  for (const [index, subtree] of legacyModel.renderSubtrees.entries()) {
    projectSubtree({
      graph: input.graph,
      subtree,
      subtreeIndex: index,
      accumulator,
    });
  }

  const sortedBoundaries = sortById(accumulator.componentBoundaries);
  const sortedElements = sortById(accumulator.elements);
  const sortedPlacementConditions = sortById(accumulator.placementConditions);
  const components = projectComponentsFromBoundaries({
    graph: input.graph,
    boundaries: sortedBoundaries,
  });
  const renderGraph = projectRenderGraphFromBoundaries({
    components,
    boundaries: sortedBoundaries,
  });
  const renderRegions = projectRenderRegionsFromBoundariesAndPaths({
    boundaries: sortedBoundaries,
    elements: sortedElements,
    placementConditions: sortedPlacementConditions,
  });
  for (const region of renderRegions) {
    addRenderRegion(accumulator, region);
  }

  return {
    components,
    componentBoundaries: sortedBoundaries,
    elements: sortedElements,
    emissionSites: sortById(accumulator.emissionSites),
    renderPaths: sortById(accumulator.renderPaths),
    placementConditions: sortedPlacementConditions,
    renderRegions: sortById(accumulator.renderRegions),
    renderGraph,
    diagnostics: [],
  };
}

function emptyProjection(): ReturnType<typeof projectLegacyRenderModel> {
  return {
    components: [],
    componentBoundaries: [],
    elements: [],
    emissionSites: [],
    renderPaths: [],
    placementConditions: [],
    renderRegions: [],
    renderGraph: { nodes: [], edges: [] },
    diagnostics: [],
  };
}

function projectSubtree(input: {
  graph: RenderStructureInput["graph"];
  subtree: RenderSubtree;
  subtreeIndex: number;
  accumulator: ProjectionAccumulator;
}): void {
  const componentNodeId = input.subtree.componentKey
    ? input.graph.indexes.componentNodeIdByComponentKey.get(input.subtree.componentKey)
    : undefined;
  const subtreeKey = createSubtreeKey(input.subtree, input.subtreeIndex);
  const rootBoundaryId = renderedComponentBoundaryId({
    boundaryKind: "component-root",
    key: input.subtree.componentKey ?? subtreeKey,
  });
  const rootPath = createRenderPath({
    id: renderPathId({
      terminalKind: "component-boundary",
      terminalId: rootBoundaryId,
    }),
    rootComponentNodeId: componentNodeId,
    terminalKind: "component-boundary",
    terminalId: rootBoundaryId,
    segments: [
      {
        kind: "component-root",
        ...(componentNodeId ? { componentNodeId } : {}),
        location: normalizeAnchor(input.subtree.sourceAnchor),
      },
    ],
    certainty: "definite",
  });
  const boundary: RenderedComponentBoundary = {
    id: rootBoundaryId,
    boundaryKind: "component-root",
    ...(componentNodeId ? { componentNodeId } : {}),
    ...(input.subtree.componentKey ? { componentKey: input.subtree.componentKey } : {}),
    ...(input.subtree.componentName ? { componentName: input.subtree.componentName } : {}),
    filePath: normalizeProjectPath(input.subtree.sourceAnchor.filePath),
    declarationLocation: normalizeAnchor(input.subtree.sourceAnchor),
    childBoundaryIds: [],
    rootElementIds: [],
    renderPathId: rootPath.id,
    placementConditionIds: [],
    expansion: { status: "root" },
    traces: [],
  };

  input.accumulator.rootBoundaryIdBySubtreeKey.set(subtreeKey, rootBoundaryId);
  if (input.subtree.componentKey) {
    input.accumulator.rootBoundaryIdByComponentKey.set(input.subtree.componentKey, rootBoundaryId);
  }
  addBoundary(input.accumulator, boundary);
  addRenderPath(input.accumulator, rootPath);
  projectNode({
    node: input.subtree.root,
    accumulator: input.accumulator,
    context: {
      rootComponentNodeId: componentNodeId,
      emittingComponentNodeId: componentNodeId,
      placementComponentNodeId: componentNodeId,
      boundaryId: rootBoundaryId,
      pathSegments: rootPath.segments,
      placementConditionIds: [],
      certainty: "definite",
    },
  });
}

function projectNode(input: {
  node: RenderNode;
  accumulator: ProjectionAccumulator;
  context: TraversalContext;
}): string[] {
  projectStaticallySkippedBranches(input);

  if (input.node.expandedFromComponentReference) {
    return projectExpandedComponentBoundary(input);
  }

  if (input.node.kind === "component-reference") {
    projectUnresolvedComponentBoundary({
      node: input.node,
      accumulator: input.accumulator,
      context: input.context,
    });
    return [];
  }

  if (input.node.kind === "element") {
    return projectElement({
      node: input.node,
      accumulator: input.accumulator,
      context: input.context,
    });
  }

  if (input.node.kind === "fragment") {
    const rootElementIds: string[] = [];
    input.node.children.forEach((child, childIndex) => {
      rootElementIds.push(
        ...projectNode({
          node: child,
          accumulator: input.accumulator,
          context: {
            ...input.context,
            pathSegments: [
              ...input.context.pathSegments,
              { kind: "child-index", index: childIndex },
            ],
          },
        }),
      );
    });
    return rootElementIds;
  }

  if (input.node.kind === "conditional") {
    const trueBranchConditionId = addPlacementCondition(input.accumulator, {
      id: placementConditionId({
        conditionKind: "conditional-branch",
        key: `${input.context.boundaryId}:when-true:${input.node.conditionSourceText}:${anchorKey(input.node.sourceAnchor)}`,
      }),
      kind: "conditional-branch",
      sourceText: input.node.conditionSourceText,
      sourceLocation: normalizeAnchor(input.node.sourceAnchor),
      branch: "when-true",
      certainty: downgradeCertainty(input.context.certainty),
      confidence: "medium",
      traces: input.node.traces ?? [],
    });
    const falseBranchConditionId = addPlacementCondition(input.accumulator, {
      id: placementConditionId({
        conditionKind: "conditional-branch",
        key: `${input.context.boundaryId}:when-false:${input.node.conditionSourceText}:${anchorKey(input.node.sourceAnchor)}`,
      }),
      kind: "conditional-branch",
      sourceText: input.node.conditionSourceText,
      sourceLocation: normalizeAnchor(input.node.sourceAnchor),
      branch: "when-false",
      certainty: downgradeCertainty(input.context.certainty),
      confidence: "medium",
      traces: input.node.traces ?? [],
    });
    return [
      ...projectNode({
        node: input.node.whenTrue,
        accumulator: input.accumulator,
        context: {
          ...input.context,
          certainty: downgradeCertainty(input.context.certainty),
          placementConditionIds: uniqueSorted([
            ...input.context.placementConditionIds,
            trueBranchConditionId,
          ]),
          pathSegments: [
            ...input.context.pathSegments,
            {
              kind: "conditional-branch",
              branch: "when-true",
              conditionId: trueBranchConditionId,
            },
          ],
        },
      }),
      ...projectNode({
        node: input.node.whenFalse,
        accumulator: input.accumulator,
        context: {
          ...input.context,
          certainty: downgradeCertainty(input.context.certainty),
          placementConditionIds: uniqueSorted([
            ...input.context.placementConditionIds,
            falseBranchConditionId,
          ]),
          pathSegments: [
            ...input.context.pathSegments,
            {
              kind: "conditional-branch",
              branch: "when-false",
              conditionId: falseBranchConditionId,
            },
          ],
        },
      }),
    ];
  }

  if (input.node.kind === "repeated-region") {
    const repeatedConditionId = addPlacementCondition(input.accumulator, {
      id: placementConditionId({
        conditionKind: "repeated-region",
        key: `${input.context.boundaryId}:${input.node.reason}:${anchorKey(input.node.sourceAnchor)}`,
      }),
      kind: "repeated-region",
      reason: input.node.reason,
      sourceLocation: normalizeAnchor(input.node.sourceAnchor),
      certainty: downgradeCertainty(input.context.certainty),
      confidence: "medium",
      traces: input.node.traces ?? [],
    });
    return projectNode({
      node: input.node.template,
      accumulator: input.accumulator,
      context: {
        ...input.context,
        certainty: downgradeCertainty(input.context.certainty),
        placementConditionIds: uniqueSorted([
          ...input.context.placementConditionIds,
          repeatedConditionId,
        ]),
        pathSegments: [
          ...input.context.pathSegments,
          {
            kind: "repeated-template",
            conditionId: repeatedConditionId,
          },
        ],
      },
    });
  }

  if (input.node.kind === "unknown") {
    const unknownConditionId = addPlacementCondition(input.accumulator, {
      id: placementConditionId({
        conditionKind: "unknown-barrier",
        key: `${input.context.boundaryId}:${input.node.reason}:${anchorKey(input.node.sourceAnchor)}`,
      }),
      kind: "unknown-barrier",
      reason: input.node.reason,
      sourceLocation: normalizeAnchor(input.node.sourceAnchor),
      certainty: "unknown",
      confidence: "low",
      traces: input.node.traces ?? [],
    });
    const pathSegments = [
      ...input.context.pathSegments,
      {
        kind: "unknown-barrier" as const,
        reason: input.node.reason,
        location: normalizeAnchor(input.node.sourceAnchor),
      },
    ];
    const pathId = renderPathId({
      terminalKind: "unknown-region",
      terminalId: `${input.context.boundaryId}:${anchorKey(input.node.sourceAnchor)}:${input.node.reason}`,
    });
    addRenderPath(
      input.accumulator,
      createRenderPath({
        id: pathId,
        rootComponentNodeId: input.context.rootComponentNodeId,
        terminalKind: "unknown-region",
        terminalId: `${input.context.boundaryId}:${anchorKey(input.node.sourceAnchor)}:${input.node.reason}`,
        segments: pathSegments,
        placementConditionIds: uniqueSorted([
          ...input.context.placementConditionIds,
          unknownConditionId,
        ]),
        certainty: "unknown",
        traces: input.node.traces ?? [],
      }),
    );
    addRenderRegion(input.accumulator, {
      id: renderRegionId({
        regionKind: "unknown-barrier",
        key: `${input.context.boundaryId}:${input.node.reason}:${anchorKey(input.node.sourceAnchor)}:${serializeRenderPathSegments(pathSegments)}`,
      }),
      regionKind: "unknown-barrier",
      boundaryId: input.context.boundaryId,
      ...(input.context.rootComponentNodeId
        ? { componentNodeId: input.context.rootComponentNodeId }
        : {}),
      renderPathId: pathId,
      sourceLocation: normalizeAnchor(input.node.sourceAnchor),
      placementConditionIds: uniqueSorted([
        ...input.context.placementConditionIds,
        unknownConditionId,
      ]),
      childElementIds: [],
      childBoundaryIds: [],
    });
    return [];
  }

  return [];
}

function projectStaticallySkippedBranches(input: {
  node: RenderNode;
  accumulator: ProjectionAccumulator;
  context: TraversalContext;
}): void {
  for (const skippedBranch of input.node.staticallySkippedBranches ?? []) {
    addPlacementCondition(input.accumulator, {
      id: placementConditionId({
        conditionKind: "statically-skipped-branch",
        key: `${input.context.boundaryId}:${skippedBranch.skippedBranch}:${skippedBranch.reason}:${skippedBranch.conditionSourceText}:${anchorKey(skippedBranch.sourceAnchor)}`,
      }),
      kind: "statically-skipped-branch",
      sourceText: skippedBranch.conditionSourceText,
      sourceLocation: normalizeAnchor(skippedBranch.sourceAnchor),
      branch: skippedBranch.skippedBranch,
      reason: skippedBranch.reason,
      certainty: "definite",
      confidence: "high",
      traces: [],
    });
  }
}

function projectExpandedComponentBoundary(input: {
  node: RenderNode;
  accumulator: ProjectionAccumulator;
  context: TraversalContext;
}): string[] {
  const expansion = input.node.expandedFromComponentReference;
  if (!expansion) {
    return projectNode(input);
  }

  const boundaryId = renderedComponentBoundaryId({
    boundaryKind: "expanded-component-reference",
    key: `${expansion.componentKey}:${anchorKey(expansion.sourceAnchor)}`,
  });
  const expandedComponentNodeId = input.accumulator.componentNodeIdByComponentKey.get(
    expansion.componentKey,
  );
  const pathSegments: RenderPathSegment[] = [
    ...input.context.pathSegments,
    {
      kind: "component-reference",
      location: normalizeAnchor(expansion.sourceAnchor),
    },
  ];
  const path = createRenderPath({
    id: renderPathId({
      terminalKind: "component-boundary",
      terminalId: boundaryId,
    }),
    rootComponentNodeId: input.context.rootComponentNodeId,
    terminalKind: "component-boundary",
    terminalId: boundaryId,
    segments: pathSegments,
    placementConditionIds: input.context.placementConditionIds,
    certainty: input.context.certainty,
    traces: expansion.traces,
  });
  const boundary: RenderedComponentBoundary = {
    id: boundaryId,
    boundaryKind: "expanded-component-reference",
    ...(expandedComponentNodeId ? { componentNodeId: expandedComponentNodeId } : {}),
    componentKey: expansion.componentKey,
    componentName: expansion.componentName,
    filePath: normalizeProjectPath(expansion.filePath),
    declarationLocation: normalizeAnchor(expansion.targetSourceAnchor),
    referenceLocation: normalizeAnchor(expansion.sourceAnchor),
    parentBoundaryId: input.context.boundaryId,
    ...(input.context.parentElementId ? { parentElementId: input.context.parentElementId } : {}),
    childBoundaryIds: [],
    rootElementIds: [],
    renderPathId: path.id,
    placementConditionIds: input.context.placementConditionIds,
    expansion: { status: "expanded", reason: "legacy-render-model-expansion" },
    traces: expansion.traces,
  };

  addBoundary(input.accumulator, boundary);
  addRenderPath(input.accumulator, path);
  linkBoundaryToParent(input.accumulator, boundary);

  const rootElementIds = projectNode({
    node: {
      ...input.node,
      expandedFromComponentReference: undefined,
    } as RenderNode,
    accumulator: input.accumulator,
    context: {
      rootComponentNodeId: input.context.rootComponentNodeId,
      emittingComponentNodeId: expandedComponentNodeId ?? input.context.emittingComponentNodeId,
      externalSupplierComponentNodeId: input.context.emittingComponentNodeId,
      placementComponentNodeId: input.context.rootComponentNodeId,
      boundaryId,
      parentElementId: input.context.parentElementId,
      pathSegments,
      placementConditionIds: input.context.placementConditionIds,
      certainty: input.context.certainty,
    },
  });
  boundary.rootElementIds = uniqueSorted(rootElementIds);
  return rootElementIds;
}

function projectUnresolvedComponentBoundary(input: {
  node: RenderComponentReferenceNode;
  accumulator: ProjectionAccumulator;
  context: TraversalContext;
}): void {
  const unknownConditionId = addPlacementCondition(input.accumulator, {
    id: placementConditionId({
      conditionKind: "unknown-barrier",
      key: `${input.context.boundaryId}:${input.node.reason}:${anchorKey(input.node.sourceAnchor)}`,
    }),
    kind: "unknown-barrier",
    reason: input.node.reason,
    sourceLocation: normalizeAnchor(input.node.sourceAnchor),
    certainty: "unknown",
    confidence: "low",
    traces: input.node.traces ?? [],
  });
  const placementConditionIds = uniqueSorted([
    ...input.context.placementConditionIds,
    unknownConditionId,
  ]);
  const boundaryId = renderedComponentBoundaryId({
    boundaryKind: "unresolved-component-reference",
    key: `${input.node.componentName}:${anchorKey(input.node.sourceAnchor)}`,
  });
  const pathSegments: RenderPathSegment[] = [
    ...input.context.pathSegments,
    {
      kind: "component-reference",
      location: normalizeAnchor(input.node.sourceAnchor),
    },
  ];
  const path = createRenderPath({
    id: renderPathId({
      terminalKind: "component-boundary",
      terminalId: boundaryId,
    }),
    rootComponentNodeId: input.context.rootComponentNodeId,
    terminalKind: "component-boundary",
    terminalId: boundaryId,
    segments: pathSegments,
    placementConditionIds,
    certainty: "unknown",
    traces: input.node.traces ?? [],
  });
  const boundary: RenderedComponentBoundary = {
    id: boundaryId,
    boundaryKind: "unresolved-component-reference",
    ...(input.node.componentKey ? { componentKey: input.node.componentKey } : {}),
    componentName: input.node.componentName,
    referenceLocation: normalizeAnchor(input.node.sourceAnchor),
    parentBoundaryId: input.context.boundaryId,
    ...(input.context.parentElementId ? { parentElementId: input.context.parentElementId } : {}),
    childBoundaryIds: [],
    rootElementIds: [],
    renderPathId: path.id,
    placementConditionIds,
    expansion: { status: "unresolved", reason: input.node.reason },
    traces: input.node.traces ?? [],
  };

  addBoundary(input.accumulator, boundary);
  addRenderPath(input.accumulator, path);
  addRenderRegion(input.accumulator, {
    id: renderRegionId({
      regionKind: "unknown-barrier",
      key: `${boundaryId}:${input.node.reason}:${anchorKey(input.node.sourceAnchor)}`,
    }),
    regionKind: "unknown-barrier",
    boundaryId,
    ...(input.context.rootComponentNodeId
      ? { componentNodeId: input.context.rootComponentNodeId }
      : {}),
    renderPathId: path.id,
    sourceLocation: normalizeAnchor(input.node.sourceAnchor),
    placementConditionIds,
    childElementIds: [],
    childBoundaryIds: [],
  });
  linkBoundaryToParent(input.accumulator, boundary);

  if (input.node.className) {
    projectEmissionSite({
      accumulator: input.accumulator,
      classExpression: input.node.className,
      boundaryId,
      emittedElementLocation: input.node.sourceAnchor,
      placementLocation: input.node.placementAnchor,
      context: {
        ...input.context,
        pathSegments,
        placementConditionIds,
      },
      emissionKind: "unresolved-component-class-prop",
    });
  }
}

function projectElement(input: {
  node: RenderElementNode;
  accumulator: ProjectionAccumulator;
  context: TraversalContext;
}): string[] {
  const elementId = renderedElementId({
    key: `${input.context.boundaryId}:${anchorKey(input.node.sourceAnchor)}`,
    tagName: input.node.tagName,
  });
  const pathSegments: RenderPathSegment[] = [
    ...input.context.pathSegments,
    {
      kind: "element",
      elementId,
      tagName: input.node.tagName,
      location: normalizeAnchor(input.node.sourceAnchor),
    },
  ];
  const path = createRenderPath({
    id: renderPathId({
      terminalKind: "element",
      terminalId: elementId,
    }),
    rootComponentNodeId: input.context.rootComponentNodeId,
    terminalKind: "element",
    terminalId: elementId,
    segments: pathSegments,
    placementConditionIds: input.context.placementConditionIds,
    certainty: input.context.certainty,
    traces: input.node.traces ?? [],
  });
  const element: RenderedElement = {
    id: elementId,
    tagName: input.node.tagName,
    sourceLocation: normalizeAnchor(input.node.sourceAnchor),
    ...(input.context.parentElementId ? { parentElementId: input.context.parentElementId } : {}),
    parentBoundaryId: input.context.boundaryId,
    childElementIds: [],
    childBoundaryIds: [],
    emissionSiteIds: [],
    ...(input.context.emittingComponentNodeId
      ? { emittingComponentNodeId: input.context.emittingComponentNodeId }
      : {}),
    ...(input.context.placementComponentNodeId
      ? { placementComponentNodeId: input.context.placementComponentNodeId }
      : {}),
    renderPathId: path.id,
    placementConditionIds: input.context.placementConditionIds,
    certainty: input.context.certainty,
    traces: input.node.traces ?? [],
  };

  addElement(input.accumulator, element);
  addRenderPath(input.accumulator, path);
  linkElementToParent(input.accumulator, element);

  if (input.node.className) {
    projectEmissionSite({
      accumulator: input.accumulator,
      classExpression: input.node.className,
      element,
      boundaryId: input.context.boundaryId,
      emittedElementLocation: input.node.sourceAnchor,
      placementLocation: input.node.placementAnchor,
      context: {
        ...input.context,
        pathSegments,
        placementConditionIds: input.context.placementConditionIds,
      },
      emissionKind: "rendered-element-class",
    });
  }

  input.node.children.forEach((child, childIndex) => {
    projectNode({
      node: child,
      accumulator: input.accumulator,
      context: {
        ...input.context,
        parentElementId: elementId,
        pathSegments: [...pathSegments, { kind: "child-index", index: childIndex }],
        placementConditionIds: input.context.placementConditionIds,
      },
    });
  });

  return [elementId];
}

function projectEmissionSite(input: {
  accumulator: ProjectionAccumulator;
  classExpression: ClassExpressionSummary;
  element?: RenderedElement;
  boundaryId: string;
  emittedElementLocation?: SourceAnchor;
  placementLocation?: SourceAnchor;
  context: TraversalContext;
  emissionKind: EmissionSite["emissionKind"];
}): void {
  const summaryRecord = input.accumulator.legacyClassSummaryRecordBySummary.get(
    input.classExpression,
  );
  const classExpressionLocation = summaryRecord?.location ?? input.classExpression.sourceAnchor;
  const symbolicExpression =
    findSymbolicExpressionForClassSummaryLocation(
      input.accumulator.symbolicExpressions,
      classExpressionLocation,
    ) ??
    findSymbolicExpressionForClassSummaryTokenAnchors(
      input.accumulator.symbolicExpressions,
      input.classExpression,
    );
  if (!symbolicExpression) {
    return;
  }

  const sourceLocation = normalizeAnchor(symbolicExpression.location);
  const siteKey = `${symbolicExpression.classExpressionSiteNodeId}:${input.element?.id ?? input.boundaryId}`;
  const id = emissionSiteId({
    classExpressionId: symbolicExpression.id,
    key: siteKey,
  });
  const path = createRenderPath({
    id: renderPathId({
      terminalKind: "emission-site",
      terminalId: id,
    }),
    rootComponentNodeId: input.context.rootComponentNodeId,
    terminalKind: "emission-site",
    terminalId: id,
    segments: input.context.pathSegments,
    placementConditionIds: input.context.placementConditionIds,
    certainty: input.context.certainty,
    traces: symbolicExpression.traces,
  });
  const emissionSite: EmissionSite = {
    id,
    emissionKind: input.emissionKind,
    ...(input.element ? { elementId: input.element.id } : {}),
    boundaryId: input.boundaryId,
    classExpressionId: symbolicExpression.id,
    classExpressionSiteNodeId: symbolicExpression.classExpressionSiteNodeId,
    sourceExpressionIds: [symbolicExpression.id],
    sourceLocation,
    ...(input.emittedElementLocation
      ? { emittedElementLocation: normalizeAnchor(input.emittedElementLocation) }
      : {}),
    ...(input.placementLocation
      ? { placementLocation: normalizeAnchor(input.placementLocation) }
      : {}),
    ...(input.context.emittingComponentNodeId
      ? { emittingComponentNodeId: input.context.emittingComponentNodeId }
      : {}),
    ...(resolveSuppliedByComponentNodeId({
      symbolicExpression,
      classExpression: input.classExpression,
      context: input.context,
    })
      ? {
          suppliedByComponentNodeId: resolveSuppliedByComponentNodeId({
            symbolicExpression,
            classExpression: input.classExpression,
            context: input.context,
          }),
        }
      : {}),
    ...(input.context.placementComponentNodeId
      ? { placementComponentNodeId: input.context.placementComponentNodeId }
      : {}),
    tokenProvenance: [],
    tokens: [],
    emissionVariants: buildEmissionVariantsFromSummary({
      classExpression: input.classExpression,
      symbolicExpression,
    }),
    externalContributions: [...symbolicExpression.externalContributions].sort((left, right) =>
      left.id.localeCompare(right.id),
    ),
    cssModuleContributions: [...symbolicExpression.cssModuleContributions].sort((left, right) =>
      left.id.localeCompare(right.id),
    ),
    unsupported: hasReliableClassSummary(input.classExpression)
      ? []
      : [...symbolicExpression.unsupported].sort((left, right) => left.id.localeCompare(right.id)),
    confidence: getEmissionSiteConfidence(input.classExpression, symbolicExpression),
    renderPathId: path.id,
    placementConditionIds: input.context.placementConditionIds,
    traces: symbolicExpression.traces,
  };
  const suppliedByComponentNodeId = resolveSuppliedByComponentNodeId({
    symbolicExpression,
    classExpression: input.classExpression,
    context: input.context,
  });
  const summaryTokens = buildSummaryTokenAlternatives({
    classExpression: input.classExpression,
    symbolicExpression,
    lookup: input.accumulator.symbolicExpressions,
  });
  const instantiatedExternalTokens = instantiateExternalContributionTokens({
    symbolicExpression,
    summary: input.classExpression,
    suppliedByComponentNodeId,
  });
  const tokens = mergeTokenAlternatives([
    ...symbolicExpression.tokens,
    ...summaryTokens,
    ...instantiatedExternalTokens,
  ]);
  emissionSite.tokens = tokens;
  emissionSite.tokenProvenance = buildTokenProvenanceFromTokens({
    tokens,
    expression: symbolicExpression,
    lookup: input.accumulator.symbolicExpressions,
    emittedByComponentNodeId: input.context.emittingComponentNodeId,
    suppliedByComponentNodeId,
  });
  if (instantiatedExternalTokens.length > 0 && input.emissionKind === "rendered-element-class") {
    emissionSite.emissionKind = "instantiated-external-class";
  }

  input.accumulator.emissionSites.push(emissionSite);
  addRenderPath(input.accumulator, path);

  if (input.element) {
    input.element.emissionSiteIds = uniqueSorted([...input.element.emissionSiteIds, id]);
    input.element.elementTemplateNodeId ??= symbolicExpression.elementTemplateNodeId;
    input.element.renderSiteNodeId ??= symbolicExpression.renderSiteNodeId;
  }
}

function resolveSuppliedByComponentNodeId(input: {
  symbolicExpression: CanonicalClassExpression;
  classExpression: ClassExpressionSummary;
  context: TraversalContext;
}): string | undefined {
  if (
    input.context.externalSupplierComponentNodeId &&
    (input.symbolicExpression.externalContributions.length > 0 ||
      hasExternallyAnchoredSummaryToken(input.classExpression, input.symbolicExpression))
  ) {
    return input.context.externalSupplierComponentNodeId;
  }

  return input.symbolicExpression.emittingComponentNodeId;
}

function hasExternallyAnchoredSummaryToken(
  classExpression: ClassExpressionSummary,
  symbolicExpression: CanonicalClassExpression,
): boolean {
  const anchors = Object.values(classExpression.classNameSourceAnchors ?? {}).map(normalizeAnchor);
  return anchors.some(
    (anchor) =>
      normalizeProjectPath(anchor.filePath) !== normalizeProjectPath(symbolicExpression.filePath) ||
      !sourceAnchorContains(symbolicExpression.location, anchor),
  );
}

function instantiateExternalContributionTokens(input: {
  symbolicExpression: CanonicalClassExpression;
  summary: ClassExpressionSummary;
  suppliedByComponentNodeId?: string;
}): TokenAlternative[] {
  if (
    input.symbolicExpression.externalContributions.length === 0 ||
    !input.suppliedByComponentNodeId ||
    input.summary.value.kind !== "class-set"
  ) {
    return [];
  }

  const knownTokens = new Set(input.symbolicExpression.tokens.map((token) => token.token));
  const fallbackConditionId =
    input.symbolicExpression.externalContributions[0]?.conditionId ??
    input.symbolicExpression.tokens[0]?.conditionId;
  if (!fallbackConditionId) {
    return [];
  }

  const contributions = input.symbolicExpression.externalContributions;
  const contributionId = contributions[0]?.id;
  const sourceAnchorByToken = input.summary.classNameSourceAnchors ?? {};
  const instantiated: TokenAlternative[] = [];
  const pushInstantiated = (token: string, presence: "always" | "possible") => {
    if (knownTokens.has(token)) {
      return;
    }
    knownTokens.add(token);
    instantiated.push({
      id: `${input.symbolicExpression.id}:external:${token}:${presence}`,
      token,
      tokenKind: "external-class",
      presence,
      conditionId: fallbackConditionId,
      ...(sourceAnchorByToken[token] ? { sourceAnchor: sourceAnchorByToken[token] } : {}),
      confidence: input.symbolicExpression.confidence,
      ...(contributionId ? { contributionId } : {}),
    });
  };

  for (const token of input.summary.value.definite) {
    pushInstantiated(token, "always");
  }
  for (const token of input.summary.value.possible) {
    pushInstantiated(token, "possible");
  }
  return instantiated;
}

function buildSummaryTokenAlternatives(input: {
  classExpression: ClassExpressionSummary;
  symbolicExpression: CanonicalClassExpression;
  lookup: SymbolicExpressionLookup;
}): TokenAlternative[] {
  if (input.symbolicExpression.cssModuleContributions.length > 0) {
    return [];
  }

  const existingTokens = new Set(input.symbolicExpression.tokens.map((token) => token.token));
  const alwaysConditionId = conditionId({
    expressionId: input.symbolicExpression.id,
    conditionKey: "always",
  });
  const possibleConditionId = conditionId({
    expressionId: input.symbolicExpression.id,
    conditionKey: "possible",
  });
  const sourceAnchorByToken = input.classExpression.classNameSourceAnchors ?? {};
  const tokens: TokenAlternative[] = [];
  const pushSummaryToken = (token: string, presence: "always" | "possible") => {
    if (existingTokens.has(token)) {
      return;
    }

    existingTokens.add(token);
    const sourceAnchor = sourceAnchorByToken[token] ?? input.classExpression.sourceAnchor;
    const sourceExpression = findSymbolicExpressionByAnchor(input.lookup, sourceAnchor);
    tokens.push({
      id: tokenAlternativeId({
        expressionId: input.symbolicExpression.id,
        token,
        index: input.symbolicExpression.tokens.length + tokens.length,
      }),
      token,
      tokenKind:
        sourceExpression && sourceExpression.id !== input.symbolicExpression.id
          ? "external-class"
          : "global-class",
      presence,
      conditionId: presence === "always" ? alwaysConditionId : possibleConditionId,
      ...(findExclusiveGroupId(input.symbolicExpression.id, input.classExpression, token)
        ? {
            exclusiveGroupId: findExclusiveGroupId(
              input.symbolicExpression.id,
              input.classExpression,
              token,
            ),
          }
        : {}),
      sourceAnchor: normalizeAnchor(sourceAnchor),
      confidence: presence === "always" ? "high" : "medium",
    });
  };

  for (const token of input.classExpression.classes.definite) {
    pushSummaryToken(token, "always");
  }

  for (const token of input.classExpression.classes.possible) {
    pushSummaryToken(token, "possible");
  }

  return sortTokens(tokens);
}

function buildEmissionVariantsFromSummary(input: {
  classExpression: ClassExpressionSummary;
  symbolicExpression: CanonicalClassExpression;
}): EmissionSite["emissionVariants"] {
  const symbolicVariants = [...input.symbolicExpression.emissionVariants].sort((left, right) =>
    left.id.localeCompare(right.id),
  );
  const summaryVariants = buildSummaryEmissionVariants(input);
  if (summaryVariants.length === 0) {
    return symbolicVariants;
  }

  return [...symbolicVariants, ...summaryVariants].sort((left, right) =>
    left.id.localeCompare(right.id),
  );
}

function buildSummaryEmissionVariants(input: {
  classExpression: ClassExpressionSummary;
  symbolicExpression: CanonicalClassExpression;
}): EmissionSite["emissionVariants"] {
  const alwaysConditionId = conditionId({
    expressionId: input.symbolicExpression.id,
    conditionKey: "always",
  });
  const value = input.classExpression.value;
  if (value.kind === "string-exact") {
    return [
      {
        id: `${input.symbolicExpression.id}:summary-variant:0`,
        conditionId: alwaysConditionId,
        tokens: tokenizeClassNames(value.value),
        completeness: "complete",
        unknownDynamic: false,
      },
    ];
  }

  if (value.kind === "string-set") {
    return value.values.map((candidate, index) => ({
      id: `${input.symbolicExpression.id}:summary-variant:${index}`,
      conditionId: alwaysConditionId,
      tokens: tokenizeClassNames(candidate),
      completeness: "complete",
      unknownDynamic: false,
    }));
  }

  if (value.kind !== "class-set") {
    return [];
  }

  const tokens = uniqueSorted([...value.definite, ...value.possible]);
  if (tokens.length === 0) {
    return [];
  }

  return [
    {
      id: `${input.symbolicExpression.id}:summary-variant:0`,
      conditionId: alwaysConditionId,
      tokens,
      completeness: value.possible.length === 0 && !value.unknownDynamic ? "complete" : "partial",
      unknownDynamic: value.unknownDynamic || value.possible.length > 0,
    },
  ];
}

function mergeTokenAlternatives(tokens: TokenAlternative[]): TokenAlternative[] {
  const mergedByToken = new Map<string, TokenAlternative>();
  for (const token of tokens) {
    const key = `${token.tokenKind}:${token.token}`;
    const existing = mergedByToken.get(key);
    if (!existing || comparePresence(token.presence, existing.presence) < 0) {
      mergedByToken.set(key, token);
    }
  }

  return sortTokens([...mergedByToken.values()]);
}

function comparePresence(
  left: TokenAlternative["presence"],
  right: TokenAlternative["presence"],
): number {
  return presenceRank(left) - presenceRank(right);
}

function presenceRank(presence: TokenAlternative["presence"]): number {
  if (presence === "always") {
    return 0;
  }

  if (presence === "conditional") {
    return 1;
  }

  return 2;
}

function findExclusiveGroupId(
  expressionId: string,
  classExpression: ClassExpressionSummary,
  token: string,
): string | undefined {
  const groupIndex = classExpression.classes.mutuallyExclusiveGroups.findIndex((group) =>
    group.includes(token),
  );
  if (groupIndex < 0) {
    return undefined;
  }

  return `${expressionId}:summary-exclusive-group:${groupIndex}`;
}

function hasReliableClassSummary(classExpression: ClassExpressionSummary): boolean {
  return (
    (classExpression.classes.definite.length > 0 || classExpression.classes.possible.length > 0) &&
    !classExpression.classes.unknownDynamic
  );
}

function getEmissionSiteConfidence(
  classExpression: ClassExpressionSummary,
  symbolicExpression: CanonicalClassExpression,
): CanonicalClassExpression["confidence"] {
  if (hasReliableClassSummary(classExpression)) {
    return "high";
  }

  if (classExpression.classes.definite.length > 0 || classExpression.classes.possible.length > 0) {
    return "medium";
  }

  return symbolicExpression.confidence;
}

function buildSymbolicExpressionLookup(input: RenderStructureInput): SymbolicExpressionLookup {
  const all: CanonicalClassExpression[] = [];
  const byId = new Map<string, CanonicalClassExpression>();
  const bySiteNodeId = new Map<string, CanonicalClassExpression>();
  const byExpressionNodeId = new Map<string, CanonicalClassExpression[]>();
  const byAnchor = new Map<string, CanonicalClassExpression[]>();
  const siteNodeIdByAnchor = new Map<string, string>();
  const expressionNodeIdBySiteNodeId = new Map<string, string>();

  for (const site of input.graph.nodes.classExpressionSites) {
    siteNodeIdByAnchor.set(anchorKey(site.location), site.id);
    expressionNodeIdBySiteNodeId.set(site.id, site.expressionNodeId);
  }

  for (const expression of input.symbolicEvaluation.evaluatedExpressions.classExpressions) {
    all.push(expression);
    byId.set(expression.id, expression);
    bySiteNodeId.set(expression.classExpressionSiteNodeId, expression);
    pushMapValue(byExpressionNodeId, expression.expressionNodeId, expression);
    pushMapValue(byAnchor, anchorKey(expression.location), expression);
  }

  sortLookupValues(byExpressionNodeId);
  sortLookupValues(byAnchor);

  return {
    all: all.sort(compareCanonicalClassExpressions),
    byId,
    bySiteNodeId,
    byExpressionNodeId,
    byAnchor,
    siteNodeIdByAnchor,
    expressionNodeIdBySiteNodeId,
  };
}

function findSymbolicExpressionForClassSummaryLocation(
  lookup: SymbolicExpressionLookup,
  classExpressionLocation: SourceAnchor,
): CanonicalClassExpression | undefined {
  const sourceAnchorKey = anchorKey(classExpressionLocation);
  const siteNodeId = lookup.siteNodeIdByAnchor.get(sourceAnchorKey);
  if (siteNodeId) {
    const expression = lookup.bySiteNodeId.get(siteNodeId);
    if (expression) {
      return expression;
    }

    const expressionNodeId = lookup.expressionNodeIdBySiteNodeId.get(siteNodeId);
    const expressionByExpressionNodeId = expressionNodeId
      ? lookup.byExpressionNodeId.get(expressionNodeId)?.[0]
      : undefined;
    if (expressionByExpressionNodeId) {
      return expressionByExpressionNodeId;
    }
  }

  // Temporary compatibility fallback while legacy render trees only expose source anchors.
  return lookup.byAnchor.get(sourceAnchorKey)?.[0];
}

function findSymbolicExpressionForClassSummaryTokenAnchors(
  lookup: SymbolicExpressionLookup,
  classExpression: ClassExpressionSummary,
): CanonicalClassExpression | undefined {
  const tokenAnchors = Object.values(classExpression.classNameSourceAnchors ?? {}).sort(
    compareAnchors,
  );
  const containingCandidates: CanonicalClassExpression[] = [];
  const exactCandidates: CanonicalClassExpression[] = [];

  for (const tokenAnchor of tokenAnchors) {
    const exact = findSymbolicExpressionForClassSummaryLocation(lookup, tokenAnchor);
    if (exact) {
      exactCandidates.push(exact);
    }

    containingCandidates.push(
      ...lookup.all.filter(
        (expression) =>
          !anchorsEqual(expression.location, tokenAnchor) &&
          sourceAnchorContains(expression.location, tokenAnchor),
      ),
    );
  }

  return (
    sortContainingExpressions(containingCandidates)[0] ??
    exactCandidates.sort(compareCanonicalClassExpressions)[0]
  );
}

function findSymbolicExpressionByAnchor(
  lookup: SymbolicExpressionLookup,
  anchor: SourceAnchor,
): CanonicalClassExpression | undefined {
  return lookup.byAnchor.get(anchorKey(anchor))?.[0];
}

function buildTokenProvenanceFromTokens(input: {
  tokens: TokenAlternative[];
  expression: CanonicalClassExpression;
  lookup: SymbolicExpressionLookup;
  emittedByComponentNodeId?: string;
  suppliedByComponentNodeId?: string;
}): EmissionTokenProvenance[] {
  return sortTokens(input.tokens).map((token) => {
    const sourceExpression = token.sourceAnchor
      ? findSymbolicExpressionByAnchor(input.lookup, token.sourceAnchor)
      : undefined;
    const suppliedByComponentNodeId =
      sourceExpression && sourceExpression.id !== input.expression.id
        ? sourceExpression.emittingComponentNodeId
        : token.tokenKind === "external-class"
          ? input.suppliedByComponentNodeId
          : undefined;

    return {
      token: token.token,
      tokenKind: token.tokenKind,
      presence: token.presence,
      sourceExpressionId: sourceExpression?.id ?? input.expression.id,
      sourceClassExpressionSiteNodeId:
        sourceExpression?.classExpressionSiteNodeId ?? input.expression.classExpressionSiteNodeId,
      ...(token.sourceAnchor ? { sourceLocation: normalizeAnchor(token.sourceAnchor) } : {}),
      ...(suppliedByComponentNodeId ? { suppliedByComponentNodeId } : {}),
      ...(input.emittedByComponentNodeId
        ? { emittedByComponentNodeId: input.emittedByComponentNodeId }
        : {}),
      conditionId: token.conditionId,
      confidence: token.confidence,
    };
  });
}

function sortTokens(tokens: TokenAlternative[]): TokenAlternative[] {
  return [...tokens].sort(
    (left, right) =>
      left.token.localeCompare(right.token) ||
      left.presence.localeCompare(right.presence) ||
      left.id.localeCompare(right.id),
  );
}

function pushMapValue<Key, Value>(map: Map<Key, Value[]>, key: Key, value: Value): void {
  const values = map.get(key) ?? [];
  values.push(value);
  map.set(key, values);
}

function sortLookupValues(map: Map<string, CanonicalClassExpression[]>): void {
  for (const [key, values] of map.entries()) {
    map.set(
      key,
      values.sort(
        (left, right) =>
          left.id.localeCompare(right.id) ||
          compareAnchors(left.location, right.location) ||
          left.rawExpressionText.localeCompare(right.rawExpressionText),
      ),
    );
  }
}

function sortContainingExpressions(
  expressions: CanonicalClassExpression[],
): CanonicalClassExpression[] {
  return [...new Map(expressions.map((expression) => [expression.id, expression])).values()].sort(
    (left, right) =>
      anchorSpan(left.location) - anchorSpan(right.location) ||
      compareCanonicalClassExpressions(left, right),
  );
}

function compareCanonicalClassExpressions(
  left: CanonicalClassExpression,
  right: CanonicalClassExpression,
): number {
  return (
    compareAnchors(left.location, right.location) ||
    left.id.localeCompare(right.id) ||
    left.rawExpressionText.localeCompare(right.rawExpressionText)
  );
}

function projectComponentsFromBoundaries(input: {
  graph: RenderStructureInput["graph"];
  boundaries: RenderedComponentBoundary[];
}): RenderedComponent[] {
  const componentNodesById = new Map(input.graph.nodes.components.map((node) => [node.id, node]));
  const componentsByKey = new Map<string, RenderedComponent>();
  for (const boundary of input.boundaries) {
    if (boundary.boundaryKind !== "component-root" || !boundary.componentKey) {
      continue;
    }
    const existing = componentsByKey.get(boundary.componentKey);
    const componentNode =
      (boundary.componentNodeId ? componentNodesById.get(boundary.componentNodeId) : undefined) ??
      undefined;
    const declarationLocation = normalizeAnchor(
      boundary.declarationLocation ?? componentNode?.location ?? createUnknownAnchor(),
    );
    const filePath = normalizeProjectPath(
      boundary.filePath ?? componentNode?.filePath ?? declarationLocation.filePath,
    );
    componentsByKey.set(boundary.componentKey, {
      id: renderedComponentId(boundary.componentKey),
      ...(boundary.componentNodeId ? { componentNodeId: boundary.componentNodeId } : {}),
      componentKey: boundary.componentKey,
      componentName:
        boundary.componentName ?? componentNode?.componentName ?? boundary.componentKey,
      filePath,
      exported: componentNode?.exported ?? true,
      declarationLocation,
      rootBoundaryIds: uniqueSorted([...(existing?.rootBoundaryIds ?? []), boundary.id]),
      provenance: [
        {
          stage: "render-structure" as const,
          filePath,
          anchor: declarationLocation,
          upstreamId: boundary.componentNodeId,
          summary: "Derived component from component-root boundary",
        },
      ],
      traces: [],
    });
  }
  return [...componentsByKey.values()].sort((left, right) => left.id.localeCompare(right.id));
}

function projectRenderGraphFromBoundaries(input: {
  components: RenderedComponent[];
  boundaries: RenderedComponentBoundary[];
}): RenderGraphProjection {
  const componentByKey = new Map(
    input.components.map((component) => [component.componentKey, component] as const),
  );
  const nodes = input.components
    .map((component) => ({
      ...(component.componentNodeId ? { componentNodeId: component.componentNodeId } : {}),
      componentKey: component.componentKey,
      componentName: component.componentName,
      filePath: component.filePath,
      exported: component.exported,
      sourceLocation: component.declarationLocation,
    }))
    .sort(compareRenderGraphNodes);
  const boundariesById = new Map(input.boundaries.map((boundary) => [boundary.id, boundary]));
  const edges: RenderGraphProjectionEdge[] = [];
  for (const boundary of input.boundaries) {
    if (
      boundary.boundaryKind !== "expanded-component-reference" &&
      boundary.boundaryKind !== "unresolved-component-reference"
    ) {
      continue;
    }
    const parentBoundary = boundary.parentBoundaryId
      ? boundariesById.get(boundary.parentBoundaryId)
      : undefined;
    if (!parentBoundary?.componentKey) {
      continue;
    }
    const parentComponent = componentByKey.get(parentBoundary.componentKey);
    if (!parentComponent) {
      continue;
    }
    const childComponent = boundary.componentKey
      ? componentByKey.get(boundary.componentKey)
      : undefined;
    const sourceLocation = normalizeAnchor(
      boundary.referenceLocation ??
        parentBoundary.referenceLocation ??
        parentBoundary.declarationLocation ??
        createUnknownAnchor(),
    );
    edges.push({
      ...(parentComponent.componentNodeId
        ? { fromComponentNodeId: parentComponent.componentNodeId }
        : {}),
      fromComponentKey: parentComponent.componentKey,
      fromComponentName: parentComponent.componentName,
      fromFilePath: parentComponent.filePath,
      ...(childComponent?.componentNodeId
        ? { toComponentNodeId: childComponent.componentNodeId }
        : {}),
      ...(childComponent ? { toComponentKey: childComponent.componentKey } : {}),
      toComponentName: childComponent?.componentName ?? boundary.componentName ?? "unknown",
      ...(childComponent ? { toFilePath: childComponent.filePath } : {}),
      ...(childComponent ? { targetLocation: childComponent.declarationLocation } : {}),
      sourceLocation,
      resolution:
        boundary.boundaryKind === "expanded-component-reference" ? "resolved" : "unresolved",
      traversal: "render-structure",
      renderPath:
        boundary.boundaryKind === "expanded-component-reference"
          ? "definite"
          : boundary.expansion.status === "unresolved"
            ? "unknown"
            : "possible",
      traces: boundary.traces,
    });
  }
  return {
    nodes,
    edges: edges.sort(compareRenderGraphEdges),
  };
}

function projectRenderRegionsFromBoundariesAndPaths(input: {
  boundaries: RenderedComponentBoundary[];
  elements: RenderedElement[];
  placementConditions: PlacementCondition[];
}): RenderRegion[] {
  const regions: RenderRegion[] = [];
  for (const boundary of input.boundaries) {
    if (boundary.boundaryKind !== "component-root") {
      continue;
    }
    regions.push({
      id: renderRegionId({
        regionKind: "component-root",
        key: boundary.id,
      }),
      regionKind: "component-root",
      boundaryId: boundary.id,
      ...(boundary.componentNodeId ? { componentNodeId: boundary.componentNodeId } : {}),
      renderPathId: boundary.renderPathId,
      sourceLocation: normalizeAnchor(
        boundary.declarationLocation ?? boundary.referenceLocation ?? createUnknownAnchor(),
      ),
      placementConditionIds: boundary.placementConditionIds,
      childElementIds: uniqueSorted(boundary.rootElementIds),
      childBoundaryIds: uniqueSorted(boundary.childBoundaryIds),
    });
  }
  return sortById(regions);
}

function addBoundary(
  accumulator: ProjectionAccumulator,
  boundary: RenderedComponentBoundary,
): void {
  accumulator.boundaryById.set(boundary.id, boundary);
  accumulator.componentBoundaries.push(boundary);
}

function addElement(accumulator: ProjectionAccumulator, element: RenderedElement): void {
  accumulator.elementById.set(element.id, element);
  accumulator.elements.push(element);
}

function addRenderPath(accumulator: ProjectionAccumulator, renderPath: RenderPath): void {
  accumulator.renderPaths.push(renderPath);
}

function addPlacementCondition(
  accumulator: ProjectionAccumulator,
  placementCondition: PlacementCondition,
): string {
  const existing = accumulator.placementConditionById.get(placementCondition.id);
  if (existing) {
    return existing.id;
  }

  accumulator.placementConditionById.set(placementCondition.id, placementCondition);
  accumulator.placementConditions.push(placementCondition);
  return placementCondition.id;
}

function addRenderRegion(accumulator: ProjectionAccumulator, renderRegion: RenderRegion): void {
  if (accumulator.renderRegionById.has(renderRegion.id)) {
    return;
  }

  accumulator.renderRegionById.set(renderRegion.id, renderRegion);
  accumulator.renderRegions.push(renderRegion);
}

function linkBoundaryToParent(
  accumulator: ProjectionAccumulator,
  boundary: RenderedComponentBoundary,
): void {
  if (boundary.parentElementId) {
    const parentElement = accumulator.elementById.get(boundary.parentElementId);
    if (parentElement) {
      parentElement.childBoundaryIds = uniqueSorted([
        ...parentElement.childBoundaryIds,
        boundary.id,
      ]);
    }
    return;
  }

  if (boundary.parentBoundaryId) {
    const parentBoundary = accumulator.boundaryById.get(boundary.parentBoundaryId);
    if (parentBoundary) {
      parentBoundary.childBoundaryIds = uniqueSorted([
        ...parentBoundary.childBoundaryIds,
        boundary.id,
      ]);
    }
  }
}

function linkElementToParent(accumulator: ProjectionAccumulator, element: RenderedElement): void {
  if (element.parentElementId) {
    const parentElement = accumulator.elementById.get(element.parentElementId);
    if (parentElement) {
      parentElement.childElementIds = uniqueSorted([...parentElement.childElementIds, element.id]);
    }
    return;
  }

  const parentBoundary = accumulator.boundaryById.get(element.parentBoundaryId);
  if (parentBoundary) {
    parentBoundary.rootElementIds = uniqueSorted([...parentBoundary.rootElementIds, element.id]);
  }
}

function createRenderPath(
  input: Omit<RenderPath, "placementConditionIds" | "traces"> &
    Partial<Pick<RenderPath, "placementConditionIds" | "traces">>,
): RenderPath {
  return {
    ...input,
    placementConditionIds: input.placementConditionIds ?? [],
    traces: input.traces ?? [],
  };
}

function downgradeCertainty(certainty: RenderCertainty): RenderCertainty {
  return certainty === "unknown" ? "unknown" : "possible";
}

function compareRenderGraphNodes(
  left: RenderGraphProjectionNode,
  right: RenderGraphProjectionNode,
): number {
  return (
    left.filePath.localeCompare(right.filePath) ||
    left.componentKey.localeCompare(right.componentKey) ||
    left.componentName.localeCompare(right.componentName) ||
    compareAnchors(left.sourceLocation, right.sourceLocation)
  );
}

function compareRenderGraphEdges(
  left: RenderGraphProjectionEdge,
  right: RenderGraphProjectionEdge,
): number {
  return (
    left.fromFilePath.localeCompare(right.fromFilePath) ||
    left.fromComponentKey.localeCompare(right.fromComponentKey) ||
    left.fromComponentName.localeCompare(right.fromComponentName) ||
    compareAnchors(left.sourceLocation, right.sourceLocation) ||
    (left.toComponentKey ?? "").localeCompare(right.toComponentKey ?? "") ||
    left.toComponentName.localeCompare(right.toComponentName) ||
    (left.toFilePath ?? "").localeCompare(right.toFilePath ?? "")
  );
}

function compareAnchors(left: SourceAnchor, right: SourceAnchor): number {
  return (
    left.filePath.localeCompare(right.filePath) ||
    left.startLine - right.startLine ||
    left.startColumn - right.startColumn ||
    (left.endLine ?? 0) - (right.endLine ?? 0) ||
    (left.endColumn ?? 0) - (right.endColumn ?? 0)
  );
}

function anchorsEqual(left: SourceAnchor, right: SourceAnchor): boolean {
  return compareAnchors(left, right) === 0;
}

function sourceAnchorContains(containing: SourceAnchor, contained: SourceAnchor): boolean {
  const containingPath = normalizeProjectPath(containing.filePath);
  const containedPath = normalizeProjectPath(contained.filePath);
  if (containingPath !== containedPath) {
    return false;
  }

  const containingStart = anchorPosition(containing.startLine, containing.startColumn);
  const containingEnd = anchorPosition(
    containing.endLine ?? containing.startLine,
    containing.endColumn ?? containing.startColumn,
  );
  const containedStart = anchorPosition(contained.startLine, contained.startColumn);
  const containedEnd = anchorPosition(
    contained.endLine ?? contained.startLine,
    contained.endColumn ?? contained.startColumn,
  );

  return containingStart <= containedStart && containingEnd >= containedEnd;
}

function anchorSpan(anchor: SourceAnchor): number {
  return (
    anchorPosition(anchor.endLine ?? anchor.startLine, anchor.endColumn ?? anchor.startColumn) -
    anchorPosition(anchor.startLine, anchor.startColumn)
  );
}

function anchorPosition(line: number, column: number): number {
  return line * 1_000_000 + column;
}

function createSubtreeKey(subtree: RenderSubtree, index: number): string {
  return `${subtree.componentKey ?? subtree.componentName ?? "anonymous"}:${anchorKey(subtree.sourceAnchor)}:${index}`;
}

function serializeRenderPathSegments(pathSegments: RenderPathSegment[]): string {
  return pathSegments
    .map((segment) => {
      if (segment.kind === "component-root") {
        return `component-root:${segment.componentNodeId ?? "unknown"}:${anchorKey(segment.location)}`;
      }

      if (segment.kind === "component-reference") {
        return `component-reference:${segment.renderSiteNodeId ?? "unknown"}:${anchorKey(segment.location)}`;
      }

      if (segment.kind === "element") {
        return `element:${segment.elementId}:${segment.tagName}:${anchorKey(segment.location)}`;
      }

      if (segment.kind === "child-index") {
        return `child-index:${segment.index}`;
      }

      if (segment.kind === "conditional-branch") {
        return `conditional-branch:${segment.branch}:${segment.conditionId}`;
      }

      if (segment.kind === "repeated-template") {
        return `repeated-template:${segment.conditionId}`;
      }

      return `unknown-barrier:${segment.reason}:${anchorKey(segment.location)}`;
    })
    .join("/");
}

function anchorKey(anchor: SourceAnchor): string {
  return [
    normalizeProjectPath(anchor.filePath),
    anchor.startLine,
    anchor.startColumn,
    anchor.endLine ?? "",
    anchor.endColumn ?? "",
  ].join(":");
}

function normalizeAnchor(anchor: SourceAnchor): SourceAnchor {
  return {
    ...anchor,
    filePath: normalizeProjectPath(anchor.filePath),
  };
}

function normalizeProjectPath(filePath: string): string {
  return filePath.replace(/\\/g, "/");
}

function createUnknownAnchor(): SourceAnchor {
  return {
    filePath: "<unknown>",
    startLine: 1,
    startColumn: 1,
  };
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function sortById<T extends { id: string }>(values: T[]): T[] {
  return [...values].sort((left, right) => left.id.localeCompare(right.id));
}
