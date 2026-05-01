import type { AnalysisTrace } from "../../types/analysis.js";
import type { ReachabilityDerivation, StylesheetReachabilityContextRecord } from "./types.js";
import type {
  ComponentAvailabilityRecord,
  PlacedChildRenderRegion,
  ReachabilityRenderRegion,
  ReachabilityGraphContext,
  ReachabilityComponentRoot,
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
        componentRoots: [
          input.reachabilityGraphContext.componentRootsByComponentKey.get(componentKey),
        ].filter((root): root is ReachabilityComponentRoot => Boolean(root)),
        availability: wholeComponentRegionAvailability.availability,
        reason:
          wholeComponentRegionAvailability.reasons[0] ??
          "render subtree root inherits component stylesheet availability",
        derivations: wholeComponentRegionAvailability.derivations,
        traces: wholeComponentRegionAvailability.traces,
        includeTraces: input.includeTraces,
        predicate: (root) =>
          (normalizeProjectPath(root.filePath) ?? root.filePath) ===
            (normalizeProjectPath(node.filePath) ?? node.filePath) &&
          root.componentKey === node.componentKey,
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
        componentRoot:
          input.reachabilityGraphContext.componentRootsByComponentKey.get(componentKey),
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
  componentRoot?: ReachabilityComponentRoot;
  renderRegions: ReachabilityRenderRegion[];
  renderRegionsByPathKey: Map<string, ReachabilityRenderRegion[]>;
  unknownBarriers: UnknownReachabilityBarrier[];
  includeTraces: boolean;
}): void {
  if (
    !input.componentRoot ||
    input.unknownBarriers.length === 0 ||
    !input.componentRoot.componentName
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
          normalizeProjectPath(input.componentRoot.filePath) ?? input.componentRoot.filePath,
        componentKey: input.componentRoot.componentKey,
        componentName: input.componentRoot.componentName,
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
          normalizeProjectPath(input.componentRoot.filePath) ?? input.componentRoot.filePath,
        componentKey: input.componentRoot.componentKey,
        componentName: input.componentRoot.componentName,
        rootAnchor: {
          startLine: input.componentRoot.rootSourceAnchor.startLine,
          startColumn: input.componentRoot.rootSourceAnchor.startColumn,
          endLine: input.componentRoot.rootSourceAnchor.endLine,
          endColumn: input.componentRoot.rootSourceAnchor.endColumn,
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
  barrierPath: ReachabilityRenderRegion["path"];
  renderRegionsByPathKey: Map<string, ReachabilityRenderRegion[]>;
}): ReachabilityRenderRegion[] {
  const renderRegions: ReachabilityRenderRegion[] = [];
  for (let length = 1; length <= input.barrierPath.length; length += 1) {
    const pathKey = serializeRegionPath(input.barrierPath.slice(0, length));
    renderRegions.push(...(input.renderRegionsByPathKey.get(pathKey) ?? []));
  }

  return renderRegions;
}

function addRenderSubtreeRootContexts(input: {
  contextRecordsByKey: Map<string, StylesheetReachabilityContextRecord>;
  componentRoots: ReachabilityComponentRoot[];
  availability: StylesheetReachabilityContextRecord["availability"];
  reason: string;
  derivations: ReachabilityDerivation[];
  traces: AnalysisTrace[];
  includeTraces: boolean;
  predicate: (root: ReachabilityComponentRoot) => boolean;
}): void {
  for (const root of input.componentRoots.filter(input.predicate)) {
    addContextRecord(
      input.contextRecordsByKey,
      {
        context: {
          kind: "render-subtree-root",
          filePath: normalizeProjectPath(root.filePath) ?? root.filePath,
          componentKey: root.componentKey,
          componentName: root.componentName,
          rootAnchor: {
            startLine: root.rootSourceAnchor.startLine,
            startColumn: root.rootSourceAnchor.startColumn,
            endLine: root.rootSourceAnchor.endLine,
            endColumn: root.rootSourceAnchor.endColumn,
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
  renderRegions: ReachabilityRenderRegion[];
  availability: StylesheetReachabilityContextRecord["availability"];
  reasons: string[];
  derivations: ReachabilityDerivation[];
  traces: AnalysisTrace[];
  includeTraces: boolean;
  predicate: (region: ReachabilityRenderRegion) => boolean;
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
