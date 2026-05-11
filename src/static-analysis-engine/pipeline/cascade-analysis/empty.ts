import { buildCascadeAnalysisIndexes } from "./indexes.js";
import type { CascadeAnalysisResult } from "./types.js";

export function createEmptyCascadeAnalysisResult(): CascadeAnalysisResult {
  const declarations: CascadeAnalysisResult["declarations"] = [];
  const conditionSets: CascadeAnalysisResult["conditionSets"] = [];
  const candidates: CascadeAnalysisResult["candidates"] = [];
  const outcomes: CascadeAnalysisResult["outcomes"] = [];
  const computedProperties: CascadeAnalysisResult["computedProperties"] = [];
  const diagnostics: CascadeAnalysisResult["diagnostics"] = [];

  return {
    declarations,
    conditionSets,
    candidates,
    outcomes,
    computedProperties,
    diagnostics,
    indexes: buildCascadeAnalysisIndexes({
      declarations,
      conditionSets,
      candidates,
      outcomes,
      computedProperties,
      diagnostics,
    }),
    meta: {
      generatedAtStage: "cascade-analysis",
      declarationCount: 0,
      conditionSetCount: 0,
      candidateCount: 0,
      outcomeCount: 0,
      computedPropertyCount: 0,
      diagnosticCount: 0,
    },
  };
}
