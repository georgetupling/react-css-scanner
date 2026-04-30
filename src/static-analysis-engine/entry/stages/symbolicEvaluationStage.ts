import { evaluateSymbolicExpressions } from "../../pipeline/symbolic-evaluation/index.js";
import type { FactGraph } from "../../pipeline/fact-graph/index.js";
import type {
  RenderModelStageResult,
  SymbolResolutionStageResult,
  SymbolicEvaluationStageResult,
} from "./types.js";

export function runSymbolicEvaluationStage(input: {
  graph: FactGraph;
  renderModel?: Pick<RenderModelStageResult, "legacyClassExpressionSummaries">;
  symbolResolution?: SymbolResolutionStageResult;
  includeTraces?: boolean;
}): SymbolicEvaluationStageResult {
  return evaluateSymbolicExpressions({
    graph: input.graph,
    options: {
      includeTraces: input.includeTraces,
    },
    ...(input.renderModel || input.symbolResolution
      ? {
          legacy: {
            ...(input.renderModel
              ? {
                  renderModelClassExpressionSummaries:
                    input.renderModel.legacyClassExpressionSummaries,
                }
              : {}),
            ...(input.symbolResolution ? { symbolResolution: input.symbolResolution } : {}),
          },
        }
      : {}),
  });
}
