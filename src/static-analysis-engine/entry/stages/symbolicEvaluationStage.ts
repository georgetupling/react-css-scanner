import { evaluateSymbolicExpressions } from "../../pipeline/symbolic-evaluation/index.js";
import type { FactGraph } from "../../pipeline/fact-graph/index.js";
import type {
  ParsedProjectFile,
  RenderModelStageResult,
  SymbolicEvaluationStageResult,
} from "./types.js";

export function runSymbolicEvaluationStage(input: {
  graph: FactGraph;
  parsedFiles?: ParsedProjectFile[];
  renderModel?: Pick<RenderModelStageResult, "legacyClassExpressionSummaries">;
  includeTraces?: boolean;
}): SymbolicEvaluationStageResult {
  return evaluateSymbolicExpressions({
    graph: input.graph,
    options: {
      includeTraces: input.includeTraces,
    },
    ...(input.parsedFiles || input.renderModel
      ? {
          legacy: {
            ...(input.parsedFiles ? { parsedFiles: input.parsedFiles } : {}),
            ...(input.renderModel
              ? {
                  renderModelClassExpressionSummaries:
                    input.renderModel.legacyClassExpressionSummaries,
                }
              : {}),
          },
        }
      : {}),
  });
}
