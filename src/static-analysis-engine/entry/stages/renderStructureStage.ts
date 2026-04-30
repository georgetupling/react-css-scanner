import { buildRenderStructure } from "../../pipeline/render-structure/index.js";
import type {
  FactGraphStageResult,
  RenderStructureStageResult,
  SymbolicEvaluationStageResult,
} from "./types.js";

export function runRenderStructureStage(input: {
  factGraph: FactGraphStageResult;
  symbolicEvaluation: SymbolicEvaluationStageResult;
  includeTraces?: boolean;
}): RenderStructureStageResult {
  return buildRenderStructure({
    graph: input.factGraph.graph,
    symbolicEvaluation: input.symbolicEvaluation,
    options: {
      includeTraces: input.includeTraces,
    },
  });
}
