import {
  collectRenderRegionsFromSubtrees,
  type RenderRegion,
  type RenderNode,
  type RenderSubtree,
} from "../render-model/render-ir/index.js";
import type { RenderGraph } from "../render-model/render-graph/types.js";
import type {
  ReachabilityGraphContext,
  PlacedChildRenderRegion,
  UnknownReachabilityBarrier,
} from "./internalTypes.js";
import { normalizeProjectPath } from "./pathUtils.js";
import { compareEdges, createComponentKey, serializeRegionPath } from "./sortAndKeys.js";

export function buildReachabilityGraphContext(input: {
  renderGraph: RenderGraph;
  renderSubtrees: RenderSubtree[];
}): ReachabilityGraphContext {
  const renderRegionsByComponentKey = new Map<string, RenderRegion[]>();
  const renderRegionsByPathKeyByComponentKey = new Map<string, Map<string, RenderRegion[]>>();
  const renderSubtreesByComponentKey = new Map<string, RenderSubtree>();
  const unknownBarriersByComponentKey = new Map<string, UnknownReachabilityBarrier[]>();
  const renderGraphNodesByKey = new Map(
    input.renderGraph.nodes.map((node) => [
      createComponentKey(node.filePath, node.componentName),
      node,
    ]),
  );
  const outgoingEdgesByComponentKey = new Map<
    string,
    import("../render-model/render-graph/types.js").RenderGraphEdge[]
  >();
  const incomingEdgesByComponentKey = new Map<
    string,
    import("../render-model/render-graph/types.js").RenderGraphEdge[]
  >();
  const componentKeysByFilePath = new Map<string, string[]>();

  for (const renderRegion of collectRenderRegionsFromSubtrees(input.renderSubtrees)) {
    if (!renderRegion.componentName) {
      continue;
    }

    const componentKey = createComponentKey(renderRegion.filePath, renderRegion.componentName);
    const renderRegions = renderRegionsByComponentKey.get(componentKey) ?? [];
    renderRegions.push(renderRegion);
    renderRegionsByComponentKey.set(componentKey, renderRegions);

    const pathKey = serializeRegionPath(renderRegion.path);
    const renderRegionsByPathKey =
      renderRegionsByPathKeyByComponentKey.get(componentKey) ?? new Map();
    const matchingPathRegions = renderRegionsByPathKey.get(pathKey) ?? [];
    matchingPathRegions.push(renderRegion);
    renderRegionsByPathKey.set(pathKey, matchingPathRegions);
    renderRegionsByPathKeyByComponentKey.set(componentKey, renderRegionsByPathKey);
  }

  for (const renderSubtree of input.renderSubtrees) {
    if (!renderSubtree.componentName) {
      continue;
    }

    const filePath =
      normalizeProjectPath(renderSubtree.sourceAnchor.filePath) ??
      renderSubtree.sourceAnchor.filePath;
    const componentKey = createComponentKey(filePath, renderSubtree.componentName);
    renderSubtreesByComponentKey.set(componentKey, renderSubtree);
    unknownBarriersByComponentKey.set(
      componentKey,
      collectUnknownReachabilityBarriersFromSubtree(renderSubtree),
    );
  }

  for (const edge of input.renderGraph.edges) {
    if (edge.resolution !== "resolved" || !edge.toFilePath) {
      continue;
    }

    const fromKey = createComponentKey(edge.fromFilePath, edge.fromComponentName);
    const toKey = createComponentKey(edge.toFilePath, edge.toComponentName);
    const outgoingEdges = outgoingEdgesByComponentKey.get(fromKey) ?? [];
    outgoingEdges.push(edge);
    outgoingEdgesByComponentKey.set(fromKey, outgoingEdges);
    const incomingEdges = incomingEdgesByComponentKey.get(toKey) ?? [];
    incomingEdges.push(edge);
    incomingEdgesByComponentKey.set(toKey, incomingEdges);
  }

  for (const [componentKey, node] of renderGraphNodesByKey.entries()) {
    const filePath = normalizeProjectPath(node.filePath) ?? node.filePath;
    const componentKeys = componentKeysByFilePath.get(filePath) ?? [];
    componentKeys.push(componentKey);
    componentKeysByFilePath.set(filePath, componentKeys);
  }

  for (const edges of outgoingEdgesByComponentKey.values()) {
    edges.sort(compareEdges);
  }
  for (const edges of incomingEdgesByComponentKey.values()) {
    edges.sort(compareEdges);
  }
  for (const componentKeys of componentKeysByFilePath.values()) {
    componentKeys.sort((left, right) => left.localeCompare(right));
  }

  const placedChildRenderRegionsByComponentKey = buildPlacedChildRenderRegionsByComponentKey({
    renderSubtreesByComponentKey,
    renderRegionsByComponentKey,
    renderRegionsByPathKeyByComponentKey,
    outgoingEdgesByComponentKey,
  });

  return {
    componentKeys: [...renderGraphNodesByKey.keys()].sort((left, right) =>
      left.localeCompare(right),
    ),
    renderRegionsByComponentKey,
    renderRegionsByPathKeyByComponentKey,
    renderSubtreesByComponentKey,
    unknownBarriersByComponentKey,
    placedChildRenderRegionsByComponentKey,
    renderGraphNodesByKey,
    outgoingEdgesByComponentKey,
    incomingEdgesByComponentKey,
    componentKeysByFilePath,
  };
}

function buildPlacedChildRenderRegionsByComponentKey(input: {
  renderSubtreesByComponentKey: Map<string, RenderSubtree>;
  renderRegionsByComponentKey: Map<string, RenderRegion[]>;
  renderRegionsByPathKeyByComponentKey: Map<string, Map<string, RenderRegion[]>>;
  outgoingEdgesByComponentKey: Map<
    string,
    import("../render-model/render-graph/types.js").RenderGraphEdge[]
  >;
}): Map<string, PlacedChildRenderRegion[]> {
  const placementsByComponentKey = new Map<string, PlacedChildRenderRegion[]>();

  for (const [componentKey, outgoingEdges] of input.outgoingEdgesByComponentKey.entries()) {
    const renderSubtree = input.renderSubtreesByComponentKey.get(componentKey);
    const renderRegions = input.renderRegionsByComponentKey.get(componentKey) ?? [];
    const renderRegionsByPathKey =
      input.renderRegionsByPathKeyByComponentKey.get(componentKey) ?? new Map();
    const placements: PlacedChildRenderRegion[] = [];

    for (const edge of outgoingEdges) {
      const containingRenderRegions = findContainingRenderRegionsForEdge({
        renderSubtree,
        renderRegions,
        renderRegionsByPathKey,
        sourceAnchor: edge.sourceAnchor,
      });
      if (containingRenderRegions.length > 0) {
        placements.push({
          edge,
          renderRegions: containingRenderRegions,
        });
      }
    }

    if (placements.length > 0) {
      placementsByComponentKey.set(componentKey, placements);
    }
  }

  return placementsByComponentKey;
}

function collectUnknownReachabilityBarriersFromSubtree(
  renderSubtree: RenderSubtree,
): UnknownReachabilityBarrier[] {
  const barriers: UnknownReachabilityBarrier[] = [];
  collectUnknownReachabilityBarriers({
    node: renderSubtree.root,
    path: [{ kind: "root" }],
    barriers,
  });
  return barriers;
}

function collectUnknownReachabilityBarriers(input: {
  node: RenderNode;
  path: import("../render-model/render-ir/types.js").RenderRegionPathSegment[];
  barriers: UnknownReachabilityBarrier[];
}): void {
  if (input.node.kind === "unknown") {
    input.barriers.push({
      node: input.node,
      path: input.path,
      reason: input.node.reason,
      sourceAnchor: input.node.placementAnchor ?? input.node.sourceAnchor,
    });
    return;
  }

  if (input.node.kind === "component-reference") {
    input.barriers.push({
      node: input.node,
      path: input.path,
      reason: input.node.reason,
      sourceAnchor: input.node.placementAnchor ?? input.node.sourceAnchor,
    });
    return;
  }

  if (input.node.kind === "conditional") {
    collectUnknownReachabilityBarriers({
      node: input.node.whenTrue,
      path: [...input.path, { kind: "conditional-branch", branch: "when-true" }],
      barriers: input.barriers,
    });
    collectUnknownReachabilityBarriers({
      node: input.node.whenFalse,
      path: [...input.path, { kind: "conditional-branch", branch: "when-false" }],
      barriers: input.barriers,
    });
    return;
  }

  if (input.node.kind === "repeated-region") {
    collectUnknownReachabilityBarriers({
      node: input.node.template,
      path: [...input.path, { kind: "repeated-template" }],
      barriers: input.barriers,
    });
    return;
  }

  if (input.node.kind === "element" || input.node.kind === "fragment") {
    input.node.children.forEach((child, childIndex) =>
      collectUnknownReachabilityBarriers({
        node: child,
        path: [...input.path, { kind: "fragment-child", childIndex }],
        barriers: input.barriers,
      }),
    );
  }
}

export function collectRenderRegionsForBarrierPath(input: {
  barrierPath: RenderRegion["path"];
  renderRegionsByPathKey: Map<string, RenderRegion[]>;
}): RenderRegion[] {
  const renderRegions: RenderRegion[] = [];
  for (let length = 1; length <= input.barrierPath.length; length += 1) {
    const pathKey = serializeRegionPath(input.barrierPath.slice(0, length));
    renderRegions.push(...(input.renderRegionsByPathKey.get(pathKey) ?? []));
  }

  return renderRegions;
}

function findContainingRenderRegionsForEdge(input: {
  renderSubtree?: RenderSubtree;
  renderRegions: RenderRegion[];
  renderRegionsByPathKey: Map<string, RenderRegion[]>;
  sourceAnchor: import("../../types/core.js").SourceAnchor;
}): RenderRegion[] {
  if (!input.renderSubtree) {
    return [];
  }

  const matchingPathKeys = new Set(
    resolvePlacementRegionPaths({
      node: input.renderSubtree.root,
      sourceAnchor: input.sourceAnchor,
      path: [{ kind: "root" }],
    }).map((path) => serializeRegionPath(path)),
  );

  if (matchingPathKeys.size === 0) {
    const rootRegion = input.renderRegions.find(
      (renderRegion) =>
        renderRegion.kind === "subtree-root" &&
        sourceAnchorContains(renderRegion.sourceAnchor, input.sourceAnchor),
    );
    return rootRegion ? [rootRegion] : [];
  }

  return [...matchingPathKeys].flatMap(
    (matchingPathKey) => input.renderRegionsByPathKey.get(matchingPathKey) ?? [],
  );
}

function resolvePlacementRegionPaths(input: {
  node: import("../render-model/render-ir/types.js").RenderNode;
  sourceAnchor: import("../../types/core.js").SourceAnchor;
  path: RenderRegion["path"];
}): RenderRegion["path"][] {
  if (input.node.kind === "conditional") {
    if (
      normalizeProjectPath(input.node.sourceAnchor.filePath) ===
        normalizeProjectPath(input.sourceAnchor.filePath) &&
      !sourceAnchorContains(input.node.sourceAnchor, input.sourceAnchor)
    ) {
      return [];
    }

    return [
      ...resolveConditionalBranchPlacementPaths({
        branch: "when-true",
        branchNode: input.node.whenTrue,
        siblingBranchNode: input.node.whenFalse,
        sourceAnchor: input.sourceAnchor,
        path: input.path,
      }),
      ...resolveConditionalBranchPlacementPaths({
        branch: "when-false",
        branchNode: input.node.whenFalse,
        siblingBranchNode: input.node.whenTrue,
        sourceAnchor: input.sourceAnchor,
        path: input.path,
      }),
    ];
  }

  if (input.node.kind === "repeated-region") {
    if (
      normalizeProjectPath(input.node.sourceAnchor.filePath) ===
        normalizeProjectPath(input.sourceAnchor.filePath) &&
      !sourceAnchorContains(input.node.sourceAnchor, input.sourceAnchor)
    ) {
      return [];
    }

    const templatePath: RenderRegion["path"] = [...input.path, { kind: "repeated-template" }];
    return [
      templatePath,
      ...resolvePlacementRegionPaths({
        node: input.node.template,
        sourceAnchor: input.sourceAnchor,
        path: templatePath,
      }),
    ];
  }

  if (input.node.kind === "element" || input.node.kind === "fragment") {
    return input.node.children.flatMap((child, childIndex) =>
      resolvePlacementRegionPaths({
        node: child,
        sourceAnchor: input.sourceAnchor,
        path: [...input.path, { kind: "fragment-child", childIndex }],
      }),
    );
  }

  return [];
}

function resolveConditionalBranchPlacementPaths(input: {
  branch: "when-true" | "when-false";
  branchNode: import("../render-model/render-ir/types.js").RenderNode;
  siblingBranchNode: import("../render-model/render-ir/types.js").RenderNode;
  sourceAnchor: import("../../types/core.js").SourceAnchor;
  path: RenderRegion["path"];
}): RenderRegion["path"][] {
  if (!isRenderNodePlacementCandidate(input.branchNode, input.sourceAnchor)) {
    return [];
  }

  const matchingBranchPath: RenderRegion["path"] = [
    ...input.path,
    { kind: "conditional-branch", branch: input.branch },
  ];

  const siblingMatches = isRenderNodePlacementCandidate(
    input.siblingBranchNode,
    input.sourceAnchor,
  );
  if (
    siblingMatches &&
    normalizeProjectPath(input.siblingBranchNode.sourceAnchor.filePath) ===
      normalizeProjectPath(input.sourceAnchor.filePath)
  ) {
    return [];
  }

  return [
    matchingBranchPath,
    ...resolvePlacementRegionPaths({
      node: input.branchNode,
      sourceAnchor: input.sourceAnchor,
      path: matchingBranchPath,
    }),
  ];
}

function isRenderNodePlacementCandidate(
  node: import("../render-model/render-ir/types.js").RenderNode,
  sourceAnchor: import("../../types/core.js").SourceAnchor,
): boolean {
  const normalizedNodeFilePath = normalizeProjectPath(node.sourceAnchor.filePath);
  const normalizedSourceFilePath = normalizeProjectPath(sourceAnchor.filePath);
  if (normalizedNodeFilePath !== normalizedSourceFilePath) {
    return true;
  }

  return sourceAnchorContains(node.sourceAnchor, sourceAnchor);
}

function sourceAnchorContains(
  containing: import("../../types/core.js").SourceAnchor,
  contained: import("../../types/core.js").SourceAnchor,
): boolean {
  const normalizedContainingFilePath = normalizeProjectPath(containing.filePath);
  const normalizedContainedFilePath = normalizeProjectPath(contained.filePath);
  if (normalizedContainingFilePath !== normalizedContainedFilePath) {
    return false;
  }

  const containingStart = toAnchorPositionValue(containing.startLine, containing.startColumn);
  const containingEnd = toAnchorPositionValue(
    containing.endLine ?? containing.startLine,
    containing.endColumn ?? containing.startColumn,
  );
  const containedStart = toAnchorPositionValue(contained.startLine, contained.startColumn);
  const containedEnd = toAnchorPositionValue(
    contained.endLine ?? contained.startLine,
    contained.endColumn ?? contained.startColumn,
  );

  return containingStart <= containedStart && containingEnd >= containedEnd;
}

function toAnchorPositionValue(line: number, column: number): number {
  return line * 1_000_000 + column;
}
