import type { AnalysisTrace } from "../../types/analysis.js";
import type { RenderRegion, RenderSubtree } from "../render-model/render-ir/index.js";
import type { ReachabilityDerivation, StylesheetReachabilityContextRecord } from "./types.js";
import type {
  ComponentAvailabilityRecord,
  PlacedChildRenderRegion,
  ReachabilityGraphContext,
  UnknownReachabilityBarrier,
} from "./internalTypes.js";
import { normalizeProjectPath } from "./pathUtils.js";
import { addContextRecord } from "./recordUtils.js";
import { compareContextRecords, serializeRegionPath } from "./sortAndKeys.js";

export function buildContextRecords(input: {
  importingSourceFilePaths: string[];
  reachabilityGraphContext: ReachabilityGraphContext;
  componentAvailabilityByKey: Map<string, ComponentAvailabilityRecord>;
  includeTraces: boolean;
}): StylesheetReachabilityContextRecord[] {
  const contextRecordsByKey = new Map<string, StylesheetReachabilityContextRecord>();

  for (const filePath of input.importingSourceFilePaths) {
    addContextRecord(
      contextRecordsByKey,
      {
        context: {
          kind: "source-file",
          filePath,
        },
        availability: "definite",
        reasons: ["source file directly imports this stylesheet"],
        derivations: [{ kind: "source-file-direct-import" }],
      },
      input.includeTraces,
    );
  }

  const importingComponentKeySet = new Set(
    input.importingSourceFilePaths.flatMap(
      (filePath) => input.reachabilityGraphContext.componentKeysByFilePath.get(filePath) ?? [],
    ),
  );
  const importingComponentKeys = [...importingComponentKeySet].sort((left, right) =>
    left.localeCompare(right),
  );
  const availableComponentKeys = new Set(input.componentAvailabilityByKey.keys());

  for (const componentKey of importingComponentKeys) {
    const node = input.reachabilityGraphContext.renderGraphNodesByKey.get(componentKey);
    if (!node) {
      continue;
    }

    addContextRecord(
      contextRecordsByKey,
      {
        context: {
          kind: "component",
          filePath: normalizeProjectPath(node.filePath) ?? node.filePath,
          componentKey: node.componentKey,
          componentName: node.componentName,
        },
        availability: "definite",
        reasons: ["component is declared in a source file that directly imports this stylesheet"],
        derivations: [{ kind: "whole-component-direct-import" }],
      },
      input.includeTraces,
    );
  }

  for (const componentKey of input.componentAvailabilityByKey.keys()) {
    const node = input.reachabilityGraphContext.renderGraphNodesByKey.get(componentKey);
    if (!node) {
      continue;
    }

    const wholeComponentRegionAvailability = resolveWholeComponentRegionAvailability({
      componentKey,
      componentAvailabilityByKey: input.componentAvailabilityByKey,
      includeTraces: input.includeTraces,
    });

    if (wholeComponentRegionAvailability && !importingComponentKeySet.has(componentKey)) {
      addContextRecord(
        contextRecordsByKey,
        {
          context: {
            kind: "component",
            filePath: normalizeProjectPath(node.filePath) ?? node.filePath,
            componentKey: node.componentKey,
            componentName: node.componentName,
          },
          availability: wholeComponentRegionAvailability.availability,
          reasons: wholeComponentRegionAvailability.reasons,
          derivations: wholeComponentRegionAvailability.derivations,
          traces: wholeComponentRegionAvailability.traces,
        },
        input.includeTraces,
      );
    }

    if (wholeComponentRegionAvailability) {
      addRenderSubtreeRootContexts({
        contextRecordsByKey,
        renderSubtrees: [
          input.reachabilityGraphContext.renderSubtreesByComponentKey.get(componentKey),
        ].filter((subtree): subtree is RenderSubtree => Boolean(subtree)),
        availability: wholeComponentRegionAvailability.availability,
        reason:
          wholeComponentRegionAvailability.reasons[0] ??
          "render subtree root inherits component stylesheet availability",
        derivations: wholeComponentRegionAvailability.derivations,
        traces: wholeComponentRegionAvailability.traces,
        includeTraces: input.includeTraces,
        predicate: (subtree) =>
          (normalizeProjectPath(subtree.sourceAnchor.filePath) ?? subtree.sourceAnchor.filePath) ===
            (normalizeProjectPath(node.filePath) ?? node.filePath) &&
          subtree.componentKey === node.componentKey,
      });
      addRenderRegionContexts({
        contextRecordsByKey,
        renderRegions:
          input.reachabilityGraphContext.renderRegionsByComponentKey.get(componentKey) ?? [],
        availability: wholeComponentRegionAvailability.availability,
        reasons: wholeComponentRegionAvailability.reasons,
        derivations: wholeComponentRegionAvailability.derivations,
        traces: wholeComponentRegionAvailability.traces,
        includeTraces: input.includeTraces,
        predicate: () => true,
      });
    }
  }

  for (const componentKey of input.reachabilityGraphContext.componentKeys) {
    addPlacedChildRenderRegionContexts({
      contextRecordsByKey,
      placedChildRenderRegions:
        input.reachabilityGraphContext.placedChildRenderRegionsByComponentKey.get(componentKey) ??
        [],
      componentAvailabilityByKey: input.componentAvailabilityByKey,
      includeTraces: input.includeTraces,
    });

    if (!availableComponentKeys.has(componentKey)) {
      addUnknownBarrierContexts({
        contextRecordsByKey,
        renderSubtree:
          input.reachabilityGraphContext.renderSubtreesByComponentKey.get(componentKey),
        renderRegions:
          input.reachabilityGraphContext.renderRegionsByComponentKey.get(componentKey) ?? [],
        renderRegionsByPathKey:
          input.reachabilityGraphContext.renderRegionsByPathKeyByComponentKey.get(componentKey) ??
          new Map(),
        unknownBarriers:
          input.reachabilityGraphContext.unknownBarriersByComponentKey.get(componentKey) ?? [],
        includeTraces: input.includeTraces,
      });
    }
  }

  return [...contextRecordsByKey.values()].sort(compareContextRecords);
}

function resolveWholeComponentRegionAvailability(input: {
  componentKey: string;
  includeTraces: boolean;
  componentAvailabilityByKey: Map<
    string,
    {
      availability: StylesheetReachabilityContextRecord["availability"];
      reasons: string[];
      derivations: ReachabilityDerivation[];
      traces: AnalysisTrace[];
    }
  >;
}):
  | {
      availability: StylesheetReachabilityContextRecord["availability"];
      reasons: string[];
      derivations: ReachabilityDerivation[];
      traces: AnalysisTrace[];
    }
  | undefined {
  const availabilityRecord = input.componentAvailabilityByKey.get(input.componentKey);
  if (
    !availabilityRecord ||
    (availabilityRecord.availability !== "definite" &&
      availabilityRecord.availability !== "possible")
  ) {
    return undefined;
  }

  return {
    availability: availabilityRecord.availability,
    reasons: [...availabilityRecord.reasons],
    derivations: [...availabilityRecord.derivations],
    traces: input.includeTraces ? [...availabilityRecord.traces] : [],
  };
}

function addPlacedChildRenderRegionContexts(input: {
  contextRecordsByKey: Map<string, StylesheetReachabilityContextRecord>;
  placedChildRenderRegions: PlacedChildRenderRegion[];
  componentAvailabilityByKey: Map<
    string,
    {
      availability: StylesheetReachabilityContextRecord["availability"];
      reasons: string[];
      derivations: ReachabilityDerivation[];
      traces: AnalysisTrace[];
    }
  >;
  includeTraces: boolean;
}): void {
  for (const placement of input.placedChildRenderRegions) {
    const { edge } = placement;
    const childAvailability = edge.toComponentKey
      ? input.componentAvailabilityByKey.get(edge.toComponentKey)
      : undefined;
    if (
      !childAvailability ||
      (childAvailability.availability !== "definite" &&
        childAvailability.availability !== "possible")
    ) {
      continue;
    }

    const availability =
      childAvailability.availability === "definite" && edge.renderPath === "definite"
        ? "definite"
        : "possible";
    const reasons =
      availability === "definite"
        ? [
            `region can render ${edge.toComponentName} from ${normalizeProjectPath(edge.toFilePath) ?? edge.toFilePath}, which has definite stylesheet availability`,
          ]
        : [
            `region can render ${edge.toComponentName} from ${normalizeProjectPath(edge.toFilePath) ?? edge.toFilePath}, which has stylesheet availability`,
          ];
    const derivations: ReachabilityDerivation[] = [
      {
        kind: "placement-derived-region",
        toComponentKey: edge.toComponentKey,
        toComponentName: edge.toComponentName,
        toFilePath: edge.toFilePath,
        renderPath: edge.renderPath,
      },
    ];

    for (const renderRegion of placement.renderRegions) {
      addContextRecord(
        input.contextRecordsByKey,
        {
          context: {
            kind: "render-region",
            filePath: renderRegion.filePath,
            componentKey: renderRegion.componentKey,
            componentName: renderRegion.componentName,
            regionKind: renderRegion.kind,
            path: renderRegion.path,
            sourceAnchor: {
              startLine: renderRegion.sourceAnchor.startLine,
              startColumn: renderRegion.sourceAnchor.startColumn,
              endLine: renderRegion.sourceAnchor.endLine,
              endColumn: renderRegion.sourceAnchor.endColumn,
            },
          },
          availability,
          reasons,
          derivations,
          traces: input.includeTraces ? edge.traces : [],
        },
        input.includeTraces,
      );
    }
  }
}

function addUnknownBarrierContexts(input: {
  contextRecordsByKey: Map<string, StylesheetReachabilityContextRecord>;
  renderSubtree?: RenderSubtree;
  renderRegions: RenderRegion[];
  renderRegionsByPathKey: Map<string, RenderRegion[]>;
  unknownBarriers: UnknownReachabilityBarrier[];
  includeTraces: boolean;
}): void {
  if (
    !input.renderSubtree ||
    input.unknownBarriers.length === 0 ||
    !input.renderSubtree.componentName
  ) {
    return;
  }

  const uniqueReasons = [...new Set(input.unknownBarriers.map((barrier) => barrier.reason))].sort(
    (left, right) => left.localeCompare(right),
  );
  const derivations = uniqueReasons.map<ReachabilityDerivation>((reason) => ({
    kind: "whole-component-unknown-barrier",
    reason,
  }));

  addContextRecord(
    input.contextRecordsByKey,
    {
      context: {
        kind: "component",
        filePath:
          normalizeProjectPath(input.renderSubtree.sourceAnchor.filePath) ??
          input.renderSubtree.sourceAnchor.filePath,
        componentKey: input.renderSubtree.componentKey,
        componentName: input.renderSubtree.componentName,
      },
      availability: "unknown",
      reasons: [
        "component contains unsupported or budget-limited render expansion that may hide stylesheet availability",
      ],
      derivations,
    },
    input.includeTraces,
  );

  addContextRecord(
    input.contextRecordsByKey,
    {
      context: {
        kind: "render-subtree-root",
        filePath:
          normalizeProjectPath(input.renderSubtree.sourceAnchor.filePath) ??
          input.renderSubtree.sourceAnchor.filePath,
        componentKey: input.renderSubtree.componentKey,
        componentName: input.renderSubtree.componentName,
        rootAnchor: {
          startLine: input.renderSubtree.root.sourceAnchor.startLine,
          startColumn: input.renderSubtree.root.sourceAnchor.startColumn,
          endLine: input.renderSubtree.root.sourceAnchor.endLine,
          endColumn: input.renderSubtree.root.sourceAnchor.endColumn,
        },
      },
      availability: "unknown",
      reasons: [
        "render subtree contains unsupported or budget-limited expansion that may hide stylesheet availability",
      ],
      derivations,
    },
    input.includeTraces,
  );

  for (const barrier of input.unknownBarriers) {
    for (const renderRegion of collectRenderRegionsForBarrierPath({
      barrierPath: barrier.path,
      renderRegionsByPathKey: input.renderRegionsByPathKey,
    })) {
      if (renderRegion.kind === "subtree-root") {
        continue;
      }

      addContextRecord(
        input.contextRecordsByKey,
        {
          context: {
            kind: "render-region",
            filePath: renderRegion.filePath,
            componentKey: renderRegion.componentKey,
            componentName: renderRegion.componentName,
            regionKind: renderRegion.kind,
            path: renderRegion.path,
            sourceAnchor: {
              startLine: renderRegion.sourceAnchor.startLine,
              startColumn: renderRegion.sourceAnchor.startColumn,
              endLine: renderRegion.sourceAnchor.endLine,
              endColumn: renderRegion.sourceAnchor.endColumn,
            },
          },
          availability: "unknown",
          reasons: [
            "render region contains unsupported or budget-limited expansion that may hide stylesheet availability",
          ],
          derivations: [{ kind: "render-region-unknown-barrier", reason: barrier.reason }],
        },
        input.includeTraces,
      );
    }
  }
}

function collectRenderRegionsForBarrierPath(input: {
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

function addRenderSubtreeRootContexts(input: {
  contextRecordsByKey: Map<string, StylesheetReachabilityContextRecord>;
  renderSubtrees: RenderSubtree[];
  availability: StylesheetReachabilityContextRecord["availability"];
  reason: string;
  derivations: ReachabilityDerivation[];
  traces: AnalysisTrace[];
  includeTraces: boolean;
  predicate: (subtree: RenderSubtree) => boolean;
}): void {
  for (const subtree of input.renderSubtrees.filter(input.predicate)) {
    addContextRecord(
      input.contextRecordsByKey,
      {
        context: {
          kind: "render-subtree-root",
          filePath:
            normalizeProjectPath(subtree.sourceAnchor.filePath) ?? subtree.sourceAnchor.filePath,
          componentKey: subtree.componentKey,
          componentName: subtree.componentName,
          rootAnchor: {
            startLine: subtree.root.sourceAnchor.startLine,
            startColumn: subtree.root.sourceAnchor.startColumn,
            endLine: subtree.root.sourceAnchor.endLine,
            endColumn: subtree.root.sourceAnchor.endColumn,
          },
        },
        availability: input.availability,
        reasons: [input.reason],
        derivations: [...input.derivations],
        traces: input.includeTraces ? [...input.traces] : [],
      },
      input.includeTraces,
    );
  }
}

function addRenderRegionContexts(input: {
  contextRecordsByKey: Map<string, StylesheetReachabilityContextRecord>;
  renderRegions: RenderRegion[];
  availability: StylesheetReachabilityContextRecord["availability"];
  reasons: string[];
  derivations: ReachabilityDerivation[];
  traces: AnalysisTrace[];
  includeTraces: boolean;
  predicate: (region: RenderRegion) => boolean;
}): void {
  for (const region of input.renderRegions.filter(input.predicate)) {
    if (region.kind === "subtree-root") {
      continue;
    }

    addContextRecord(
      input.contextRecordsByKey,
      {
        context: {
          kind: "render-region",
          filePath: region.filePath,
          componentKey: region.componentKey,
          componentName: region.componentName,
          regionKind: region.kind,
          path: region.path,
          sourceAnchor: {
            startLine: region.sourceAnchor.startLine,
            startColumn: region.sourceAnchor.startColumn,
            endLine: region.sourceAnchor.endLine,
            endColumn: region.sourceAnchor.endColumn,
          },
        },
        availability: input.availability,
        reasons: [...input.reasons],
        derivations: [...input.derivations],
        traces: input.includeTraces ? [...input.traces] : [],
      },
      input.includeTraces,
    );
  }
}
