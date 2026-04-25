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
  includeTraces?: boolean;
}): ReachabilitySummary {
  const includeTraces = input.includeTraces ?? true;
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
  const packageCssImportBySpecifier = new Map(
    input.externalCssSummary.packageCssImports
      .filter((importRecord) => importRecord.importerKind === "source")
      .map((importRecord) => [
        createPackageCssImportKey(importRecord.importerFilePath, importRecord.specifier),
        normalizeProjectPath(importRecord.resolvedFilePath) ?? importRecord.resolvedFilePath,
      ]),
  );
  const analyzedSourceFilePaths = collectAnalyzedSourceFilePaths(input.moduleGraph);
  const directCssImportersByStylesheetPath = collectDirectCssImportersByStylesheetPath({
    moduleGraph: input.moduleGraph,
    knownCssFilePaths,
    packageCssImportBySpecifier,
  });
  const reachabilityGraphContext = buildReachabilityGraphContext({
    renderGraph: input.renderGraph,
    renderSubtrees: input.renderSubtrees,
  });
  const componentAvailability = computeBatchedComponentAvailability({
    cssSources: input.cssSources,
    directCssImportersByStylesheetPath,
    reachabilityGraphContext,
    includeTraces,
  });

  const stylesheets = input.cssSources.map((cssSource) =>
    buildStylesheetReachabilityRecord({
      cssSource,
      moduleGraph: input.moduleGraph,
      renderGraph: input.renderGraph,
      renderSubtrees: input.renderSubtrees,
      knownCssFilePaths,
      projectWideExternalStylesheetFilePaths,
      packageCssImportBySpecifier,
      directCssImportersByStylesheetPath,
      reachabilityGraphContext,
      analyzedSourceFilePaths,
      componentAvailability,
      includeTraces,
    }),
  );

  return {
    stylesheets: applyStylesheetPackageImportReachability({
      stylesheets,
      packageCssImports: input.externalCssSummary.packageCssImports,
      includeTraces,
    }),
  };
}

function buildStylesheetReachabilityRecord(input: {
  cssSource: SelectorSourceInput;
  moduleGraph: ModuleGraph;
  renderGraph: RenderGraph;
  renderSubtrees: RenderSubtree[];
  knownCssFilePaths: Set<string>;
  projectWideExternalStylesheetFilePaths: Set<string>;
  packageCssImportBySpecifier: Map<string, string>;
  directCssImportersByStylesheetPath: Map<string, string[]>;
  reachabilityGraphContext: ReachabilityGraphContext;
  analyzedSourceFilePaths: string[];
  componentAvailability: BatchedComponentAvailability;
  includeTraces: boolean;
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
      includeTraces: input.includeTraces,
    });
  }

  const contextRecordsByKey = new Map<string, StylesheetReachabilityContextRecord>();
  const sortedImportingSourceFilePaths =
    input.directCssImportersByStylesheetPath.get(cssFilePath) ?? [];

  if (sortedImportingSourceFilePaths.length > 0) {
    for (const contextRecord of buildContextRecords({
      importingSourceFilePaths: sortedImportingSourceFilePaths,
      reachabilityGraphContext: input.reachabilityGraphContext,
      componentAvailabilityByKey:
        input.componentAvailability.componentAvailabilityByStylesheetPath.get(cssFilePath) ??
        new Map(),
      includeTraces: input.includeTraces,
    })) {
      contextRecordsByKey.set(serializeContextKey(contextRecord), contextRecord);
    }
  }

  const isProjectWideExternalStylesheet =
    input.projectWideExternalStylesheetFilePaths.has(cssFilePath);
  if (isProjectWideExternalStylesheet) {
    for (const filePath of input.analyzedSourceFilePaths) {
      addContextRecord(
        contextRecordsByKey,
        {
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
        },
        input.includeTraces,
      );
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
      includeTraces: input.includeTraces,
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
    includeTraces: input.includeTraces,
  });
}

function collectAnalyzedSourceFilePaths(moduleGraph: ModuleGraph): string[] {
  return [...moduleGraph.modulesById.values()]
    .filter((moduleNode) => moduleNode.kind === "source")
    .map((moduleNode) => normalizeProjectPath(moduleNode.filePath) ?? moduleNode.filePath)
    .sort((left, right) => left.localeCompare(right));
}

function collectDirectCssImportersByStylesheetPath(input: {
  moduleGraph: ModuleGraph;
  knownCssFilePaths: Set<string>;
  packageCssImportBySpecifier: Map<string, string>;
}): Map<string, string[]> {
  const importersByStylesheetPath = new Map<string, Set<string>>();

  for (const moduleNode of input.moduleGraph.modulesById.values()) {
    if (moduleNode.kind !== "source") {
      continue;
    }

    const sourceFilePath = normalizeProjectPath(moduleNode.filePath) ?? moduleNode.filePath;
    for (const importRecord of moduleNode.imports) {
      const stylesheetPath =
        importRecord.importKind === "css"
          ? resolveCssImportPath({
              fromFilePath: moduleNode.filePath,
              specifier: importRecord.specifier,
              knownCssFilePaths: input.knownCssFilePaths,
            })
          : importRecord.importKind === "external-css"
            ? (input.packageCssImportBySpecifier.get(
                createPackageCssImportKey(moduleNode.filePath, importRecord.specifier),
              ) ??
              normalizeProjectPath(importRecord.specifier) ??
              importRecord.specifier)
            : undefined;

      if (!stylesheetPath) {
        continue;
      }

      const importers = importersByStylesheetPath.get(stylesheetPath) ?? new Set<string>();
      importers.add(sourceFilePath);
      importersByStylesheetPath.set(stylesheetPath, importers);
    }
  }

  return new Map(
    [...importersByStylesheetPath.entries()].map(([stylesheetPath, importers]) => [
      stylesheetPath,
      [...importers].sort((left, right) => left.localeCompare(right)),
    ]),
  );
}

function applyStylesheetPackageImportReachability(input: {
  stylesheets: StylesheetReachabilityRecord[];
  packageCssImports: ExternalCssSummary["packageCssImports"];
  includeTraces: boolean;
}): StylesheetReachabilityRecord[] {
  const stylesheetRecordsByPath = new Map(
    input.stylesheets
      .map((stylesheet) => [
        stylesheet.cssFilePath ? normalizeProjectPath(stylesheet.cssFilePath) : undefined,
        stylesheet,
      ])
      .filter(
        (entry): entry is [string, StylesheetReachabilityRecord] => typeof entry[0] === "string",
      ),
  );
  const stylesheetImports = input.packageCssImports
    .filter((importRecord) => importRecord.importerKind === "stylesheet")
    .map((importRecord) => ({
      ...importRecord,
      importerFilePath:
        normalizeProjectPath(importRecord.importerFilePath) ?? importRecord.importerFilePath,
      resolvedFilePath:
        normalizeProjectPath(importRecord.resolvedFilePath) ?? importRecord.resolvedFilePath,
    }))
    .sort((left, right) =>
      `${left.importerFilePath}:${left.specifier}:${left.resolvedFilePath}`.localeCompare(
        `${right.importerFilePath}:${right.specifier}:${right.resolvedFilePath}`,
      ),
    );

  let changed = true;
  let remainingIterations = stylesheetImports.length + input.stylesheets.length + 1;
  while (changed && remainingIterations > 0) {
    changed = false;
    remainingIterations -= 1;

    for (const importRecord of stylesheetImports) {
      const importer = stylesheetRecordsByPath.get(importRecord.importerFilePath);
      const imported = stylesheetRecordsByPath.get(importRecord.resolvedFilePath);
      if (!importer || !imported || importer.contexts.length === 0) {
        continue;
      }

      const before = serializeStylesheetReachabilityRecord(imported);
      const contextRecordsByKey = new Map<string, StylesheetReachabilityContextRecord>();
      for (const context of imported.contexts) {
        addContextRecord(contextRecordsByKey, context, input.includeTraces);
      }
      for (const context of importer.contexts) {
        addContextRecord(
          contextRecordsByKey,
          {
            context: context.context,
            availability: context.availability,
            reasons: [
              `stylesheet is imported by reachable stylesheet ${importRecord.importerFilePath}`,
              ...context.reasons,
            ],
            derivations: [...context.derivations],
            traces: [...context.traces],
          },
          input.includeTraces,
        );
      }

      const contexts = [...contextRecordsByKey.values()].sort(compareContextRecords);
      const reasons = [
        `stylesheet is imported by reachable stylesheet ${importRecord.importerFilePath}`,
        `reachability is attached to ${contexts.length} explicit render context${contexts.length === 1 ? "" : "s"}`,
      ];
      const nextRecord = withStylesheetRecordTraces({
        ...imported,
        availability: getAvailabilityFromContexts(contexts),
        contexts,
        reasons,
        traces: [],
        includeTraces: input.includeTraces,
      });

      Object.assign(imported, nextRecord);
      if (serializeStylesheetReachabilityRecord(imported) !== before) {
        changed = true;
      }
    }
  }

  return input.stylesheets.sort((left, right) =>
    (left.cssFilePath ?? "").localeCompare(right.cssFilePath ?? ""),
  );
}

type ReachabilityGraphContext = {
  renderRegionsByComponentKey: Map<string, RenderRegion[]>;
  renderRegionsByPathKeyByComponentKey: Map<string, Map<string, RenderRegion[]>>;
  renderSubtreesByComponentKey: Map<string, RenderSubtree>;
  unknownBarriersByComponentKey: Map<string, UnknownReachabilityBarrier[]>;
  renderGraphNodesByKey: Map<
    string,
    import("../render-model/render-graph/types.js").RenderGraphNode
  >;
  outgoingEdgesByComponentKey: Map<
    string,
    import("../render-model/render-graph/types.js").RenderGraphEdge[]
  >;
  incomingEdgesByComponentKey: Map<
    string,
    import("../render-model/render-graph/types.js").RenderGraphEdge[]
  >;
  componentKeysByFilePath: Map<string, string[]>;
};

type ComponentAvailabilityRecord = {
  availability: StylesheetReachabilityContextRecord["availability"];
  reasons: string[];
  derivations: ReachabilityDerivation[];
  traces: AnalysisTrace[];
};

type BatchedComponentAvailability = {
  componentAvailabilityByStylesheetPath: Map<string, Map<string, ComponentAvailabilityRecord>>;
};

function buildReachabilityGraphContext(input: {
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

  return {
    renderRegionsByComponentKey,
    renderRegionsByPathKeyByComponentKey,
    renderSubtreesByComponentKey,
    unknownBarriersByComponentKey,
    renderGraphNodesByKey,
    outgoingEdgesByComponentKey,
    incomingEdgesByComponentKey,
    componentKeysByFilePath,
  };
}

function computeBatchedComponentAvailability(input: {
  cssSources: SelectorSourceInput[];
  directCssImportersByStylesheetPath: Map<string, string[]>;
  reachabilityGraphContext: ReachabilityGraphContext;
  includeTraces: boolean;
}): BatchedComponentAvailability {
  const stylesheetPaths = [
    ...new Set(
      input.cssSources
        .map((cssSource) => normalizeProjectPath(cssSource.filePath))
        .filter((filePath): filePath is string => Boolean(filePath)),
    ),
  ].sort((left, right) => left.localeCompare(right));
  const stylesheetIndexByPath = new Map(
    stylesheetPaths.map((stylesheetPath, index) => [stylesheetPath, index]),
  );
  const allStylesheetBits = createBitMask(stylesheetPaths.length);
  const directDefiniteBitsByComponentKey = new Map<string, bigint>();
  const definiteBitsByComponentKey = new Map<string, bigint>();
  const possibleBitsByComponentKey = new Map<string, bigint>();
  const sortedComponentKeys = [...input.reachabilityGraphContext.renderGraphNodesByKey.keys()].sort(
    (left, right) => left.localeCompare(right),
  );

  for (const [
    stylesheetPath,
    importingSourceFilePaths,
  ] of input.directCssImportersByStylesheetPath) {
    const stylesheetIndex = stylesheetIndexByPath.get(stylesheetPath);
    if (stylesheetIndex === undefined) {
      continue;
    }

    const stylesheetBit = 1n << BigInt(stylesheetIndex);
    for (const importingSourceFilePath of importingSourceFilePaths) {
      for (const componentKey of input.reachabilityGraphContext.componentKeysByFilePath.get(
        importingSourceFilePath,
      ) ?? []) {
        const currentBits = directDefiniteBitsByComponentKey.get(componentKey) ?? 0n;
        directDefiniteBitsByComponentKey.set(componentKey, currentBits | stylesheetBit);
      }
    }
  }

  for (const componentKey of sortedComponentKeys) {
    definiteBitsByComponentKey.set(
      componentKey,
      directDefiniteBitsByComponentKey.get(componentKey) ?? 0n,
    );
    possibleBitsByComponentKey.set(componentKey, 0n);
  }

  let changed = true;
  while (changed) {
    changed = false;

    for (const componentKey of sortedComponentKeys) {
      const directBits = directDefiniteBitsByComponentKey.get(componentKey) ?? 0n;
      const incomingEdges =
        input.reachabilityGraphContext.incomingEdgesByComponentKey.get(componentKey) ?? [];
      const currentDefiniteBits = definiteBitsByComponentKey.get(componentKey) ?? 0n;
      const currentPossibleBits = possibleBitsByComponentKey.get(componentKey) ?? 0n;
      let nextDefiniteBits = directBits;
      let nextPossibleBits = 0n;

      if (incomingEdges.length > 0) {
        let allParentsDefiniteBits = allStylesheetBits;
        let allParentEdgesAreDefinite = true;
        let availableParentBits = 0n;

        for (const edge of incomingEdges) {
          const parentKey = createComponentKey(edge.fromFilePath, edge.fromComponentName);
          const parentDefiniteBits = definiteBitsByComponentKey.get(parentKey) ?? 0n;
          const parentPossibleBits = possibleBitsByComponentKey.get(parentKey) ?? 0n;
          const parentAvailableBits = parentDefiniteBits | parentPossibleBits;
          availableParentBits |= parentAvailableBits;
          allParentsDefiniteBits &= parentDefiniteBits;
          if (edge.renderPath !== "definite") {
            allParentEdgesAreDefinite = false;
          }
        }

        if (allParentEdgesAreDefinite) {
          nextDefiniteBits |= allParentsDefiniteBits;
        }
        nextPossibleBits = availableParentBits & ~nextDefiniteBits;
      }

      if (nextDefiniteBits !== currentDefiniteBits || nextPossibleBits !== currentPossibleBits) {
        definiteBitsByComponentKey.set(componentKey, nextDefiniteBits);
        possibleBitsByComponentKey.set(componentKey, nextPossibleBits);
        changed = true;
      }
    }
  }

  const componentAvailabilityByStylesheetPath = new Map<
    string,
    Map<string, ComponentAvailabilityRecord>
  >();
  for (const stylesheetPath of stylesheetPaths) {
    const stylesheetIndex = stylesheetIndexByPath.get(stylesheetPath);
    if (stylesheetIndex === undefined) {
      continue;
    }

    const stylesheetBit = 1n << BigInt(stylesheetIndex);
    const componentAvailabilityByKey = new Map<string, ComponentAvailabilityRecord>();
    for (const componentKey of sortedComponentKeys) {
      componentAvailabilityByKey.set(
        componentKey,
        buildComponentAvailabilityRecordForStylesheet({
          componentKey,
          stylesheetBit,
          directDefiniteBitsByComponentKey,
          definiteBitsByComponentKey,
          possibleBitsByComponentKey,
          incomingEdges:
            input.reachabilityGraphContext.incomingEdgesByComponentKey.get(componentKey) ?? [],
          includeTraces: input.includeTraces,
        }),
      );
    }
    componentAvailabilityByStylesheetPath.set(stylesheetPath, componentAvailabilityByKey);
  }

  return { componentAvailabilityByStylesheetPath };
}

function createBitMask(bitCount: number): bigint {
  return bitCount === 0 ? 0n : (1n << BigInt(bitCount)) - 1n;
}

function buildComponentAvailabilityRecordForStylesheet(input: {
  componentKey: string;
  stylesheetBit: bigint;
  directDefiniteBitsByComponentKey: Map<string, bigint>;
  definiteBitsByComponentKey: Map<string, bigint>;
  possibleBitsByComponentKey: Map<string, bigint>;
  incomingEdges: import("../render-model/render-graph/types.js").RenderGraphEdge[];
  includeTraces: boolean;
}): ComponentAvailabilityRecord {
  const directBits = input.directDefiniteBitsByComponentKey.get(input.componentKey) ?? 0n;
  if ((directBits & input.stylesheetBit) !== 0n) {
    return {
      availability: "definite",
      reasons: ["component is declared in a source file that directly imports this stylesheet"],
      derivations: [{ kind: "whole-component-direct-import" }],
      traces: [],
    };
  }

  const definiteBits = input.definiteBitsByComponentKey.get(input.componentKey) ?? 0n;
  if ((definiteBits & input.stylesheetBit) !== 0n) {
    return {
      availability: "definite",
      reasons: ["all known renderers of this component have definite stylesheet availability"],
      derivations: [{ kind: "whole-component-all-known-renderers-definite" }],
      traces: input.includeTraces ? input.incomingEdges.flatMap((edge) => edge.traces) : [],
    };
  }

  const possibleBits = input.possibleBitsByComponentKey.get(input.componentKey) ?? 0n;
  if ((possibleBits & input.stylesheetBit) === 0n) {
    return {
      availability: "unavailable",
      reasons: [],
      derivations: [],
      traces: [],
    };
  }

  const availableParentEdges = input.incomingEdges.filter((edge) => {
    const parentKey = createComponentKey(edge.fromFilePath, edge.fromComponentName);
    const parentDefiniteBits = input.definiteBitsByComponentKey.get(parentKey) ?? 0n;
    const parentPossibleBits = input.possibleBitsByComponentKey.get(parentKey) ?? 0n;
    return ((parentDefiniteBits | parentPossibleBits) & input.stylesheetBit) !== 0n;
  });
  const definitePathParentEdges = availableParentEdges.filter(
    (edge) => edge.renderPath === "definite",
  );
  if (definitePathParentEdges.length > 0) {
    return {
      availability: "possible",
      reasons: ["at least one known renderer of this component has stylesheet availability"],
      derivations: [{ kind: "whole-component-at-least-one-renderer" }],
      traces: input.includeTraces ? definitePathParentEdges.flatMap((edge) => edge.traces) : [],
    };
  }

  return {
    availability: "possible",
    reasons: [
      "this component is only rendered on possible paths beneath a renderer with stylesheet availability",
    ],
    derivations: [{ kind: "whole-component-only-possible-renderers" }],
    traces: input.includeTraces ? availableParentEdges.flatMap((edge) => edge.traces) : [],
  };
}

function buildContextRecords(input: {
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
          componentName: node.componentName,
        },
        availability: "definite",
        reasons: ["component is declared in a source file that directly imports this stylesheet"],
        derivations: [{ kind: "whole-component-direct-import" }],
      },
      input.includeTraces,
    );
  }

  for (const [componentKey, availabilityRecord] of input.componentAvailabilityByKey.entries()) {
    const node = input.reachabilityGraphContext.renderGraphNodesByKey.get(componentKey);
    if (!node) {
      continue;
    }

    const wholeComponentRegionAvailability = resolveWholeComponentRegionAvailability({
      componentKey,
      componentAvailabilityByKey: input.componentAvailabilityByKey,
    });

    if (wholeComponentRegionAvailability && !importingComponentKeys.includes(componentKey)) {
      addContextRecord(
        contextRecordsByKey,
        {
          context: {
            kind: "component",
            filePath: normalizeProjectPath(node.filePath) ?? node.filePath,
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
          subtree.componentName === node.componentName,
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

    addPlacedChildRenderRegionContexts({
      contextRecordsByKey,
      renderSubtree: input.reachabilityGraphContext.renderSubtreesByComponentKey.get(componentKey),
      renderRegions:
        input.reachabilityGraphContext.renderRegionsByComponentKey.get(componentKey) ?? [],
      renderRegionsByPathKey:
        input.reachabilityGraphContext.renderRegionsByPathKeyByComponentKey.get(componentKey) ??
        new Map(),
      outgoingEdges:
        input.reachabilityGraphContext.outgoingEdgesByComponentKey.get(componentKey) ?? [],
      componentAvailabilityByKey: input.componentAvailabilityByKey,
      includeTraces: input.includeTraces,
    });

    if (availabilityRecord.availability === "unavailable") {
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
  renderRegionsByPathKey: Map<string, RenderRegion[]>;
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
  includeTraces: boolean;
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
      renderRegionsByPathKey: input.renderRegionsByPathKey,
      sourceAnchor: edge.sourceAnchor,
    })) {
      addContextRecord(
        input.contextRecordsByKey,
        {
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
          traces: input.includeTraces ? edge.traces : [],
        },
        input.includeTraces,
      );
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

function addContextRecord(
  contextRecordsByKey: Map<string, StylesheetReachabilityContextRecord>,
  contextRecord: Omit<StylesheetReachabilityContextRecord, "traces"> & {
    traces?: AnalysisTrace[];
  },
  includeTraces = true,
): void {
  const normalizedContextRecord = withContextRecordTraces(contextRecord, includeTraces);
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
  for (const derivation of existingContextRecord.derivations) {
    derivationsByKey.set(serializeDerivation(derivation), derivation);
  }
  for (const derivation of normalizedContextRecord.derivations) {
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
  includeTraces = true,
): StylesheetReachabilityContextRecord {
  if (!includeTraces) {
    return {
      ...contextRecord,
      traces: [],
    };
  }

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
  record: StylesheetReachabilityRecord & { includeTraces?: boolean },
): StylesheetReachabilityRecord {
  const { includeTraces = true, ...stylesheetRecord } = record;
  if (!includeTraces) {
    return {
      ...stylesheetRecord,
      traces: [],
    };
  }

  const traces =
    stylesheetRecord.traces.length > 0
      ? [...stylesheetRecord.traces]
      : [
          createReachabilityTrace({
            traceId: `reachability-stylesheet:${stylesheetRecord.cssFilePath ?? "unknown"}:${stylesheetRecord.availability}`,
            summary:
              stylesheetRecord.reasons[0] ??
              `stylesheet reachability resolved as ${stylesheetRecord.availability}`,
            children: mergeTraceCollections(
              stylesheetRecord.contexts.map((context) => context.traces),
            ),
            metadata: {
              cssFilePath: stylesheetRecord.cssFilePath,
              availability: stylesheetRecord.availability,
              contextCount: stylesheetRecord.contexts.length,
            },
          }),
        ];

  return {
    ...stylesheetRecord,
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
  for (const trace of left) {
    tracesByKey.set(serializeTraceKey(trace), trace);
  }
  for (const trace of right) {
    tracesByKey.set(serializeTraceKey(trace), trace);
  }

  return [...tracesByKey.entries()]
    .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
    .map(([, trace]) => trace);
}

function mergeTraceCollections(traceCollections: AnalysisTrace[][]): AnalysisTrace[] {
  const tracesByKey = new Map<string, AnalysisTrace>();
  for (const traces of traceCollections) {
    for (const trace of traces) {
      tracesByKey.set(serializeTraceKey(trace), trace);
    }
  }

  return [...tracesByKey.entries()]
    .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
    .map(([, trace]) => trace);
}

const traceKeyCache = new WeakMap<AnalysisTrace, string>();

function serializeTraceKey(trace: AnalysisTrace): string {
  const cachedKey = traceKeyCache.get(trace);
  if (cachedKey) {
    return cachedKey;
  }

  const anchor = trace.anchor
    ? [
        trace.anchor.filePath,
        trace.anchor.startLine,
        trace.anchor.startColumn,
        trace.anchor.endLine ?? "",
        trace.anchor.endColumn ?? "",
      ].join(":")
    : "";

  const key = `${trace.traceId}:${trace.category}:${anchor}`;
  traceKeyCache.set(trace, key);
  return key;
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

function getAvailabilityFromContexts(
  contexts: StylesheetReachabilityContextRecord[],
): StylesheetReachabilityRecord["availability"] {
  if (contexts.some((context) => context.availability === "definite")) {
    return "definite";
  }
  if (contexts.some((context) => context.availability === "possible")) {
    return "possible";
  }
  if (contexts.some((context) => context.availability === "unknown")) {
    return "unknown";
  }
  return "unavailable";
}

function serializeStylesheetReachabilityRecord(record: StylesheetReachabilityRecord): string {
  return JSON.stringify({
    cssFilePath: record.cssFilePath,
    availability: record.availability,
    contexts: record.contexts,
    reasons: record.reasons,
  });
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

const derivationKeyCache = new WeakMap<ReachabilityDerivation, string>();

function serializeDerivation(derivation: ReachabilityDerivation): string {
  const cachedKey = derivationKeyCache.get(derivation);
  if (cachedKey) {
    return cachedKey;
  }

  let key: string;
  switch (derivation.kind) {
    case "source-file-direct-import":
      key = derivation.kind;
      break;
    case "source-file-project-wide-external-css":
      key = [derivation.kind, derivation.stylesheetHref].join(":");
      break;
    case "whole-component-direct-import":
    case "whole-component-all-known-renderers-definite":
    case "whole-component-at-least-one-renderer":
    case "whole-component-only-possible-renderers":
      key = derivation.kind;
      break;
    case "whole-component-unknown-barrier":
    case "render-region-unknown-barrier":
      key = [derivation.kind, derivation.reason].join(":");
      break;
    case "placement-derived-region":
      key = [
        derivation.kind,
        derivation.toComponentName,
        derivation.toFilePath ?? "",
        derivation.renderPath,
      ].join(":");
      break;
  }

  derivationKeyCache.set(derivation, key);
  return key;
}

function createComponentKey(filePath: string, componentName: string): string {
  return `${normalizeProjectPath(filePath) ?? filePath}::${componentName}`;
}

function createPackageCssImportKey(sourceFilePath: string, specifier: string): string {
  return `${normalizeProjectPath(sourceFilePath) ?? sourceFilePath}:${specifier}`;
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
