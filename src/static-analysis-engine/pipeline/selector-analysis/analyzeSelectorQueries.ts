import type {
  ReachabilitySummary,
  StylesheetReachabilityContextRecord,
} from "../reachability/types.js";
import type {
  ParsedSelectorQuery,
  SelectorAnalysisTarget,
  SelectorRenderModelIndex,
  SelectorQueryResult,
} from "./types.js";
import type { RenderModel, RenderPathSegment } from "../render-structure/types.js";
import { buildSelectorQueryResult } from "./resultUtils.js";
import { analyzeAncestorDescendantConstraint } from "./adapters/ancestorDescendant.js";
import { analyzeParentChildConstraint } from "./adapters/parentChild.js";
import { analyzeSameNodeClassConjunction } from "./adapters/sameNodeConjunction.js";
import { analyzeSiblingConstraint } from "./adapters/sibling.js";

type AvailableContextRecord = StylesheetReachabilityContextRecord & {
  availability: "definite" | "possible";
};

type RenderRegionContext = Extract<
  StylesheetReachabilityContextRecord["context"],
  { kind: "render-region" }
>;

type ProjectedRenderPathSegment = RenderRegionContext["path"][number];

type ReachabilityTargetResolution = {
  result?: SelectorQueryResult;
  analysisTargets: SelectorAnalysisTarget[];
};

export function analyzeSelectorQueries(input: {
  selectorQueries: ParsedSelectorQuery[];
  renderModel: RenderModel;
  reachabilitySummary?: ReachabilitySummary;
  includeTraces?: boolean;
}): SelectorQueryResult[] {
  const includeTraces = input.includeTraces ?? true;
  const reachabilityTargetCache = new Map<string, SelectorAnalysisTarget[]>();
  const renderModelIndex = buildSelectorRenderModelIndex(input.renderModel);

  return input.selectorQueries.map((selectorQuery) =>
    analyzeSelectorQuery({
      selectorQuery,
      renderModelIndex,
      reachabilitySummary: input.reachabilitySummary,
      reachabilityTargetCache,
      includeTraces,
    }),
  );
}

function analyzeSelectorQuery(input: {
  selectorQuery: ParsedSelectorQuery;
  renderModelIndex: SelectorRenderModelIndex;
  reachabilitySummary?: ReachabilitySummary;
  reachabilityTargetCache: Map<string, SelectorAnalysisTarget[]>;
  includeTraces: boolean;
}): SelectorQueryResult {
  const { constraint } = input.selectorQuery;
  let analysisTargets = buildWholeModelAnalysisTargets(input.renderModelIndex.renderModel);

  if (input.selectorQuery.source.kind === "css-source") {
    const reachabilityResolution = resolveQueryReachability(input);
    if (reachabilityResolution.result) {
      return reachabilityResolution.result;
    }

    analysisTargets = reachabilityResolution.analysisTargets;
  }

  if ("kind" in constraint && constraint.kind === "unsupported") {
    return buildSelectorQueryResult({
      selectorQuery: input.selectorQuery,
      outcome: "possible-match",
      status: "unsupported",
      reasons: [
        `unsupported selector query: ${constraint.reason}`,
        ...input.selectorQuery.parseNotes,
      ],
      certainty: "unknown",
      dimensions: {
        structure: "unsupported",
      },
      traces: input.includeTraces
        ? [
            {
              traceId: "selector-match:unsupported-selector-shape",
              category: "selector-match",
              summary: `unsupported selector query: ${constraint.reason}`,
              anchor:
                input.selectorQuery.source.kind === "css-source"
                  ? input.selectorQuery.source.selectorAnchor
                  : undefined,
              children: input.selectorQuery.parseTraces,
              metadata: {
                selectorText: input.selectorQuery.selectorText,
              },
            },
          ]
        : [],
      includeTraces: input.includeTraces,
    });
  }

  if (constraint.kind === "same-node-class-conjunction") {
    return analyzeSameNodeClassConjunction({
      selectorQuery: input.selectorQuery,
      constraint,
      analysisTargets,
      renderModelIndex: input.renderModelIndex,
      includeTraces: input.includeTraces,
    });
  }

  if (constraint.kind === "parent-child") {
    return analyzeParentChildConstraint({
      selectorQuery: input.selectorQuery,
      constraint,
      analysisTargets,
      renderModelIndex: input.renderModelIndex,
      includeTraces: input.includeTraces,
    });
  }

  if (constraint.kind === "sibling") {
    return analyzeSiblingConstraint({
      selectorQuery: input.selectorQuery,
      constraint,
      analysisTargets,
      renderModelIndex: input.renderModelIndex,
      includeTraces: input.includeTraces,
    });
  }

  return analyzeAncestorDescendantConstraint({
    selectorQuery: input.selectorQuery,
    constraint,
    analysisTargets,
    renderModelIndex: input.renderModelIndex,
    includeTraces: input.includeTraces,
  });
}

function buildSelectorRenderModelIndex(renderModel: RenderModel): SelectorRenderModelIndex {
  const componentKeyByNodeId = new Map(
    renderModel.components
      .filter((component) => component.componentNodeId)
      .map((component) => [component.componentNodeId as string, component.componentKey]),
  );
  return {
    renderModel,
    componentKeyByNodeId,
    componentNodeIdByComponentKey: new Map(
      renderModel.components
        .filter((component) => component.componentNodeId)
        .map((component) => [component.componentKey, component.componentNodeId as string]),
    ),
  };
}

function resolveQueryReachability(input: {
  selectorQuery: ParsedSelectorQuery;
  renderModelIndex: SelectorRenderModelIndex;
  reachabilitySummary?: ReachabilitySummary;
  reachabilityTargetCache: Map<string, SelectorAnalysisTarget[]>;
  includeTraces: boolean;
}): ReachabilityTargetResolution {
  if (input.selectorQuery.source.kind !== "css-source") {
    return {
      analysisTargets: buildWholeModelAnalysisTargets(input.renderModelIndex.renderModel),
    };
  }

  const cssFilePath = input.selectorQuery.source.selectorAnchor?.filePath;
  const cacheKey = cssFilePath ? normalizeProjectPath(cssFilePath) : undefined;
  const cachedAnalysisTargets = cacheKey ? input.reachabilityTargetCache.get(cacheKey) : undefined;
  if (cachedAnalysisTargets) {
    return {
      analysisTargets: cachedAnalysisTargets,
    };
  }

  const reachabilityRecord = input.reachabilitySummary?.stylesheets.find(
    (stylesheet) => stylesheet.cssFilePath === cssFilePath,
  );

  if (!reachabilityRecord) {
    return {
      result: buildSelectorQueryResult({
        selectorQuery: input.selectorQuery,
        outcome: "possible-match",
        status: "unsupported",
        reasons: ["could not determine stylesheet reachability for this selector source"],
        certainty: "unknown",
        dimensions: {
          reachability: "unsupported",
        },
        traces: input.includeTraces
          ? [
              {
                traceId: "selector-reachability:missing-record",
                category: "reachability",
                summary: "could not determine stylesheet reachability for this selector source",
                anchor: input.selectorQuery.source.selectorAnchor,
                children: [],
                metadata: {
                  cssFilePath,
                },
              },
            ]
          : [],
        includeTraces: input.includeTraces,
        reachability: {
          kind: "css-source",
          cssFilePath,
          availability: "unknown",
          contexts: [],
          reasons: ["no reachability record exists for this stylesheet source"],
        },
      }),
      analysisTargets: [],
    };
  }

  if (reachabilityRecord.availability === "unknown") {
    return {
      result: buildSelectorQueryResult({
        selectorQuery: input.selectorQuery,
        outcome: "possible-match",
        status: "unsupported",
        reasons: ["stylesheet reachability is unknown for this selector source"],
        certainty: "unknown",
        dimensions: {
          reachability: "unknown",
        },
        traces: input.includeTraces
          ? [
              {
                traceId: "selector-reachability:unknown",
                category: "reachability",
                summary: "stylesheet reachability is unknown for this selector source",
                anchor: input.selectorQuery.source.selectorAnchor,
                children: reachabilityRecord.traces ?? [],
                metadata: {
                  cssFilePath: reachabilityRecord.cssFilePath,
                },
              },
            ]
          : [],
        includeTraces: input.includeTraces,
        reachability: {
          kind: "css-source",
          cssFilePath: reachabilityRecord.cssFilePath,
          availability: reachabilityRecord.availability,
          contexts: reachabilityRecord.contexts,
          reasons: reachabilityRecord.reasons,
        },
      }),
      analysisTargets: [],
    };
  }

  if (reachabilityRecord.availability === "unavailable") {
    return {
      result: buildSelectorQueryResult({
        selectorQuery: input.selectorQuery,
        outcome: "no-match-under-bounded-analysis",
        status: "resolved",
        reasons: [
          "stylesheet is not reachable from any analyzed source file or propagated render context",
        ],
        certainty: "definite",
        dimensions: {
          structure: "not-found-under-bounded-analysis",
          reachability: "unavailable",
        },
        traces: input.includeTraces
          ? [
              {
                traceId: "selector-reachability:unavailable",
                category: "reachability",
                summary:
                  "stylesheet is not reachable from any analyzed source file or propagated render context",
                anchor: input.selectorQuery.source.selectorAnchor,
                children: reachabilityRecord.traces ?? [],
                metadata: {
                  cssFilePath: reachabilityRecord.cssFilePath,
                },
              },
            ]
          : [],
        includeTraces: input.includeTraces,
        reachability: {
          kind: "css-source",
          cssFilePath: reachabilityRecord.cssFilePath,
          availability: reachabilityRecord.availability,
          contexts: reachabilityRecord.contexts,
          reasons: reachabilityRecord.reasons,
        },
      }),
      analysisTargets: [],
    };
  }

  const analysisTargets = buildReachabilityAnalysisTargets({
    renderModelIndex: input.renderModelIndex,
    contexts: reachabilityRecord.contexts,
  });

  if (cacheKey) {
    input.reachabilityTargetCache.set(cacheKey, analysisTargets);
  }

  return {
    analysisTargets,
  };
}

function buildWholeModelAnalysisTargets(renderModel: RenderModel): SelectorAnalysisTarget[] {
  const elementIds = renderModel.elements.map((element) => element.id);
  return elementIds.length > 0
    ? [
        {
          targetId: "direct-query:whole-render-model",
          elementIds,
          reachabilityAvailability: "definite",
          reachabilityContexts: [],
        },
      ]
    : [];
}

function buildReachabilityAnalysisTargets(input: {
  renderModelIndex: SelectorRenderModelIndex;
  contexts: StylesheetReachabilityContextRecord[];
}): SelectorAnalysisTarget[] {
  const targetByKey = new Map<string, SelectorAnalysisTarget>();

  for (const context of input.contexts) {
    if (!isAvailableContextRecord(context)) {
      continue;
    }

    const elementIds = resolveElementIdsForContext(input.renderModelIndex, context);
    if (elementIds.length === 0) {
      continue;
    }

    const key = elementIds.join(",");
    const existing = targetByKey.get(key);
    if (existing) {
      existing.reachabilityContexts.push(context);
      if (context.availability === "definite") {
        existing.reachabilityAvailability = "definite";
      }
      continue;
    }

    targetByKey.set(key, {
      targetId: `reachability:${targetByKey.size + 1}`,
      elementIds,
      reachabilityAvailability: context.availability,
      reachabilityContexts: [context],
    });
  }

  return [...targetByKey.values()].sort((left, right) =>
    left.targetId.localeCompare(right.targetId),
  );
}

function isAvailableContextRecord(
  context: StylesheetReachabilityContextRecord,
): context is AvailableContextRecord {
  return context.availability === "definite" || context.availability === "possible";
}

function resolveElementIdsForContext(
  index: SelectorRenderModelIndex,
  contextRecord: AvailableContextRecord,
): string[] {
  const context = contextRecord.context;
  if (context.kind === "source-file") {
    return getElementIdsForSourceFile(index, context.filePath);
  }

  if (context.kind === "component" || context.kind === "render-subtree-root") {
    const componentKey = resolveComponentKey(index, context);
    return componentKey ? getElementIdsForComponentKey(index, componentKey) : [];
  }

  const componentKey = resolveComponentKey(index, context);
  if (!componentKey) {
    return [];
  }

  const regionElementIds = getElementIdsForRenderRegion(index, componentKey, context.path);
  return regionElementIds.length > 0
    ? regionElementIds
    : getElementIdsForComponentKey(index, componentKey);
}

function getElementIdsForSourceFile(index: SelectorRenderModelIndex, filePath: string): string[] {
  const normalizedPath = normalizeProjectPath(filePath);
  const componentKeys = index.renderModel.components
    .filter((component) => normalizeProjectPath(component.filePath) === normalizedPath)
    .map((component) => component.componentKey);
  return deduplicateElementIds(
    componentKeys.flatMap((componentKey) => getElementIdsForComponentKey(index, componentKey)),
  );
}

function getElementIdsForComponentKey(
  index: SelectorRenderModelIndex,
  componentKey: string,
): string[] {
  return deduplicateElementIds(
    index.renderModel.elements
      .filter((element) => elementBelongsToRootComponent(index, element.id, componentKey))
      .map((element) => element.id),
  );
}

function getElementIdsForRenderRegion(
  index: SelectorRenderModelIndex,
  componentKey: string,
  contextPath: RenderRegionContext["path"],
): string[] {
  return deduplicateElementIds(
    index.renderModel.elements
      .filter((element) => {
        if (!elementBelongsToRootComponent(index, element.id, componentKey)) {
          return false;
        }

        const renderPath = index.renderModel.indexes.renderPathById.get(element.renderPathId);
        if (!renderPath) {
          return false;
        }

        return pathStartsWith(projectLegacyPath(renderPath.segments), contextPath);
      })
      .map((element) => element.id),
  );
}

function elementBelongsToRootComponent(
  index: SelectorRenderModelIndex,
  elementId: string,
  componentKey: string,
): boolean {
  const element = index.renderModel.indexes.elementById.get(elementId);
  if (!element) {
    return false;
  }

  const renderPath = index.renderModel.indexes.renderPathById.get(element.renderPathId);
  const rootComponentKey = renderPath?.rootComponentNodeId
    ? index.componentKeyByNodeId.get(renderPath.rootComponentNodeId)
    : undefined;
  if (rootComponentKey) {
    return rootComponentKey === componentKey;
  }

  const placementComponentKey = element.placementComponentNodeId
    ? index.componentKeyByNodeId.get(element.placementComponentNodeId)
    : undefined;
  if (placementComponentKey) {
    return placementComponentKey === componentKey;
  }

  const emittingComponentKey = element.emittingComponentNodeId
    ? index.componentKeyByNodeId.get(element.emittingComponentNodeId)
    : undefined;
  return emittingComponentKey === componentKey;
}

function resolveComponentKey(
  index: SelectorRenderModelIndex,
  context: Extract<
    StylesheetReachabilityContextRecord["context"],
    { kind: "component" | "render-subtree-root" | "render-region" }
  >,
): string | undefined {
  if (context.componentKey) {
    return context.componentKey;
  }

  const normalizedPath = normalizeProjectPath(context.filePath);
  return index.renderModel.components.find(
    (component) =>
      normalizeProjectPath(component.filePath) === normalizedPath &&
      component.componentName === context.componentName,
  )?.componentKey;
}

function projectLegacyPath(segments: RenderPathSegment[]): ProjectedRenderPathSegment[] {
  const result: ProjectedRenderPathSegment[] = [{ kind: "root" }];
  for (const segment of segments) {
    if (segment.kind === "child-index") {
      result.push({ kind: "fragment-child", childIndex: segment.index });
      continue;
    }
    if (segment.kind === "conditional-branch") {
      result.push({ kind: "conditional-branch", branch: segment.branch });
      continue;
    }
    if (segment.kind === "repeated-template") {
      result.push({ kind: "repeated-template" });
      continue;
    }
  }
  return result;
}

function pathStartsWith(
  candidate: ProjectedRenderPathSegment[],
  prefix: ProjectedRenderPathSegment[],
): boolean {
  if (prefix.length > candidate.length) {
    return false;
  }

  return prefix.every(
    (segment, index) => serializePathSegment(segment) === serializePathSegment(candidate[index]),
  );
}

function serializePathSegment(segment: ProjectedRenderPathSegment): string {
  if (segment.kind === "fragment-child") {
    return `${segment.kind}:${segment.childIndex ?? ""}`;
  }
  if (segment.kind === "conditional-branch") {
    return `${segment.kind}:${segment.branch ?? ""}`;
  }
  return segment.kind;
}

function deduplicateElementIds(elementIds: string[]): string[] {
  return [...new Set(elementIds)].sort((left, right) => left.localeCompare(right));
}

function normalizeProjectPath(filePath: string): string {
  return filePath.replace(/\\/g, "/");
}
