import type { AnalysisTrace } from "../../../types/analysis.js";
import type { SourceAnchor } from "../../../types/core.js";

export function createSymbolicEvaluationTrace(input: {
  traceId: string;
  summary: string;
  anchor?: SourceAnchor;
  children?: AnalysisTrace[];
  metadata?: Record<string, unknown>;
}): AnalysisTrace {
  return {
    traceId: input.traceId,
    category: "value-evaluation",
    summary: input.summary,
    ...(input.anchor ? { anchor: input.anchor } : {}),
    children: input.children ?? [],
    ...(input.metadata ? { metadata: input.metadata } : {}),
  };
}

export function traceList(input: {
  includeTraces?: boolean;
  trace: AnalysisTrace;
}): AnalysisTrace[] {
  return input.includeTraces ? [input.trace] : [];
}
