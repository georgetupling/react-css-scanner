import type {
  RenderNode,
  RenderRegionPathSegment,
  RenderSubtree,
} from "../render-model/render-ir/types.js";
import type {
  ReachabilitySummary,
  StylesheetReachabilityContextRecord,
} from "../reachability/types.js";
import type { ParsedSelectorQuery, SelectorAnalysisTarget, SelectorQueryResult } from "./types.js";
import { buildSelectorQueryResult } from "./resultUtils.js";
import { analyzeAncestorDescendantConstraint } from "./adapters/ancestorDescendant.js";
import { analyzeParentChildConstraint } from "./adapters/parentChild.js";
import { analyzeSameNodeClassConjunction } from "./adapters/sameNodeConjunction.js";
import { analyzeSiblingConstraint } from "./adapters/sibling.js";

type ReachableAnalysisSubtree = {
  subtree: RenderSubtree;
  availability: "definite" | "possible";
  contexts: ReachabilitySummary["stylesheets"][number]["contexts"];
};

type AvailableContextRecord = StylesheetReachabilityContextRecord & {
  availability: "definite" | "possible";
};

type RenderRegionContextRecord = AvailableContextRecord & {
  context: Extract<StylesheetReachabilityContextRecord["context"], { kind: "render-region" }>;
};

type ReachabilityContextIndex = {
  sourceFileContextsByFilePath: Map<string, AvailableContextRecord[]>;
  componentContextsByComponentKey: Map<string, AvailableContextRecord[]>;
  subtreeRootContextsByRootKey: Map<string, AvailableContextRecord[]>;
  renderRegionContextsByComponentKey: Map<string, RenderRegionContextRecord[]>;
};

export function analyzeSelectorQueries(input: {
  selectorQueries: ParsedSelectorQuery[];
  renderSubtrees: RenderSubtree[];
  reachabilitySummary?: ReachabilitySummary;
  includeTraces?: boolean;
}): SelectorQueryResult[] {
  const includeTraces = input.includeTraces ?? true;
  const reachabilityTargetCache = new Map<string, SelectorAnalysisTarget[]>();
  return input.selectorQueries.map((selectorQuery) =>
    analyzeSelectorQuery({
      selectorQuery,
      renderSubtrees: input.renderSubtrees,
      reachabilitySummary: input.reachabilitySummary,
      reachabilityTargetCache,
      includeTraces,
    }),
  );
}

function analyzeSelectorQuery(input: {
  selectorQuery: ParsedSelectorQuery;
  renderSubtrees: RenderSubtree[];
  reachabilitySummary?: ReachabilitySummary;
  reachabilityTargetCache: Map<string, SelectorAnalysisTarget[]>;
  includeTraces: boolean;
}): SelectorQueryResult {
  const { constraint } = input.selectorQuery;
  let analysisTargets: SelectorAnalysisTarget[] = input.renderSubtrees.map((renderSubtree) => ({
    renderSubtree,
    reachabilityAvailability: "definite",
    reachabilityContexts: [],
  }));

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
      includeTraces: input.includeTraces,
    });
  }

  if (constraint.kind === "parent-child") {
    return analyzeParentChildConstraint({
      selectorQuery: input.selectorQuery,
      constraint,
      analysisTargets,
      includeTraces: input.includeTraces,
    });
  }

  if (constraint.kind === "sibling") {
    return analyzeSiblingConstraint({
      selectorQuery: input.selectorQuery,
      constraint,
      analysisTargets,
      includeTraces: input.includeTraces,
    });
  }

  return analyzeAncestorDescendantConstraint({
    selectorQuery: input.selectorQuery,
    constraint,
    analysisTargets,
    includeTraces: input.includeTraces,
  });
}

function resolveQueryReachability(input: {
  selectorQuery: ParsedSelectorQuery;
  renderSubtrees: RenderSubtree[];
  reachabilitySummary?: ReachabilitySummary;
  reachabilityTargetCache: Map<string, SelectorAnalysisTarget[]>;
  includeTraces: boolean;
}):
  | {
      result: SelectorQueryResult;
      analysisTargets: SelectorAnalysisTarget[];
    }
  | {
      result?: undefined;
      analysisTargets: SelectorAnalysisTarget[];
    } {
  if (input.selectorQuery.source.kind !== "css-source") {
    return {
      analysisTargets: input.renderSubtrees.map((renderSubtree) => ({
        renderSubtree,
        reachabilityAvailability: "definite",
        reachabilityContexts: [],
      })),
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

  const reachabilityContextIndex = buildReachabilityContextIndex(reachabilityRecord.contexts);
  const analysisTargets = input.renderSubtrees
    .flatMap((subtree) => resolveReachableAnalysisSubtrees(subtree, reachabilityContextIndex))
    .map((analysisSubtree) => ({
      renderSubtree: analysisSubtree.subtree,
      reachabilityAvailability: analysisSubtree.availability,
      reachabilityContexts: analysisSubtree.contexts,
    }));

  if (cacheKey) {
    input.reachabilityTargetCache.set(cacheKey, analysisTargets);
  }

  return {
    analysisTargets,
  };
}

function resolveReachableAnalysisSubtrees(
  subtree: RenderSubtree,
  reachabilityContextIndex: ReachabilityContextIndex,
): ReachableAnalysisSubtree[] {
  const normalizedFilePath = subtree.sourceAnchor.filePath.replace(/\\/g, "/");
  const componentKey = createComponentContextKey(normalizedFilePath, subtree.componentName);
  const matchingRenderRegionContexts =
    reachabilityContextIndex.renderRegionContextsByComponentKey.get(componentKey) ?? [];
  const sourceFileContexts =
    reachabilityContextIndex.sourceFileContextsByFilePath.get(normalizedFilePath) ?? [];
  const matchingSubtreeRootContexts =
    reachabilityContextIndex.subtreeRootContextsByRootKey.get(
      createSubtreeRootContextKey({
        filePath: normalizedFilePath,
        componentName: subtree.componentName,
        startLine: subtree.root.sourceAnchor.startLine,
        startColumn: subtree.root.sourceAnchor.startColumn,
        endLine: subtree.root.sourceAnchor.endLine,
        endColumn: subtree.root.sourceAnchor.endColumn,
      }),
    ) ?? [];
  const matchingComponentContexts =
    reachabilityContextIndex.componentContextsByComponentKey.get(componentKey) ?? [];
  const hasSourceFileContext = sourceFileContexts.length > 0;
  const hasSubtreeRootContext = matchingSubtreeRootContexts.length > 0;
  const hasComponentContext = matchingComponentContexts.length > 0;

  const narrowedSubtrees: ReachableAnalysisSubtree[] = [];
  for (const contextRecord of matchingRenderRegionContexts) {
    const root = resolveRenderRegionNode({
      root: subtree.root,
      path: contextRecord.context.path,
    });
    if (!root) {
      continue;
    }

    narrowedSubtrees.push({
      subtree: {
        ...subtree,
        root,
      },
      availability: contextRecord.availability,
      contexts: [contextRecord],
    });
  }

  if (narrowedSubtrees.length > 0 && !hasSourceFileContext) {
    return deduplicateAnalysisSubtrees(narrowedSubtrees);
  }

  if (hasSourceFileContext || hasSubtreeRootContext || hasComponentContext) {
    const wholeSubtreeAvailability = hasSourceFileContext
      ? "definite"
      : [...matchingSubtreeRootContexts, ...matchingComponentContexts].some(
            (contextRecord) => contextRecord.availability === "definite",
          )
        ? "definite"
        : "possible";

    return deduplicateAnalysisSubtrees([
      {
        subtree,
        availability: wholeSubtreeAvailability,
        contexts: hasSourceFileContext
          ? sourceFileContexts
          : [...matchingSubtreeRootContexts, ...matchingComponentContexts],
      },
      ...narrowedSubtrees,
    ]);
  }

  return deduplicateAnalysisSubtrees(narrowedSubtrees);
}

function buildReachabilityContextIndex(
  contextRecords: StylesheetReachabilityContextRecord[],
): ReachabilityContextIndex {
  const index: ReachabilityContextIndex = {
    sourceFileContextsByFilePath: new Map(),
    componentContextsByComponentKey: new Map(),
    subtreeRootContextsByRootKey: new Map(),
    renderRegionContextsByComponentKey: new Map(),
  };

  for (const contextRecord of contextRecords) {
    if (contextRecord.availability !== "definite" && contextRecord.availability !== "possible") {
      continue;
    }

    const availableContextRecord = contextRecord as AvailableContextRecord;
    const context = contextRecord.context;
    if (context.kind === "source-file") {
      appendToMap(
        index.sourceFileContextsByFilePath,
        normalizeProjectPath(context.filePath),
        availableContextRecord,
      );
      continue;
    }

    if (context.kind === "component") {
      appendToMap(
        index.componentContextsByComponentKey,
        createComponentContextKey(context.filePath, context.componentName),
        availableContextRecord,
      );
      continue;
    }

    if (context.kind === "render-subtree-root") {
      appendToMap(
        index.subtreeRootContextsByRootKey,
        createSubtreeRootContextKey({
          filePath: context.filePath,
          componentName: context.componentName,
          startLine: context.rootAnchor.startLine,
          startColumn: context.rootAnchor.startColumn,
          endLine: context.rootAnchor.endLine,
          endColumn: context.rootAnchor.endColumn,
        }),
        availableContextRecord,
      );
      continue;
    }

    appendToMap(
      index.renderRegionContextsByComponentKey,
      createComponentContextKey(context.filePath, context.componentName),
      availableContextRecord as RenderRegionContextRecord,
    );
  }

  return index;
}

function appendToMap<TKey, TValue>(map: Map<TKey, TValue[]>, key: TKey, value: TValue): void {
  const values = map.get(key);
  if (values) {
    values.push(value);
    return;
  }

  map.set(key, [value]);
}

function createComponentContextKey(filePath: string, componentName?: string): string {
  return [normalizeProjectPath(filePath), componentName ?? ""].join(":");
}

function createSubtreeRootContextKey(input: {
  filePath: string;
  componentName?: string;
  startLine: number;
  startColumn: number;
  endLine?: number;
  endColumn?: number;
}): string {
  return [
    normalizeProjectPath(input.filePath),
    input.componentName ?? "",
    input.startLine,
    input.startColumn,
    input.endLine ?? 0,
    input.endColumn ?? 0,
  ].join(":");
}

function resolveRenderRegionNode(input: {
  root: RenderNode;
  path: RenderRegionPathSegment[];
}): RenderNode | undefined {
  let current: RenderNode | undefined = input.root;

  for (const [segmentIndex, segment] of input.path.entries()) {
    if (segment.kind === "root") {
      if (segmentIndex !== 0) {
        return undefined;
      }
      continue;
    }

    if (!current) {
      return undefined;
    }

    if (segment.kind === "fragment-child") {
      if (current.kind !== "element" && current.kind !== "fragment") {
        return undefined;
      }

      current = current.children[segment.childIndex];
      continue;
    }

    if (segment.kind === "conditional-branch") {
      if (current.kind !== "conditional") {
        return undefined;
      }

      current = segment.branch === "when-true" ? current.whenTrue : current.whenFalse;
      continue;
    }

    if (current.kind !== "repeated-region") {
      return undefined;
    }

    current = current.template;
  }

  return current;
}

function deduplicateAnalysisSubtrees(
  analysisSubtrees: ReachableAnalysisSubtree[],
): ReachableAnalysisSubtree[] {
  const deduplicated = new Map<string, ReachableAnalysisSubtree>();

  for (const analysisSubtree of analysisSubtrees) {
    const key = [
      analysisSubtree.subtree.sourceAnchor.filePath.replace(/\\/g, "/"),
      analysisSubtree.subtree.componentName ?? "",
      analysisSubtree.subtree.root.sourceAnchor.startLine,
      analysisSubtree.subtree.root.sourceAnchor.startColumn,
      analysisSubtree.subtree.root.sourceAnchor.endLine ?? "",
      analysisSubtree.subtree.root.sourceAnchor.endColumn ?? "",
    ].join(":");
    const existing = deduplicated.get(key);

    if (!existing || existing.availability === "possible") {
      deduplicated.set(key, analysisSubtree);
    }
  }

  return [...deduplicated.values()];
}

function normalizeProjectPath(filePath: string): string {
  return filePath.replace(/\\/g, "/");
}
