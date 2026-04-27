import type { AnalysisTrace } from "../../types/analysis.js";
import type { SourceAnchor } from "../../types/core.js";
import type {
  ReachabilityDerivation,
  StylesheetReachabilityContextRecord,
  StylesheetReachabilityRecord,
} from "./types.js";
import { compareDerivations, serializeContextKey, serializeDerivation } from "./sortAndKeys.js";

export function addContextRecord(
  contextRecordsByKey: Map<string, StylesheetReachabilityContextRecord>,
  contextRecord: Omit<StylesheetReachabilityContextRecord, "traces"> & {
    traces?: AnalysisTrace[];
  },
  includeTraces = true,
): boolean {
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
    return true;
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
  const nextAvailability = mergeAvailability(
    existingContextRecord.availability,
    normalizedContextRecord.availability,
  );
  const nextReasons = [...mergedReasons].sort((left, right) => left.localeCompare(right));
  const nextDerivations = [...derivationsByKey.values()].sort(compareDerivations);
  const nextTraces = includeTraces
    ? mergeTraces(existingContextRecord.traces, normalizedContextRecord.traces)
    : [];
  if (
    existingContextRecord.availability === nextAvailability &&
    stringArraysEqual(existingContextRecord.reasons, nextReasons) &&
    derivationArraysEqual(existingContextRecord.derivations, nextDerivations) &&
    traceArraysEqual(existingContextRecord.traces, nextTraces)
  ) {
    return false;
  }

  contextRecordsByKey.set(contextKey, {
    ...existingContextRecord,
    availability: nextAvailability,
    reasons: nextReasons,
    derivations: nextDerivations,
    traces: nextTraces,
  });
  return true;
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

export function withStylesheetRecordTraces(
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
  anchor?: SourceAnchor;
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
): SourceAnchor | undefined {
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

function stringArraysEqual(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function derivationArraysEqual(
  left: ReachabilityDerivation[],
  right: ReachabilityDerivation[],
): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => serializeDerivation(value) === serializeDerivation(right[index]))
  );
}

function traceArraysEqual(left: AnalysisTrace[], right: AnalysisTrace[]): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => serializeTraceKey(value) === serializeTraceKey(right[index]))
  );
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

export function getAvailabilityFromContexts(
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
