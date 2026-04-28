import type { ParsedSelectorQuery, SelectorQueryResult } from "./types.js";
import type { SelectorAnalysisTarget } from "./types.js";
import type { AnalysisTrace } from "../../types/analysis.js";

export function attachMatchedReachability(input: {
  selectorQuery: ParsedSelectorQuery;
  result: SelectorQueryResult;
  matchedTargets: SelectorAnalysisTarget[];
  includeTraces?: boolean;
}): SelectorQueryResult {
  if (input.selectorQuery.source.kind !== "css-source") {
    return input.result;
  }

  const includeTraces = input.includeTraces ?? true;
  const cssFilePath = input.selectorQuery.source.selectorAnchor?.filePath;
  const matchedContextsByKey = new Map<
    string,
    SelectorAnalysisTarget["reachabilityContexts"][number]
  >();
  for (const target of input.matchedTargets) {
    for (const contextRecord of target.reachabilityContexts) {
      matchedContextsByKey.set(serializeContextRecord(contextRecord), contextRecord);
    }
  }

  const availability =
    input.result.outcome === "match"
      ? "definite"
      : input.matchedTargets.some((target) => target.reachabilityAvailability === "possible")
        ? "possible"
        : "definite";
  const reachabilityTrace: AnalysisTrace[] = includeTraces
    ? [
        {
          traceId: `selector-reachability:${availability}`,
          category: "reachability",
          summary:
            input.result.outcome === "match"
              ? "selector matched within stylesheet-reachable render contexts"
              : "selector only matched within possible stylesheet-reachable render contexts",
          anchor:
            input.selectorQuery.source.kind === "css-source"
              ? input.selectorQuery.source.selectorAnchor
              : undefined,
          children: mergeTraces(
            [...matchedContextsByKey.values()].flatMap((context) => context.traces ?? []),
          ),
          metadata: {
            cssFilePath,
            matchedContextCount: matchedContextsByKey.size,
            availability,
          },
        },
      ]
    : [];

  return {
    ...input.result,
    decision: {
      ...input.result.decision,
      dimensions: {
        ...input.result.decision.dimensions,
        reachability: availability,
      },
      traces: includeTraces ? [...input.result.decision.traces, ...reachabilityTrace] : [],
    },
    reachability: {
      kind: "css-source",
      cssFilePath,
      availability,
      contexts: [...matchedContextsByKey.values()],
      matchedContexts: [...matchedContextsByKey.values()],
      reasons: [
        input.result.outcome === "match"
          ? "selector matched within stylesheet-reachable render contexts"
          : "selector only matched within possible stylesheet-reachable render contexts",
      ],
    },
  };
}

function serializeContextRecord(
  contextRecord: SelectorAnalysisTarget["reachabilityContexts"][number],
): string {
  const context = contextRecord.context;
  if (context.kind === "source-file") {
    return `${context.kind}:${context.filePath}:${contextRecord.availability}`;
  }

  if (context.kind === "component") {
    return `${context.kind}:${context.componentKey ?? ""}:${context.filePath}:${context.componentName}:${contextRecord.availability}`;
  }

  if (context.kind === "render-subtree-root") {
    return [
      context.kind,
      context.filePath,
      context.componentKey ?? "",
      context.componentName ?? "",
      context.rootAnchor.startLine,
      context.rootAnchor.startColumn,
      context.rootAnchor.endLine ?? "",
      context.rootAnchor.endColumn ?? "",
      contextRecord.availability,
    ].join(":");
  }

  return [
    context.kind,
    context.filePath,
    context.componentKey ?? "",
    context.componentName ?? "",
    context.regionKind,
    context.sourceAnchor.startLine,
    context.sourceAnchor.startColumn,
    context.sourceAnchor.endLine ?? "",
    context.sourceAnchor.endColumn ?? "",
    contextRecord.availability,
  ].join(":");
}

function mergeTraces(traces: AnalysisTrace[]): AnalysisTrace[] {
  const tracesByKey = new Map<string, AnalysisTrace>();
  for (const trace of traces) {
    tracesByKey.set(serializeTraceKey(trace), trace);
  }

  return [...tracesByKey.values()];
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
