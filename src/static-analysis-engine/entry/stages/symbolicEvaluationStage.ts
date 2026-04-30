import { evaluateSymbolicExpressions } from "../../pipeline/symbolic-evaluation/index.js";
import type { FactGraph } from "../../pipeline/fact-graph/index.js";
import type { SymbolResolutionStageResult, SymbolicEvaluationStageResult } from "./types.js";

export function runSymbolicEvaluationStage(input: {
  graph: FactGraph;
  symbolResolution?: SymbolResolutionStageResult;
  includeTraces?: boolean;
}): SymbolicEvaluationStageResult {
  return evaluateSymbolicExpressions({
    graph: input.graph,
    options: {
      includeTraces: input.includeTraces,
    },
    ...(input.symbolResolution
      ? {
          legacy: {
            symbolResolution: input.symbolResolution,
          },
        }
      : {}),
  });
}
