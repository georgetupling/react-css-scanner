import type { ModuleGraph } from "../module-graph/types.js";
import type { RenderGraph } from "../render-model/render-graph/types.js";
import {
  collectRenderRegionsFromSubtrees,
  type RenderRegion,
  type RenderNode,
  type RenderSubtree,
} from "../render-model/render-ir/index.js";
import type { ExternalCssSummary } from "../external-css/types.js";
import type { SelectorSourceInput } from "../selector-analysis/types.js";
import type { AnalysisTrace } from "../../types/analysis.js";
import type {
  ReachabilityDerivation,
  ReachabilitySummary,
  StylesheetReachabilityContextRecord,
  StylesheetReachabilityRecord,
} from "./types.js";

export function buildReachabilitySummary(input: {
  moduleGraph: ModuleGraph;
  renderGraph: RenderGraph;
  renderSubtrees: RenderSubtree[];
  cssSources: SelectorSourceInput[];
  externalCssSummary: ExternalCssSummary;
}): ReachabilitySummary {
  const knownCssFilePaths = new Set(
    input.cssSources
      .map((cssSource) => normalizeProjectPath(cssSource.filePath))
      .filter(Boolean) as string[],
  );
  const projectWideExternalStylesheetFilePaths = new Set(
    input.externalCssSummary.projectWideStylesheetFilePaths
      .map((filePath) => normalizeProjectPath(filePath))
      .filter(Boolean) as string[],
  );
  const analyzedSourceFilePaths = collectAnalyzedSourceFilePaths(input.moduleGraph);

  return {
    stylesheets: input.cssSources.map((cssSource) =>
      buildStylesheetReachabilityRecord({
        cssSource,
        moduleGraph: input.moduleGraph,
        renderGraph: input.renderGraph,
        renderSubtrees: input.renderSubtrees,
        knownCssFilePaths,
        projectWideExternalStylesheetFilePaths,
        analyzedSourceFilePaths,
      }),
    ),
  };
}

function buildStylesheetReachabilityRecord(input: {
  cssSource: SelectorSourceInput;
  moduleGraph: ModuleGraph;
  renderGraph: RenderGraph;
  renderSubtrees: RenderSubtree[];
  knownCssFilePaths: Set<string>;
  projectWideExternalStylesheetFilePaths: Set<string>;
  analyzedSourceFilePaths: string[];
}): StylesheetReachabilityRecord {
  const cssFilePath = normalizeProjectPath(input.cssSource.filePath);
  if (!cssFilePath) {
    return withStylesheetRecordTraces({
      cssFilePath: input.cssSource.filePath,
      availability: "unknown",
      contexts: [],
      reasons: [
        "stylesheet source does not have a file path, so reachability cannot be determined",
      ],
      traces: [],
    });
  }

  const directlyImportingSourceFilePaths: string[] = [];
  for (const moduleNode of input.moduleGraph.modulesById.values()) {
    if (moduleNode.kind !== "source") {
      continue;
    }

    const importsCssSource = moduleNode.imports.some((importRecord) => {
      if (importRecord.importKind === "css") {
        return (
          resolveCssImportPath({
            fromFilePath: moduleNode.filePath,
            specifier: importRecord.specifier,
            knownCssFilePaths: input.knownCssFilePaths,
          }) === cssFilePath
        );
      }

      if (importRecord.importKind === "external-css") {
        return (
          (normalizeProjectPath(importRecord.specifier) ?? importRecord.specifier) === cssFilePath
        );
      }

      return false;
    });

    if (importsCssSource) {
      directlyImportingSourceFilePaths.push(moduleNode.filePath.replace(/\\/g, "/"));
    }
  }

  const contextRecordsByKey = new Map<string, StylesheetReachabilityContextRecord>();
  const sortedImportingSourceFilePaths = directlyImportingSourceFilePaths.sort((left, right) =>
    left.localeCompare(right),
  );

  if (sortedImportingSourceFilePaths.length > 0) {
    for (const contextRecord of buildContextRecords({
      importingSourceFilePaths: sortedImportingSourceFilePaths,
      renderGraph: input.renderGraph,
      renderSubtrees: input.renderSubtrees,
    })) {
      contextRecordsByKey.set(serializeContextKey(contextRecord), contextRecord);
    }
  }

  const isProjectWideExternalStylesheet =
    input.projectWideExternalStylesheetFilePaths.has(cssFilePath);
  if (isProjectWideExternalStylesheet) {
    for (const filePath of input.analyzedSourceFilePaths) {
      addContextRecord(contextRecordsByKey, {
        context: {
          kind: "source-file",
          filePath,
        },
        availability: "definite",
        reasons: [
          "source file is covered by a project-wide HTML-linked remote external stylesheet",
        ],
        derivations: [
          {
            kind: "source-file-project-wide-external-css",
            stylesheetHref: cssFilePath,
          },
        ],
      });
    }
  }

  const contextRecords = [...contextRecordsByKey.values()].sort(compareContextRecords);
  if (contextRecords.length === 0) {
    return withStylesheetRecordTraces({
      cssFilePath: input.cssSource.filePath,
      availability: "unavailable",
      contexts: [],
      reasons: [
        input.projectWideExternalStylesheetFilePaths.size > 0
          ? "no analyzed source file directly imports this stylesheet or reaches it project-wide"
          : "no analyzed source file directly imports this stylesheet",
      ],
      traces: [],
    });
  }

  const reasons: string[] = [];
  if (sortedImportingSourceFilePaths.length > 0) {
    reasons.push(
      `stylesheet is directly imported by ${sortedImportingSourceFilePaths.length} analyzed source file${sortedImportingSourceFilePaths.length === 1 ? "" : "s"}`,
    );
  }
  if (isProjectWideExternalStylesheet) {
    reasons.push(
      "stylesheet is active project-wide through an HTML-linked remote external stylesheet",
    );
  }
  reasons.push(
    `reachability is attached to ${contextRecords.length} explicit render context${contextRecords.length === 1 ? "" : "s"}`,
  );

  return withStylesheetRecordTraces({
    cssFilePath: input.cssSource.filePath,
    availability: contextRecords.some((context) => context.availability === "definite")
      ? "definite"
      : contextRecords.some((context) => context.availability === "possible")
        ? "possible"
        : contextRecords.some((context) => context.availability === "unknown")
          ? "unknown"
          : "unavailable",
    contexts: contextRecords,
    reasons,
    traces: [],
  });
}

function collectAnalyzedSourceFilePaths(moduleGraph: ModuleGraph): string[] {
  return [...moduleGraph.modulesById.values()]
    .filter((moduleNode) => moduleNode.kind === "source")
    .map((moduleNode) => normalizeProjectPath(moduleNode.filePath) ?? moduleNode.filePath)
    .sort((left, right) => left.localeCompare(right));
}

function buildContextRecords(input: {
  importingSourceFilePaths: string[];
  renderGraph: RenderGraph;
  renderSubtrees: RenderSubtree[];
}): StylesheetReachabilityContextRecord[] {
  const contextRecordsByKey = new Map<string, StylesheetReachabilityContextRecord>();
  const renderRegions = collectRenderRegionsFromSubtrees(input.renderSubtrees);
  const renderRegionsByComponentKey = new Map<string, RenderRegion[]>();
  const renderSubtreesByComponentKey = new Map<string, RenderSubtree>();
  const unknownBarriersByComponentKey = new Map<string, UnknownReachabilityBarrier[]>();
  const renderGraphNodesByKey = new Map(
    input.renderGraph.nodes.map((node) => [
      createComponentKey(node.filePath, node.componentName),
      node,
    ]),
  );
  const directImportingSourceFilePathSet = new Set(input.importingSourceFilePaths);

  for (const renderRegion of renderRegions) {
    if (!renderRegion.componentName) {
      continue;
    }

    const componentKey = createComponentKey(renderRegion.filePath, renderRegion.componentName);
    renderRegionsByComponentKey.set(componentKey, [
      ...(renderRegionsByComponentKey.get(componentKey) ?? []),
      renderRegion,
    ]);
  }

  for (const renderSubtree of input.renderSubtrees) {
    if (!renderSubtree.componentName) {
      continue;
    }

    const componentKey = createComponentKey(
      normalizeProjectPath(renderSubtree.sourceAnchor.filePath) ??
        renderSubtree.sourceAnchor.filePath,
      renderSubtree.componentName,
    );
    renderSubtreesByComponentKey.set(componentKey, renderSubtree);
    unknownBarriersByComponentKey.set(
      componentKey,
      collectUnknownReachabilityBarriersFromSubtree(renderSubtree),
    );
  }

  for (const filePath of input.importingSourceFilePaths) {
    addContextRecord(contextRecordsByKey, {
      context: {
        kind: "source-file",
        filePath,
      },
      availability: "definite",
      reasons: ["source file directly imports this stylesheet"],
      derivations: [{ kind: "source-file-direct-import" }],
    });
  }

  const outgoingEdgesByComponentKey = new Map<string, typeof input.renderGraph.edges>();
  const incomingEdgesByComponentKey = new Map<string, typeof input.renderGraph.edges>();
  for (const edge of input.renderGraph.edges) {
    if (edge.resolution !== "resolved" || !edge.toFilePath) {
      continue;
    }

    const fromKey = createComponentKey(edge.fromFilePath, edge.fromComponentName);
    const toKey = createComponentKey(edge.toFilePath, edge.toComponentName);
    outgoingEdgesByComponentKey.set(fromKey, [
      ...(outgoingEdgesByComponentKey.get(fromKey) ?? []),
      edge,
    ]);
    incomingEdgesByComponentKey.set(toKey, [
      ...(incomingEdgesByComponentKey.get(toKey) ?? []),
      edge,
    ]);
  }

  const componentAvailabilityByKey = computeComponentAvailability({
    renderGraphNodesByKey,
    incomingEdgesByComponentKey,
    directImportingSourceFilePathSet,
  });

  const importingComponentKeys = input.renderGraph.nodes
    .filter((node) =>
      input.importingSourceFilePaths.includes(normalizeProjectPath(node.filePath) ?? node.filePath),
    )
    .map((node) => createComponentKey(node.filePath, node.componentName))
    .sort((left, right) => left.localeCompare(right));

  for (const componentKey of importingComponentKeys) {
    const node = renderGraphNodesByKey.get(componentKey);
    if (!node) {
      continue;
    }

    addContextRecord(contextRecordsByKey, {
      context: {
        kind: "component",
        filePath: normalizeProjectPath(node.filePath) ?? node.filePath,
        componentName: node.componentName,
      },
      availability: "definite",
      reasons: ["component is declared in a source file that directly imports this stylesheet"],
      derivations: [{ kind: "whole-component-direct-import" }],
    });
  }

  for (const [componentKey, availabilityRecord] of componentAvailabilityByKey.entries()) {
    const node = renderGraphNodesByKey.get(componentKey);
    if (!node) {
      continue;
    }

    const wholeComponentRegionAvailability = resolveWholeComponentRegionAvailability({
      componentKey,
      componentAvailabilityByKey,
    });

    if (wholeComponentRegionAvailability && !importingComponentKeys.includes(componentKey)) {
      addContextRecord(contextRecordsByKey, {
        context: {
          kind: "component",
          filePath: normalizeProjectPath(node.filePath) ?? node.filePath,
          componentName: node.componentName,
        },
        availability: wholeComponentRegionAvailability.availability,
        reasons: wholeComponentRegionAvailability.reasons,
        derivations: wholeComponentRegionAvailability.derivations,
        traces: wholeComponentRegionAvailability.traces,
      });
    }

    if (wholeComponentRegionAvailability) {
      addRenderSubtreeRootContexts({
        contextRecordsByKey,
        renderSubtrees: input.renderSubtrees,
        availability: wholeComponentRegionAvailability.availability,
        reason:
          wholeComponentRegionAvailability.reasons[0] ??
          "render subtree root inherits component stylesheet availability",
        derivations: wholeComponentRegionAvailability.derivations,
        traces: wholeComponentRegionAvailability.traces,
        predicate: (subtree) =>
          (normalizeProjectPath(subtree.sourceAnchor.filePath) ?? subtree.sourceAnchor.filePath) ===
            (normalizeProjectPath(node.filePath) ?? node.filePath) &&
          subtree.componentName === node.componentName,
      });
      addRenderRegionContexts({
        contextRecordsByKey,
        renderRegions: renderRegionsByComponentKey.get(componentKey) ?? [],
        availability: wholeComponentRegionAvailability.availability,
        reasons: wholeComponentRegionAvailability.reasons,
        derivations: wholeComponentRegionAvailability.derivations,
        traces: wholeComponentRegionAvailability.traces,
        predicate: () => true,
      });
    }

    addPlacedChildRenderRegionContexts({
      contextRecordsByKey,
      renderSubtree: renderSubtreesByComponentKey.get(componentKey),
      renderRegions: renderRegionsByComponentKey.get(componentKey) ?? [],
      outgoingEdges: [...(outgoingEdgesByComponentKey.get(componentKey) ?? [])].sort(compareEdges),
      componentAvailabilityByKey,
    });

    if (availabilityRecord.availability === "unavailable") {
      addUnknownBarrierContexts({
        contextRecordsByKey,
        renderSubtree: renderSubtreesByComponentKey.get(componentKey),
        renderRegions: renderRegionsByComponentKey.get(componentKey) ?? [],
        unknownBarriers: unknownBarriersByComponentKey.get(componentKey) ?? [],
      });
    }
  }

  return [...contextRecordsByKey.values()].sort(compareContextRecords);
}

function resolveWholeComponentRegionAvailability(input: {
  componentKey: string;
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
    traces: [...availabilityRecord.traces],
  };
}

function addPlacedChildRenderRegionContexts(input: {
  contextRecordsByKey: Map<string, StylesheetReachabilityContextRecord>;
  renderSubtree?: RenderSubtree;
  renderRegions: RenderRegion[];
  outgoingEdges: import("../render-model/render-graph/types.js").RenderGraphEdge[];
  componentAvailabilityByKey: Map<
    string,
    {
      availability: StylesheetReachabilityContextRecord["availability"];
      reasons: string[];
      derivations: ReachabilityDerivation[];
      traces: AnalysisTrace[];
    }
  >;
}): void {
  for (const edge of input.outgoingEdges) {
    const childAvailability = input.componentAvailabilityByKey.get(
      createComponentKey(edge.toFilePath ?? "", edge.toComponentName),
    );
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
        toComponentName: edge.toComponentName,
        toFilePath: edge.toFilePath,
        renderPath: edge.renderPath,
      },
    ];

    for (const renderRegion of findContainingRenderRegionsForEdge({
      renderSubtree: input.renderSubtree,
      renderRegions: input.renderRegions,
      sourceAnchor: edge.sourceAnchor,
    })) {
      addContextRecord(input.contextRecordsByKey, {
        context: {
          kind: "render-region",
          filePath: renderRegion.filePath,
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
        traces: edge.traces,
      });
    }
  }
}

type UnknownReachabilityBarrier = {
  path: import("../render-model/render-ir/types.js").RenderRegionPathSegment[];
  reason: string;
  sourceAnchor: import("../../types/core.js").SourceAnchor;
};

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
      path: input.path,
      reason: input.node.reason,
      sourceAnchor: input.node.placementAnchor ?? input.node.sourceAnchor,
    });
    return;
  }

  if (input.node.kind === "component-reference") {
    input.barriers.push({
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

function addUnknownBarrierContexts(input: {
  contextRecordsByKey: Map<string, StylesheetReachabilityContextRecord>;
  renderSubtree?: RenderSubtree;
  renderRegions: RenderRegion[];
  unknownBarriers: UnknownReachabilityBarrier[];
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

  addContextRecord(input.contextRecordsByKey, {
    context: {
      kind: "component",
      filePath:
        normalizeProjectPath(input.renderSubtree.sourceAnchor.filePath) ??
        input.renderSubtree.sourceAnchor.filePath,
      componentName: input.renderSubtree.componentName,
    },
    availability: "unknown",
    reasons: [
      "component contains unsupported or budget-limited render expansion that may hide stylesheet availability",
    ],
    derivations,
  });

  addContextRecord(input.contextRecordsByKey, {
    context: {
      kind: "render-subtree-root",
      filePath:
        normalizeProjectPath(input.renderSubtree.sourceAnchor.filePath) ??
        input.renderSubtree.sourceAnchor.filePath,
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
  });

  for (const barrier of input.unknownBarriers) {
    for (const renderRegion of input.renderRegions.filter((region) =>
      isRegionPathPrefix(region.path, barrier.path),
    )) {
      if (renderRegion.kind === "subtree-root") {
        continue;
      }

      addContextRecord(input.contextRecordsByKey, {
        context: {
          kind: "render-region",
          filePath: renderRegion.filePath,
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
      });
    }
  }
}

function findContainingRenderRegionsForEdge(input: {
  renderSubtree?: RenderSubtree;
  renderRegions: RenderRegion[];
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

  return input.renderRegions.filter((renderRegion) =>
    matchingPathKeys.has(serializeRegionPath(renderRegion.path)),
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

function computeComponentAvailability(input: {
  renderGraphNodesByKey: Map<
    string,
    import("../render-model/render-graph/types.js").RenderGraphNode
  >;
  incomingEdgesByComponentKey: Map<
    string,
    import("../render-model/render-graph/types.js").RenderGraphEdge[]
  >;
  directImportingSourceFilePathSet: Set<string>;
}): Map<
  string,
  {
    availability: StylesheetReachabilityContextRecord["availability"];
    reasons: string[];
    derivations: ReachabilityDerivation[];
    traces: AnalysisTrace[];
  }
> {
  const availabilityByComponentKey = new Map<
    string,
    {
      availability: StylesheetReachabilityContextRecord["availability"];
      reasons: string[];
      derivations: ReachabilityDerivation[];
      traces: AnalysisTrace[];
    }
  >();

  const sortedComponentKeys = [...input.renderGraphNodesByKey.keys()].sort((left, right) =>
    left.localeCompare(right),
  );

  for (const componentKey of sortedComponentKeys) {
    const node = input.renderGraphNodesByKey.get(componentKey);
    if (!node) {
      continue;
    }

    if (
      input.directImportingSourceFilePathSet.has(
        normalizeProjectPath(node.filePath) ?? node.filePath,
      )
    ) {
      availabilityByComponentKey.set(componentKey, {
        availability: "definite",
        reasons: ["component is declared in a source file that directly imports this stylesheet"],
        derivations: [{ kind: "whole-component-direct-import" }],
        traces: [],
      });
      continue;
    }

    availabilityByComponentKey.set(componentKey, {
      availability: "unavailable",
      reasons: [],
      derivations: [],
      traces: [],
    });
  }

  let changed = true;
  while (changed) {
    changed = false;

    for (const componentKey of sortedComponentKeys) {
      const node = input.renderGraphNodesByKey.get(componentKey);
      if (!node) {
        continue;
      }

      const currentAvailabilityRecord = availabilityByComponentKey.get(componentKey);
      if (
        input.directImportingSourceFilePathSet.has(
          normalizeProjectPath(node.filePath) ?? node.filePath,
        ) &&
        currentAvailabilityRecord?.availability === "definite"
      ) {
        continue;
      }

      const nextAvailabilityRecord = evaluateComponentAvailability({
        incomingEdges: [...(input.incomingEdgesByComponentKey.get(componentKey) ?? [])].sort(
          compareEdges,
        ),
        availabilityByComponentKey,
      });

      if (
        currentAvailabilityRecord?.availability !== nextAvailabilityRecord.availability ||
        !areReasonsEqual(
          currentAvailabilityRecord?.reasons ?? [],
          nextAvailabilityRecord.reasons,
        ) ||
        !areDerivationsEqual(
          currentAvailabilityRecord?.derivations ?? [],
          nextAvailabilityRecord.derivations,
        ) ||
        !areTracesEqual(currentAvailabilityRecord?.traces ?? [], nextAvailabilityRecord.traces)
      ) {
        availabilityByComponentKey.set(componentKey, nextAvailabilityRecord);
        changed = true;
      }
    }
  }

  return availabilityByComponentKey;
}

function evaluateComponentAvailability(input: {
  incomingEdges: import("../render-model/render-graph/types.js").RenderGraphEdge[];
  availabilityByComponentKey: Map<
    string,
    {
      availability: StylesheetReachabilityContextRecord["availability"];
      reasons: string[];
      derivations: ReachabilityDerivation[];
      traces: AnalysisTrace[];
    }
  >;
}): {
  availability: StylesheetReachabilityContextRecord["availability"];
  reasons: string[];
  derivations: ReachabilityDerivation[];
  traces: AnalysisTrace[];
} {
  if (input.incomingEdges.length > 0) {
    const parentAvailabilities = input.incomingEdges.map((edge) => ({
      edge,
      availability: input.availabilityByComponentKey.get(
        createComponentKey(edge.fromFilePath, edge.fromComponentName),
      ),
    }));
    const allParentsDefinite =
      parentAvailabilities.length > 0 &&
      parentAvailabilities.every(
        ({ edge, availability }) =>
          availability?.availability === "definite" && edge.renderPath === "definite",
      );
    if (allParentsDefinite) {
      return {
        availability: "definite",
        reasons: ["all known renderers of this component have definite stylesheet availability"],
        derivations: [{ kind: "whole-component-all-known-renderers-definite" }],
        traces: parentAvailabilities.flatMap(({ edge }) => edge.traces),
      };
    }
  }

  const availableParentEdges = input.incomingEdges.filter((edge) => {
    const parentAvailability = input.availabilityByComponentKey.get(
      createComponentKey(edge.fromFilePath, edge.fromComponentName),
    );
    return (
      parentAvailability?.availability === "definite" ||
      parentAvailability?.availability === "possible"
    );
  });
  if (availableParentEdges.length > 0) {
    const definitePathParentEdges = availableParentEdges.filter(
      (edge) => edge.renderPath === "definite",
    );
    if (definitePathParentEdges.length > 0) {
      return {
        availability: "possible",
        reasons: ["at least one known renderer of this component has stylesheet availability"],
        derivations: [{ kind: "whole-component-at-least-one-renderer" }],
        traces: definitePathParentEdges.flatMap((edge) => edge.traces),
      };
    }

    return {
      availability: "possible",
      reasons: [
        "this component is only rendered on possible paths beneath a renderer with stylesheet availability",
      ],
      derivations: [{ kind: "whole-component-only-possible-renderers" }],
      traces: availableParentEdges.flatMap((edge) => edge.traces),
    };
  }

  return {
    availability: "unavailable",
    reasons: [],
    derivations: [],
    traces: [],
  };
}

function areReasonsEqual(left: string[], right: string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((reason, index) => reason === right[index]);
}

function areDerivationsEqual(
  left: ReachabilityDerivation[],
  right: ReachabilityDerivation[],
): boolean {
  if (left.length !== right.length) {
    return false;
  }

  const sortedLeft = [...left].sort(compareDerivations);
  const sortedRight = [...right].sort(compareDerivations);
  return sortedLeft.every(
    (derivation, index) =>
      serializeDerivation(derivation) === serializeDerivation(sortedRight[index]),
  );
}

function areTracesEqual(left: AnalysisTrace[], right: AnalysisTrace[]): boolean {
  if (left.length !== right.length) {
    return false;
  }

  const sortedLeft = [...left].sort((a, b) => serializeTrace(a).localeCompare(serializeTrace(b)));
  const sortedRight = [...right].sort((a, b) => serializeTrace(a).localeCompare(serializeTrace(b)));
  return sortedLeft.every(
    (trace, index) => serializeTrace(trace) === serializeTrace(sortedRight[index]),
  );
}

function addRenderSubtreeRootContexts(input: {
  contextRecordsByKey: Map<string, StylesheetReachabilityContextRecord>;
  renderSubtrees: RenderSubtree[];
  availability: StylesheetReachabilityContextRecord["availability"];
  reason: string;
  derivations: ReachabilityDerivation[];
  traces: AnalysisTrace[];
  predicate: (subtree: RenderSubtree) => boolean;
}): void {
  for (const subtree of input.renderSubtrees.filter(input.predicate)) {
    addContextRecord(input.contextRecordsByKey, {
      context: {
        kind: "render-subtree-root",
        filePath:
          normalizeProjectPath(subtree.sourceAnchor.filePath) ?? subtree.sourceAnchor.filePath,
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
      traces: [...input.traces],
    });
  }
}

function addRenderRegionContexts(input: {
  contextRecordsByKey: Map<string, StylesheetReachabilityContextRecord>;
  renderRegions: RenderRegion[];
  availability: StylesheetReachabilityContextRecord["availability"];
  reasons: string[];
  derivations: ReachabilityDerivation[];
  traces: AnalysisTrace[];
  predicate: (region: RenderRegion) => boolean;
}): void {
  for (const region of input.renderRegions.filter(input.predicate)) {
    if (region.kind === "subtree-root") {
      continue;
    }

    addContextRecord(input.contextRecordsByKey, {
      context: {
        kind: "render-region",
        filePath: region.filePath,
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
      traces: [...input.traces],
    });
  }
}

function addContextRecord(
  contextRecordsByKey: Map<string, StylesheetReachabilityContextRecord>,
  contextRecord: Omit<StylesheetReachabilityContextRecord, "traces"> & {
    traces?: AnalysisTrace[];
  },
): void {
  const normalizedContextRecord = withContextRecordTraces(contextRecord);
  const contextKey = serializeContextKey(normalizedContextRecord);
  const existingContextRecord = contextRecordsByKey.get(contextKey);
  if (!existingContextRecord) {
    contextRecordsByKey.set(contextKey, {
      ...normalizedContextRecord,
      reasons: [...normalizedContextRecord.reasons].sort((left, right) =>
        left.localeCompare(right),
      ),
      derivations: [...normalizedContextRecord.derivations].sort(compareDerivations),
    });
    return;
  }

  const mergedReasons = new Set([
    ...existingContextRecord.reasons,
    ...normalizedContextRecord.reasons,
  ]);
  const derivationsByKey = new Map<string, ReachabilityDerivation>();
  for (const derivation of [
    ...existingContextRecord.derivations,
    ...normalizedContextRecord.derivations,
  ]) {
    derivationsByKey.set(serializeDerivation(derivation), derivation);
  }
  contextRecordsByKey.set(contextKey, {
    ...existingContextRecord,
    availability: mergeAvailability(
      existingContextRecord.availability,
      normalizedContextRecord.availability,
    ),
    reasons: [...mergedReasons].sort((left, right) => left.localeCompare(right)),
    derivations: [...derivationsByKey.values()].sort(compareDerivations),
    traces: mergeTraces(existingContextRecord.traces, normalizedContextRecord.traces),
  });
}

function withContextRecordTraces(
  contextRecord: Omit<StylesheetReachabilityContextRecord, "traces"> & {
    traces?: AnalysisTrace[];
  },
): StylesheetReachabilityContextRecord {
  const traces = [
    createReachabilityTrace({
      traceId: `reachability-context:${contextRecord.context.kind}:${contextRecord.availability}`,
      summary:
        contextRecord.reasons[0] ??
        `reachability context recorded as ${contextRecord.availability}`,
      anchor: getReachabilityContextAnchor(contextRecord.context),
      children: contextRecord.traces ? [...contextRecord.traces] : [],
      metadata: {
        contextKind: contextRecord.context.kind,
        availability: contextRecord.availability,
        derivations: contextRecord.derivations.map(serializeDerivation),
      },
    }),
  ];

  return {
    ...contextRecord,
    traces,
  };
}

function withStylesheetRecordTraces(
  record: StylesheetReachabilityRecord,
): StylesheetReachabilityRecord {
  const traces =
    record.traces.length > 0
      ? [...record.traces]
      : [
          createReachabilityTrace({
            traceId: `reachability-stylesheet:${record.cssFilePath ?? "unknown"}:${record.availability}`,
            summary:
              record.reasons[0] ?? `stylesheet reachability resolved as ${record.availability}`,
            children: mergeTraces(
              [],
              record.contexts.flatMap((context) => context.traces),
            ),
            metadata: {
              cssFilePath: record.cssFilePath,
              availability: record.availability,
              contextCount: record.contexts.length,
            },
          }),
        ];

  return {
    ...record,
    traces,
  };
}

function createReachabilityTrace(input: {
  traceId: string;
  summary: string;
  anchor?: import("../../types/core.js").SourceAnchor;
  children?: AnalysisTrace[];
  metadata?: Record<string, unknown>;
}): AnalysisTrace {
  return {
    traceId: input.traceId,
    category: "reachability",
    summary: input.summary,
    ...(input.anchor ? { anchor: input.anchor } : {}),
    children: [...(input.children ?? [])],
    ...(input.metadata ? { metadata: input.metadata } : {}),
  };
}

function getReachabilityContextAnchor(
  context: StylesheetReachabilityContextRecord["context"],
): import("../../types/core.js").SourceAnchor | undefined {
  if (context.kind === "source-file" || context.kind === "component") {
    return undefined;
  }

  if (context.kind === "render-subtree-root") {
    return {
      filePath: context.filePath,
      startLine: context.rootAnchor.startLine,
      startColumn: context.rootAnchor.startColumn,
      endLine: context.rootAnchor.endLine,
      endColumn: context.rootAnchor.endColumn,
    };
  }

  return {
    filePath: context.filePath,
    startLine: context.sourceAnchor.startLine,
    startColumn: context.sourceAnchor.startColumn,
    endLine: context.sourceAnchor.endLine,
    endColumn: context.sourceAnchor.endColumn,
  };
}

function mergeTraces(left: AnalysisTrace[], right: AnalysisTrace[]): AnalysisTrace[] {
  const tracesByKey = new Map<string, AnalysisTrace>();
  for (const trace of [...left, ...right]) {
    tracesByKey.set(serializeTrace(trace), trace);
  }

  return [...tracesByKey.values()].sort((a, b) =>
    serializeTrace(a).localeCompare(serializeTrace(b)),
  );
}

function serializeTrace(trace: AnalysisTrace): string {
  return JSON.stringify(trace);
}

function mergeAvailability(
  left: StylesheetReachabilityContextRecord["availability"],
  right: StylesheetReachabilityContextRecord["availability"],
): StylesheetReachabilityContextRecord["availability"] {
  const order: Record<StylesheetReachabilityContextRecord["availability"], number> = {
    definite: 3,
    possible: 2,
    unknown: 1,
    unavailable: 0,
  };

  return order[left] >= order[right] ? left : right;
}

function serializeContextKey(contextRecord: StylesheetReachabilityContextRecord): string {
  if (contextRecord.context.kind === "source-file") {
    return `source-file:${contextRecord.context.filePath}`;
  }

  if (contextRecord.context.kind === "component") {
    return `component:${contextRecord.context.filePath}:${contextRecord.context.componentName}`;
  }

  if (contextRecord.context.kind === "render-region") {
    return [
      "render-region",
      contextRecord.context.filePath,
      contextRecord.context.componentName ?? "",
      contextRecord.context.regionKind,
      serializeRegionPath(contextRecord.context.path),
      contextRecord.context.sourceAnchor.startLine,
      contextRecord.context.sourceAnchor.startColumn,
      contextRecord.context.sourceAnchor.endLine ?? "",
      contextRecord.context.sourceAnchor.endColumn ?? "",
    ].join(":");
  }

  return [
    "render-subtree-root",
    contextRecord.context.filePath,
    contextRecord.context.componentName ?? "",
    contextRecord.context.rootAnchor.startLine,
    contextRecord.context.rootAnchor.startColumn,
    contextRecord.context.rootAnchor.endLine ?? "",
    contextRecord.context.rootAnchor.endColumn ?? "",
  ].join(":");
}

function compareDerivations(left: ReachabilityDerivation, right: ReachabilityDerivation): number {
  return serializeDerivation(left).localeCompare(serializeDerivation(right));
}

function serializeDerivation(derivation: ReachabilityDerivation): string {
  switch (derivation.kind) {
    case "source-file-direct-import":
      return derivation.kind;
    case "source-file-project-wide-external-css":
      return [derivation.kind, derivation.stylesheetHref].join(":");
    case "whole-component-direct-import":
    case "whole-component-all-known-renderers-definite":
    case "whole-component-at-least-one-renderer":
    case "whole-component-only-possible-renderers":
      return derivation.kind;
    case "whole-component-unknown-barrier":
    case "render-region-unknown-barrier":
      return [derivation.kind, derivation.reason].join(":");
    case "placement-derived-region":
      return [
        derivation.kind,
        derivation.toComponentName,
        derivation.toFilePath ?? "",
        derivation.renderPath,
      ].join(":");
  }
}

function isRegionPathPrefix(
  prefix: import("../render-model/render-ir/types.js").RenderRegionPathSegment[],
  full: import("../render-model/render-ir/types.js").RenderRegionPathSegment[],
): boolean {
  if (prefix.length > full.length) {
    return false;
  }

  return prefix.every(
    (segment, index) => serializeRegionPath([segment]) === serializeRegionPath([full[index]]),
  );
}

function createComponentKey(filePath: string, componentName: string): string {
  return `${normalizeProjectPath(filePath) ?? filePath}::${componentName}`;
}

function compareContextRecords(
  left: StylesheetReachabilityContextRecord,
  right: StylesheetReachabilityContextRecord,
): number {
  if (left.context.kind !== right.context.kind) {
    return left.context.kind.localeCompare(right.context.kind);
  }

  if (left.context.kind === "source-file" && right.context.kind === "source-file") {
    return left.context.filePath.localeCompare(right.context.filePath);
  }

  if (left.context.kind === "component" && right.context.kind === "component") {
    return (
      left.context.filePath.localeCompare(right.context.filePath) ||
      left.context.componentName.localeCompare(right.context.componentName)
    );
  }

  if (left.context.kind === "render-subtree-root" && right.context.kind === "render-subtree-root") {
    return (
      left.context.filePath.localeCompare(right.context.filePath) ||
      (left.context.componentName ?? "").localeCompare(right.context.componentName ?? "") ||
      left.context.rootAnchor.startLine - right.context.rootAnchor.startLine ||
      left.context.rootAnchor.startColumn - right.context.rootAnchor.startColumn ||
      (left.context.rootAnchor.endLine ?? 0) - (right.context.rootAnchor.endLine ?? 0) ||
      (left.context.rootAnchor.endColumn ?? 0) - (right.context.rootAnchor.endColumn ?? 0)
    );
  }

  if (left.context.kind === "render-region" && right.context.kind === "render-region") {
    return (
      left.context.filePath.localeCompare(right.context.filePath) ||
      (left.context.componentName ?? "").localeCompare(right.context.componentName ?? "") ||
      left.context.regionKind.localeCompare(right.context.regionKind) ||
      serializeRegionPath(left.context.path).localeCompare(
        serializeRegionPath(right.context.path),
      ) ||
      left.context.sourceAnchor.startLine - right.context.sourceAnchor.startLine ||
      left.context.sourceAnchor.startColumn - right.context.sourceAnchor.startColumn ||
      (left.context.sourceAnchor.endLine ?? 0) - (right.context.sourceAnchor.endLine ?? 0) ||
      (left.context.sourceAnchor.endColumn ?? 0) - (right.context.sourceAnchor.endColumn ?? 0)
    );
  }

  return 0;
}

function serializeRegionPath(path: RenderRegion["path"]): string {
  return path
    .map((segment) => {
      if (segment.kind === "root") {
        return "root";
      }

      if (segment.kind === "fragment-child") {
        return `fragment-child:${segment.childIndex}`;
      }

      if (segment.kind === "conditional-branch") {
        return `conditional-branch:${segment.branch}`;
      }

      return "repeated-template";
    })
    .join("/");
}

function compareEdges(
  left: import("../render-model/render-graph/types.js").RenderGraphEdge,
  right: import("../render-model/render-graph/types.js").RenderGraphEdge,
): number {
  return (
    left.fromFilePath.localeCompare(right.fromFilePath) ||
    left.fromComponentName.localeCompare(right.fromComponentName) ||
    left.toComponentName.localeCompare(right.toComponentName) ||
    (left.toFilePath ?? "").localeCompare(right.toFilePath ?? "")
  );
}

function resolveCssImportPath(input: {
  fromFilePath: string;
  specifier: string;
  knownCssFilePaths: Set<string>;
}): string | undefined {
  const normalizedSpecifier = normalizeProjectPath(input.specifier);
  const normalizedFromFilePath = normalizeProjectPath(input.fromFilePath);
  if (!normalizedSpecifier || !normalizedFromFilePath) {
    return undefined;
  }

  if (!normalizedSpecifier.endsWith(".css")) {
    return undefined;
  }

  if (!normalizedSpecifier.startsWith(".")) {
    return undefined;
  }

  const fromSegments = normalizedFromFilePath.split("/");
  fromSegments.pop();
  const specifierSegments = normalizedSpecifier.split("/").filter((segment) => segment.length > 0);
  const candidatePath = normalizeSegments([...fromSegments, ...specifierSegments]);
  return input.knownCssFilePaths.has(candidatePath) ? candidatePath : undefined;
}

function normalizeSegments(segments: string[]): string {
  const normalized: string[] = [];
  for (const segment of segments) {
    if (segment === ".") {
      continue;
    }

    if (segment === "..") {
      normalized.pop();
      continue;
    }

    normalized.push(segment);
  }

  return normalized.join("/");
}

function normalizeProjectPath(filePath: string | undefined): string | undefined {
  return filePath?.replace(/\\/g, "/");
}
