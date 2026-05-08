import type { AnalysisTrace } from "../../../types/analysis.js";

export function mergeTraces(traces: AnalysisTrace[]): AnalysisTrace[] {
  const tracesByKey = new Map<string, AnalysisTrace>();
  for (const trace of traces) {
    tracesByKey.set(serializeTraceKey(trace), trace);
  }

  return [...tracesByKey.values()].sort((left, right) => left.traceId.localeCompare(right.traceId));
}

const traceKeyCache = new WeakMap<AnalysisTrace, string>();

export function serializeTraceKey(trace: AnalysisTrace): string {
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
