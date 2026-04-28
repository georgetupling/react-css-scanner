import type { AnalysisTrace } from "../../../types/analysis.js";
import type { EngineSymbol } from "../types.js";

export function createSymbolResolutionTrace(input: {
  traceId: string;
  summary: string;
  anchor?: EngineSymbol["declaration"];
  metadata?: Record<string, unknown>;
  children?: AnalysisTrace[];
}): AnalysisTrace {
  return {
    traceId: input.traceId,
    category: "symbol-resolution",
    summary: input.summary,
    ...(input.anchor ? { anchor: input.anchor } : {}),
    children: [...(input.children ?? [])],
    ...(input.metadata ? { metadata: input.metadata } : {}),
  };
}
