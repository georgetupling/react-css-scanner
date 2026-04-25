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

export function analyzeSelectorQueries(input: {
  selectorQueries: ParsedSelectorQuery[];
  renderSubtrees: RenderSubtree[];
  reachabilitySummary?: ReachabilitySummary;
}): SelectorQueryResult[] {
  return input.selectorQueries.map((selectorQuery) =>
    analyzeSelectorQuery({
      selectorQuery,
      renderSubtrees: input.renderSubtrees,
      reachabilitySummary: input.reachabilitySummary,
    }),
  );
}

function analyzeSelectorQuery(input: {
  selectorQuery: ParsedSelectorQuery;
  renderSubtrees: RenderSubtree[];
  reachabilitySummary?: ReachabilitySummary;
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
      traces: [
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
      ],
    });
  }

  if (constraint.kind === "same-node-class-conjunction") {
    return analyzeSameNodeClassConjunction({
      selectorQuery: input.selectorQuery,
      constraint,
      analysisTargets,
    });
  }

  if (constraint.kind === "parent-child") {
    return analyzeParentChildConstraint({
      selectorQuery: input.selectorQuery,
      constraint,
      analysisTargets,
    });
  }

  if (constraint.kind === "sibling") {
    return analyzeSiblingConstraint({
      selectorQuery: input.selectorQuery,
      constraint,
      analysisTargets,
    });
  }

  return analyzeAncestorDescendantConstraint({
    selectorQuery: input.selectorQuery,
    constraint,
    analysisTargets,
  });
}

function resolveQueryReachability(input: {
  selectorQuery: ParsedSelectorQuery;
  renderSubtrees: RenderSubtree[];
  reachabilitySummary?: ReachabilitySummary;
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
        traces: [
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
        ],
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
        traces: [
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
        ],
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
        traces: [
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
        ],
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

  return {
    analysisTargets: input.renderSubtrees
      .flatMap((subtree) => resolveReachableAnalysisSubtrees(subtree, reachabilityRecord))
      .map((analysisSubtree) => ({
        renderSubtree: analysisSubtree.subtree,
        reachabilityAvailability: analysisSubtree.availability,
        reachabilityContexts: analysisSubtree.contexts,
      })),
  };
}

function resolveReachableAnalysisSubtrees(
  subtree: RenderSubtree,
  reachabilityRecord: ReachabilitySummary["stylesheets"][number],
): ReachableAnalysisSubtree[] {
  const normalizedFilePath = subtree.sourceAnchor.filePath.replace(/\\/g, "/");
  const availableContextRecords = reachabilityRecord.contexts.filter(
    (contextRecord) =>
      contextRecord.availability === "definite" || contextRecord.availability === "possible",
  ) as AvailableContextRecord[];
  const matchingRenderRegionContexts = availableContextRecords.filter(
    (contextRecord) =>
      contextRecord.context.kind === "render-region" &&
      contextRecord.context.filePath === normalizedFilePath &&
      contextRecord.context.componentName === subtree.componentName,
  ) as RenderRegionContextRecord[];
  const hasSourceFileContext = availableContextRecords.some(
    (contextRecord) =>
      contextRecord.context.kind === "source-file" &&
      contextRecord.context.filePath === normalizedFilePath,
  );
  const matchingSubtreeRootContexts = availableContextRecords.filter(
    (contextRecord) =>
      contextRecord.context.kind === "render-subtree-root" &&
      contextRecord.context.filePath === normalizedFilePath &&
      contextRecord.context.componentName === subtree.componentName &&
      contextRecord.context.rootAnchor.startLine === subtree.root.sourceAnchor.startLine &&
      contextRecord.context.rootAnchor.startColumn === subtree.root.sourceAnchor.startColumn &&
      (contextRecord.context.rootAnchor.endLine ?? 0) ===
        (subtree.root.sourceAnchor.endLine ?? 0) &&
      (contextRecord.context.rootAnchor.endColumn ?? 0) ===
        (subtree.root.sourceAnchor.endColumn ?? 0),
  );
  const matchingComponentContexts = availableContextRecords.filter(
    (contextRecord) =>
      contextRecord.context.kind === "component" &&
      contextRecord.context.filePath === normalizedFilePath &&
      contextRecord.context.componentName === subtree.componentName,
  );
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
          ? availableContextRecords.filter(
              (contextRecord) =>
                contextRecord.context.kind === "source-file" &&
                contextRecord.context.filePath === normalizedFilePath,
            )
          : [...matchingSubtreeRootContexts, ...matchingComponentContexts],
      },
      ...narrowedSubtrees,
    ]);
  }

  return deduplicateAnalysisSubtrees(narrowedSubtrees);
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
